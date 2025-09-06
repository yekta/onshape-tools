import { EXPORT_FORMATS } from "@/components/constants";
import {
  OnshapeDocument,
  OnshapeElement,
  PartStudioPart,
} from "@/components/types";
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
  partStudios: OnshapeElement[];
  selectedPartStudioIds: string[];
  setSelectedPartStudioIds: (ids: string[]) => void;
};

export default function ExportConfigurationPage({
  onBackClick,
  onExportClick,
  isLoading,
  selectedDocument,
  allParts,
  selectedFormats,
  setSelectedFormats,
  partStudios,
  selectedPartStudioIds,
  setSelectedPartStudioIds,
}: TProps) {
  // Count parts per studio
  const getPartCountForStudio = (studioId: string) => {
    return allParts.filter((part) => part.elementId === studioId).length;
  };

  // Get selected parts count for a studio
  const getSelectedPartCountForStudio = (studioId: string) => {
    const isStudioSelected = selectedPartStudioIds.includes(studioId);
    return isStudioSelected ? getPartCountForStudio(studioId) : 0;
  };

  const allStudiosSelected =
    selectedPartStudioIds.length === partStudios.length;

  const selectedPartsCount = allParts.filter((part) =>
    selectedPartStudioIds.includes(part.elementId)
  ).length;

  return (
    <div className="w-full flex flex-col items-center gap-6">
      <Card className="w-full max-w-xl">
        <CardHeader>
          <CardTitle>Export Configuration</CardTitle>
          <CardDescription>
            {selectedDocument?.name} •{" "}
            <span className="text-foreground font-semibold">
              {isLoading
                ? "Checking for parts..."
                : `${allParts.length} parts found`}
            </span>
          </CardDescription>
        </CardHeader>
        <CardContent className="w-full flex flex-col gap-6">
          {/* Export Formats */}
          <div className="w-full flex flex-col">
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
                    className="font-medium flex flex-col items-start gap-1 cursor-pointer"
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
          {/* Part Studio Selection */}
          <div className="w-full flex flex-col">
            <Label className="text-base font-medium">Part Studios</Label>
            <div className="w-full flex flex-col gap-3 pt-3">
              {/* Select All Option */}
              <div className="w-full flex items-center space-x-2 pb-2 border-b">
                <Checkbox
                  id="select-all-studios"
                  checked={allStudiosSelected}
                  onCheckedChange={(checked) => {
                    if (checked) {
                      setSelectedPartStudioIds(partStudios.map((s) => s.id));
                    } else {
                      setSelectedPartStudioIds([]);
                    }
                  }}
                />
                <Label
                  htmlFor="select-all-studios"
                  className="font-medium cursor-pointer"
                >
                  Select All ({partStudios.length})
                </Label>
              </div>

              {/* Individual Studios */}
              {isLoading && (
                <div className="w-full flex gap-2 items-center justify-center px-6 text-muted-foreground">
                  <Loader className="h-4 w-4 animate-spin" />
                  <p className="leading-tight text-sm">Checking for parts...</p>
                </div>
              )}
              {!isLoading &&
                partStudios.map((studio) => {
                  const partCount = getPartCountForStudio(studio.id);
                  const selectedPartCount = getSelectedPartCountForStudio(
                    studio.id
                  );
                  return (
                    <div
                      key={studio.id}
                      className="w-full flex items-start space-x-2"
                    >
                      <Checkbox
                        id={studio.id}
                        checked={selectedPartStudioIds.includes(studio.id)}
                        onCheckedChange={(checked) => {
                          if (checked) {
                            setSelectedPartStudioIds([
                              ...selectedPartStudioIds,
                              studio.id,
                            ]);
                          } else {
                            setSelectedPartStudioIds(
                              selectedPartStudioIds.filter(
                                (id) => id !== studio.id
                              )
                            );
                          }
                        }}
                      />
                      <Label
                        htmlFor={studio.id}
                        className="font-medium flex flex-col items-start gap-1 cursor-pointer"
                      >
                        {studio.name}
                        <p className="text-xs text-muted-foreground">
                          {selectedPartCount}/{partCount} parts selected
                        </p>
                      </Label>
                    </div>
                  );
                })}
            </div>
          </div>

          {/* Action Buttons */}
          <div className="w-full flex flex-col gap-2">
            <Button
              onClick={onExportClick}
              disabled={
                isLoading ||
                selectedFormats.length === 0 ||
                selectedPartStudioIds.length === 0 ||
                selectedPartsCount === 0
              }
              className="w-full"
            >
              {isLoading ? (
                <>
                  <Loader className="h-4 w-4 animate-spin" />
                  Checking for Parts...
                </>
              ) : (
                <>
                  <Download className="h-4 w-4" />
                  Export Selected Parts (
                  {selectedPartsCount * selectedFormats.length} files)
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
