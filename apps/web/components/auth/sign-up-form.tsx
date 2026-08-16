"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { signIn } from "next-auth/react";
import { useRouter } from "next/navigation";

import { GoogleContinueButton } from "@/components/auth/google-continue-button";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { resolveRedirectTarget } from "@/lib/auth/resolveRedirectTarget";

// See sign-in-form.tsx for why this is safe to read directly client-side.
const CREDENTIALS_LOGIN_ENABLED = process.env.NEXT_PUBLIC_ALLOW_CREDENTIALS_LOGIN === "true";

export function SignUpForm({
  googleConfigured,
  callbackUrl,
  call
}: {
  googleConfigured: boolean;
  callbackUrl?: string;
  call?: string;
}) {
  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  return (
    <Card className="w-full max-w-md">
      <CardHeader>
        <CardTitle>Create account</CardTitle>
        <CardDescription>
          Every new player starts with 10,000 free virtual points for story-based predictions.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {error && <p className="rounded-2xl bg-rose-50 px-4 py-3 text-sm text-rose-600">{error}</p>}

        {googleConfigured ? (
          <GoogleContinueButton callbackUrl={callbackUrl} call={call} label="Continue with Google to get started" />
        ) : (
          <p className="rounded-2xl border border-dashed border-ink-200 bg-ink-50 px-4 py-3 text-sm text-ink-500">
            Sign-up is being finalized — check back shortly.
          </p>
        )}

        {/*
          There is no separate "register" step for the Google path — signing in
          with Google on first use IS signing up (S74-T1's createUser override
          provisions the wallet/stats/notification). The form below only exists
          for the dev-only credentials path (S74-T2); it never renders in prod.
        */}
        {CREDENTIALS_LOGIN_ENABLED && (
          <>
            <div className="flex items-center gap-3 text-xs font-medium uppercase tracking-wide text-ink-400">
              <span className="h-px flex-1 bg-ink-100" />
              Dev-only password sign-up
              <span className="h-px flex-1 bg-ink-100" />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium text-ink-700">Username</label>
              <Input value={username} onChange={(event) => setUsername(event.target.value)} placeholder="forecastfan" />
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
                placeholder="At least 8 characters, 1 letter + 1 number"
              />
            </div>
            <Button
              variant="secondary"
              className="w-full"
              disabled={isPending}
              onClick={() =>
                startTransition(async () => {
                  setError("");
                  const response = await fetch("/api/auth/register", {
                    method: "POST",
                    headers: {
                      "Content-Type": "application/json"
                    },
                    body: JSON.stringify({ username, email, password })
                  });
                  const payload = (await response.json()) as { error?: string };
                  if (!response.ok) {
                    setError(payload.error ?? "Unable to create account.");
                    return;
                  }

                  await signIn("credentials", {
                    email,
                    password,
                    redirect: false
                  });
                  router.push(resolveRedirectTarget(callbackUrl, call));
                  router.refresh();
                })
              }
            >
              {isPending ? "Creating account..." : "Create account with password"}
            </Button>
          </>
        )}

        <p className="text-sm text-ink-500">
          Already have an account?{" "}
          <Link href="/sign-in" className="font-medium text-signal-sky">
            Sign in
          </Link>
        </p>
      </CardContent>
    </Card>
  );
}
