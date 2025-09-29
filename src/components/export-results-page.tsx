import { ExportJob } from "@/components/types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  AlertCircle,
  ArrowLeft,
  CheckCircle,
  Download,
  Loader,
  Package,
} from "lucide-react";
import { toast } from "sonner";

type TProps = {
  onStartOver: () => void;
  onBackToExport: () => void;
  exportJobs: ExportJob[];
  totalParts: number;
  completedParts: number;
};

export default function ExportResultsPage({
  onBackToExport,
  exportJobs,
  totalParts,
  completedParts,
}: TProps) {
  async function downloadAllFiles() {
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
  }

  return (
    <div className="w-full flex flex-col items-center">
      <Card className="w-full max-w-xl">
        <CardHeader>
          <CardTitle className="flex items-center gap-1.5">
            <Package className="h-5 w-5" />
            Export Results
          </CardTitle>
          <CardDescription>
            Track the progress of your export jobs
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="w-full flex flex-wrap gap-2">
            <Button variant="outline" onClick={onBackToExport}>
              <ArrowLeft className="h-4 w-4" />
              Back to Export
            </Button>
          </div>
          <Button
            className="mt-3 w-full"
            onClick={downloadAllFiles}
            disabled={
              exportJobs.filter((j) => j.status === "done").length === 0 ||
              exportJobs.some(
                (j) => j.status === "pending" || j.status === "exporting"
              )
            }
            variant="default"
          >
            {exportJobs.some(
              (j) => j.status === "pending" || j.status === "exporting"
            ) ? (
              <>
                <Loader className="h-4 w-4 animate-spin" />
                Processing ({completedParts}/{totalParts})...
              </>
            ) : (
              <>
                <Download className="h-4 w-4" />
                Download All (
                {exportJobs.filter((j) => j.status === "done").length})
              </>
            )}
          </Button>
          <div className="w-full flex flex-col gap-2 pt-3">
            {exportJobs.map((job) => (
              <div
                key={job.id + job.studioName + job.partName + job.partId}
                className="w-full flex items-center justify-between p-3 border rounded-lg gap-8"
              >
                <div className=" flex items-center gap-3">
                  {job.status === "pending" && (
                    <Loader className="h-4 w-4 animate-spin text-muted-foreground" />
                  )}
                  {job.status === "exporting" && (
                    <Loader className="h-4 w-4 animate-spin text-process" />
                  )}
                  {job.status === "done" && (
                    <CheckCircle className="h-4 w-4 text-success" />
                  )}
                  {job.status === "failed" && (
                    <AlertCircle className="h-4 w-4 text-destructive" />
                  )}

                  <div className="flex-1 min-w-0 flex flex-col">
                    <p className="font-medium leading-tight text-balance">
                      {job.studioName}
                      {job.combineParts ? " (Combined)" : ` → ${job.partName}`}
                    </p>
                    <p className="text-xs text-muted-foreground text-balance leading-tight mt-1">
                      Document ID: {job.documentId.slice(0, 4)} • Element ID:{" "}
                      {job.elementId.slice(0, 4)} • Part ID: {job.partId}
                    </p>
                    {job.error && (
                      <p className="text-sm text-destructive leading-tight mt-2">
                        {job.error}
                      </p>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink min-w-0 w-24 justify-end">
                  <Badge
                    variant={
                      job.status === "done"
                        ? "default"
                        : job.status === "failed"
                        ? "destructive"
                        : "secondary"
                    }
                    className={`${
                      job.status === "done"
                        ? "bg-success text-background"
                        : job.status === "exporting"
                        ? "bg-process text-background"
                        : ""
                    } rounded-full`}
                  >
                    {statusToStatusText(job.status)}
                  </Badge>
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function statusToStatusText(status: string) {
  switch (status) {
    case "pending":
      return "Pending";
    case "exporting":
      return "Exporting";
    case "done":
      return "Done";
    case "failed":
      return "Failed";
    default:
      return status;
  }
}

function downloadFile(job: ExportJob) {
  if (!job.blob) return;

  const url = URL.createObjectURL(job.blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${job.studioName}${
    job.combineParts ? " - Combined" : ` - ${job.partName}`
  }.zip`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
