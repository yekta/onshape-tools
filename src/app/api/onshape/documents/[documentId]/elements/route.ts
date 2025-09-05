import { type NextRequest, NextResponse } from "next/server";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ documentId: string }> }
) {
  try {
    const authHeader = request.headers.get("authorization");
    if (!authHeader) {
      return NextResponse.json(
        { error: "Missing authorization header" },
        { status: 401 }
      );
    }

    const { documentId } = await params;

    // Get document info first to get the workspace ID
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

    // Get elements from the workspace
    const elementsResponse = await fetch(
      `https://cad.onshape.com/api/v6/documents/d/${documentId}/w/${workspaceId}/elements`,
      {
        headers: {
          Authorization: authHeader,
          Accept: "application/json",
        },
      }
    );

    if (!elementsResponse.ok) {
      return NextResponse.json(
        { error: `Failed to get elements: ${elementsResponse.statusText}` },
        { status: elementsResponse.status }
      );
    }

    const elementsData = await elementsResponse.json();
    return NextResponse.json(elementsData);
  } catch (error) {
    console.error("Error fetching elements:", error);
    return NextResponse.json(
      { error: "Failed to fetch elements" },
      { status: 500 }
    );
  }
}
