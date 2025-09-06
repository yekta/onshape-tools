import { EXPORT_FORMATS } from "@/components/constants";
import { OnshapeDocument, PartStudioPart } from "@/components/types";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { ArrowLeft, Download, Loader } from "lucide-react";

type TProps = {
  onBackClick: () => void;
  onExportClick: () => void;
  isLoading: boolean;
  selectedDocument: OnshapeDocument | null;
  allParts: PartStudioPart[];
  selectedFormats: string[];
  setSelectedFormats: (formats: string[]) => void;
};

export default function ExportConfigurationPage({
  onBackClick,
  onExportClick,
  isLoading,
  selectedDocument,
  allParts,
  selectedFormats,
  setSelectedFormats,
}: TProps) {
  return (
    <div className="w-full flex flex-col items-center gap-6">
      <Card className="w-full max-w-xl">
        <CardHeader>
          <CardTitle>Export Configuration</CardTitle>
          <CardDescription>
            {selectedDocument?.name} •{" "}
            <span className="text-foreground font-semibold">
              {allParts.length} parts found
            </span>
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <Label className="text-base font-medium">Export Formats</Label>
            <div className="w-full flex flex-col gap-4 pt-3">
              {EXPORT_FORMATS.map((format) => (
                <div
                  key={format.id}
                  className="w-full flex items-start space-x-2"
                >
                  <Checkbox
                    id={format.id}
                    checked={selectedFormats.includes(format.id)}
                    onCheckedChange={(checked) => {
                      if (checked) {
                        setSelectedFormats([...selectedFormats, format.id]);
                      } else {
                        setSelectedFormats(
                          selectedFormats.filter((f) => f !== format.id)
                        );
                      }
                    }}
                  />
                  <Label
                    htmlFor={format.id}
                    className="font-medium flex flex-col items-start gap-1"
                  >
                    {format.name}
                    <p className="text-xs text-muted-foreground">
                      {format.description}
                    </p>
                  </Label>
                </div>
              ))}
            </div>
          </div>

          <div className="w-full flex flex-col gap-2">
            <Button
              onClick={onExportClick}
              disabled={isLoading || selectedFormats.length === 0}
              className="w-full"
            >
              {isLoading ? (
                <>
                  <Loader className="h-4 w-4 animate-spin" />
                  Starting Export...
                </>
              ) : (
                <>
                  <Download className="h-4 w-4" />
                  Export All Parts ({allParts.length *
                    selectedFormats.length}{" "}
                  files)
                </>
              )}
            </Button>
            <Button className="w-full" variant="outline" onClick={onBackClick}>
              <ArrowLeft className="h-4 w-4" />
              Back
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
