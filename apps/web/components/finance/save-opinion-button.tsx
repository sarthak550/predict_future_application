"use client";

/**
 * Save/unsave toggle for a single analyst call ("save this call" — Saved
 * Opinions brief, .claude/agent-memory/ceo-product-strategist/
 * cto_assignment_brief_saved_opinions.md). One shared component for both
 * host surfaces:
 *  - ExpandableCallsTable's row (icon variant, EVERY row including
 *    PENDING — no isGraded gate, unlike the neighboring Share2 icon: a
 *    user saving a call to watch how it plays out is the core use case).
 *  - /calls/[id]'s verdict row, next to ShareCallButton (labeled variant).
 *
 * Mirrors FollowExpertButton's optimistic-toggle/revert-on-failure pattern,
 * but does NOT mount-fetch its own initial state or session — the caller
 * already knows both:
 *  - ExpandableCallsTable does ONE batch GET /api/finance/opinions/saved-ids
 *    for the whole table and passes each row's membership down as
 *    initialSaved, instead of an N-instance mount-fetch-per-row (see that
 *    file's own doc comment for the N+1 rationale — the exact class of bug
 *    reference_prisma_distinct_emulation.md documents).
 *  - /calls/[id] is a Server Component with an RSC-known session; it passes
 *    a server-queried `saved` boolean directly (mirrors why MyAnalystCard
 *    skips FollowExpertButton's own unknown-initial-state fetch).
 *
 * Signed-out click: this codebase's usual pattern (FollowExpertButton,
 * TakeASide) renders a visible "Sign in to X" link in place of the toggle.
 * There's no room for that in a dense table cell, so this component always
 * renders the toggle and, on a 401 from the write, navigates to
 * /sign-in?callbackUrl=<current path> instead — the brief's own explicit
 * call for this surface, not a third auth-prompt shape invented here.
 */

import { useEffect, useRef, useState, type MouseEvent } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Bookmark, BookmarkCheck } from "lucide-react";

import { cn } from "@/lib/utils";

export function SaveOpinionButton({
  opinionId,
  initialSaved,
  variant = "icon",
  className,
}: {
  opinionId: string;
  initialSaved: boolean;
  /** "icon": bare icon for a dense table row (ExpandableCallsTable). "labeled": icon + text, for /calls/[id]'s verdict row alongside ShareCallButton. */
  variant?: "icon" | "labeled";
  className?: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const [saved, setSaved] = useState(initialSaved);
  const [pending, setPending] = useState(false);
  const hasInteractedRef = useRef(false);

  // Re-sync from the caller's own source of truth. This matters for the
  // table host: initialSaved starts false for every row until the parent's
  // batch /saved-ids fetch resolves (after first paint) and re-renders with
  // the real value. Guarded by hasInteractedRef so a very fast click during
  // that window never gets clobbered by the batch fetch landing afterward.
  useEffect(() => {
    if (!hasInteractedRef.current) {
      setSaved(initialSaved);
    }
  }, [initialSaved]);

  async function handleToggle(e: MouseEvent) {
    // Required whenever this sits inside ExpandableCallsTable's row — the
    // row's own onClick toggles the expand panel, and a click on this
    // button must not also trigger that. Harmless on /calls/[id], which has
    // no ancestor click handler to guard against.
    e.stopPropagation();
    if (pending) return;

    hasInteractedRef.current = true;
    setPending(true);
    const nextSaved = !saved;
    setSaved(nextSaved); // optimistic

    try {
      const res = await fetch(`/api/finance/opinions/${opinionId}/save`, {
        method: nextSaved ? "POST" : "DELETE",
      });

      if (res.status === 401) {
        setSaved(!nextSaved); // revert — don't navigate away carrying stale optimistic state
        const query = searchParams.toString();
        const callbackUrl = `${pathname}${query ? `?${query}` : ""}`;
        router.push(`/sign-in?callbackUrl=${encodeURIComponent(callbackUrl)}`);
        return;
      }

      if (!res.ok) {
        setSaved(!nextSaved); // revert
        return;
      }

      const data: { saved: boolean } = await res.json();
      setSaved(data.saved);
    } catch {
      setSaved(!nextSaved); // revert
    } finally {
      setPending(false);
    }
  }

  if (variant === "labeled") {
    return (
      <button
        type="button"
        onClick={handleToggle}
        disabled={pending}
        aria-pressed={saved}
        className={cn(
          "inline-flex items-center gap-1.5 rounded-full border border-ink-200 bg-white px-3.5 py-1.5 text-sm font-medium text-ink-700 transition hover:border-signal-sky hover:text-signal-sky disabled:cursor-not-allowed disabled:opacity-60",
          saved && "border-signal-sky text-signal-sky",
          className,
        )}
      >
        {saved ? <BookmarkCheck className="h-3.5 w-3.5" /> : <Bookmark className="h-3.5 w-3.5" />}
        {saved ? "Saved" : "Save"}
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={handleToggle}
      disabled={pending}
      aria-pressed={saved}
      aria-label={saved ? "Unsave this call" : "Save this call"}
      title={saved ? "Unsave this call" : "Save this call"}
      className={cn(
        "text-ink-400 transition hover:text-signal-sky disabled:cursor-not-allowed disabled:opacity-60",
        saved && "text-signal-sky",
        className,
      )}
    >
      {saved ? <BookmarkCheck className="h-4 w-4" /> : <Bookmark className="h-4 w-4" />}
    </button>
  );
}
