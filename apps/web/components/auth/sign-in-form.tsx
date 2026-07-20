"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { signIn } from "next-auth/react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";

export function SignInForm({ initialErrorMessage = "" }: { initialErrorMessage?: string }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  return (
    <Card className="w-full max-w-md">
      <CardHeader>
        <CardTitle>Sign in</CardTitle>
        <CardDescription>Open your news feed, virtual points balance, and forecasting streak.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
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
        {(error || initialErrorMessage) && (
          <p className="rounded-2xl bg-rose-50 px-4 py-3 text-sm text-rose-600">
            {error || initialErrorMessage}
          </p>
        )}
        <Button
          className="w-full"
          disabled={isPending}
          onClick={() =>
            startTransition(async () => {
              setError("");
              const result = await signIn("credentials", {
                email,
                password,
                redirect: false
              });
              if (result?.error) {
                setError("Email or password is incorrect.");
                return;
              }
              router.push("/");
              router.refresh();
            })
          }
        >
          {isPending ? "Signing in..." : "Sign in"}
        </Button>
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
