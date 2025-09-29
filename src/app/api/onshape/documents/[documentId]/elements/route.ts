import {
  OnshapeConfiguration,
  OnshapeDocumentInfo,
  OnshapeElementWithConfiguration,
} from "@/components/types";
import { type NextRequest, NextResponse } from "next/server";

async function fetchJson<T>(url: string, authHeader: string): Promise<T> {
  const res = await fetch(url, {
    headers: { Authorization: authHeader, Accept: "application/json" },
    cache: "no-store",
  });
  if (!res.ok) {
    throw new Error(`Fetch failed ${res.status} ${res.statusText} for ${url}`);
  }
  return (await res.json()) as T;
}

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

    // 1) Document -> default workspace
    const doc = await fetchJson<OnshapeDocumentInfo>(
      `https://cad.onshape.com/api/v6/documents/${documentId}`,
      authHeader
    );

    const workspaceId = doc.defaultWorkspace?.id;
    if (!workspaceId) {
      return NextResponse.json(
        { error: "No default workspace found" },
        { status: 400 }
      );
    }

    // 2) Elements in workspace
    const elements = await fetchJson<OnshapeElementWithConfiguration[]>(
      `https://cad.onshape.com/api/v6/documents/d/${documentId}/w/${workspaceId}/elements`,
      authHeader
    );

    // 3) Attach configuration when available
    const withConfigs: OnshapeElementWithConfiguration[] = await Promise.all(
      elements.map(async (el) => {
        try {
          const cfg = await fetchJson<OnshapeConfiguration>(
            `https://cad.onshape.com/api/v6/elements/d/${documentId}/w/${workspaceId}/e/${el.id}/configuration`,
            authHeader
          );
          return { ...el, configuration: cfg ?? null };
        } catch {
          // Non-configurable elements commonly 404 here — normalize to null.
          return { ...el, configuration: null };
        }
      })
    );

    return NextResponse.json(withConfigs);
  } catch (err) {
    console.error("Error fetching elements:", err);
    return NextResponse.json(
      { error: "Failed to fetch elements" },
      { status: 500 }
    );
  }
}
