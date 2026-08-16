"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { signIn } from "next-auth/react";
import { useRouter } from "next/navigation";

import { GoogleContinueButton } from "@/components/auth/google-continue-button";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { resolveAuthErrorMessage } from "@/lib/auth/errorMessages";
import { resolveRedirectTarget } from "@/lib/auth/resolveRedirectTarget";

// NEXT_PUBLIC_* is inlined at build time, safe to read directly in a client
// component. Mirrors the server-side ALLOW_CREDENTIALS_LOGIN gate (S74-T2)
// that controls whether CredentialsProvider/api/auth/register even work —
// this only controls whether the form renders, so the two must stay in sync
// deploy-to-deploy (same env source, set together).
const CREDENTIALS_LOGIN_ENABLED = process.env.NEXT_PUBLIC_ALLOW_CREDENTIALS_LOGIN === "true";

export function SignInForm({
  googleConfigured,
  error,
  callbackUrl,
  call
}: {
  googleConfigured: boolean;
  error?: string;
  callbackUrl?: string;
  call?: string;
}) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [credentialsError, setCredentialsError] = useState("");
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  const errorMessage = credentialsError || resolveAuthErrorMessage(error);

  return (
    <Card className="w-full max-w-md">
      <CardHeader>
        <CardTitle>Sign in</CardTitle>
        <CardDescription>Open your news feed, virtual points balance, and forecasting streak.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {errorMessage && (
          <p className="rounded-2xl bg-rose-50 px-4 py-3 text-sm text-rose-600">{errorMessage}</p>
        )}

        {googleConfigured ? (
          <GoogleContinueButton callbackUrl={callbackUrl} call={call} label="Continue with Google" />
        ) : (
          <p className="rounded-2xl border border-dashed border-ink-200 bg-ink-50 px-4 py-3 text-sm text-ink-500">
            Sign-in is being finalized — check back shortly.
          </p>
        )}

        {CREDENTIALS_LOGIN_ENABLED && (
          <>
            <div className="flex items-center gap-3 text-xs font-medium uppercase tracking-wide text-ink-400">
              <span className="h-px flex-1 bg-ink-100" />
              Dev-only password sign-in
              <span className="h-px flex-1 bg-ink-100" />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium text-ink-700">Email</label>
              <Input value={email} onChange={(event) => setEmail(event.target.value)} placeholder="you@example.com" />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium text-ink-700">Password</label>
              <Input
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                placeholder="••••••••"
              />
            </div>
            <Button
              variant="secondary"
              className="w-full"
              disabled={isPending}
              onClick={() =>
                startTransition(async () => {
                  setCredentialsError("");
                  const result = await signIn("credentials", {
                    email,
                    password,
                    redirect: false
                  });
                  if (result?.error) {
                    setCredentialsError("Email or password is incorrect.");
                    return;
                  }
                  router.push(resolveRedirectTarget(callbackUrl, call));
                  router.refresh();
                })
              }
            >
              {isPending ? "Signing in..." : "Sign in with password"}
            </Button>
          </>
        )}

        <p className="text-sm text-ink-500">
          No account yet?{" "}
          <Link href="/sign-up" className="font-medium text-signal-sky">
            Create one
          </Link>
        </p>
      </CardContent>
    </Card>
  );
}
