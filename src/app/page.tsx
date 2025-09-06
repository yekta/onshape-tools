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

export default function OnshapeExporter() {
  const [apiKey, setApiKey] = useState("");
  const [secretKey, setSecretKey] = useState("");
  const [, setIsAuthenticated] = useState(false);
  const [documents, setDocuments] = useState<OnshapeDocument[]>([]);
  const [selectedDocument, setSelectedDocument] =
    useState<OnshapeDocument | null>(null);
  const [, setPartStudios] = useState<OnshapeElement[]>([]);
  const [allParts, setAllParts] = useState<PartStudioPart[]>([]);
  const [selectedFormats, setSelectedFormats] = useState<string[]>([
    "STL",
    "STEP",
    "SOLIDWORKS",
  ]);
  const [exportJobs, setExportJobs] = useState<ExportJob[]>([]);
  const [isLoading, setIsLoading] = useState(false);
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

  const authenticateAndLoadDocuments = async () => {
    if (!apiKey || !secretKey) {
      toast.error("Missing credentials", {
        description: "Please enter both API key and secret key",
      });
      return;
    }

    setIsLoading(true);

    // save api key and secret key as strict cookies for 14 days
    document.cookie = `onshape_api_key=${apiKey}; max-age=${
      14 * 24 * 60 * 60
    }; path=/; samesite=strict`;
    document.cookie = `onshape_secret_key=${secretKey}; max-age=${
      14 * 24 * 60 * 60
    }; path=/; samesite=strict`;

    try {
      const response = await fetch("/api/onshape/documents", {
        method: "GET",
        headers: {
          Authorization: `Basic ${btoa(`${apiKey}:${secretKey}`)}`,
        },
      });

      if (!response.ok) {
        throw new Error(`Authentication failed: ${response.statusText}`);
      }

      const data = await response.json();
      setDocuments(data.items || []);
      setIsAuthenticated(true);
      setCurrentStep("documents");
    } catch (error) {
      toast.error("Authentication failed", {
        description:
          error instanceof Error
            ? error.message
            : "Failed to authenticate with Onshape",
      });
    } finally {
      setIsLoading(false);
    }
  };

  const selectDocument = async (document: OnshapeDocument) => {
    setSelectedDocument(document);
    setIsLoading(true);

    try {
      // Get document elements
      const elementsResponse = await fetch(
        `/api/onshape/documents/${document.id}/elements`,
        {
          headers: {
            Authorization: `Basic ${btoa(`${apiKey}:${secretKey}`)}`,
          },
        }
      );

      if (!elementsResponse.ok) {
        throw new Error("Failed to load document elements");
      }

      const elementsData = await elementsResponse.json();
      const studios = elementsData.filter(
        (element: OnshapeElement) => element.elementType === "PARTSTUDIO"
      );
      setPartStudios(studios);

      // Get all parts from all part studios
      const allPartsPromises = studios.map(async (studio: OnshapeElement) => {
        try {
          const partsResponse = await fetch(
            `/api/onshape/documents/${document.id}/elements/${studio.id}/parts`,
            {
              headers: {
                Authorization: `Basic ${btoa(`${apiKey}:${secretKey}`)}`,
              },
            }
          );

          if (partsResponse.ok) {
            const partsData = await partsResponse.json();
            return partsData.map((part: any) => ({
              partId: part.partId,
              name: part.name,
              elementId: studio.id,
              studioName: studio.name, // Include studio name for identification
            }));
          }
          return [];
        } catch {
          return [];
        }
      });

      const partsArrays = await Promise.all(allPartsPromises);
      const flatParts = partsArrays.flat();
      setAllParts(flatParts);
      setCurrentStep("export");
    } catch (error) {
      toast.error("Failed to load document", {
        description: error instanceof Error ? error.message : "Unknown error",
      });
    } finally {
      setIsLoading(false);
    }
  };

  const startExport = async () => {
    if (allParts.length === 0 || selectedFormats.length === 0) {
      toast.error("Nothing to export", {
        description: "No parts found or no formats selected",
      });
      return;
    }

    const jobs: ExportJob[] = [];

    if (!selectedDocument) {
      toast.error("No document selected", {
        description: "Please select a document before exporting",
      });
      return;
    }

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

    const processedJobs = new Set<string>();

    const processExport = async (job: ExportJob) => {
      if (processedJobs.has(job.id)) {
        return;
      }
      processedJobs.add(job.id);

      try {
        const part = allParts.find((p) => p.elementId === job.elementId);
        if (!part) return;

        setExportJobs((prev) =>
          prev.map((j) =>
            j.id === job.id && j.status === "pending"
              ? { ...j, status: "exporting" }
              : j
          )
        );

        console.log("[v0] Starting export for", job.partName, job.format);

        const response = await fetch("/api/onshape/export", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Basic ${btoa(`${apiKey}:${secretKey}`)}`,
          },
          body: JSON.stringify({
            documentId: selectedDocument.id,
            elementId: part.elementId,
            partId: part.partId,
            format: job.format,
          }),
        });

        if (response.ok) {
          const blob = await response.blob();
          setExportJobs((prev) =>
            prev.map((j) =>
              j.id === job.id && j.status !== "done"
                ? {
                    ...j,
                    status: "done",
                    blob: blob,
                  }
                : j
            )
          );
        } else {
          const errorData = await response
            .json()
            .catch(() => ({ error: response.statusText }));
          throw new Error(
            errorData.error || `Export failed: ${response.statusText}`
          );
        }
      } catch (error) {
        console.log("[v0] Error exporting part:", error);
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

    const allJobPromises = jobs.map((job) => processExport(job));
    await Promise.all(allJobPromises);
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

    // Create a simple archive by downloading each file individually
    // In a real implementation, you'd want to use a ZIP library
    for (const job of completedJobs) {
      downloadFile(job);
      // Small delay between downloads to avoid overwhelming the browser
      await new Promise((resolve) => setTimeout(resolve, 100));
    }

    toast("Download started", {
      description: `Downloading ${completedJobs.length} files`,
    });
  };

  const resetApp = () => {
    setCurrentStep("auth");
    setSelectedDocument(null);
    setPartStudios([]);
    setAllParts([]);
    setExportJobs([]);
    setDocuments([]);
    setIsAuthenticated(false);
  };

  return (
    <div className="w-full min-h-screen pt-8 px-4 pb-16 flex flex-col items-center">
      <div className="w-full max-w-5xl space-y-6">
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
            onConnect={authenticateAndLoadDocuments}
            isLoading={isLoading}
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
            isLoading={isLoading}
            selectedDocument={selectedDocument}
          />
        )}

        {/* Step 3: Export Configuration */}
        {currentStep === "export" && (
          <ExportConfigurationPage
            onBackClick={() => setCurrentStep("documents")}
            onExportClick={startExport}
            isLoading={isLoading}
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
          />
        )}
      </div>
    </div>
  );
}
