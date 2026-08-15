import type { Metadata } from "next";
import Link from "next/link";

import { MyAnalystCard } from "@/components/finance/my-analyst-card";
import { Avatar } from "@/components/ui/avatar";
import { Card, CardContent } from "@/components/ui/card";
import { requireUser } from "@/lib/auth";
import { getMyAnalysts } from "@/lib/finance/profile";
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
  const myAnalysts = await getMyAnalysts(user.id);

  return (
    <div className="space-y-8">
      <div className="flex items-center gap-4">
        <Avatar name={user.username} src={user.image ?? user.avatarUrl} className="h-16 w-16 rounded-3xl text-lg" />
        <div>
          <h1 className="text-3xl font-semibold text-ink-900">{user.username}</h1>
          <p className="mt-1 text-sm text-ink-500">Member since {formatDateOnly(user.createdAt)}</p>
        </div>
      </div>

      <section className="space-y-4">
        <div>
          <h2 className="text-xl font-semibold text-ink-900">My Analysts</h2>
          <p className="mt-1 text-sm text-ink-500">Analysts you follow, and their track record.</p>
        </div>
        {myAnalysts.length === 0 ? (
          <Card>
            <CardContent className="p-8 text-center text-sm text-ink-500">
              You&rsquo;re not following any analysts yet.{" "}
              <Link href="/analysts" className="font-medium text-signal-sky hover:underline">
                Follow one from their profile or the Scorecard
              </Link>{" "}
              to see their calls here.
            </CardContent>
          </Card>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {myAnalysts.map((analyst) => (
              <MyAnalystCard key={analyst.followId} analyst={analyst} />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
