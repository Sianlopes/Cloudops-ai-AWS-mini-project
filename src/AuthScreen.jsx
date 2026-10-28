import React, { useState } from "react";
import { Cloud, LoaderCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";

export default function AuthScreen({ setupRequired, api, onSuccess }) {
  const [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  return (
    <div className="flex min-h-svh flex-col items-center justify-center bg-muted/40 p-6">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex flex-col items-center gap-3 text-center">
          <span className="flex size-10 items-center justify-center rounded-lg bg-primary text-primary-foreground">
            <Cloud className="size-5" />
          </span>
          <div>
            <h1 className="text-xl font-semibold tracking-tight">
              {setupRequired ? "Set up CloudOps" : "Sign in to CloudOps"}
            </h1>
            <p className="mt-1 text-sm text-muted-foreground">
              {setupRequired
                ? "Create the administrator account."
                : "Monitoring and incident management."}
            </p>
          </div>
        </div>
        <form
          className="flex flex-col gap-4 rounded-lg border bg-background p-6"
          onSubmit={async (e) => {
            e.preventDefault();
            setError("");
            setBusy(true);
            try {
              const result = await api(
                `auth/${setupRequired ? "setup" : "login"}`,
                { body: Object.fromEntries(new FormData(e.currentTarget)) },
              );
              onSuccess(result);
            } catch (err) {
              setError(err.message);
            } finally {
              setBusy(false);
            }
          }}
        >
          <div className="flex flex-col gap-2">
            <Label htmlFor="email">Email</Label>
            <Input
              id="email"
              name="email"
              type="email"
              autoComplete="username"
              placeholder="you@example.com"
              required
              maxLength={254}
            />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="password">Password</Label>
            <Input
              id="password"
              name="password"
              type="password"
              autoComplete={setupRequired ? "new-password" : "current-password"}
              required
              minLength={12}
              maxLength={128}
            />
            {setupRequired && (
              <p className="text-xs text-muted-foreground">
                At least 12 characters.
              </p>
            )}
          </div>
          {error && (
            <Alert variant="destructive" role="alert">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}
          <Button className="w-full" disabled={busy}>
            {busy && <LoaderCircle className="animate-spin" />}
            {setupRequired ? "Create account" : "Sign in"}
          </Button>
        </form>
      </div>
    </div>
  );
}
