import { type NextRequest, NextResponse } from "next/server";

export async function GET(
  request: NextRequest,
  { params }: { params: { documentId: string; elementId: string } }
) {
  try {
    const authHeader = request.headers.get("authorization");
    if (!authHeader) {
      return NextResponse.json(
        { error: "Missing authorization header" },
        { status: 401 }
      );
    }

    const { documentId, elementId } = params;

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

    // Get parts from the part studio
    const partsResponse = await fetch(
      `https://cad.onshape.com/api/v6/parts/d/${documentId}/w/${workspaceId}?elementId=${elementId}`,
      {
        headers: {
          Authorization: authHeader,
          Accept: "application/json",
        },
      }
    );

    if (!partsResponse.ok) {
      return NextResponse.json(
        { error: `Failed to get parts: ${partsResponse.statusText}` },
        { status: partsResponse.status }
      );
    }

    const partsData = await partsResponse.json();
    return NextResponse.json(partsData);
  } catch (error) {
    console.error("Error fetching parts:", error);
    return NextResponse.json(
      { error: "Failed to fetch parts" },
      { status: 500 }
    );
  }
}
