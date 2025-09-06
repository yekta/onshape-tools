import { type NextRequest, NextResponse } from "next/server";

const ALLOWED_PARAMS = [
  "q",
  "offset",
  "limit",
  "sortColumn",
  "sortOrder",
  "filter",
];

export async function GET(request: NextRequest) {
  try {
    const authHeader = request.headers.get("authorization");
    if (!authHeader) {
      return NextResponse.json(
        { error: "Missing authorization header" },
        { status: 401 }
      );
    }

    const { searchParams } = request.nextUrl;

    // Build query params for Onshape
    const url = new URL("https://cad.onshape.com/api/v6/documents");

    // Apply allowed direct params
    for (const key of ALLOWED_PARAMS) {
      const v = searchParams.get(key);
      if (v) url.searchParams.set(key, v);
    }

    if (url.searchParams.get("q") !== "") {
      url.searchParams.set("filter", "0");
    }

    const response = await fetch(url.toString(), {
      headers: {
        Authorization: authHeader,
        Accept: "application/json",
        "Content-Type": "application/json",
      },
    });

    if (!response.ok) {
      return NextResponse.json(
        {
          error: `Onshape API error: ${response.status} ${response.statusText}`,
        },
        { status: response.status }
      );
    }

    const data = await response.json();
    return NextResponse.json(data);
  } catch (error) {
    console.error("Error fetching documents:", error);
    return NextResponse.json(
      { error: "Failed to fetch documents" },
      { status: 500 }
    );
  }
}
