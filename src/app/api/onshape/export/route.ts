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
    keyDisplay: String(opt.keyDisplay),
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

function humanConfigTag(
  pairs: { key: string; keyDisplay: string; value: string }[]
) {
  return pairs
    .map(({ keyDisplay, value }) => `${keyDisplay} = ${value}`)
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
  if (f === "solidworks") return "sldprt";
  if (f === "parasolid") return "x_t";
  if (f === "iges") return "igs";
  return f;
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
      elementName,
      partId,
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
    if (!combineParts && !partId) {
      return NextResponse.json(
        { error: "partId is required when combineParts is false" },
        { status: 400 }
      );
    }

    // 1) Resolve default workspace for the document
    const docResponse = await fetch(
      `https://cad.onshape.com/api/v6/documents/${documentId}`,
      { headers: { Authorization: authHeader, Accept: "application/json" } }
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

    // 1.5) If combining parts, get all part IDs in the Part Studio
    let allPartIds: string[] = [];
    if (combineParts) {
      const partsResponse = await fetch(
        `https://cad.onshape.com/api/v6/parts/d/${documentId}/w/${workspaceId}?elementId=${elementId}`,
        { headers: { Authorization: authHeader, Accept: "application/json" } }
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

    // 2) Build all configuration combinations (if any configurations provided)
    const options: ConfigOption[] = Array.isArray(configOptions)
      ? configOptions
      : [];
    const hasConfig = options.length > 0;
    const valueArrays = hasConfig ? options.map((o) => o.values) : [];
    const combos = hasConfig ? cartesianProduct(valueArrays) : [[]];

    // 3) Iterate over all configurations and formats, collecting binaries into a ZIP
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
          // --- STL export (synchronous API) ---
          const endpoint = combineParts
            ? `https://cad.onshape.com/api/v6/partstudios/d/${documentId}/w/${workspaceId}/e/${elementId}/stl`
            : `https://cad.onshape.com/api/v6/parts/d/${documentId}/w/${workspaceId}/e/${elementId}/partid/${encodeURIComponent(
                partId!
              )}/stl`;

          const queryParams: string[] = [];
          if (hasConfigurationParam) {
            queryParams.push(
              `configuration=${encodeURIComponent(configurationString)}`
            );
          }
          queryParams.push(`mode=${STL_DEFAULTS.mode}`);
          queryParams.push(`units=${STL_DEFAULTS.units}`);
          queryParams.push(`scale=${STL_DEFAULTS.scale}`);
          queryParams.push(`angleTolerance=${STL_DEFAULTS.angleTolerance}`);
          queryParams.push(`chordTolerance=${STL_DEFAULTS.chordTolerance}`);
          queryParams.push(`minFacetWidth=${STL_DEFAULTS.minFacetWidth}`);
          if (combineParts) queryParams.push(`grouping=true`);

          const stlUrl = `${endpoint}?${queryParams.join("&")}`;
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
            // Follow redirect for STL download
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
          const tagSuffix = hasConfigurationParam ? ` - ${configTag}` : "";
          const isZip =
            contentType.toLowerCase().includes("zip") ||
            (fileBuffer && new Uint8Array(fileBuffer)[0] === 0x50);
          const stlName = `${base}${tagSuffix}.stl`;
          const zipName = `${base}${tagSuffix}.zip`;
          zip.file(isZip ? zipName : stlName, Buffer.from(fileBuffer!));
          continue;
        }

        // --- Export other formats via Part Studio translations (async API) ---
        {
          // Prepare translation request
          const params = new URLSearchParams();
          if (hasConfigurationParam) {
            params.set("configuration", configurationString);
          }
          const translationUrl =
            `https://cad.onshape.com/api/v6/partstudios/d/${documentId}/w/${workspaceId}/e/${elementId}/translations` +
            (params.toString() ? `?${params.toString()}` : "");
          const tBody: Record<string, unknown> = {
            formatName: fmt,
            storeInDocument: false,
            translate: true,
          };
          if (!combineParts && partId) {
            // Export only the specified part
            tBody.partIds = [partId];
          }
          // If combineParts is true, no partIds are provided – export whole Part Studio

          // Initiate the translation
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

          // Poll translation status until DONE
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
              const base = getBaseFileName({
                documentId,
                elementId,
                elementName,
                partId: partId || "",
                partName: partName || "",
                combineParts,
              });
              const ext = extForFormat(fmt);
              const tagSuffix = hasConfigurationParam ? ` - ${configTag}` : "";
              const fileName = `${base}${tagSuffix}.${ext}`;
              zip.file(fileName, Buffer.from(fileBuffer));
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

    // 4) Package all exported files into a ZIP and return it
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
