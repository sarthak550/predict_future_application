"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { signIn } from "next-auth/react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";

export function SignUpForm() {
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
        <CardDescription>Every new player starts with 10,000 free virtual points for story-based predictions.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
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
            placeholder="At least 8 characters"
          />
        </div>
        {error && <p className="rounded-2xl bg-rose-50 px-4 py-3 text-sm text-rose-600">{error}</p>}
        <Button
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
              router.push("/");
              router.refresh();
            })
          }
        >
          {isPending ? "Creating account..." : "Create account"}
        </Button>
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
