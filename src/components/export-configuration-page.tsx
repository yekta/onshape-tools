import ConfigParamInput from "@/components/config-param-input";
import {
  DEFAULT_ANGLE_TOLERANCE,
  DEFAULT_CHORD_TOLERANCE,
  DEFAULT_MIN_FACET_WIDTH,
  EXPORT_FORMATS,
} from "@/components/constants";
import {
  ConfigOption,
  ConfigurationParameter,
  OnshapeDocument,
  OnshapeElementWithConfiguration,
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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ArrowLeft, Loader, Package, SettingsIcon } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

// ---------- Props ----------
export type PerStudioConfig = Record<string, ConfigOption[]>;

export type ExportConfigurationPageProps = {
  onBackClick: () => void;
  // ⬇️ now passes per-studio combine map too
  onExportClick: (args: {
    perStudioConfig: PerStudioConfig;
    combineByStudio: Record<string, boolean>;
  }) => void;
  isLoading: boolean;
  selectedDocument: OnshapeDocument | null;
  allParts: PartStudioPart[];
  selectedFormats: string[];
  setSelectedFormats: (formats: string[]) => void;
  partStudios: OnshapeElementWithConfiguration[]; // already includes .configuration
  selectedPartStudioIds: string[];
  setSelectedPartStudioIds: (ids: string[]) => void;
  minFacetWidth: string;
  setMinFacetWidth: (width: string) => void;
  angleTolerance: string;
  setAngleTolerance: (angle: string) => void;
  chordTolerance: string;
  setChordTolerance: (chord: string) => void;
};

function parseCSVValues(raw: string): (string | number)[] {
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => {
      if (/^[-+]?\d+(?:\.\d+)?$/.test(s)) {
        const n = Number(s);
        return Number.isFinite(n) ? n : s;
      }
      return s; // keep true/false as strings; coerce server-side
    });
}

