"use client";

import { useState } from "react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import {
  Loader2,
  Download,
  FileText,
  Settings,
  CheckCircle,
  AlertCircle,
  Package,
} from "lucide-react";
import { toast } from "sonner";

interface OnshapeDocument {
  id: string;
  name: string;
  href: string;
  public: boolean;
  permission: string;
}

interface OnshapeElement {
  id: string;
  name: string;
  elementType: string;
  dataType: string;
}

interface PartStudioPart {
  partId: string;
  name: string;
  elementId: string;
  studioName: string; // Added studio name for better identification
}

interface ExportJob {
  id: string;
  documentId: string; // Added documentId for better identification
  elementId: string; // Added elementId for better identification
  partId: string; // Added partId for unique identification
  partName: string;
  studioName: string; // Added studio name for context
  format: string;
  status: "pending" | "exporting" | "done" | "failed";
  downloadUrl?: string;
  error?: string;
  blob?: Blob; // Store blob data for bulk download
}

const EXPORT_FORMATS = [
  { id: "STL", name: "STL", description: "Stereolithography format" },
  {
    id: "STEP",
    name: "STEP",
    description: "Standard for Exchange of Product Data",
  },
  {
    id: "SOLIDWORKS",
    name: "SolidWorks",
    description: "SolidWorks native format",
  },
];

