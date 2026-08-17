"use client";

/**
 * Follow/unfollow toggle for an analyst's profile hero (Growth Loop Sprint G1,
 * Decision 2). Session-aware CLIENT-side, the same way SessionChip and
 * SaveOpinionButton are — /analysts/[slug] is ISR (revalidate: 3600), so
 * reading cookies()/getSession() in the server component would force dynamic
 * rendering and kill ISR. On mount, fetches session AND the current follow
 * state in parallel; the follow-state GET is safe to call even when signed
 * out (it degrades to { following: false }), but we still need the session
 * fetch to distinguish "signed out" from "signed in, not following" — the
 * GET response alone can't tell the two apart.
 *
 * Signed-out click: renders a "Sign in to follow" link, the same general
 * shape SaveOpinionButton's own signed-out fallback uses (see
 * components/finance/save-opinion-button.tsx) — same callbackUrl shape, same
 * /sign-in destination — rather than inventing a second auth-prompt pattern.
 *
 * No follower counts (Decision 2, locked): this renders ONLY the current
 * user's own follow state, nothing else.
 */

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { Check, Plus } from "lucide-react";

import { cn } from "@/lib/utils";

type SessionUser = { id?: string | null; name?: string | null; email?: string | null };

export function FollowExpertButton({ expertId }: { expertId: string }) {
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const [checked, setChecked] = useState(false);
  const [user, setUser] = useState<SessionUser | null>(null);
  const [following, setFollowing] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;

    Promise.all([
      fetch("/api/auth/session")
        .then((r) => (r.ok ? r.json() : null))
        .catch(() => null),
      fetch(`/api/finance/experts/${expertId}/follow`)
        .then((r) => (r.ok ? r.json() : null))
        .catch(() => null),
    ]).then(([session, followState]) => {
      if (cancelled) return;
      setUser(session?.user ?? null);
      setFollowing(Boolean(followState?.following));
      setChecked(true);
    });

    return () => {
      cancelled = true;
    };
  }, [expertId]);

  async function handleToggle() {
    if (pending) return;
    setPending(true);
    setError("");
    const nextFollowing = !following;
    setFollowing(nextFollowing); // optimistic
    try {
      const res = await fetch(`/api/finance/experts/${expertId}/follow`, {
        method: nextFollowing ? "POST" : "DELETE",
      });
      if (!res.ok) {
        setFollowing(!nextFollowing); // revert
        setError("Couldn't update — try again.");
        return;
      }
      const data: { following: boolean } = await res.json();
      setFollowing(data.following);
    } catch {
      setFollowing(!nextFollowing); // revert
      setError("Couldn't update — check your connection.");
    } finally {
      setPending(false);
    }
  }

  // Not resolved yet — render nothing committal, same as SessionChip's own
  // "keep the common signed-out case, flip in one paint" approach.
  if (!checked) {
    return (
      <div className="h-9 w-24 animate-pulse rounded-full bg-white/10" aria-hidden="true" />
    );
  }

  if (!user) {
    const currentQuery = searchParams.toString();
    const callbackUrl = `${pathname}${currentQuery ? `?${currentQuery}` : ""}`;
    const signInHref = `/sign-in?callbackUrl=${encodeURIComponent(callbackUrl)}`;
    return (
      <Link
        href={signInHref}
        className="inline-flex h-9 items-center gap-1.5 rounded-full border border-white/20 px-4 text-sm font-medium text-white/80 transition hover:bg-white/10 hover:text-white"
      >
        Sign in to follow
      </Link>
    );
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        type="button"
        onClick={handleToggle}
        disabled={pending}
        aria-pressed={following}
        className={cn(
          "inline-flex h-9 items-center gap-1.5 rounded-full px-4 text-sm font-medium transition disabled:cursor-not-allowed disabled:opacity-60",
          following
            ? "bg-white/10 text-white hover:bg-white/20"
            : "bg-white text-ink-900 hover:bg-white/90",
        )}
      >
        {following ? <Check className="h-3.5 w-3.5" /> : <Plus className="h-3.5 w-3.5" />}
        {following ? "Following" : "Follow"}
      </button>
      {error && <p className="text-xs text-rose-300">{error}</p>}
    </div>
  );
}