function humanCount(n: number) {
  return n.toLocaleString();
}

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
  minFacetWidth,
  setMinFacetWidth,
  angleTolerance,
  setAngleTolerance,
  chordTolerance,
  setChordTolerance,
}: ExportConfigurationPageProps) {
  // ---------- per-studio combine toggle ----------
  const [combineByStudio, setCombineByStudio] = useState<
    Record<string, boolean>
  >({});

  // ---------- seed per-studio combine default + param inputs ----------
  const [studioInputs, setStudioInputs] = useState<
    Record<string, Record<string, string>>
  >({});

  useEffect(() => {
    setStudioInputs((prev) => {
      const next: Record<string, Record<string, string>> = {};
      for (const studio of partStudios) {
        const params: any[] = studio.configuration?.parameters ?? [];
        const existing = prev[studio.id] || {};
        const map: Record<string, string> = {};
        for (const p of params) {
          const key = p?.parameterId || p?.name;
          if (!key) continue;
          map[key] = existing[key] ?? "";
        }
        next[studio.id] = map;
      }
      return next;
    });

    setCombineByStudio((prev) => {
      const next: Record<string, boolean> = { ...prev };
      for (const studio of partStudios) {
        if (next[studio.id] === undefined) {
          next[studio.id] = false; // default: combine
        }
      }
      // prune removed studios
      Object.keys(next).forEach((id) => {
        if (!partStudios.find((s) => s.id === id)) delete next[id];
      });
      return next;
    });
  }, [partStudios]);

  // Counts
  const getPartCountForStudio = (studioId: string) =>
    allParts.filter((part) => part.elementId === studioId).length;

  const getSelectedPartCountForStudio = (studioId: string) =>
    selectedPartStudioIds.includes(studioId)
      ? getPartCountForStudio(studioId)
      : 0;

  const allStudiosSelected =
    selectedPartStudioIds.length === partStudios.length;

  const selectedPartsCount = useMemo(
    () =>
      allParts.filter((p) => selectedPartStudioIds.includes(p.elementId))
        .length,
    [allParts, selectedPartStudioIds]
  );

  // Build parsed config per studio from inputs (ignore empty rows)
  const perStudioParsed: PerStudioConfig = useMemo(() => {
    const out: PerStudioConfig = {};
    for (const studio of partStudios) {
      const params: ConfigurationParameter[] =
        studio.configuration?.configurationParameters ?? [];
      const inputs = studioInputs[studio.id] || {};
      const rows: ConfigOption[] = [];

      for (const p of params) {
        const key = p?.parameterId || p?.parameterName;
        if (!key) continue;
        const raw = (inputs[key] ?? "").trim();
        if (!raw) continue;
        const values = parseCSVValues(raw);
        if (values.length > 0)
          rows.push({
            key,
            keyDisplay: p.parameterName,
            values,
            unit: p.rangeAndDefault?.units ?? "",
          });
      }
      out[studio.id] = rows;
    }
    return out;
  }, [partStudios, studioInputs]);

  // For preview: combinations per selected studio (empty => 1)
  const perStudioComboCount = useMemo(() => {
    const m: Record<string, number> = {};
    for (const id of selectedPartStudioIds) {
      const opts = perStudioParsed[id] || [];
      const combos =
        opts.length === 0
          ? 1
          : opts.reduce((acc, o) => acc * Math.max(1, o.values.length), 1);
      m[id] = combos;
    }
    return m;
  }, [perStudioParsed, selectedPartStudioIds]);

  // Total file count (per-studio combine aware)
  const totalFiles = useMemo(() => {
    const fmtCount = selectedFormats.length;
    let sum = 0;
    for (const id of selectedPartStudioIds) {
      const combos = perStudioComboCount[id] || 1;
      const unit = combineByStudio[id] ? 1 : getPartCountForStudio(id);
      sum += unit * fmtCount * combos;
    }
    return sum;
  }, [
    selectedFormats.length,
    selectedPartStudioIds,
    perStudioComboCount,
    combineByStudio,
  ]);

  const exportDisabled =
    isLoading ||
    selectedFormats.length === 0 ||
    selectedPartStudioIds.length === 0 ||
    // if any selected studio is *not* combined, ensure there is at least one selected part in total
    (!selectedPartStudioIds.every((id) => combineByStudio[id]) &&
      selectedPartsCount === 0);

  const handleExport = () => {
    const payload: PerStudioConfig = {};
    for (const id of selectedPartStudioIds) {
      payload[id] = perStudioParsed[id] || [];
    }
    onExportClick({ perStudioConfig: payload, combineByStudio });
  };

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
                      if (checked)
                        setSelectedFormats([...selectedFormats, format.id]);
                      else
                        setSelectedFormats(
                          selectedFormats.filter((f) => f !== format.id)
                        );
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
          {/* STL Quality Settings */}
          <div className="w-full flex flex-col -mt-1.5">
            <Label className="text-base font-medium">
              STL Quality Settings
            </Label>
            <div className="w-full flex flex-col pt-3">
              <Label className="w-[calc(100%+1rem)] items-start flex flex-col gap-0 py-2 first:-mt-2 px-2 rounded -mx-2">
                <p className="w-full text-left px-1 text-muted-foreground text-sm">
                  Minimum Facet Width
                </p>
                <Input
                  className="mt-1"
                  placeholder={DEFAULT_MIN_FACET_WIDTH}
                  value={minFacetWidth}
                  onChange={(e) => {
                    setMinFacetWidth(e.target.value);
                  }}
                />
              </Label>
              <Label className="w-[calc(100%+1rem)] items-start flex flex-col gap-0 py-2 first:-mt-2 px-2 rounded -mx-2">
                <p className="w-full text-left px-1 text-muted-foreground text-sm">
                  Angle Tolerance
                </p>
                <Input
                  className="mt-1"
                  placeholder={DEFAULT_ANGLE_TOLERANCE}
                  value={angleTolerance}
                  onChange={(e) => {
                    setAngleTolerance(e.target.value);
                  }}
                />
              </Label>
              <Label className="w-[calc(100%+1rem)] items-start flex flex-col gap-0 py-2 first:-mt-2 px-2 rounded -mx-2">
                <p className="w-full text-left px-1 text-muted-foreground text-sm">
                  Chord Tolerance
                </p>
                <Input
                  className="mt-1"
                  placeholder={DEFAULT_CHORD_TOLERANCE}
                  value={chordTolerance}
                  onChange={(e) => {
                    setChordTolerance(e.target.value);
                  }}
                />
              </Label>
            </div>
          </div>
          {/* Part Studio Selection + Parameters (auto-listed) */}
          <div className="w-full flex flex-col">
            <Label className="text-base font-medium">Part Studios</Label>
            <div className="w-full flex flex-col gap-3 pt-3">
              {/* Select All */}
              <Label
                htmlFor="select-all-studios"
                className="w-[calc(100%+1rem)] flex items-start gap-0 cursor-pointer hover:bg-accent active:bg-accent py-2 first:-mt-2 px-2 rounded -mx-2"
              >
                <Checkbox
                  id="select-all-studios"
                  checked={allStudiosSelected}
                  onCheckedChange={(checked) => {
                    if (checked)
                      setSelectedPartStudioIds(partStudios.map((s) => s.id));
                    else setSelectedPartStudioIds([]);
                  }}
                />
                <p className="font-medium flex-1 pl-2 cursor-pointer">
                  {allStudiosSelected ? "Deselect" : "Select"} All (
                  {partStudios.length})
                </p>
              </Label>
              <hr className="border-t border-border -mt-2" />

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
                    const params =
                      studio.configuration?.configurationParameters ?? [];

                    return (
                      <div key={studio.id} className="w-full rounded-md">
                        <Label
                          htmlFor={studio.id}
                          className="w-[calc(100%+1rem)] hover:bg-accent flex items-start gap-0 cursor-pointer py-2 px-2 rounded -mx-2"
                        >
                          <Checkbox
                            id={studio.id}
                            checked={selectedPartStudioIds.includes(studio.id)}
                            onCheckedChange={(checked) => {
                              if (checked)
                                setSelectedPartStudioIds([
                                  ...selectedPartStudioIds,
                                  studio.id,
                                ]);
                              else
                                setSelectedPartStudioIds(
                                  selectedPartStudioIds.filter(
                                    (id) => id !== studio.id
                                  )
                                );
                            }}
                          />
                          <p className="font-medium pl-2 flex flex-col items-start gap-1 cursor-pointer">
                            {studio.name}
                            <span className="text-xs text-muted-foreground">
                              {combineByStudio[studio.id]
                                ? `${selectedPartCount} parts combined`
                                : `${selectedPartCount}/${partCount} part${
                                    partCount === 1 ? "" : "s"
                                  } selected`}
                            </span>
                            <span className="text-[11px] text-muted-foreground">
                              {params.length
                                ? `${params.length} parameter${
                                    params.length === 1 ? "" : "s"
                                  }`
                                : "No configurable parameters"}
                            </span>
                          </p>
                        </Label>

                        {/* Per-studio combine toggle */}
                        {partCount > 1 && (
                          <div className="pl-7 -mt-1 mb-2">
                            <Label
                              htmlFor={`combine-${studio.id}`}
                              className="w-[calc(100%+1rem)] flex items-center gap-0 cursor-pointer hover:bg-accent active:bg-accent py-1.5 px-2 rounded -mx-2"
                            >
                              <Checkbox
                                id={`combine-${studio.id}`}
                                checked={!!combineByStudio[studio.id]}
                                onCheckedChange={(checked) =>
                                  setCombineByStudio((m) => ({
                                    ...m,
                                    [studio.id]: !!checked,
                                  }))
                                }
                              />
                              <p className="pl-2 text-sm cursor-pointer">
                                Combine parts
                              </p>
                            </Label>
                          </div>
                        )}

                        {/* Auto-listed parameters */}
                        {params.length > 0 && (
                          <div className="mb-4 space-y-2 mt-2 pl-7">
                            {params.map((param) => {
                              const key =
                                param?.parameterId || param?.parameterName;
                              if (!key) return null;

                              const val = studioInputs[studio.id]?.[key] ?? "";
                              return (
                                <ConfigParamInput
                                  key={`${studio.id}-${key}`}
                                  studioId={studio.id}
                                  param={param}
                                  value={val}
                                  onChange={(next) =>
                                    setStudioInputs((m) => ({
                                      ...m,
                                      [studio.id]: {
                                        ...(m[studio.id] || {}),
                                        [key]: next,
                                      },
                                    }))
                                  }
                                />
                              );
                            })}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>

          {/* Action */}
          <div className="w-full flex flex-col gap-2">
            <Button
              onClick={handleExport}
              disabled={exportDisabled}
              className="w-full"
            >
              {isLoading ? (
                <>
                  <Loader className="h-4 w-4 animate-spin" /> Checking for
                  Parts...
                </>
              ) : (
                <>
                  <Package className="h-4 w-4" /> Export (
                  {humanCount(totalFiles)} files)
                </>
              )}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
