import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Loader, LogIn, LogInIcon, Settings } from "lucide-react";

type TProps = {
  onConnect: () => void;
  isLoading: boolean;
  apiKey: string;
  onApiKeyChange: (value: string) => void;
  secretKey: string;
  onSecretKeyChange: (value: string) => void;
  savedCredentials: {
    apiKey: string;
    secretKey: string;
  };
};

export default function AuthPage({
  onConnect,
  isLoading,
  apiKey,
  onApiKeyChange,
  secretKey,
  onSecretKeyChange,
  savedCredentials,
}: TProps) {
  return (
    <div className="w-full flex flex-col items-center">
      <Card className="w-full max-w-xl">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <LogInIcon className="h-5 w-5" />
            Connect to Onshape
          </CardTitle>
          <CardDescription>
            Enter your Onshape API credentials to get started.
          </CardDescription>
        </CardHeader>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (isLoading) return;
            onConnect();
          }}
          className="w-full flex flex-col"
        >
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="api_key">API Key</Label>
              <Input
                id="api_key"
                placeholder="Your Onshape API key"
                value={apiKey}
                onChange={(e) => onApiKeyChange(e.target.value)}
                className={`${
                  savedCredentials.apiKey && savedCredentials.apiKey === apiKey
                    ? "border-process/25 bg-process/10 text-process"
                    : ""
                }`}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="secret_key">Secret Key</Label>
              <Input
                id="secret_key"
                type="password"
                placeholder="Your Onshape secret key"
                value={secretKey}
                onChange={(e) => onSecretKeyChange(e.target.value)}
                className={`${
                  savedCredentials.secretKey &&
                  savedCredentials.secretKey === secretKey
                    ? "border-process/25 bg-process/10 text-process"
                    : ""
                }`}
              />
            </div>
            <Button disabled={isLoading} className="w-full">
              {isLoading ? (
                <>
                  <Loader className="h-4 w-4 animate-spin" />
                  Authenticating...
                </>
              ) : (
                <>
                  <LogIn className="h-4 w-4" />
                  Connect to Onshape
                </>
              )}
            </Button>
          </CardContent>
        </form>
      </Card>
    </div>
  );
}
