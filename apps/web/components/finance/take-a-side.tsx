"use client";

/**
 * Free "take a side" voting widget (Agree/Neutral/Disagree) for a single
 * expert call, rendered inside ExpandableCallsTable's expanded panel.
 *
 * Session-aware CLIENT-side, the same way SessionChip is (fetch
 * /api/auth/session on mount) — deliberately NOT a prop threaded down from the
 * parent server page. /opinions and /analysts/[slug] are ISR (revalidate: 900 /
 * 3600); reading cookies()/getSession() in those server components would force
 * dynamic rendering and kill ISR + the SEO win it exists for. This component
 * already only mounts when its row expands, so the extra session fetch is
 * cheap and scoped to actual interest, not every row on page load.
 *
 * Tallies are fetched lazily on mount too (i.e. on expand, not on page load)
 * for the same reason — no need to hit the DB for rows nobody opens.
 */

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import type { OpinionResolutionStatus } from "@prisma/client";

import { VerdictBadge } from "@/components/finance/analyst-badges";
import { Button } from "@/components/ui/button";
import type { TalliesResponse } from "@/lib/finance/tallies";
import { cn, formatPercent } from "@/lib/utils";

type PlainChoice = "AGREE" | "NEUTRAL" | "DISAGREE";

const PLAIN_CHOICES: { value: PlainChoice; label: string }[] = [
  { value: "DISAGREE", label: "Disagree" },
  { value: "NEUTRAL", label: "Neutral" },
  { value: "AGREE", label: "Agree" },
];

type SessionUser = { id?: string | null; name?: string | null; email?: string | null };

type FoldedTallies = { agree: number; neutral: number; disagree: number; total: number };

/**
 * Folds the 5 raw agreement buckets down to the 3 this surface displays.
 * Mobile's two-step Opine poll can write the STRONGLY_* extremes; web only
 * ever writes the plain 3 (see lib/finance/votes.ts), but a mobile-cast vote
 * on the same call must still count toward the bar shown here.
 */
function foldBuckets(t: TalliesResponse["implication"]): FoldedTallies {
  return {
    disagree: t.disagree + t.stronglyDisagree,
    neutral: t.neutral,
    agree: t.agree + t.stronglyAgree,
    total: t.total,
  };
}

function foldedUserChoice(
  choice: TalliesResponse["implication"]["userChoice"]
): PlainChoice | null {
  if (choice === "STRONGLY_AGREE" || choice === "AGREE") return "AGREE";
  if (choice === "STRONGLY_DISAGREE" || choice === "DISAGREE") return "DISAGREE";
  if (choice === "NEUTRAL") return "NEUTRAL";
  return null;
}

