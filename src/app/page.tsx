"use client";

import AuthPage from "@/components/auth-page";
import DocumentSelectionPage from "@/components/document-selection-page";
import ExportConfigurationPage from "@/components/export-configuration-page";
import ExportResultPage from "@/components/export-results-page";
import { getJobId } from "@/components/helpers";
import {
  ExportJob,
  OnshapeDocument,
  OnshapeElement,
  PartStudioPart,
} from "@/components/types";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { useQuery, useMutation, useQueries } from "@tanstack/react-query";

export default function Page() {
  const [apiKey, setApiKey] = useState("");
  const [secretKey, setSecretKey] = useState("");
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [selectedDocument, setSelectedDocument] =
    useState<OnshapeDocument | null>(null);
  const [selectedFormats, setSelectedFormats] = useState<string[]>([
    "STL",
    "STEP",
    "SOLIDWORKS",
  ]);
  const [exportJobs, setExportJobs] = useState<ExportJob[]>([]);
  const [currentStep, setCurrentStep] = useState<
    "auth" | "documents" | "export" | "results"
  >("auth");
  const [savedCredentials, setSavedCredentials] = useState<{
    apiKey: string;
    secretKey: string;
  }>({ apiKey: "", secretKey: "" });

  useEffect(() => {
    setSavedCredentials({ apiKey: "", secretKey: "" });
    // On mount, check for saved cookies
    const cookies = document.cookie.split("; ").reduce((acc, cookie) => {
      const [key, value] = cookie.split("=");
      acc[key] = value;
      return acc;
    }, {} as Record<string, string>);

    if (cookies.onshape_api_key && cookies.onshape_secret_key) {
      setApiKey(cookies.onshape_api_key);
      setSecretKey(cookies.onshape_secret_key);
      setSavedCredentials({
        apiKey: cookies.onshape_api_key,
        secretKey: cookies.onshape_secret_key,
      });
    }
  }, []);

  // Query for documents - only runs when authenticated
  const {
    data: documents = [],
    isLoading: documentsLoading,
    error: documentsError,
  } = useQuery({
    queryKey: ["documents", apiKey, secretKey],
    queryFn: () => fetchDocuments({ apiKey, secretKey }),
    enabled: isAuthenticated && !!apiKey && !!secretKey,
    staleTime: 5 * 60 * 1000, // 5 minutes
  });

  // Query for document elements
  const { data: documentElements = [], isLoading: elementsLoading } = useQuery({
    queryKey: ["documentElements", selectedDocument?.id, apiKey, secretKey],
    queryFn: () =>
      fetchDocumentElements({
        documentId: selectedDocument!.id,
        apiKey,
        secretKey,
      }),
    enabled: !!selectedDocument && !!apiKey && !!secretKey,
    staleTime: 5 * 60 * 1000,
  });

  // Get part studios from elements
  const partStudios = documentElements.filter(
    (element: OnshapeElement) => element.elementType === "PARTSTUDIO"
  );

  // Queries for parts from all studios
  const partQueries = useQueries({
    queries: partStudios.map((studio: OnshapeElement) => ({
      queryKey: [
        "studioParts",
        selectedDocument?.id,
        studio.id,
        apiKey,
        secretKey,
      ],
      queryFn: () =>
        fetchStudioParts({
          documentId: selectedDocument!.id,
          elementId: studio.id,
          apiKey,
          secretKey,
        }),
      enabled: !!selectedDocument && !!apiKey && !!secretKey,
      staleTime: 5 * 60 * 1000,
    })),
  });

  // Combine all parts with studio information
  const allParts: PartStudioPart[] = partQueries
    .map((query, index) => {
      if (query.data) {
        return query.data.map((part: any) => ({
          partId: part.partId,
          name: part.name,
          elementId: partStudios[index].id,
          studioName: partStudios[index].name,
        }));
      }
      return [];
    })
    .flat();

  const partsLoading = partQueries.some((query) => query.isLoading);

  // Authentication mutation
  const authMutation = useMutation({
    mutationFn: async () => {
      if (!apiKey || !secretKey) {
        throw new Error("Please enter both API key and secret key");
      }

      // Save credentials as cookies
      document.cookie = `onshape_api_key=${apiKey}; max-age=${
        14 * 24 * 60 * 60
      }; path=/; samesite=strict; secure;`;
      document.cookie = `onshape_secret_key=${secretKey}; max-age=${
        14 * 24 * 60 * 60
      }; path=/; samesite=strict; secure;`;

      // Test authentication by fetching documents
      return fetchDocuments({ apiKey, secretKey });
    },
    onSuccess: () => {
      setIsAuthenticated(true);
      setCurrentStep("documents");
    },
    onError: (error: Error) => {
      toast.error("Authentication failed", {
        description: error.message,
      });
    },
  });

  // Export mutation
  const exportMutation = useMutation({
    mutationFn: async () => {
      if (allParts.length === 0 || selectedFormats.length === 0) {
        throw new Error("No parts found or no formats selected");
      }

      if (!selectedDocument) {
        throw new Error("No document selected");
      }

      const jobs: ExportJob[] = [];

      // Create export jobs for each part and format combination
      for (const part of allParts) {
        for (const format of selectedFormats) {
          jobs.push({
            id: `${getJobId({
              elementId: part.elementId,
              partId: part.partId,
              format,
            })}`,
            documentId: selectedDocument.id,
            elementId: part.elementId,
            partId: part.partId,
            partName: part.name,
            studioName: part.studioName,
            format,
            status: "pending",
          });
        }
      }

      setExportJobs(jobs);
      setCurrentStep("results");

      // Process exports
      const processedJobs = new Set<string>();

      const processExport = async (job: ExportJob) => {
        if (processedJobs.has(job.id)) return;
        processedJobs.add(job.id);

        try {
          setExportJobs((prev) =>
            prev.map((j) =>
              j.id === job.id && j.status === "pending"
                ? { ...j, status: "exporting" }
                : j
            )
          );

          const blob = await exportPart({
            documentId: selectedDocument.id,
            elementId: job.elementId,
            partId: job.partId,
            format: job.format,
            apiKey,
            secretKey,
          });

          setExportJobs((prev) =>
            prev.map((j) =>
              j.id === job.id && j.status !== "done"
                ? { ...j, status: "done", blob }
                : j
            )
          );
        } catch (error) {
          setExportJobs((prev) =>
            prev.map((j) =>
              j.id === job.id && j.status !== "done"
                ? {
                    ...j,
                    status: "failed",
                    error:
                      error instanceof Error ? error.message : "Unknown error",
                  }
                : j
            )
          );
        }
      };

      await Promise.all(jobs.map(processExport));
    },
    onError: (error: Error) => {
      toast.error("Export failed", {
        description: error.message,
      });
    },
  });

  const selectDocument = (document: OnshapeDocument) => {
    setSelectedDocument(document);
    setCurrentStep("export");
  };

  const downloadFile = (job: ExportJob) => {
    if (!job.blob) return;

    const url = URL.createObjectURL(job.blob);
    const a = document.createElement("a");
    a.href = url;
    const fileExtension =
      job.format.toLowerCase() === "solidworks"
        ? "sldprt"
        : job.format.toLowerCase();
    a.download = `${job.studioName}_${job.partName}.${fileExtension}`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const downloadAllFiles = async () => {
    const completedJobs = exportJobs.filter(
      (job) => job.status === "done" && job.blob
    );

    if (completedJobs.length === 0) {
      toast.error("No files to download", {
        description: "No completed exports found",
      });
      return;
    }

    for (const job of completedJobs) {
      downloadFile(job);
      await new Promise((resolve) => setTimeout(resolve, 100));
    }

    toast("Download started", {
      description: `Downloading ${completedJobs.length} files`,
    });
  };

  const resetApp = () => {
    setCurrentStep("auth");
    setSelectedDocument(null);
    setExportJobs([]);
    setIsAuthenticated(false);
  };

  // Handle errors
  useEffect(() => {
    if (documentsError) {
      toast.error("Failed to load documents", {
        description: documentsError.message,
      });
    }
  }, [documentsError]);

  const completedParts = exportJobs.filter((j) => j.status === "done").length;
  const totalParts = exportJobs.length;

  return (
    <div className="w-full min-h-screen pt-8 px-4 pb-16 flex flex-col items-center">
      <div className="w-full max-w-3xl space-y-6">
        <div className="text-center space-y-2">
          <h1 className="text-3xl font-bold">Onshape Bulk Exporter</h1>
          <p className="text-muted-foreground">
            Export all parts from Onshape documents in STL, STEP, and SolidWorks
            formats
          </p>
        </div>

        {/* Step 1: Authentication */}
        {currentStep === "auth" && (
          <AuthPage
            onConnect={() => authMutation.mutate()}
            isLoading={authMutation.isPending}
            apiKey={apiKey}
            onApiKeyChange={setApiKey}
            secretKey={secretKey}
            onSecretKeyChange={setSecretKey}
            savedCredentials={savedCredentials}
          />
        )}

        {/* Step 2: Document Selection */}
        {currentStep === "documents" && (
          <DocumentSelectionPage
            documents={documents}
            onSelectDocument={selectDocument}
            onBackToAuth={resetApp}
            isLoading={documentsLoading}
            selectedDocument={selectedDocument}
          />
        )}

        {/* Step 3: Export Configuration */}
        {currentStep === "export" && (
          <ExportConfigurationPage
            onBackClick={() => setCurrentStep("documents")}
            onExportClick={() => exportMutation.mutate()}
            isLoading={
              elementsLoading || partsLoading || exportMutation.isPending
            }
            selectedDocument={selectedDocument}
            allParts={allParts}
            selectedFormats={selectedFormats}
            setSelectedFormats={setSelectedFormats}
          />
        )}

        {/* Step 4: Export Results */}
        {currentStep === "results" && (
          <ExportResultPage
            onStartOver={resetApp}
            onBackToExport={() => setCurrentStep("export")}
            onDownloadAll={downloadAllFiles}
            exportJobs={exportJobs}
            totalParts={totalParts}
            completedParts={completedParts}
          />
        )}
      </div>
    </div>
  );
}

// API functions
async function fetchDocuments({
  apiKey,
  secretKey,
}: {
  apiKey: string;
  secretKey: string;
}) {
  const response = await fetch("/api/onshape/documents", {
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

async function fetchDocumentElements({
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

  const resJson: OnshapeElement[] = await response.json();
  return resJson;
}

async function fetchStudioParts({
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

async function exportPart({
  documentId,
  elementId,
  partId,
  format,
  apiKey,
  secretKey,
}: {
  documentId: string;
  elementId: string;
  partId: string;
  format: string;
  apiKey: string;
  secretKey: string;
}) {
  const response = await fetch("/api/onshape/export", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Basic ${btoa(`${apiKey}:${secretKey}`)}`,
    },
    body: JSON.stringify({
      documentId,
      elementId,
      partId,
      format,
    }),
  });

  if (!response.ok) {
    const errorData = await response
      .json()
      .catch(() => ({ error: response.statusText }));
    throw new Error(errorData.error || `Export failed: ${response.statusText}`);
  }

  return response.blob();
}
