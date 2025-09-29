import {
  ConfigOption,
  ExportInput,
  OnshapeDocument,
  OnshapeElementWithConfiguration,
  PartStudioPart,
} from "@/components/types";

// API functions
export async function fetchDocuments({
  search,
  apiKey,
  secretKey,
}: {
  search: string;
  apiKey: string;
  secretKey: string;
}) {
  const url = `/api/onshape/documents`;
  const params = new URLSearchParams();

  if (search !== "") {
    params.append("q", search);
  }

  let fullUrl = url;
  const paramsStr = params.toString();

  if (paramsStr !== "") {
    fullUrl += `?${paramsStr}`;
  }

  const response = await fetch(fullUrl, {
    method: "GET",
    headers: {
      Authorization: `Basic ${btoa(`${apiKey}:${secretKey}`)}`,
    },
  });

  if (!response.ok) {
    throw new Error(`Authentication failed: ${response.statusText}`);
  }

  const resJson: { items: OnshapeDocument[] } = await response.json();
  return resJson.items || [];
}

export async function fetchDocumentElements({
  documentId,
  apiKey,
  secretKey,
}: {
  documentId: string;
  apiKey: string;
  secretKey: string;
}) {
  const response = await fetch(
    `/api/onshape/documents/${documentId}/elements`,
    {
      headers: {
        Authorization: `Basic ${btoa(`${apiKey}:${secretKey}`)}`,
      },
    }
  );

  if (!response.ok) {
    throw new Error("Failed to load document elements");
  }

  const resJson: OnshapeElementWithConfiguration[] = await response.json();
  return resJson;
}

export async function fetchStudioParts({
  documentId,
  elementId,
  apiKey,
  secretKey,
}: {
  documentId: string;
  elementId: string;
  apiKey: string;
  secretKey: string;
}) {
  const response = await fetch(
    `/api/onshape/documents/${documentId}/elements/${elementId}/parts`,
    {
      headers: {
        Authorization: `Basic ${btoa(`${apiKey}:${secretKey}`)}`,
      },
    }
  );

  if (!response.ok) {
    throw new Error("Failed to load parts");
  }

  const resJson: PartStudioPart[] = await response.json();
  return resJson;
}

export async function exportPart({
  documentId,
  elementId,
  elementName,
  partId,
  partName,
  formats,
  apiKey,
  secretKey,
  configOptions,
  combineParts,
}: {
  documentId: string;
  elementId: string;
  elementName: string;
  partId: string;
  partName: string;
  formats: string[];
  apiKey: string;
  secretKey: string;
  configOptions: ConfigOption[];
  combineParts: boolean;
}) {
  const body: ExportInput = {
    documentId,
    elementId,
    elementName,
    partId,
    partName,
    formats,
    configOptions,
    combineParts,
  };
  const response = await fetch("/api/onshape/export", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Basic ${btoa(`${apiKey}:${secretKey}`)}`,
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const errorData = await response
      .json()
      .catch(() => ({ error: response.statusText }));
    throw new Error(errorData.error || `Export failed: ${response.statusText}`);
  }

  return response.blob();
}
