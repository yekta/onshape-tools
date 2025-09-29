// app/api/onshape/export/route.ts
import { type NextRequest, NextResponse } from "next/server";
import JSZip from "jszip";
import { ConfigOption, ExportInput } from "@/components/types";

// ---------------- Utilities ----------------

function cartesianProduct<T>(arrays: T[][]): T[][] {
  return arrays.reduce<T[][]>(
    (acc, arr) => acc.flatMap((prev) => arr.map((val) => [...prev, val])),
    [[]]
  );
}

function buildConfigPairs(options: ConfigOption[], combo: (string | number)[]) {
  return options.map((opt, i) => ({
    // IMPORTANT: opt.key must be the Onshape configuration parameterId
    parameterId: String(opt.key),
    parameterName: String(opt.keyDisplay ?? opt.key),
    // For enums, value must be the "option" token (e.g. "_500_mm"), not the display.
    // For numeric/measure, pass a string with unit text (e.g. "50 mm").
    parameterValue:
      typeof combo[i] === "number"
        ? String(combo[i]) + (opt.unit ? ` ${opt.unit}` : "")
        : String(combo[i]),
    parameterBareValue: String(combo[i]),
  }));
}

function humanConfigTag(
  pairs: { parameterName: string; parameterBareValue: string }[]
) {
  if (!pairs.length) return "";
  return pairs
    .map(
      ({ parameterName, parameterBareValue }) =>
        `${parameterName} = ${parameterBareValue}`
    )
    .join(" | ");
}

function getBaseFileName({
  elementName,
  partName,
  combineParts,
}: {
  documentId: string;
  elementId: string;
  elementName: string;
  partId: string;
  partName: string;
  combineParts: boolean;
}) {
  return combineParts
    ? `${elementName} - Combined`
    : `${elementName} - ${partName}`;
}

function extForFormat(fmt: string) {
  const f = fmt.toLowerCase();
  if (f === "solidworks") return "sldprt"; // translator returns a zip often
  if (f === "parasolid") return "x_t";
  if (f === "iges") return "igs";
  if (f === "step") return "step";
  return f;
}

function isZipPayload(contentType: string | null, buffer: ArrayBuffer) {
  const type = (contentType || "").toLowerCase();
  if (type.includes("zip")) return true;
  const u8 = new Uint8Array(buffer);
  return u8.length >= 2 && u8[0] === 0x50 && u8[1] === 0x4b; // "PK"
}

function normalizeName(s: string) {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "");
}

async function pickZipEntryForPart(
  zip: JSZip,
  opts: { extCandidates: string[]; partName?: string; elementName?: string }
): Promise<JSZip.JSZipObject | null> {
  const entries = Object.values(zip.files).filter((f) => !f.dir);
  if (entries.length === 0) return null;

  const byExt = entries.filter((f) => {
    const name = f.name.split("/").pop() || f.name;
    return opts.extCandidates.some((ext) =>
      name.toLowerCase().endsWith(`.${ext.toLowerCase()}`)
    );
  });

  if (byExt.length === 1) return byExt[0];
  if (byExt.length === 0) {
    if (entries.length === 1) return entries[0];
    return null;
  }

  const normPart = normalizeName(opts.partName ?? "");
  const normElem = normalizeName(opts.elementName ?? "");
  const expectedPrefix =
    opts.elementName && opts.partName
      ? normalizeName(`${opts.elementName} - ${opts.partName}`)
      : "";

  const exact = byExt.find((f) =>
    normalizeName(f.name.split("/").pop() || f.name).startsWith(expectedPrefix)
  );
  if (exact) return exact;

  if (normPart) {
    const containsPart = byExt.find((f) =>
      normalizeName(f.name.split("/").pop() || f.name).includes(normPart)
    );
    if (containsPart) return containsPart;
  }

  if (normElem) {
    const containsElem = byExt.find((f) =>
      normalizeName(f.name.split("/").pop() || f.name).includes(normElem)
    );
    if (containsElem) return containsElem;
  }

  return byExt[0];
}

// ---------------- Onshape helpers ----------------

