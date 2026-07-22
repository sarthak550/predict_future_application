"use client";

/**
 * /portfolios/new — signed-in create form. Session-aware client-side (same
 * fetch("/api/auth/session") pattern as SessionChip/TakeASide/CreatePortfolioCta)
 * since this whole route is NOT ISR and can afford it, but staying consistent
 * with the rest of Portfolios keeps one mental model for the surface.
 */
import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { PORTFOLIO_MAX_PER_USER } from "@/lib/validations/portfolio";

type LoadState = "loading" | "signed-out" | "at-cap" | "ready";

export function CreatePortfolioForm() {
  const router = useRouter();
  const [state, setState] = useState<LoadState>("loading");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [visibility, setVisibility] = useState<"PRIVATE" | "PUBLIC">("PRIVATE");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;

    async function load() {
      const sessionRes = await fetch("/api/auth/session").catch(() => null);
      const session = sessionRes?.ok ? await sessionRes.json().catch(() => null) : null;
      if (cancelled) return;

      if (!session?.user) {
        setState("signed-out");
        return;
      }

      const mineRes = await fetch("/api/portfolios/mine").catch(() => null);
      const mine = mineRes?.ok ? await mineRes.json().catch(() => null) : null;
      if (cancelled) return;

      const count: number = Array.isArray(mine?.portfolios) ? mine.portfolios.length : 0;
      setState(count >= PORTFOLIO_MAX_PER_USER ? "at-cap" : "ready");
    }

    load();
    return () => {
      cancelled = true;
    };
  }, []);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (submitting) return;
    setSubmitting(true);
    setError("");
    try {
      const res = await fetch("/api/portfolios", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, description, visibility })
      });
      if (!res.ok) {
        const payload = await res.json().catch(() => ({}));
        setError(payload.error ?? "Couldn't create the portfolio — try again.");
        return;
      }
      router.push("/portfolios/manage");
    } catch {
      setError("Couldn't create the portfolio — check your connection and try again.");
    } finally {
      setSubmitting(false);
    }
  }

  if (state === "loading") {
    return (
      <Card className="w-full max-w-lg">
        <CardContent className="p-8 text-center text-sm text-ink-500">Loading…</CardContent>
      </Card>
    );
  }

  if (state === "signed-out") {
    return (
      <Card className="w-full max-w-lg">
        <CardHeader>
          <CardTitle>Sign in to create a portfolio</CardTitle>
          <CardDescription>You need an account to start a model portfolio.</CardDescription>
        </CardHeader>
        <CardContent>
          <Link href="/sign-in?callbackUrl=%2Fportfolios%2Fnew">
            <Button variant="primary">Sign in</Button>
          </Link>
        </CardContent>
      </Card>
    );
  }

  if (state === "at-cap") {
    return (
      <Card className="w-full max-w-lg">
        <CardHeader>
          <CardTitle>Portfolio limit reached</CardTitle>
          <CardDescription>
            You can have at most {PORTFOLIO_MAX_PER_USER} portfolios. Manage or delete an existing one to
            make room.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Link href="/portfolios/manage">
            <Button variant="secondary">Go to My Portfolios</Button>
          </Link>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="w-full max-w-lg">
      <CardHeader>
        <CardTitle>Create a model portfolio</CardTitle>
        <CardDescription>
          Starts with ₹10,00,000 in simulated capital. Orders you place fill at the next market close —
          not immediately.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form className="space-y-4" onSubmit={handleSubmit}>
          <div className="space-y-2">
            <label className="text-sm font-medium text-ink-700">Name</label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Momentum Midcaps"
              maxLength={60}
              required
            />
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium text-ink-700">Description (optional)</label>
            <Textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="What's the thesis for this portfolio?"
              maxLength={280}
            />
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium text-ink-700">Visibility</label>
            <Select value={visibility} onChange={(e) => setVisibility(e.target.value as "PRIVATE" | "PUBLIC")}>
              <option value="PRIVATE">Private — only visible to you</option>
              <option value="PUBLIC">Public — listed on the /portfolios directory</option>
            </Select>
          </div>
          {error && <p className="text-sm text-rose-600">{error}</p>}
          <Button type="submit" variant="primary" className="w-full" disabled={submitting || name.trim().length < 3}>
            {submitting ? "Creating…" : "Create portfolio"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