export function TakeASide({
  opinionId,
  resolutionStatus,
}: {
  opinionId: string;
  resolutionStatus: OpinionResolutionStatus;
}) {
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const isPending = resolutionStatus === "PENDING";
  const isGraded =
    resolutionStatus === "RESOLVED_HIT" || resolutionStatus === "RESOLVED_MISS";

  const [sessionChecked, setSessionChecked] = useState(!isPending);
  const [user, setUser] = useState<SessionUser | null>(null);
  const [tallies, setTallies] = useState<TalliesResponse | null>(null);
  const [talliesLoading, setTalliesLoading] = useState(isPending || isGraded);
  const [optimisticChoice, setOptimisticChoice] = useState<PlainChoice | null>(null);
  const [submitting, setSubmitting] = useState<PlainChoice | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!isPending && !isGraded) return; // NOT_GRADED — nothing to show, nothing to fetch

    let cancelled = false;

    fetch(`/api/finance/expert-opinions/${opinionId}/tallies`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data: TalliesResponse | null) => {
        if (!cancelled && data) setTallies(data);
      })
      .catch(() => {
        /* offline / transient — leave tallies null, section stays empty */
      })
      .finally(() => {
        if (!cancelled) setTalliesLoading(false);
      });

    if (isPending) {
      fetch("/api/auth/session")
        .then((r) => (r.ok ? r.json() : null))
        .then((s) => {
          if (!cancelled) setUser(s?.user ?? null);
        })
        .catch(() => {
          /* offline — treat as signed out */
        })
        .finally(() => {
          if (!cancelled) setSessionChecked(true);
        });
    }

    return () => {
      cancelled = true;
    };
    // opinionId is the only value this effect should re-run for.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [opinionId]);

  if (resolutionStatus === "NOT_GRADED") {
    return null;
  }

  if (isGraded) {
    if (talliesLoading || !tallies) return null;
    const folded = foldBuckets(tallies.implication);
    // Founder 2026-08-16 ("the agree/disagree/neutral buttons are gone now,
    // why?"): with /opinions now defaulting to GRADED calls, a zero-vote
    // graded call rendered NOTHING here, which read as the voting feature
    // having vanished from the product. Voting closing at grading is by
    // design (taking a side after the outcome is known is meaningless) —
    // say so honestly and point at where open calls live, instead of a
    // silent blank.
    if (folded.total === 0) {
      return (
        <p className="border-t border-ink-100 pt-3 text-sm text-ink-500">
          Voting closed — this call is graded.{" "}
          <Link href="/opinions?status=pending" className="text-signal-sky hover:underline">
            Take a side on open calls
          </Link>
        </p>
      );
    }
    const agreePct = folded.agree / folded.total;
    return (
      <div className="flex flex-wrap items-center gap-2 border-t border-ink-100 pt-3 text-sm text-ink-600">
        <span>{formatPercent(agreePct)} agreed this call</span>
        <VerdictBadge status={resolutionStatus} />
      </div>
    );
  }

  // PENDING from here on.
  const currentChoice = foldedUserChoice(tallies?.implication.userChoice ?? null);
  const effectiveChoice = currentChoice ?? optimisticChoice;
  const hasVoted = effectiveChoice !== null;
  const folded = tallies
    ? foldBuckets(tallies.implication)
    : { agree: 0, neutral: 0, disagree: 0, total: 0 };

  async function handleVote(choice: PlainChoice) {
    if (submitting || hasVoted) return;
    setOptimisticChoice(choice);
    setSubmitting(choice);
    setError("");
    try {
      const res = await fetch(`/api/finance/expert-opinions/${opinionId}/vote`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ choice }),
      });
      if (!res.ok) {
        const payload = await res.json().catch(() => ({}));
        setError(payload.error ?? "Couldn't record your vote — try again.");
        setOptimisticChoice(null);
        return;
      }
      const data: TalliesResponse = await res.json();
      setTallies(data);
    } catch {
      setError("Couldn't record your vote — check your connection and try again.");
      setOptimisticChoice(null);
    } finally {
      setSubmitting(null);
    }
  }

  if (talliesLoading || !sessionChecked) {
    return (
      <div className="border-t border-ink-100 pt-3 text-sm text-ink-400">
        Loading sides taken…
      </div>
    );
  }

  if (!user) {
    const currentQuery = searchParams.toString();
    const callbackUrl = `${pathname}${currentQuery ? `?${currentQuery}` : ""}`;
    const signInHref = `/sign-in?callbackUrl=${encodeURIComponent(callbackUrl)}&call=${encodeURIComponent(opinionId)}`;
    return (
      <div className="border-t border-ink-100 pt-3">
        <Link
          href={signInHref}
          className="text-sm font-medium text-signal-sky hover:underline"
        >
          Sign in to take a side
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-2 border-t border-ink-100 pt-3">
      <p className="text-xs font-semibold uppercase tracking-[0.2em] text-ink-400">
        Take a side
      </p>
      <div className="flex flex-wrap gap-2">
        {PLAIN_CHOICES.map(({ value, label }) => {
          const isActive = effectiveChoice === value;
          return (
            <Button
              key={value}
              type="button"
              size="sm"
              variant={isActive ? "primary" : "secondary"}
              disabled={hasVoted || submitting !== null}
              aria-pressed={isActive}
              onClick={() => handleVote(value)}
              className={cn(isActive && "ring-2 ring-signal-sky ring-offset-1")}
            >
              {submitting === value ? "…" : label}
            </Button>
          );
        })}
      </div>
      {error && <p className="text-xs text-rose-600">{error}</p>}
      {folded.total > 0 && (
        <p className="text-xs text-ink-500">
          {formatPercent(folded.agree / folded.total)} agree · {folded.total} side
          {folded.total === 1 ? "" : "s"} taken
        </p>
      )}
    </div>
  );
}
