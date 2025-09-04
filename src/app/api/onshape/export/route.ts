import { type NextRequest, NextResponse } from "next/server";

export async function POST(request: NextRequest) {
  try {
    const authHeader = request.headers.get("authorization");
    if (!authHeader) {
      return NextResponse.json(
        { error: "Missing authorization header" },
        { status: 401 }
      );
    }

    const { documentId, elementId, partId, format } = await request.json();

    if (!documentId || !elementId || !partId || !format) {
      return NextResponse.json(
        { error: "Missing required parameters" },
        { status: 400 }
      );
    }

    // Get document info to get workspace ID
    const docResponse = await fetch(
      `https://cad.onshape.com/api/v6/documents/${documentId}`,
      {
        headers: {
          Authorization: authHeader,
          Accept: "application/json",
        },
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

    // Handle different export formats
    if (format === "STL") {
      const mode = "binary";
      const units = "millimeter";
      const scale = 1;
      const angleTolerance = "0.04363323129985824";
      const chordTolerance = "0.06";
      const minFacetWidth = "0.0254";
      const stlUrl = `https://cad.onshape.com/api/v6/parts/d/${documentId}/w/${workspaceId}/e/${elementId}/partid/${partId}/stl?mode=${mode}&units=${units}&scale=${scale}&angleTolerance=${angleTolerance}&chordTolerance=${chordTolerance}&minFacetWidth=${minFacetWidth}`;

      const stlResponse = await fetch(stlUrl, {
        headers: {
          Authorization: authHeader,
          Accept: "application/vnd.onshape.v1+octet-stream",
        },
        redirect: "manual", // Don't follow redirects automatically
      });

      // Handle 307 redirect
      if (stlResponse.status === 307) {
        const redirectUrl = stlResponse.headers.get("location");
        if (!redirectUrl) {
          return NextResponse.json(
            { error: "No redirect URL found" },
            { status: 500 }
          );
        }

        // Follow redirect with auth headers
        const redirectResponse = await fetch(redirectUrl, {
          headers: {
            Authorization: authHeader,
            Accept: "application/vnd.onshape.v1+json",
          },
        });

        if (!redirectResponse.ok) {
          return NextResponse.json(
            {
              error: `Failed to export STL after redirect: ${redirectResponse.statusText}`,
            },
            { status: redirectResponse.status }
          );
        }

        const fileBuffer = await redirectResponse.arrayBuffer();

        return new NextResponse(fileBuffer, {
          headers: {
            "Content-Type": "application/octet-stream",
            "Content-Disposition": `attachment; filename="part_${partId}.stl"`,
          },
        });
      } else if (!stlResponse.ok) {
        return NextResponse.json(
          { error: `Failed to export STL: ${stlResponse.statusText}` },
          { status: stlResponse.status }
        );
      } else {
        // Direct response without redirect
        const fileBuffer = await stlResponse.arrayBuffer();

        return new NextResponse(fileBuffer, {
          headers: {
            "Content-Type": "application/octet-stream",
            "Content-Disposition": `attachment; filename="part_${partId}.stl"`,
          },
        });
      }
    } else {
      const translationResponse = await fetch(
        `https://cad.onshape.com/api/v6/partstudios/d/${documentId}/w/${workspaceId}/e/${elementId}/translations`,
        {
          method: "POST",
          headers: {
            Authorization: authHeader,
            Accept: "application/json",
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            formatName: format,
            storeInDocument: false,
            translate: true,
            partIds: partId,
            ...(format === "STEP" && {
              stepVersionString: "AP214", // Use AP214 for better compatibility
              stepUnits: "millimeter",
            }),
            ...(format === "SOLIDWORKS" && {
              solidWorksVersion: "2022", // Use recent SolidWorks version
            }),
          }),
        }
      );

      if (!translationResponse.ok) {
        return NextResponse.json(
          {
            error: `Failed to start translation: ${translationResponse.statusText}`,
          },
          { status: translationResponse.status }
        );
      }

      const translationData = await translationResponse.json();

      // Poll for completion
      let attempts = 0;
      const maxAttempts = 60; // Increased timeout for all exports

      while (attempts < maxAttempts) {
        await new Promise((resolve) => setTimeout(resolve, 2000));

        const statusResponse = await fetch(
          `https://cad.onshape.com/api/v6/translations/${translationData.id}`,
          {
            headers: {
              Authorization: authHeader,
              Accept: "application/json",
            },
          }
        );

        if (statusResponse.ok) {
          const statusData = await statusResponse.json();

          if (statusData.requestState === "DONE") {
            if (
              statusData.resultExternalDataIds &&
              statusData.resultExternalDataIds.length > 0
            ) {
              const downloadUrl = `https://cad.onshape.com/api/v6/documents/d/${documentId}/externaldata/${statusData.resultExternalDataIds[0]}`;

              const fileResponse = await fetch(downloadUrl, {
                headers: {
                  Authorization: authHeader,
                },
              });

              if (!fileResponse.ok) {
                return NextResponse.json(
                  {
                    error: `Failed to download file: ${fileResponse.statusText}`,
                  },
                  { status: fileResponse.status }
                );
              }

              const fileBuffer = await fileResponse.arrayBuffer();
              const fileExtension =
                format.toLowerCase() === "solidworks"
                  ? "sldprt"
                  : format.toLowerCase();

              return new NextResponse(fileBuffer, {
                headers: {
                  "Content-Type": "application/octet-stream",
                  "Content-Disposition": `attachment; filename="part_${partId}.${fileExtension}"`,
                },
              });
            }
          } else if (statusData.requestState === "FAILED") {
            return NextResponse.json(
              { error: `Translation failed: ${statusData.failureReason}` },
              { status: 500 }
            );
          }
        }

        attempts++;
      }

      return NextResponse.json(
        { error: "Translation timeout" },
        { status: 408 }
      );
    }
  } catch (error) {
    console.error("Error exporting part:", error);
    return NextResponse.json(
      { error: "Failed to export part" },
      { status: 500 }
    );
  }
}