async function getDefaultWorkspaceId(documentId: string, authHeader: string) {
  const r = await fetch(
    `https://cad.onshape.com/api/v6/documents/${documentId}`,
    {
      headers: { Authorization: authHeader, Accept: "application/json" },
    }
  );
  if (!r.ok)
    throw new Error(`Failed to get document info: ${r.status} ${r.statusText}`);
  const j = await r.json();
  return j.defaultWorkspace?.id as string | undefined;
}

/**
 * Encode a configuration with Onshape's official endpoint.
 * Returns:
 *  - encodedId: use in async export request bodies (STEP/SolidWorks/translations)
 *  - queryParam: e.g. "configuration=List_...%3D_500_mm" (use as query in STL/Parasolid)
 */
async function encodeConfiguration(
  documentId: string,
  elementId: string,
  authHeader: string,
  pairs: { parameterId: string; parameterValue: string }[]
): Promise<{ encodedId?: string; queryParam?: string }> {
  if (!pairs.length) return {};
  const r = await fetch(
    `https://cad.onshape.com/api/v6/elements/d/${documentId}/e/${elementId}/configurationencodings`,
    {
      method: "POST",
      headers: {
        Authorization: authHeader,
        Accept: "application/json;charset=UTF-8; qs=0.09",
        "Content-Type": "application/json;charset=UTF-8; qs=0.09",
      },
      body: JSON.stringify({ parameters: pairs }),
    }
  );
  if (!r.ok) {
    const t = await r.text();
    throw new Error(
      `Failed to encode configuration: ${r.status} ${r.statusText} :: ${t}`
    );
  }
  return (await r.json()) as { encodedId: string; queryParam: string };
}

/**
 * Get parts for a Part Studio under a given configuration (queryParam form).
 * Used to resolve the correct configured partId by name.
 */
async function listPartsForConfiguration(params: {
  documentId: string;
  workspaceId: string;
  elementId: string;
  queryParam?: string; // "configuration=..."
  authHeader: string;
}) {
  const { documentId, workspaceId, elementId, queryParam, authHeader } = params;
  const url =
    `https://cad.onshape.com/api/v6/parts/d/${documentId}/w/${workspaceId}?elementId=${elementId}` +
    (queryParam ? `&${queryParam}` : "");
  const r = await fetch(url, {
    headers: { Authorization: authHeader, Accept: "application/json" },
  });
  if (!r.ok)
    throw new Error(`Failed to get parts list: ${r.status} ${r.statusText}`);
  return (await r.json()) as any[];
}

// ---------------- Route ----------------

