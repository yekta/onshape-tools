import { OnshapeDocument } from "@/components/types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { ArrowLeft, FileText, Loader } from "lucide-react";

type TProps = {
  documents: OnshapeDocument[];
  onSelectDocument: (doc: OnshapeDocument) => void;
  onBackToAuth: () => void;
  isLoading: boolean;
  selectedDocument: OnshapeDocument | null;
};

export default function DocumentSelectionPage({
  documents,
  onSelectDocument,
  onBackToAuth,
  isLoading,
  selectedDocument,
}: TProps) {
  return (
    <div className="w-full flex flex-col items-center">
      <Card className="w-full max-w-xl">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <FileText className="h-5 w-5" />
            Select Document
          </CardTitle>
          <CardDescription>
            Choose an Onshape document to export parts from.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button
            variant="outline"
            onClick={onBackToAuth}
            className="bg-transparent"
          >
            <ArrowLeft className="h-4 w-4" />
            Back to Authentication
          </Button>
          <div className="w-full flex flex-col gap-2 mt-4">
            {isLoading && (
              <div className="w-full flex gap-2 items-center justify-center py-4 px-6 text-muted-foreground">
                <Loader className="h-4 w-4 animate-spin" />
                <p className="leading-tight text-sm">Loading documents...</p>
              </div>
            )}
            {documents.map((doc) => (
              <div
                key={doc.id}
                className="flex items-center justify-between p-3 border rounded-lg hover:bg-accent cursor-pointer transition-colors"
                onClick={() => onSelectDocument(doc)}
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
                  <Loader className="h-4 w-4 animate-spin" />
                ) : null}
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
