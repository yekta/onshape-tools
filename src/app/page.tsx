"use client";

import AuthPage from "@/components/auth-page";
import DocumentSelectionPage from "@/components/document-selection-page";
import ExportConfigurationPage, {
  PerStudioConfig,
} from "@/components/export-configuration-page";
import ExportResultPage from "@/components/export-results-page";
import { getJobId } from "@/components/helpers";
import {
  ExportJob,
  OnshapeDocument,
  OnshapeElement,
  OnshapeElementWithConfiguration,
  PartStudioPart,
} from "@/components/types";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { useQuery, useMutation, useQueries } from "@tanstack/react-query";
import {
  exportPart,
  fetchDocumentElements,
  fetchDocuments,
  fetchStudioParts,
} from "@/components/queries";

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
  const [selectedPartStudioIds, setSelectedPartStudioIds] = useState<string[]>(
    []
  );
  const [exportJobs, setExportJobs] = useState<ExportJob[]>([]);
  const [currentStep, setCurrentStep] = useState<
    "auth" | "documents" | "export" | "results"
  >("auth");
  const [savedCredentials, setSavedCredentials] = useState<{
    apiKey: string;
    secretKey: string;
  }>({ apiKey: "", secretKey: "" });
  const [search, setSearch] = useState("");

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
    queryKey: ["documents", search, apiKey, secretKey],
    queryFn: () => fetchDocuments({ search, apiKey, secretKey }),
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
    (element: OnshapeElementWithConfiguration) =>
      element.elementType === "PARTSTUDIO"
  );

  // Auto-select all part studios when document changes
  useEffect(() => {
    if (partStudios.length > 0) {
      setSelectedPartStudioIds(partStudios.map((studio) => studio.id));
    }
  }, [partStudios.length]);

  // Queries for parts from ALL studios (not just selected ones)
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

  // Combine all parts with studio information from ALL studios
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

  // Get only parts from selected studios for export
  const selectedParts = allParts.filter((part) =>
    selectedPartStudioIds.includes(part.elementId)
  );

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
      return fetchDocuments({ search, apiKey, secretKey });
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
    mutationFn: async ({
      perStudioConfig,
      combineByStudio,
    }: {
      perStudioConfig: PerStudioConfig;
      combineByStudio: Record<string, boolean>;
    }) => {
      if (selectedParts.length === 0 || selectedFormats.length === 0) {
        throw new Error("No parts found or no formats selected");
      }
      if (!selectedDocument) throw new Error("No document selected");
      if (selectedPartStudioIds.length === 0)
        throw new Error("No part studios selected");

      const jobs: ExportJob[] = [];

      // Create export jobs for each SELECTED part and format combination
      for (const part of selectedParts) {
        jobs.push({
          id: `${getJobId({
            elementId: part.elementId,
            partId: part.partId,
          })}`,
          documentId: selectedDocument.id,
          elementId: part.elementId,
          elementName: part.studioName,
          partId: part.partId,
          partName: part.name,
          studioName: part.studioName,
          formats: selectedFormats,
          status: "pending",
          configOptions: perStudioConfig[part.elementId] ?? [],
          combineParts: combineByStudio[part.elementId] || false,
        });
      }

      // Clean jobs: if combineByStudio is active, keep only the first job per studio
      const cleanedJobs = jobs.reduce((acc, job) => {
        if (combineByStudio[job.elementId]) {
          // Check if we already have a job for this studio
          const existingJob = acc.find((j) => j.elementId === job.elementId);
          if (!existingJob) {
            acc.push(job);
          }
        } else {
          acc.push(job);
        }
        return acc;
      }, [] as ExportJob[]);

      setExportJobs(cleanedJobs);
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

          // Pass studio-scoped params straight through
          const blob = await exportPart({
            documentId: selectedDocument.id,
            elementId: job.elementId,
            elementName: job.elementName,
            partId: job.partId,
            partName: job.partName,
            formats: job.formats,
            apiKey,
            secretKey,
            configOptions: perStudioConfig[job.elementId] ?? [],
            combineParts: combineByStudio[job.elementId] || false,
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

      await Promise.all(cleanedJobs.map(processExport));
    },
    onError: (error: Error) => {
      toast.error("Export failed", { description: error.message });
    },
  });

  const selectDocument = (document: OnshapeDocument) => {
    setSelectedDocument(document);
    setCurrentStep("export");
  };

  const resetApp = () => {
    setCurrentStep("auth");
    setSelectedDocument(null);
    setSelectedPartStudioIds([]);
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
            search={search}
            setSearch={setSearch}
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
            onExportClick={(params) => exportMutation.mutate(params)}
            isLoading={
              elementsLoading || partsLoading || exportMutation.isPending
            }
            selectedDocument={selectedDocument}
            allParts={allParts}
            selectedFormats={selectedFormats}
            setSelectedFormats={setSelectedFormats}
            partStudios={partStudios}
            selectedPartStudioIds={selectedPartStudioIds}
            setSelectedPartStudioIds={setSelectedPartStudioIds}
          />
        )}

        {/* Step 4: Export Results */}
        {currentStep === "results" && (
          <ExportResultPage
            onStartOver={resetApp}
            onBackToExport={() => setCurrentStep("export")}
            exportJobs={exportJobs}
            totalParts={totalParts}
            completedParts={completedParts}
          />
        )}
      </div>
    </div>
  );
}
