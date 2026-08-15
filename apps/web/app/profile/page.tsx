import type { Metadata } from "next";

import { Avatar } from "@/components/ui/avatar";
import { requireUser } from "@/lib/auth";
import { formatDateOnly } from "@/lib/utils";

export const metadata: Metadata = {
  title: "My Profile — Predict Future",
  // Never a public/indexable page — signed-in self-view only, same convention
  // as /notifications.
  robots: { index: false, follow: false },
};

/**
 * Signed-in self-view "My Account" surface (User Profile Page brief,
 * 2026-08-15 — see .claude/agent-memory/ceo-product-strategist/
 * cto_assignment_brief_user_profile_page.md). Ticket 1: shell + identity
 * block + nav entry (SessionChip now links here). Server Component,
 * requireUser()-gated — mirrors app/notifications/page.tsx's shell exactly.
 *
 * Tickets 2-4 (My Analysts, My Takes, Paper Trading + Notifications tiles)
 * compose into this same file section by section rather than a rewrite —
 * see the brief's "Sections that ship in v1" for the full section list.
 */
export default async function ProfilePage() {
  const user = await requireUser();

  return (
    <div className="space-y-8">
      <div className="flex items-center gap-4">
        <Avatar name={user.username} src={user.image ?? user.avatarUrl} className="h-16 w-16 rounded-3xl text-lg" />
        <div>
          <h1 className="text-3xl font-semibold text-ink-900">{user.username}</h1>
          <p className="mt-1 text-sm text-ink-500">Member since {formatDateOnly(user.createdAt)}</p>
        </div>
      </div>
    </div>
  );
}
