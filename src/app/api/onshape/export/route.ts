import { type NextRequest, NextResponse } from "next/server";
import JSZip from "jszip";
import { ConfigOption, ExportInput } from "@/components/types";

function cartesianProduct<T>(arrays: T[][]): T[][] {
  return arrays.reduce<T[][]>(
    (acc, arr) => acc.flatMap((prev) => arr.map((val) => [...prev, val])),
    [[]]
  );
}

function buildConfigPairs(options: ConfigOption[], combo: (string | number)[]) {
  return options.map((opt, i) => ({
    key: String(opt.key),
    value: String(combo[i]),
    unit: opt.unit ?? "",
  }));
}

function buildConfigurationString(
  pairs: { key: string; value: string; unit: string }[]
) {
  if (!pairs.length) return "";
  return pairs
    .map(({ key, value, unit }) =>
      unit ? `${key}=${value}+${unit}` : `${key}=${value}`
    )
    .join(";");
}

function humanConfigTag(pairs: { key: string; value: string }[]) {
  return pairs
    .map(
      ({ key, value }) =>
        `${key.replace(/[^A-Za-z0-9_-]+/g, "")}-${String(value).replace(
          /[^A-Za-z0-9_.-]+/g,
          ""
        )}`
    )
    .join("__");
}

function getBaseFileName(
  documentId: string,
  elementId: string,
  partId: string | null,
  combineParts: boolean
) {
  if (combineParts) return `part_${documentId}_${elementId}`;
  return `part_${documentId}_${elementId}_${partId || "all"}`;
}

function extForFormat(fmt: string) {
  const f = fmt.toLowerCase();
  if (f === "solidworks") return "sldprt";
  if (f === "parasolid") return "x_t";
  if (f === "iges") return "igs";
  return f;
}

