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
import { Loader, Settings } from "lucide-react";

type TProps = {
  onConnect: () => void;
  isLoading: boolean;
  apiKey: string;
  onApiKeyChange: (value: string) => void;
  secretKey: string;
  onSecretKeyChange: (value: string) => void;
};

export default function AuthPage({
  onConnect,
  isLoading,
  apiKey,
  onApiKeyChange,
  secretKey,
  onSecretKeyChange,
}: TProps) {
  return (
    <div className="w-full flex flex-col items-center">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Settings className="h-5 w-5" />
            Authentication
          </CardTitle>
          <CardDescription>
            Enter your Onshape API credentials to get started
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
                type="password"
                placeholder="Your Onshape API key"
                value={apiKey}
                onChange={(e) => onApiKeyChange(e.target.value)}
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
              />
            </div>
            <Button disabled={isLoading} className="w-full">
              {isLoading ? (
                <>
                  <Loader className="h-4 w-4 animate-spin" />
                  Authenticating...
                </>
              ) : (
                "Connect to Onshape"
              )}
            </Button>
          </CardContent>
        </form>
      </Card>
    </div>
  );
}
