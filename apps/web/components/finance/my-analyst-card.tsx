"use client";

/**
 * One "My Analysts" card (User Profile Page brief, Ticket 2) — same visual
 * language as the /analysts directory card (stretched-link + opt-in
 * pointer-events children, see app/analysts/page.tsx), just more compact and
 * with an inline Unfollow action instead of a firm-only secondary link.
 *
 * Lighter than FollowExpertButton (components/finance/follow-expert-button.tsx):
 * the server already knows `following: true` here (this card only ever
 * renders for a row in the user's own ExpertFollow list), so there's no
 * client-mount fetch to resolve unknown initial state — just the DELETE path
 * plus optimistic removal from the list, per Ticket 2's acceptance criteria.
 */

import { useState } from "react";
import Link from "next/link";
import { X } from "lucide-react";

import { AccuracyCaption, AccuracyPercent } from "@/components/finance/accuracy-stat";
import { FirmLink } from "@/components/finance/firm-link";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { PROVISIONAL_MIN_RESOLVED_CALLS } from "@predict-future/business-rules";
import type { MyAnalyst } from "@/lib/finance/profile";

/** How long the two-step confirm stays armed before quietly reverting — long enough to read "Unfollow?", short enough that a forgotten armed state can't surprise a later click. */
const CONFIRM_REVERT_MS = 4000;

export function MyAnalystCard({ analyst }: { analyst: MyAnalyst }) {
  const [removed, setRemoved] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  // Founder 2026-08-16: "un-following the analyst is pretty easy right now"
  // — a single accidental tap on the X silently destroyed the follow (and
  // with it the user's notification stream for that analyst). Two-step
  // inline confirm: first click arms ("Unfollow?" + cancel), only an
  // explicit second click on the armed control actually deletes; it
  // disarms itself after a few seconds or on Cancel.
  const [armed, setArmed] = useState(false);

  if (removed) return null;

  function armConfirm() {
    setArmed(true);
    setError("");
    window.setTimeout(() => setArmed(false), CONFIRM_REVERT_MS);
  }

  async function handleUnfollow() {
    if (pending) return;
    setPending(true);
    setError("");
    try {
      const res = await fetch(`/api/finance/experts/${analyst.expertId}/follow`, { method: "DELETE" });
      if (!res.ok) {
        setError("Couldn't unfollow — try again.");
        setPending(false);
        return;
      }
      setRemoved(true); // optimistic — the row is gone once the server confirms the delete
    } catch {
      setError("Couldn't unfollow — check your connection.");
      setPending(false);
    }
  }

  const profileHref = analyst.slug ? `/analysts/${analyst.slug}` : null;
  // Below PROVISIONAL_MIN_RESOLVED_CALLS, AccuracyPercent/AccuracyCaption are
  // out of contract (their own doc: "only ever called where resolvedCount >=
  // 3") — this can happen here even though /analysts' own directory never
  // shows a sub-3 card, because a user can follow a brand-new analyst who
  // hasn't cleared that floor yet. Same "Building a track record" copy every
  // other accuracy surface uses below the floor (see analysts/[slug]/page.tsx).
  const hasProvisionalTrackRecord = analyst.stats.resolvedCount < PROVISIONAL_MIN_RESOLVED_CALLS;

  return (
    <Card className="relative h-full transition hover:border-signal-sky/40">
      {profileHref && <Link href={profileHref} className="absolute inset-0 z-0" aria-label={analyst.name} />}
      <CardContent className="pointer-events-none relative z-10 flex flex-col gap-3 p-4">
        <div className="flex items-start justify-between gap-2">
          <div className="flex min-w-0 items-center gap-3">
            <Avatar name={analyst.name} src={analyst.avatarUrl} className="h-9 w-9" />
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-1.5">
                <p className="truncate text-sm font-semibold text-ink-900">{analyst.name}</p>
                {analyst.verified && <Badge variant="accent">Verified</Badge>}
              </div>
              <p className="text-xs text-ink-500">
                <FirmLink organization={analyst.organization} className="pointer-events-auto relative z-20 hover:underline" />
              </p>
            </div>
          </div>
          {armed ? (
            <span className="pointer-events-auto relative z-20 flex shrink-0 items-center gap-1.5">
              <button
                type="button"
                onClick={handleUnfollow}
                disabled={pending}
                aria-label={`Confirm unfollow ${analyst.name}`}
                className="rounded-full bg-rose-50 px-2.5 py-1 text-xs font-semibold text-rose-600 transition hover:bg-rose-100 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {pending ? "Unfollowing…" : "Unfollow?"}
              </button>
              <button
                type="button"
                onClick={() => setArmed(false)}
                disabled={pending}
                aria-label="Cancel unfollow"
                className="rounded-full px-2 py-1 text-xs font-medium text-ink-400 transition hover:bg-ink-100 hover:text-ink-700"
              >
                Cancel
              </button>
            </span>
          ) : (
            <button
              type="button"
              onClick={armConfirm}
              disabled={pending}
              aria-label={`Unfollow ${analyst.name}`}
              title={`Unfollow ${analyst.name}`}
              className="pointer-events-auto relative z-20 flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-ink-400 transition hover:bg-ink-100 hover:text-ink-700 disabled:cursor-not-allowed disabled:opacity-60"
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>
        <div className="flex items-baseline justify-between gap-3 border-t border-ink-100 pt-3">
          {hasProvisionalTrackRecord ? (
            <p className="text-sm font-medium text-ink-500">Building a track record</p>
          ) : (
            <>
              <p className="text-lg">
                <AccuracyPercent
                  hitCount={analyst.stats.hitCount}
                  resolvedCount={analyst.stats.resolvedCount}
                  normalClassName="font-semibold text-ink-900"
                  mutedClassName="font-medium text-ink-500"
                />
              </p>
              <p className="text-right text-xs text-ink-400">
                <AccuracyCaption
                  hitCount={analyst.stats.hitCount}
                  resolvedCount={analyst.stats.resolvedCount}
                  badgeClassName="pointer-events-auto relative z-20 inline-block align-middle"
                />
              </p>
            </>
          )}
        </div>
        {error && <p className="pointer-events-auto relative z-20 text-xs text-rose-600">{error}</p>}
      </CardContent>
    </Card>
  );
}
