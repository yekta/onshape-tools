import { type NextRequest, NextResponse } from "next/server";
import JSZip from "jszip";
import { ConfigOption, ExportInput } from "@/components/types";
import {
  buildConfigPairs,
  cartesianProduct,
  encodeConfiguration,
  extForFormat,
  getBaseFileName,
  getDefaultWorkspaceId,
  humanConfigTag,
  isZipPayload,
  pickZipEntryForPart,
} from "@/app/api/onshape/export/helpers";

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
      minFacetWidth,
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
      minFacetWidth: minFacetWidth !== undefined ? minFacetWidth : "0.0254",
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
          // CRITICAL: v11 format-specific endpoints don't support partIds + configuration
          // Use v6 translations endpoint for ALL formats when exporting individual parts
          const url = `https://cad.onshape.com/api/v6/partstudios/d/${documentId}/w/${workspaceId}/e/${elementId}/translations`;

          const tBody: Record<string, unknown> = {
            formatName: fmt,
            storeInDocument: false,
            partIds: partId,
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
            console.log(errText);
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

                if (zipped) {
                  const inner = await JSZip.loadAsync(Buffer.from(fileBuffer));
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