export async function POST(request: NextRequest) {
  try {
    const authHeader = request.headers.get("authorization");
    if (!authHeader) {
      return NextResponse.json(
        { error: "Missing authorization header" },
        { status: 401 }
      );
    }

    const body: ExportInput = await request.json();
    const {
      documentId,
      elementId,
      elementName,
      partId, // original/selected id (may not match configured)
      partName,
      formats,
      configOptions,
      combineParts = false,
    } = body || {};

    if (!documentId || !elementId || !formats || !Array.isArray(formats)) {
      return NextResponse.json(
        {
          error:
            "Missing required parameters: documentId, elementId, formats[]",
        },
        { status: 400 }
      );
    }
    if (!combineParts && !partId && !partName) {
      return NextResponse.json(
        { error: "partId or partName is required when combineParts is false" },
        { status: 400 }
      );
    }

    const workspaceId = await getDefaultWorkspaceId(documentId, authHeader);
    if (!workspaceId) {
      return NextResponse.json(
        { error: "No default workspace found" },
        { status: 400 }
      );
    }

    // Build configuration combinations
    const options: ConfigOption[] = Array.isArray(configOptions)
      ? configOptions
      : [];
    const hasConfig = options.length > 0;
    const valueArrays = hasConfig ? options.map((o) => o.values) : [];
    const combos = hasConfig ? cartesianProduct(valueArrays) : [[]];

    const zip = new JSZip();

    const STL_DEFAULTS = {
      mode: "binary",
      units: "millimeter",
      scale: 1,
      angleTolerance: "0.04363323129985824",
      chordTolerance: "0.06",
      minFacetWidth: "0.0254",
    } as const;

    for (const combo of combos) {
      const configPairs = hasConfig ? buildConfigPairs(options, combo) : [];
      const configTag = configPairs.length
        ? humanConfigTag(
            configPairs.map(({ parameterName, parameterBareValue }) => ({
              parameterName,
              parameterBareValue,
            }))
          )
        : "";

      // Encode once per combination
      const { encodedId, queryParam } =
        configPairs.length > 0
          ? await encodeConfiguration(
              documentId,
              elementId,
              authHeader,
              configPairs.map(({ parameterId, parameterValue }) => ({
                parameterId,
                parameterValue,
              }))
            )
          : {};

      for (const format of formats) {
        const fmt = String(format).toUpperCase();

        // ---------- STL (synchronous, uses query param for configuration) ----------
        if (fmt === "STL") {
          const endpoint = combineParts
            ? `https://cad.onshape.com/api/v6/partstudios/d/${documentId}/w/${workspaceId}/e/${elementId}/stl`
            : `https://cad.onshape.com/api/v6/parts/d/${documentId}/w/${workspaceId}/e/${elementId}/partid/${encodeURIComponent(
                partId || ""
              )}/stl`;

          const query: string[] = [];
          if (queryParam) query.push(queryParam); // configuration=...
          query.push(`mode=${STL_DEFAULTS.mode}`);
          query.push(`units=${STL_DEFAULTS.units}`);
          query.push(`scale=${STL_DEFAULTS.scale}`);
          query.push(`angleTolerance=${STL_DEFAULTS.angleTolerance}`);
          query.push(`chordTolerance=${STL_DEFAULTS.chordTolerance}`);
          query.push(`minFacetWidth=${STL_DEFAULTS.minFacetWidth}`);
          if (combineParts) query.push(`grouping=true`);

          const stlUrl = `${endpoint}?${query.join("&")}`;
          const stlResponse = await fetch(stlUrl, {
            headers: {
              Authorization: authHeader,
              Accept: "application/vnd.onshape.v1+octet-stream",
            },
            redirect: "manual",
          });

          let fileBuffer: ArrayBuffer | null = null;
          let contentType = stlResponse.headers.get("content-type") || "";
          if (stlResponse.status === 307) {
            const redirectUrl = stlResponse.headers.get("location");
            if (!redirectUrl) {
              return NextResponse.json(
                { error: "No redirect URL for STL" },
                { status: 500 }
              );
            }
            const redirectResp = await fetch(redirectUrl, {
              headers: { Authorization: authHeader },
            });
            if (!redirectResp.ok) {
              const errorText = await redirectResp.text();
              return NextResponse.json(
                {
                  error: `STL redirect failed: ${redirectResp.statusText}`,
                  details: errorText,
                  redirectUrl,
                },
                { status: redirectResp.status }
              );
            }
            contentType =
              redirectResp.headers.get("content-type") || contentType;
            fileBuffer = await redirectResp.arrayBuffer();
          } else if (!stlResponse.ok) {
            const errorText = await stlResponse.text();
            return NextResponse.json(
              {
                error: `STL export failed: ${stlResponse.statusText}`,
                details: errorText,
              },
              { status: stlResponse.status }
            );
          } else {
            fileBuffer = await stlResponse.arrayBuffer();
          }

          const base = getBaseFileName({
            documentId,
            elementId,
            elementName,
            partId: partId || "",
            partName: partName || "",
            combineParts,
          });
          const tagSuffix = configPairs.length ? ` - ${configTag}` : "";
          const isZip = isZipPayload(contentType, fileBuffer!);
          zip.file(
            isZip ? `${base}${tagSuffix}.zip` : `${base}${tagSuffix}.stl`,
            Buffer.from(fileBuffer!)
          );
          continue;
        }

        // ---------- Non-STL (asynchronous) ----------
        if (!combineParts) {
          // ===== INDIVIDUAL PART PATH =====
          // We must resolve the configured partId first (ids change with configuration).
          // Prefer match by partName if provided; else fall back to provided partId (best effort).
          let configuredPartId: string | undefined = undefined;
          try {
            const parts = await listPartsForConfiguration({
              documentId,
              workspaceId,
              elementId,
              queryParam,
              authHeader,
            });
            if (partName) {
              const matchByName = parts.find(
                (p: any) =>
                  (p.name || "").toLowerCase() === partName.toLowerCase()
              );
              configuredPartId = matchByName?.partId;
            }
            if (!configuredPartId && partId) {
              // try to find a "same base id" if Onshape prefixes/suffixes differ, or just fall back to first match
              const endsWith = parts.find((p: any) =>
                String(p.partId).endsWith(String(partId))
              );
              configuredPartId = endsWith?.partId || parts[0]?.partId;
            }
          } catch (e) {
            // If listing fails, we will still try with provided partId (may export default config)
            configuredPartId = partId;
          }
          if (!configuredPartId) {
            return NextResponse.json(
              {
                error:
                  "Could not resolve configured partId for the given configuration.",
              },
              { status: 400 }
            );
          }

          // Use format-specific v11 endpoints for STEP/SOLIDWORKS; otherwise generic translations.
          if (fmt === "STEP" || fmt === "SOLIDWORKS") {
            const baseExportUrl =
              fmt === "STEP"
                ? `https://cad.onshape.com/api/v11/partstudios/d/${documentId}/w/${workspaceId}/e/${elementId}/export/step`
                : `https://cad.onshape.com/api/v11/partstudios/d/${documentId}/w/${workspaceId}/e/${elementId}/export/solidworks`;

            const exportBody: Record<string, unknown> = {
              storeInDocument: false,
              partIds: [configuredPartId],
              ...(encodedId ? { configuration: encodedId } : {}), // IMPORTANT: configuration in BODY for async exports
            };

            const startRes = await fetch(baseExportUrl, {
              method: "POST",
              headers: {
                Authorization: authHeader,
                Accept: "application/json",
                "Content-Type": "application/json",
              },
              body: JSON.stringify(exportBody),
            });

            if (!startRes.ok) {
              const t = await startRes.text();
              return NextResponse.json(
                {
                  error: `Failed to start ${fmt} export: ${startRes.statusText}`,
                  details: t,
                },
                { status: startRes.status }
              );
            }
            const startData = await startRes.json();

            // Poll
            const maxAttempts = 90;
            let attempt = 0;
            while (attempt < maxAttempts) {
              await new Promise((r) => setTimeout(r, 2000));
              const statusRes = await fetch(
                `https://cad.onshape.com/api/v6/translations/${startData.id}`,
                {
                  headers: {
                    Authorization: authHeader,
                    Accept: "application/json",
                  },
                }
              );
              if (!statusRes.ok) {
                return NextResponse.json(
                  {
                    error: `Failed to read ${fmt} export status: ${statusRes.statusText}`,
                  },
                  { status: statusRes.status }
                );
              }
              const statusData = await statusRes.json();
              if (statusData.requestState === "DONE") {
                const ids: string[] = statusData.resultExternalDataIds || [];
                if (ids.length > 0) {
                  const downloadUrl = `https://cad.onshape.com/api/v6/documents/d/${documentId}/externaldata/${ids[0]}`;
                  const fileRes = await fetch(downloadUrl, {
                    headers: { Authorization: authHeader },
                  });
                  if (!fileRes.ok) {
                    return NextResponse.json(
                      {
                        error: `Failed to download ${fmt} file: ${fileRes.statusText}`,
                      },
                      { status: fileRes.status }
                    );
                  }
                  const fileBuffer = await fileRes.arrayBuffer();
                  const contentType = fileRes.headers.get("content-type");
                  const base = getBaseFileName({
                    documentId,
                    elementId,
                    elementName,
                    partId: configuredPartId,
                    partName: partName || "",
                    combineParts,
                  });
                  const ext = extForFormat(fmt);
                  const tagSuffix = configPairs.length ? ` - ${configTag}` : "";
                  const zipped = isZipPayload(contentType, fileBuffer);

                  if (zipped) {
                    // open translator ZIP, pick only our part file, and add it directly
                    const inner = await JSZip.loadAsync(
                      Buffer.from(fileBuffer)
                    );
                    const entry = await pickZipEntryForPart(inner, {
                      extCandidates: ext === "step" ? ["step", "stp"] : [ext],
                      partName,
                      elementName,
                    });
                    if (!entry) {
                      return NextResponse.json(
                        {
                          error: `Could not locate ${ext.toUpperCase()} for the requested part inside translator zip.`,
                        },
                        { status: 500 }
                      );
                    }
                    const singleFile = await entry.async("nodebuffer");
                    zip.file(`${base}${tagSuffix}.${ext}`, singleFile);
                  } else {
                    zip.file(
                      `${base}${tagSuffix}.${ext}`,
                      Buffer.from(fileBuffer)
                    );
                  }
                }
                break;
              } else if (statusData.requestState === "FAILED") {
                return NextResponse.json(
                  {
                    error: `Export failed (${fmt}): ${
                      statusData.failureReason || "Unknown"
                    }`,
                  },
                  { status: 500 }
                );
              }
              attempt++;
            }
            if (attempt >= maxAttempts) {
              return NextResponse.json(
                {
                  error: `Export timeout for ${fmt}${
                    configPairs.length ? ` (configuration encoded)` : ""
                  }`,
                },
                { status: 408 }
              );
            }
          } else {
            // Other formats via generic translations (still async)
            const url = `https://cad.onshape.com/api/v6/partstudios/d/${documentId}/w/${workspaceId}/e/${elementId}/translations`;

            const tBody: Record<string, unknown> = {
              formatName: fmt,
              storeInDocument: false,
              translate: true,
              partIds: [configuredPartId],
              ...(encodedId ? { configuration: encodedId } : {}),
            };

            const translationRes = await fetch(url, {
              method: "POST",
              headers: {
                Authorization: authHeader,
                Accept: "application/json",
                "Content-Type": "application/json",
              },
              body: JSON.stringify(tBody),
            });
            if (!translationRes.ok) {
              const errText = await translationRes.text();
              return NextResponse.json(
                {
                  error: `Failed to start ${fmt} translation: ${translationRes.statusText}`,
                  details: errText,
                },
                { status: translationRes.status }
              );
            }
            const translationData = await translationRes.json();

            const maxAttempts = 90;
            let attempt = 0;
            while (attempt < maxAttempts) {
              await new Promise((r) => setTimeout(r, 2000));
              const statusRes = await fetch(
                `https://cad.onshape.com/api/v6/translations/${translationData.id}`,
                {
                  headers: {
                    Authorization: authHeader,
                    Accept: "application/json",
                  },
                }
              );
              if (!statusRes.ok) {
                return NextResponse.json(
                  {
                    error: `Failed to read translation status: ${statusRes.statusText}`,
                  },
                  { status: statusRes.status }
                );
              }
              const statusData = await statusRes.json();
              if (statusData.requestState === "DONE") {
                const ids: string[] = statusData.resultExternalDataIds || [];
                if (ids.length > 0) {
                  const downloadUrl = `https://cad.onshape.com/api/v6/documents/d/${documentId}/externaldata/${ids[0]}`;
                  const fileRes = await fetch(downloadUrl, {
                    headers: { Authorization: authHeader },
                  });
                  if (!fileRes.ok) {
                    return NextResponse.json(
                      {
                        error: `Failed to download ${fmt} file: ${fileRes.statusText}`,
                      },
                      { status: fileRes.status }
                    );
                  }
                  const fileBuffer = await fileRes.arrayBuffer();
                  const contentType = fileRes.headers.get("content-type");
                  const base = getBaseFileName({
                    documentId,
                    elementId,
                    elementName,
                    partId: configuredPartId,
                    partName: partName || "",
                    combineParts,
                  });
                  const ext = extForFormat(fmt);
                  const tagSuffix = configPairs.length ? ` - ${configTag}` : "";
                  const zipped = isZipPayload(contentType, fileBuffer);

                  if (zipped) {
                    const inner = await JSZip.loadAsync(
                      Buffer.from(fileBuffer)
                    );
                    const entry = await pickZipEntryForPart(inner, {
                      extCandidates: ext === "step" ? ["step", "stp"] : [ext],
                      partName,
                      elementName,
                    });
                    if (!entry) {
                      return NextResponse.json(
                        {
                          error: `Could not locate ${fmt} for the requested part inside translator zip.`,
                        },
                        { status: 500 }
                      );
                    }
                    const singleFile = await entry.async("nodebuffer");
                    zip.file(`${base}${tagSuffix}.${ext}`, singleFile);
                  } else {
                    zip.file(
                      `${base}${tagSuffix}.${ext}`,
                      Buffer.from(fileBuffer)
                    );
                  }
                }
                break;
              } else if (statusData.requestState === "FAILED") {
                return NextResponse.json(
                  {
                    error: `Translation failed (${fmt}): ${
                      statusData.failureReason || "Unknown"
                    }`,
                  },
                  { status: 500 }
                );
              }
              attempt++;
            }
            if (attempt >= maxAttempts) {
              return NextResponse.json(
                {
                  error: `Translation timeout for ${fmt}${
                    configPairs.length ? ` (configuration encoded)` : ""
                  }`,
                },
                { status: 408 }
              );
            }
          }
        } else {
          // ===== COMBINED PARTS PATH (whole Part Studio) =====
          const translationUrl = `https://cad.onshape.com/api/v6/partstudios/d/${documentId}/w/${workspaceId}/e/${elementId}/translations`;

          const tBody: Record<string, unknown> = {
            formatName: fmt,
            storeInDocument: false,
            translate: true,
            ...(encodedId ? { configuration: encodedId } : {}),
          };

          const translationRes = await fetch(translationUrl, {
            method: "POST",
            headers: {
              Authorization: authHeader,
              Accept: "application/json",
              "Content-Type": "application/json",
            },
            body: JSON.stringify(tBody),
          });
          if (!translationRes.ok) {
            const errText = await translationRes.text();
            return NextResponse.json(
              {
                error: `Failed to start ${fmt} translation: ${translationRes.statusText}`,
                details: errText,
              },
              { status: translationRes.status }
            );
          }
          const translationData = await translationRes.json();

          const maxAttempts = 90;
          let attempt = 0;
          while (attempt < maxAttempts) {
            await new Promise((r) => setTimeout(r, 2000));
            const statusRes = await fetch(
              `https://cad.onshape.com/api/v6/translations/${translationData.id}`,
              {
                headers: {
                  Authorization: authHeader,
                  Accept: "application/json",
                },
              }
            );
            if (!statusRes.ok) {
              return NextResponse.json(
                {
                  error: `Failed to read translation status: ${statusRes.statusText}`,
                },
                { status: statusRes.status }
              );
            }
            const statusData = await statusRes.json();
            if (statusData.requestState === "DONE") {
              const ids: string[] = statusData.resultExternalDataIds || [];
              if (ids.length > 0) {
                const downloadUrl = `https://cad.onshape.com/api/v6/documents/d/${documentId}/externaldata/${ids[0]}`;
                const fileRes = await fetch(downloadUrl, {
                  headers: { Authorization: authHeader },
                });
                if (!fileRes.ok) {
                  return NextResponse.json(
                    {
                      error: `Failed to download ${fmt} file: ${fileRes.statusText}`,
                    },
                    { status: fileRes.status }
                  );
                }
                const fileBuffer = await fileRes.arrayBuffer();
                const contentType = fileRes.headers.get("content-type");
                const base = getBaseFileName({
                  documentId,
                  elementId,
                  elementName,
                  partId: partId || "",
                  partName: partName || "",
                  combineParts,
                });
                const ext = extForFormat(fmt);
                const tagSuffix = configPairs.length ? ` - ${configTag}` : "";
                const zipped = isZipPayload(contentType, fileBuffer);
                zip.file(
                  zipped
                    ? `${base}${tagSuffix}.zip`
                    : `${base}${tagSuffix}.${ext}`,
                  Buffer.from(fileBuffer)
                );
              }
              break;
            } else if (statusData.requestState === "FAILED") {
              return NextResponse.json(
                {
                  error: `Translation failed (${fmt}): ${
                    statusData.failureReason || "Unknown"
                  }`,
                },
                { status: 500 }
              );
            }
            attempt++;
          }
          if (attempt >= maxAttempts) {
            return NextResponse.json(
              {
                error: `Translation timeout for ${fmt}${
                  configPairs.length ? ` (configuration encoded)` : ""
                }`,
              },
              { status: 408 }
            );
          }
        }
      }
    }

    const zipBuffer = await (zip as any).generateAsync({
      type: "nodebuffer",
      compression: "DEFLATE",
    });
    const zipName = `onshape_exports_${documentId}_${elementId}_${Date.now()}.zip`;
    return new NextResponse(zipBuffer, {
      headers: {
        "Content-Type": "application/zip",
        "Content-Disposition": `attachment; filename="${zipName}"`,
      },
    });
  } catch (err) {
    console.error("Error exporting with configurations:", err);
    return NextResponse.json({ error: "Failed to export" }, { status: 500 });
  }
}
