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
import {
  ArrowLeft,
  Download,
  Loader,
  Package,
  SettingsIcon,
} from "lucide-react";

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
          <CardTitle className="flex items-center gap-1.5">
            <SettingsIcon className="h-5 w-5" />
            Export Configuration
          </CardTitle>
          <CardDescription>
            {selectedDocument?.name} •{" "}
            <span className="text-foreground font-semibold">
              {isLoading
                ? "Checking for parts..."
                : `${allParts.length} parts found`}
            </span>
          </CardDescription>
        </CardHeader>
        <CardContent className="w-full flex flex-col items-start gap-6">
          <Button variant="outline" onClick={onBackClick}>
            <ArrowLeft className="h-4 w-4" />
            Back to Documents
          </Button>
          {/* Export Formats */}
          <div className="w-full flex flex-col -mt-1.5">
            <Label className="text-base font-medium">Export Formats</Label>
            <div className="w-full flex flex-col pt-3">
              {EXPORT_FORMATS.map((format) => (
                <Label
                  key={format.id}
                  htmlFor={format.id}
                  className="w-[calc(100%+1rem)] flex items-start gap-0 cursor-pointer hover:bg-accent active:bg-accent py-2 first:-mt-2 px-2 rounded -mx-2"
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
                  <p className="flex-1 pl-2 font-medium flex flex-col items-start gap-1 cursor-pointer">
                    {format.name}
                    <span className="text-xs text-muted-foreground">
                      {format.description}
                    </span>
                  </p>
                </Label>
              ))}
            </div>
          </div>
          {/* Part Studio Selection */}
          <div className="w-full flex flex-col">
            <Label className="text-base font-medium">Part Studios</Label>
            <div className="w-full flex flex-col gap-3 pt-3">
              {/* Select All Option */}
              <Label
                htmlFor="select-all-studios"
                className="w-[calc(100%+1rem)] flex items-start gap-0 cursor-pointer hover:bg-accent active:bg-accent py-2 first:-mt-2 px-2 rounded -mx-2"
              >
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
                <p className="font-medium flex-1 pl-2 cursor-pointer">
                  {allStudiosSelected ? "Deselect" : "Select"} All (
                  {partStudios.length})
                </p>
              </Label>
              <hr className="border-t border-border -mt-2" />

              {/* Individual Studios */}
              {isLoading && (
                <div className="w-full flex gap-2 items-center justify-center px-6 text-muted-foreground">
                  <Loader className="h-4 w-4 animate-spin" />
                  <p className="leading-tight text-sm">Checking for parts...</p>
                </div>
              )}
              {!isLoading && (
                <div className="w-full flex flex-col">
                  {partStudios.map((studio) => {
                    const partCount = getPartCountForStudio(studio.id);
                    const selectedPartCount = getSelectedPartCountForStudio(
                      studio.id
                    );
                    return (
                      <Label
                        key={studio.id}
                        htmlFor={studio.id}
                        className="w-[calc(100%+1rem)] flex items-start gap-0 cursor-pointer hover:bg-accent active:bg-accent py-2 first:-mt-2 px-2 rounded -mx-2"
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
                        <p className="font-medium pl-2 flex flex-col items-start gap-1 cursor-pointer">
                          {studio.name}
                          <span className="text-xs text-muted-foreground">
                            {selectedPartCount}/{partCount} parts selected
                          </span>
                        </p>
                      </Label>
                    );
                  })}
                </div>
              )}
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
                  <Package className="h-4 w-4" />
                  Export Parts ({selectedPartsCount *
                    selectedFormats.length}{" "}
                  files)
                </>
              )}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
