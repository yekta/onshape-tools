export interface OnshapeDocument {
  id: string;
  name: string;
  href: string;
  public: boolean;
  permission: string;
  owner: {
    id: string;
    name: string;
    type: number;
  };
}

export type OnshapeElement = {
  id: string;
  name: string;
  elementType: string;
  dataType: string;
};

export interface PartStudioPart {
  partId: string;
  name: string;
  elementId: string;
  studioName: string; // Added studio name for better identification
}

export interface ExportJob {
  id: string;
  documentId: string; // Added documentId for better identification
  elementId: string; // Added elementId for better identification
  partId: string; // Added partId for unique identification
  partName: string;
  studioName: string; // Added studio name for context
  formats: string[];
  status: "pending" | "exporting" | "done" | "failed";
  downloadUrl?: string;
  error?: string;
  blob?: Blob; // Store blob data for bulk download
  configOptions: ConfigOption[];
  combineParts: boolean;
}

export type ConfigOption = {
  key: string; // configuration parameter name or ID as Onshape shows it (e.g. "Width" or "BTM123...")
  values: (string | number)[];
  unit: string;
};

export type ExportInput = {
  documentId: string;
  elementId: string; // Part Studio element ID
  partId: string; // Specific part ID (or leave empty string "" to export all parts for translation formats)
  formats: string[]; // e.g. ["STL", "STEP", "SOLIDWORKS"]
  configOptions: ConfigOption[];
  combineParts: boolean;
};

export type OnshapeElementType = "PARTSTUDIO" | "ASSEMBLY" | "DRAWING" | string;

export type OnshapeDocumentInfo = {
  defaultWorkspace?: { id: string } | null;
};

interface BaseConfigParam {
  parameterId: string;
  parameterName: string;
  btType: string;
  // many params include "message" or "annotation" — keep optional
  message?: string;
  value?: {
    // Onshape can return either a parsed number or an expression; keep both.
    number?: number;
    expression?: string; // e.g. "50 mm"
    units?: string; // e.g. "millimeter"
  } | null;
  // Optional range metadata if present
  rangeAndDefault?: {
    minValue?: number;
    maxValue?: number;
    units?: string;
    defaultValue?: number;
  };
}
export type ConfigurationParameter = BaseConfigParam & Record<string, unknown>;

export interface OnshapeConfiguration {
  parameters?: ConfigurationParameter[];
  configurationParameters: ConfigurationParameter[];
}

export type OnshapeElementWithConfiguration = OnshapeElement & {
  configuration: OnshapeConfiguration | null;
};