function safeName(s: string) {
  return s.replace(/[^A-Za-z0-9._-]/g, "_");
}

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
      partId = "",
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

    if (!combineParts && !partId) {
      return NextResponse.json(
        { error: "partId is required when combineParts is false" },
        { status: 400 }
      );
    }

    // 1) Resolve workspace
    const docResponse = await fetch(
      `https://cad.onshape.com/api/v6/documents/${documentId}`,
      {
        headers: { Authorization: authHeader, Accept: "application/json" },
      }
    );
    if (!docResponse.ok) {
      return NextResponse.json(
        { error: `Failed to get document info: ${docResponse.statusText}` },
        { status: docResponse.status }
      );
    }
    const docData = await docResponse.json();
    const workspaceId = docData.defaultWorkspace?.id;
    if (!workspaceId) {
      return NextResponse.json(
        { error: "No default workspace found" },
        { status: 400 }
      );
    }

    // 1.5) If combining parts, fetch all part IDs from the Part Studio
    let allPartIds: string[] = [];
    if (combineParts) {
      const partsResponse = await fetch(
        `https://cad.onshape.com/api/v6/parts/d/${documentId}/w/${workspaceId}?elementId=${elementId}`,
        {
          headers: { Authorization: authHeader, Accept: "application/json" },
        }
      );
      if (!partsResponse.ok) {
        return NextResponse.json(
          { error: `Failed to get parts list: ${partsResponse.statusText}` },
          { status: partsResponse.status }
        );
      }
      const partsData = await partsResponse.json();
      allPartIds = partsData
        .filter((p: any) => p.partId && !p.isMesh)
        .map((p: any) => p.partId);

      if (allPartIds.length === 0) {
        return NextResponse.json(
          { error: "No parts found in Part Studio" },
          { status: 400 }
        );
      }
    }

    // 2) Build all configuration combinations
    const options: ConfigOption[] = Array.isArray(configOptions)
      ? configOptions
      : [];

    console.log("Configuration options:", options);
    const hasConfig = options.length > 0;

    const valueArrays = hasConfig ? options.map((o) => o.values) : [];
    const combos = hasConfig ? cartesianProduct(valueArrays) : [[]];

    // 3) Iterate configs x formats, collect binaries into ZIP
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
      const pairs = hasConfig ? buildConfigPairs(options, combo) : [];
      const configurationString = buildConfigurationString(pairs);
      const hasConfigurationParam = configurationString.length > 0;
      const configTag = hasConfigurationParam ? humanConfigTag(pairs) : "";

      for (const format of formats) {
        const fmt = String(format).toUpperCase();

        if (fmt === "STL") {
          // --- STL export ---
          let stlEndpoint: string;

          if (combineParts) {
            stlEndpoint = `https://cad.onshape.com/api/v6/partstudios/d/${documentId}/w/${workspaceId}/e/${elementId}/stl`;
          } else {
            stlEndpoint = `https://cad.onshape.com/api/v6/parts/d/${documentId}/w/${workspaceId}/e/${elementId}/partid/${encodeURIComponent(
              partId
            )}/stl`;
          }

          // Build query string manually to avoid double-encoding
          const queryParts: string[] = [];

          if (hasConfigurationParam) {
            queryParts.push(
              `configuration=${encodeURIComponent(configurationString)}`
            );
          }
          queryParts.push(`mode=${STL_DEFAULTS.mode}`);
          queryParts.push(`units=${STL_DEFAULTS.units}`);
          queryParts.push(`scale=${STL_DEFAULTS.scale}`);
          queryParts.push(`angleTolerance=${STL_DEFAULTS.angleTolerance}`);
          queryParts.push(`chordTolerance=${STL_DEFAULTS.chordTolerance}`);
          queryParts.push(`minFacetWidth=${STL_DEFAULTS.minFacetWidth}`);

          if (combineParts) {
            queryParts.push(`grouping=true`);
          }

          const stlUrl = `${stlEndpoint}?${queryParts.join("&")}`;

          console.log("STL Request URL:", stlUrl);
          console.log("Configuration string:", configurationString);

          const stlResponse = await fetch(stlUrl, {
            headers: {
              Authorization: authHeader,
              Accept: "application/vnd.onshape.v1+octet-stream",
            },
            redirect: "manual",
          });

          console.log("STL Response status:", stlResponse.status);

          let fileBuffer: ArrayBuffer | null = null;
          let contentType = stlResponse.headers.get("content-type") || "";

          if (stlResponse.status === 307) {
            const redirectUrl = stlResponse.headers.get("location");
            console.log("Redirect URL:", redirectUrl);

            if (!redirectUrl) {
              return NextResponse.json(
                { error: "No redirect URL for STL" },
                { status: 500 }
              );
            }

            const redirectResp = await fetch(redirectUrl, {
              headers: { Authorization: authHeader },
            });

            console.log("Redirect response status:", redirectResp.status);

            if (!redirectResp.ok) {
              const errorText = await redirectResp.text();
              console.error("Redirect error body:", errorText);
              return NextResponse.json(
                {
                  error: `STL redirect failed: ${redirectResp.statusText}`,
                  details: errorText,
                  redirectUrl: redirectUrl,
                },
                { status: redirectResp.status }
              );
            }
            contentType =
              redirectResp.headers.get("content-type") || contentType;
            fileBuffer = await redirectResp.arrayBuffer();
          } else if (!stlResponse.ok) {
            const errorText = await stlResponse.text();
            console.error("STL error body:", errorText);
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

          const base = getBaseFileName(
            documentId,
            elementId,
            partId || null,
            combineParts
          );
          const tagSuffix = hasConfigurationParam
            ? `__${safeName(configTag)}`
            : "";

          const isZip =
            contentType.toLowerCase().includes("zip") ||
            (fileBuffer && new Uint8Array(fileBuffer)[0] === 0x50);

          const stlName = `${safeName(base)}${tagSuffix}.stl`;
          const zipName = `${safeName(base)}${tagSuffix}.zip`;
          zip.file(isZip ? zipName : stlName, Buffer.from(fileBuffer!));
          continue;
        }

        // --- Non-STL formats ---
        if (fmt === "STEP" || fmt === "SOLIDWORKS") {
          const baseExportUrl =
            fmt === "STEP"
              ? `https://cad.onshape.com/api/v11/partstudios/d/${documentId}/w/${workspaceId}/e/${elementId}/export/step`
              : `https://cad.onshape.com/api/v11/partstudios/d/${documentId}/w/${workspaceId}/e/${elementId}/export/solidworks`;

          const params = new URLSearchParams();
          if (hasConfigurationParam)
            params.set("configuration", configurationString);

          const exportBody: Record<string, unknown> = {
            storeInDocument: false,
          };

          if (combineParts) {
            exportBody.partIds = allPartIds;
          } else if (partId) {
            exportBody.partIds = [partId];
          }

          const startRes = await fetch(
            `${baseExportUrl}?${params.toString()}`,
            {
              method: "POST",
              headers: {
                Authorization: authHeader,
                Accept: "application/json",
                "Content-Type": "application/json",
              },
              body: JSON.stringify(exportBody),
            }
          );

          if (!startRes.ok) {
            return NextResponse.json(
              {
                error: `Failed to start ${fmt} export: ${startRes.statusText}`,
              },
              { status: startRes.status }
            );
          }

          const startData = await startRes.json();

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
              if (ids.length === 0) break;

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

              const base = getBaseFileName(
                documentId,
                elementId,
                partId || null,
                combineParts
              );
              const ext = extForFormat(fmt);
              const tagSuffix = hasConfigurationParam
                ? `__${safeName(configTag)}`
                : "";
              const name = `${safeName(base)}${tagSuffix}.${ext}`;
              zip.file(name, Buffer.from(fileBuffer));
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
                  hasConfigurationParam
                    ? ` (configuration ${configurationString})`
                    : ""
                }`,
              },
              { status: 408 }
            );
          }
        } else {
          const params = new URLSearchParams();
          if (hasConfigurationParam)
            params.set("configuration", configurationString);

          const startTranslationUrl =
            `https://cad.onshape.com/api/v6/partstudios/d/${documentId}/w/${workspaceId}/e/${elementId}/translations` +
            (params.toString() ? `?${params.toString()}` : "");

          const tBody: Record<string, unknown> = {
            formatName: fmt,
            storeInDocument: false,
            translate: true,
          };

          if (combineParts) {
            tBody.partIds = allPartIds;
          } else if (partId) {
            tBody.partIds = [partId];
          }

          const translationResponse = await fetch(startTranslationUrl, {
            method: "POST",
            headers: {
              Authorization: authHeader,
              Accept: "application/json",
              "Content-Type": "application/json",
            },
            body: JSON.stringify(tBody),
          });

          if (!translationResponse.ok) {
            return NextResponse.json(
              {
                error: `Failed to start ${fmt} translation: ${translationResponse.statusText}`,
              },
              { status: translationResponse.status }
            );
          }

          const translationData = await translationResponse.json();

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
              if (ids.length === 0) break;

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

              const base = getBaseFileName(
                documentId,
                elementId,
                partId || null,
                combineParts
              );
              const ext = extForFormat(fmt);
              const tagSuffix = hasConfigurationParam
                ? `__${safeName(configTag)}`
                : "";
              const name = `${safeName(base)}${tagSuffix}.${ext}`;
              zip.file(name, Buffer.from(fileBuffer));
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
                  hasConfigurationParam
                    ? ` (configuration ${configurationString})`
                    : ""
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
    const zipName = `onshape_exports_${safeName(documentId)}_${safeName(
      elementId
    )}_${Date.now()}.zip`;

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
