"use client";

/**
 * /portfolios/manage — signed-in dashboard listing every portfolio the caller
 * owns, each rendered as its own PortfolioManagePanel (holdings, pending
 * orders, add-transaction form, visibility toggle). Session-aware client-side
 * (same fetch("/api/auth/session") pattern used across Portfolios).
 */
import { useEffect, useState } from "react";
import Link from "next/link";

import { PortfolioManagePanel, type PortfolioSummary } from "@/components/portfolios/portfolio-manage-panel";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { PORTFOLIO_MAX_PER_USER } from "@/lib/validations/portfolio";

type LoadState = "loading" | "signed-out" | "ready";

export function ManageDashboard() {
  const [state, setState] = useState<LoadState>("loading");
  const [portfolios, setPortfolios] = useState<PortfolioSummary[]>([]);
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

      try {
        const res = await fetch("/api/portfolios/mine");
        if (!res.ok) {
          setError("Couldn't load your portfolios.");
          setState("ready");
          return;
        }
        const data = await res.json();
        if (!cancelled) {
          setPortfolios(
            (data.portfolios ?? []).map((p: { id: string; slug: string; name: string; visibility: "PUBLIC" | "PRIVATE" }) => ({
              id: p.id,
              slug: p.slug,
              name: p.name,
              visibility: p.visibility
            }))
          );
          setState("ready");
        }
      } catch {
        if (!cancelled) {
          setError("Couldn't load your portfolios — check your connection.");
          setState("ready");
        }
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, []);

  if (state === "loading") {
    return (
      <Card>
        <CardContent className="p-8 text-center text-sm text-ink-500">Loading…</CardContent>
      </Card>
    );
  }

  if (state === "signed-out") {
    return (
      <Card className="mx-auto w-full max-w-lg">
        <CardHeader>
          <CardTitle>Sign in to manage your portfolios</CardTitle>
          <CardDescription>Your model portfolios are tied to your account.</CardDescription>
        </CardHeader>
        <CardContent>
          <Link href="/sign-in?callbackUrl=%2Fportfolios%2Fmanage">
            <Button variant="primary">Sign in</Button>
          </Link>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-ink-900">My Portfolios</h1>
          <p className="mt-1 text-sm text-ink-500">
            {portfolios.length} of {PORTFOLIO_MAX_PER_USER} portfolios.
          </p>
        </div>
        {portfolios.length < PORTFOLIO_MAX_PER_USER && (
          <Link href="/portfolios/new">
            <Button variant="secondary">New portfolio</Button>
          </Link>
        )}
      </div>

      {error && <p className="text-sm text-rose-600">{error}</p>}

      {portfolios.length === 0 ? (
        <Card className="border-dashed">
          <CardHeader>
            <CardTitle>No portfolios yet</CardTitle>
            <CardDescription>Create your first model portfolio to start paper-trading.</CardDescription>
          </CardHeader>
          <CardContent>
            <Link href="/portfolios/new">
              <Button variant="primary">Create your portfolio</Button>
            </Link>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-6">
          {portfolios.map((p) => (
            <PortfolioManagePanel key={p.id} portfolio={p} />
          ))}
        </div>
      )}
    </div>
  );
}
