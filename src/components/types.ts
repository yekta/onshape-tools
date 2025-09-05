export interface OnshapeDocument {
  id: string;
  name: string;
  href: string;
  public: boolean;
  permission: string;
}

export interface OnshapeElement {
  id: string;
  name: string;
  elementType: string;
  dataType: string;
}

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
  format: string;
  status: "pending" | "exporting" | "done" | "failed";
  downloadUrl?: string;
  error?: string;
  blob?: Blob; // Store blob data for bulk download
}