export default function OnshapeExporter() {
  const [apiKey, setApiKey] = useState("");
  const [secretKey, setSecretKey] = useState("");
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [documents, setDocuments] = useState<OnshapeDocument[]>([]);
  const [selectedDocument, setSelectedDocument] =
    useState<OnshapeDocument | null>(null);
  const [partStudios, setPartStudios] = useState<OnshapeElement[]>([]);
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

  const authenticateAndLoadDocuments = async () => {
    if (!apiKey || !secretKey) {
      toast.error("Missing credentials", {
        description: "Please enter both API key and secret key",
      });
      return;
    }

    setIsLoading(true);
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

    console.log("Export jobs", jobs);

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

    toast("Export completed", {
      description: `Processed ${jobs.length} export jobs`,
    });
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
    <div className="min-h-screen bg-background p-4">
      <div className="max-w-4xl mx-auto space-y-6">
        <div className="text-center space-y-2">
          <h1 className="text-3xl font-bold">Onshape Bulk Exporter</h1>
          <p className="text-muted-foreground">
            Export all parts from Onshape documents in STL, STEP, and SolidWorks
            formats
          </p>
        </div>

        {/* Step 1: Authentication */}
        {currentStep === "auth" && (
          <div className="flex justify-center">
            <Card className="w-full max-w-md">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Settings className="h-5 w-5" />
                  Authentication
                </CardTitle>
                <CardDescription>
                  Enter your Onshape API credentials to get started
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="apiKey">API Key</Label>
                  <Input
                    id="apiKey"
                    type="password"
                    placeholder="Your Onshape API key"
                    value={apiKey}
                    onChange={(e) => setApiKey(e.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="secretKey">Secret Key</Label>
                  <Input
                    id="secretKey"
                    type="password"
                    placeholder="Your Onshape secret key"
                    value={secretKey}
                    onChange={(e) => setSecretKey(e.target.value)}
                  />
                </div>
                <Button
                  onClick={authenticateAndLoadDocuments}
                  disabled={isLoading}
                  className="w-full"
                >
                  {isLoading ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Authenticating...
                    </>
                  ) : (
                    "Connect to Onshape"
                  )}
                </Button>
              </CardContent>
            </Card>
          </div>
        )}

        {/* Step 2: Document Selection */}
        {currentStep === "documents" && (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <FileText className="h-5 w-5" />
                Select Document
              </CardTitle>
              <CardDescription>
                Choose an Onshape document to export parts from
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                {documents.map((doc) => (
                  <div
                    key={doc.id}
                    className="flex items-center justify-between p-3 border rounded-lg hover:bg-accent cursor-pointer transition-colors"
                    onClick={() => selectDocument(doc)}
                  >
                    <div>
                      <h3 className="font-medium">{doc.name}</h3>
                      <div className="flex gap-2 mt-1">
                        <Badge variant={doc.public ? "secondary" : "default"}>
                          {doc.public ? "Public" : "Private"}
                        </Badge>
                        <Badge variant="outline">{doc.permission}</Badge>
                      </div>
                    </div>
                    {isLoading && selectedDocument?.id === doc.id ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : null}
                  </div>
                ))}
              </div>
              <Button
                variant="outline"
                onClick={resetApp}
                className="mt-4 bg-transparent"
              >
                Back to Authentication
              </Button>
            </CardContent>
          </Card>
        )}

        {/* Step 3: Export Configuration */}
        {currentStep === "export" && (
          <div className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle>Export Configuration</CardTitle>
                <CardDescription>
                  Document: {selectedDocument?.name} • {allParts.length} parts
                  found
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div>
                  <Label className="text-base font-medium">
                    Export Formats
                  </Label>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mt-2">
                    {EXPORT_FORMATS.map((format) => (
                      <div
                        key={format.id}
                        className="flex items-start space-x-2"
                      >
                        <Checkbox
                          id={format.id}
                          checked={selectedFormats.includes(format.id)}
                          onCheckedChange={(checked) => {
                            if (checked) {
                              setSelectedFormats([
                                ...selectedFormats,
                                format.id,
                              ]);
                            } else {
                              setSelectedFormats(
                                selectedFormats.filter((f) => f !== format.id)
                              );
                            }
                          }}
                        />
                        <div className="grid gap-1.5 leading-none">
                          <Label htmlFor={format.id} className="font-medium">
                            {format.name}
                          </Label>
                          <p className="text-xs text-muted-foreground">
                            {format.description}
                          </p>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="flex gap-2">
                  <Button
                    onClick={startExport}
                    disabled={isLoading || selectedFormats.length === 0}
                    className="flex-1"
                  >
                    {isLoading ? (
                      <>
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        Starting Export...
                      </>
                    ) : (
                      <>
                        <Download className="mr-2 h-4 w-4" />
                        Export All Parts (
                        {allParts.length * selectedFormats.length} files)
                      </>
                    )}
                  </Button>
                  <Button
                    variant="outline"
                    onClick={() => setCurrentStep("documents")}
                  >
                    Back
                  </Button>
                </div>
              </CardContent>
            </Card>
          </div>
        )}

        {/* Step 4: Export Results */}
        {currentStep === "results" && (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center justify-between">
                Export Results
                <Button
                  onClick={downloadAllFiles}
                  disabled={
                    exportJobs.filter((j) => j.status === "done").length ===
                      0 ||
                    exportJobs.some(
                      (j) => j.status === "pending" || j.status === "exporting"
                    )
                  }
                  variant="outline"
                  size="sm"
                >
                  {exportJobs.some(
                    (j) => j.status === "pending" || j.status === "exporting"
                  ) ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Processing...
                    </>
                  ) : (
                    <>
                      <Package className="mr-2 h-4 w-4" />
                      Download All (
                      {exportJobs.filter((j) => j.status === "done").length})
                    </>
                  )}
                </Button>
              </CardTitle>
              <CardDescription>
                Track the progress of your export jobs
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-2 max-h-96 overflow-y-auto">
                {exportJobs.map((job) => (
                  <div
                    key={job.id + job.studioName + job.partName + job.partId}
                    className="flex items-center justify-between p-3 border rounded-lg"
                  >
                    <div className="flex items-center gap-3">
                      {job.status === "pending" && (
                        <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                      )}
                      {job.status === "exporting" && (
                        <Loader2 className="h-4 w-4 animate-spin text-blue-500" />
                      )}
                      {job.status === "done" && (
                        <CheckCircle className="h-4 w-4 text-green-500" />
                      )}
                      {job.status === "failed" && (
                        <AlertCircle className="h-4 w-4 text-red-500" />
                      )}

                      <div>
                        <p className="font-medium">
                          {job.studioName} → {job.partName}
                        </p>
                        <p className="text-sm text-muted-foreground">
                          {job.format} • Document ID:{" "}
                          {job.documentId.slice(0, 4)} • Element ID:{" "}
                          {job.elementId.slice(0, 4)} • Part ID: {job.partId}
                        </p>
                        {job.error && (
                          <p className="text-sm text-red-500">{job.error}</p>
                        )}
                      </div>
                    </div>

                    <div className="flex items-center gap-2">
                      <Badge
                        variant={
                          job.status === "done"
                            ? "default"
                            : job.status === "failed"
                            ? "destructive"
                            : "secondary"
                        }
                        className={
                          job.status === "done"
                            ? "bg-green-500 hover:bg-green-600 text-white"
                            : job.status === "exporting"
                            ? "bg-blue-500 hover:bg-blue-600 text-white"
                            : ""
                        }
                      >
                        {job.status}
                      </Badge>
                    </div>
                  </div>
                ))}
              </div>

              <div className="flex gap-2 mt-4">
                <Button variant="outline" onClick={resetApp}>
                  Start Over
                </Button>
                <Button
                  variant="outline"
                  onClick={() => setCurrentStep("export")}
                >
                  Back to Export
                </Button>
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}

function getJobId({
  elementId,
  partId,
  format,
}: {
  elementId: string;
  partId: string;
  format: string;
}) {
  return `${elementId}-${partId}-${format}`;
}
