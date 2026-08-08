"use client";

/**
 * "Calls I've traded" (T8) — every linkedOpinionId group, rendering the four
 * states from the CEO brief's end-to-end spec:
 *  1. Opinion PENDING + position open -> "your position is open, net P&L so far,
 *     hasn't been graded yet."
 *  2. Opinion graded (HIT/MISS) + position still open -> nudge to close.
 *  3. Opinion graded + position closed -> the money line (the honest version in
 *     BOTH directions — a loss on a HIT call and a win on a MISS call are shown
 *     exactly as plainly as the flattering combinations; the copy never suppresses
 *     the awkward cases).
 *  4. NOT_GRADED (open or closed) -> neutral factual copy, no verdict framing.
 */
import Link from "next/link";
import { useEffect, useState } from "react";

import { DirectionChip, VerdictBadge } from "@/components/finance/analyst-badges";
import { FirmLink } from "@/components/finance/firm-link";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

interface CallTradeGroup {
  linkedOpinionId: string;
  opinion: {
    quote: string;
    direction: "BULLISH" | "BEARISH" | "NEUTRAL";
    resolutionStatus: "PENDING" | "RESOLVED_HIT" | "RESOLVED_MISS" | "NOT_GRADED";
    instrument: string | null;
    sourceUrl: string;
    expert: { name: string; slug: string | null; organization: string };
  };
  symbol: string;
  quantity: number;
  avgCost: number;
  isOpen: boolean;
  realizedGrossPnl: number;
  unrealizedGrossPnl: number | null;
  totalCosts: number;
  netPnl: number | null;
}

function formatRupees(value: number): string {
  return `${value >= 0 ? "" : "-"}₹${Math.abs(value).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;
}

function MoneyLine({ group }: { group: CallTradeGroup }) {
  const isGraded = group.opinion.resolutionStatus === "RESOLVED_HIT" || group.opinion.resolutionStatus === "RESOLVED_MISS";
  const verdictWord = group.opinion.resolutionStatus === "RESOLVED_HIT" ? "correct" : "incorrect";
  const net = group.netPnl ?? 0;
  const madeOrLost = net >= 0 ? "made" : "lost";

  if (group.isOpen) {
    if (!isGraded) {
      return (
        <p className="text-sm text-ink-700">
          Your position is open — net P&L so far: <strong>{formatRupees(net)}</strong>. This call hasn&apos;t been
          graded yet.
        </p>
      );
    }
    return (
      <p className="text-sm text-ink-700">
        This call was graded <strong>{verdictWord}</strong> — your position is still open (net P&L so far:{" "}
        <strong>{formatRupees(net)}</strong>). See how it does when you close it.
      </p>
    );
  }

  if (!isGraded) {
    return (
      <p className="text-sm text-ink-700">
        Position closed — net P&L: <strong>{formatRupees(net)}</strong>. This call couldn&apos;t be objectively
        graded against market data.
      </p>
    );
  }

  return (
    <p className="text-base font-medium text-ink-900">
      You {madeOrLost} <strong>{formatRupees(Math.abs(net))}</strong> net following {group.opinion.expert.name}&apos;s{" "}
      {group.opinion.instrument ?? group.symbol} call — the call graded <strong>{verdictWord.toUpperCase()}</strong>.
    </p>
  );
}

export function CallsTradedList() {
  const [groups, setGroups] = useState<CallTradeGroup[] | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    fetch("/api/paper-trading/calls-traded")
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (!cancelled) setGroups(data?.calls ?? []);
      })
      .catch(() => {
        if (!cancelled) setError("Couldn't load your traded calls.");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (error) {
    return (
      <Card>
        <CardContent className="p-8 text-center text-sm text-rose-600">{error}</CardContent>
      </Card>
    );
  }

  if (groups === null) {
    return (
      <Card>
        <CardContent className="p-8 text-center text-sm text-ink-500">Loading…</CardContent>
      </Card>
    );
  }

  if (groups.length === 0) {
    return (
      <Card className="border-dashed">
        <CardContent className="p-8 text-center text-sm text-ink-500">
          You haven&apos;t paper-traded any analyst calls yet. Look for &ldquo;Paper trade this call&rdquo; on any
          analyst&apos;s profile.
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      {groups.map((group) => (
        <Card key={group.linkedOpinionId}>
          <CardContent className="space-y-3 p-5">
            <div className="flex flex-wrap items-center gap-2">
              {group.opinion.expert.slug ? (
                <Link href={`/analysts/${group.opinion.expert.slug}`} className="font-medium text-ink-900 hover:underline">
                  {group.opinion.expert.name}
                </Link>
              ) : (
                <span className="font-medium text-ink-900">{group.opinion.expert.name}</span>
              )}
              <span className="text-sm text-ink-400">
                · <FirmLink organization={group.opinion.expert.organization} className="hover:underline" />
              </span>
              <DirectionChip direction={group.opinion.direction} />
              <VerdictBadge status={group.opinion.resolutionStatus} />
            </div>
            <blockquote className="border-l-2 border-ink-200 pl-3 text-sm italic text-ink-700">
              &ldquo;{group.opinion.quote}&rdquo;
            </blockquote>
            <MoneyLine group={group} />
            <p className="text-xs text-ink-400">
              {group.symbol} · {group.isOpen ? `${Math.abs(group.quantity)} share${Math.abs(group.quantity) === 1 ? "" : "s"} open` : "position closed"} · costs paid so far:{" "}
              {formatRupees(group.totalCosts)}
            </p>
            <div className="flex flex-wrap items-center gap-3 pt-1 text-sm">
              <a href={group.opinion.sourceUrl} target="_blank" rel="noreferrer" className="text-signal-sky hover:underline">
                Read the original call
              </a>
              {group.isOpen && (
                <Link href={`/paper-trading?symbol=${encodeURIComponent(group.symbol)}&linkedOpinionId=${encodeURIComponent(group.linkedOpinionId)}`}>
                  <Button variant="secondary" size="sm">
                    Manage this position
                  </Button>
                </Link>
              )}
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
