// components/ConfigParamInput.tsx
import {
  BooleanParam,
  ConfigurationParameter,
  QuantityParam,
} from "@/components/types";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

// ---------- Type guards ----------
function isQuantityParam(p: ConfigurationParameter): p is QuantityParam {
  return p?.btType?.includes("Quantity");
}
function isBooleanParam(p: ConfigurationParameter): p is BooleanParam {
  return p?.btType?.includes("Boolean");
}

// ---------- Helpers ----------
function unitsOf(p: QuantityParam): string | undefined {
  return p?.value?.units || p?.rangeAndDefault?.units || undefined;
}

function placeholderFor(p: ConfigurationParameter): string {
  if (isBooleanParam(p)) return "true, false";
  if (isQuantityParam(p)) {
    const u = unitsOf(p);
    return u ? `10, 50, 100` : "10, 50, 100";
  }
  return "A, B, C";
}

function formatRangeHint(p: QuantityParam): string | null {
  const r = p.rangeAndDefault;
  if (!r) return null;
  const min = typeof r.minValue === "number" ? `${r.minValue}` : undefined;
  const max =
    r.maxValue ??
    (typeof r.maxValue === "number" ? `${r.maxValue}` : undefined);
  const def =
    r.defaultValue ??
    (typeof r.defaultValue === "number" ? `${r.defaultValue}` : undefined);

  const parts: string[] = [];
  if (min) parts.push(`Min: ${min}`);
  if (max) parts.push(`Max: ${max}`);
  if (def) parts.push(`Default: ${def}`);
  return parts.length ? parts.join(" • ") : null;
}

export type ConfigParamInputProps = {
  studioId: string;
  param: ConfigurationParameter;
  value: string; // CSV, empty => ignored upstream
  onChange: (next: string) => void;
};

export default function ConfigParamInput({
  param,
  value,
  onChange,
}: ConfigParamInputProps) {
  const key = param.parameterName || param.parameterId || "param";

  if (isBooleanParam(param)) {
    return (
      <div className="w-full grid grid-cols-12 gap-2 items-start rounded-lg border p-2">
        <div className="col-span-4">
          <Label className="text-xs px-1 text-muted-foreground">
            Parameter
          </Label>
          <div className="mt-1 text-sm px-2 py-2 rounded bg-muted font-medium">
            {param.parameterName || param.parameterId || "unknown"}
          </div>
          <div className="text-[11px] text-muted-foreground pt-1 px-1">
            Boolean
          </div>
        </div>

        <div className="col-span-8">
          <Label className="px-1 text-xs text-muted-foreground">Values</Label>
          <div className="flex gap-2 mt-1">
            <Input
              placeholder={placeholderFor(param)}
              value={value}
              onChange={(e) => onChange(e.target.value)}
            />
          </div>
        </div>
      </div>
    );
  }

  if (isQuantityParam(param)) {
    const u = unitsOf(param);
    const range = formatRangeHint(param);

    return (
      <div className="w-full grid grid-cols-12 gap-2 items-start rounded-lg border p-2">
        <div className="col-span-4">
          <Label className="text-xs px-1 text-muted-foreground">
            Parameter
          </Label>
          <div className="mt-1 text-sm px-2 py-2 rounded bg-muted font-medium">
            {key}
          </div>
          <div className="text-[11px] text-muted-foreground pt-1 px-1">
            Unit: {u ? String(u).replace(/_/g, " ") : "—"}
          </div>
          {range && (
            <div className="text-[11px] text-muted-foreground px-1">
              {range}
            </div>
          )}
        </div>

        <div className="col-span-8">
          <Label className="px-1 text-xs text-muted-foreground">Values</Label>
          <Input
            className="mt-1"
            placeholder={placeholderFor(param)}
            value={value}
            onChange={(e) => onChange(e.target.value)}
          />
        </div>
      </div>
    );
  }

  // Fallback: unknown param types are displayed but not editable
  return (
    <div className="w-full grid grid-cols-12 gap-2 items-start rounded-lg border p-2 opacity-70">
      <div className="col-span-4">
        <Label className="text-xs px-1 text-muted-foreground">Parameter</Label>
        <div className="mt-1 text-sm px-2 py-2 rounded bg-muted font-medium">
          {param.parameterName || param.parameterId || "unknown"}
        </div>
      </div>
      <div className="col-span-8">
        <Label className="px-1 text-xs text-muted-foreground">Values</Label>
        <Input
          className="mt-1"
          placeholder="Unsupported parameter type"
          disabled
        />
        <div className="text-[11px] text-muted-foreground pt-1 px-1">
          Type: {param?.btType ?? "unknown"} (shown for reference; ignored at
          export)
        </div>
      </div>
    </div>
  );
}
