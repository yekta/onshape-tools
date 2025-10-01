import { ConfigOption } from "@/components/types";
import JSZip from "jszip";

export function cartesianProduct<T>(arrays: T[][]): T[][] {
  return arrays.reduce<T[][]>(
    (acc, arr) => acc.flatMap((prev) => arr.map((val) => [...prev, val])),
    [[]]
  );
}

export function buildConfigPairs(
  options: ConfigOption[],
  combo: (string | number)[]
) {
  return options.map((opt, i) => ({
    // IMPORTANT: opt.key must be the Onshape configuration parameterId
    parameterId: String(opt.key),
    parameterName: String(opt.keyDisplay ?? opt.key),
    // For enums, value must be the "option" token (e.g. "_500_mm"), not the display.
    // For numeric/measure, pass a string with unit text (e.g. "50 mm").
    parameterValue:
      typeof combo[i] === "number"
        ? String(combo[i]) + (opt.unit ? ` ${opt.unit}` : "")
        : String(combo[i]),
    parameterBareValue: String(combo[i]),
  }));
}

export function humanConfigTag(
  pairs: { parameterName: string; parameterBareValue: string }[]
) {
  if (!pairs.length) return "";
  return pairs
    .map(
      ({ parameterName, parameterBareValue }) =>
        `${parameterName} = ${parameterBareValue}`
    )
    .join(" | ");
}

export function getBaseFileName({
  elementName,
  partName,
  combineParts,
}: {
  documentId: string;
  elementId: string;
  elementName: string;
  partId: string;
  partName: string;
  combineParts: boolean;
}) {
  return combineParts ? `${elementName}` : `${elementName} - ${partName}`;
}

export function extForFormat(fmt: string) {
  const f = fmt.toLowerCase();
  if (f === "solidworks") return "sldprt"; // translator returns a zip often
  if (f === "parasolid") return "x_t";
  if (f === "iges") return "igs";
  if (f === "step") return "step";
  return f;
}

export function isZipPayload(contentType: string | null, buffer: ArrayBuffer) {
  const type = (contentType || "").toLowerCase();
  if (type.includes("zip")) return true;
  const u8 = new Uint8Array(buffer);
  return u8.length >= 2 && u8[0] === 0x50 && u8[1] === 0x4b; // "PK"
}

export function normalizeName(s: string) {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "");
}

export async function pickZipEntryForPart(
  zip: JSZip,
  opts: { extCandidates: string[]; partName?: string; elementName?: string }
): Promise<JSZip.JSZipObject | null> {
  const entries = Object.values(zip.files).filter((f) => !f.dir);
  if (entries.length === 0) return null;

  const byExt = entries.filter((f) => {
    const name = f.name.split("/").pop() || f.name;
    return opts.extCandidates.some((ext) =>
      name.toLowerCase().endsWith(`.${ext.toLowerCase()}`)
    );
  });

  if (byExt.length === 1) return byExt[0];
  if (byExt.length === 0) {
    if (entries.length === 1) return entries[0];
    return null;
  }

  const normPart = normalizeName(opts.partName ?? "");
  const normElem = normalizeName(opts.elementName ?? "");
  const expectedPrefix =
    opts.elementName && opts.partName
      ? normalizeName(`${opts.elementName} - ${opts.partName}`)
      : "";

  const exact = byExt.find((f) =>
    normalizeName(f.name.split("/").pop() || f.name).startsWith(expectedPrefix)
  );
  if (exact) return exact;

  if (normPart) {
    const containsPart = byExt.find((f) =>
      normalizeName(f.name.split("/").pop() || f.name).includes(normPart)
    );
    if (containsPart) return containsPart;
  }

  if (normElem) {
    const containsElem = byExt.find((f) =>
      normalizeName(f.name.split("/").pop() || f.name).includes(normElem)
    );
    if (containsElem) return containsElem;
  }

  return byExt[0];
}

export async function getDefaultWorkspaceId(
  documentId: string,
  authHeader: string
) {
  const r = await fetch(
    `https://cad.onshape.com/api/v6/documents/${documentId}`,
    {
      headers: { Authorization: authHeader, Accept: "application/json" },
    }
  );
  if (!r.ok)
    throw new Error(`Failed to get document info: ${r.status} ${r.statusText}`);
  const j = await r.json();
  return j.defaultWorkspace?.id as string | undefined;
}

export async function encodeConfiguration(
  documentId: string,
  elementId: string,
  authHeader: string,
  pairs: { parameterId: string; parameterValue: string }[]
): Promise<{ encodedId?: string; queryParam?: string }> {
  if (!pairs.length) return {};
  const r = await fetch(
    `https://cad.onshape.com/api/v6/elements/d/${documentId}/e/${elementId}/configurationencodings`,
    {
      method: "POST",
      headers: {
        Authorization: authHeader,
        Accept: "application/json;charset=UTF-8; qs=0.09",
        "Content-Type": "application/json;charset=UTF-8; qs=0.09",
      },
      body: JSON.stringify({ parameters: pairs }),
    }
  );
  if (!r.ok) {
    const t = await r.text();
    throw new Error(
      `Failed to encode configuration: ${r.status} ${r.statusText} :: ${t}`
    );
  }
  return (await r.json()) as { encodedId: string; queryParam: string };
}
