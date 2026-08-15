"use client";

/**
 * Session-aware auth chip for the public finance header.
 *
 * The public pages are ISR/static, so session state must come from the client:
 * this fetches NextAuth's /api/auth/session endpoint after mount and renders
 * either the signed-in user chip (with sign-out) or the Sign in link. Until the
 * fetch resolves it renders the Sign in link (correct for the common
 * signed-out case; a signed-in user sees it flip in one paint, no layout jump).
 */

import { useEffect, useState } from "react";
import Link from "next/link";
import { signOut } from "next-auth/react";

type SessionUser = { name?: string | null; email?: string | null };

export function SessionChip() {
  const [user, setUser] = useState<SessionUser | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/auth/session")
      .then((r) => (r.ok ? r.json() : null))
      .then((s) => {
        if (!cancelled && s?.user) setUser(s.user as SessionUser);
      })
      .catch(() => {
        /* signed-out / offline — keep the Sign in link */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (!user) {
    return (
      <Link
        href="/sign-in"
        className="rounded-full border border-ink-200 px-4 py-1.5 text-sm font-medium text-ink-700 transition-colors hover:bg-ink-50"
      >
        Sign in
      </Link>
    );
  }

  const label = user.name || user.email || "Account";
  const initial = (label[0] ?? "?").toUpperCase();

  return (
    <div className="flex items-center gap-2">
      {/* User Profile Page (2026-08-15): the chip itself is now the nav entry
          point to /profile. Sign out stays a SIBLING <button>, not nested
          inside this <Link> — nested <a>/<button> interactive elements are
          invalid HTML and would make one of the two targets unreliable to
          click, the same "opt-out children" concern FirmLink's stretched-card
          pattern documents elsewhere in this codebase. */}
      <Link
        href="/profile"
        className="flex items-center gap-2 rounded-full border border-ink-200 py-1 pl-1 pr-3 text-sm font-medium text-ink-700 transition-colors hover:border-ink-300 hover:bg-ink-50"
      >
        <span className="flex h-6 w-6 items-center justify-center rounded-full bg-ink-900 text-xs font-semibold text-white">
          {initial}
        </span>
        <span className="max-w-[10rem] truncate">{label}</span>
      </Link>
      <button
        type="button"
        onClick={() => signOut({ callbackUrl: "/" })}
        className="text-xs font-medium text-ink-400 transition-colors hover:text-ink-700"
      >
        Sign out
      </button>
    </div>
  );
}
