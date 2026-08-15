import type { Metadata } from "next";
import Link from "next/link";

import { AccuracyCaption, AccuracyPercent } from "@/components/finance/accuracy-stat";
import { DirectionChip, VerdictBadge } from "@/components/finance/analyst-badges";
import { FirmLink } from "@/components/finance/firm-link";
import { MyAnalystCard } from "@/components/finance/my-analyst-card";
import { Avatar } from "@/components/ui/avatar";
import { Card, CardContent } from "@/components/ui/card";
import { PROVISIONAL_MIN_RESOLVED_CALLS } from "@predict-future/business-rules";
import { requireUser } from "@/lib/auth";
import { getMyAnalysts, getMyTakes } from "@/lib/finance/profile";
import { computeUserAccuracy, implicationChoiceToAgreement } from "@/lib/finance/userAccuracy";
import { formatDateOnly } from "@/lib/utils";

const STANCE_LABEL: Record<ReturnType<typeof implicationChoiceToAgreement>, string> = {
  AGREED: "You agreed",
  DISAGREED: "You disagreed",
  NEUTRAL: "You were neutral",
};

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
  const myTakes = await getMyTakes(user.id);
  const accuracy = computeUserAccuracy(myTakes);
  const hasProvisionalTrackRecord = accuracy.resolvedCount < PROVISIONAL_MIN_RESOLVED_CALLS;

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

      <section className="space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h2 className="text-xl font-semibold text-ink-900">My Takes</h2>
            <p className="mt-1 text-sm text-ink-500">Calls you&rsquo;ve taken a side on, graded against what happened.</p>
          </div>
          {myTakes.length > 0 &&
            (hasProvisionalTrackRecord ? (
              <p className="text-lg font-semibold text-ink-500">Building a track record</p>
            ) : (
              <div className="text-right">
                <p className="text-2xl">
                  <AccuracyPercent
                    hitCount={accuracy.hitCount}
                    resolvedCount={accuracy.resolvedCount}
                    normalClassName="font-semibold text-ink-900"
                    mutedClassName="font-medium text-ink-500"
                  />
                </p>
                <p className="text-xs text-ink-400">
                  <AccuracyCaption hitCount={accuracy.hitCount} resolvedCount={accuracy.resolvedCount} />
                </p>
              </div>
            ))}
        </div>

        {myTakes.length === 0 ? (
          <Card>
            <CardContent className="p-8 text-center text-sm text-ink-500">
              You haven&rsquo;t taken a side on any calls yet.{" "}
              <Link href="/opinions" className="font-medium text-signal-sky hover:underline">
                Vote on an analyst&rsquo;s call
              </Link>{" "}
              to start building your own track record.
            </CardContent>
          </Card>
        ) : (
          <Card>
            <CardContent className="space-y-3 p-4">
              {myTakes.map((vote) => {
                const stance = implicationChoiceToAgreement(vote.choice);
                const label = vote.opinion.instrument ?? vote.opinion.quote;
                return (
                  <Link
                    key={vote.id}
                    href={`/calls/${vote.opinion.id}`}
                    className="block rounded-[20px] border border-ink-100 px-4 py-3 transition hover:border-signal-sky/40 hover:bg-ink-50/60"
                  >
                    <div className="flex items-start gap-3">
                      <Avatar
                        name={vote.opinion.expert.name}
                        src={vote.opinion.expert.avatarUrl}
                        className="h-8 w-8 shrink-0"
                      />
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="text-sm font-medium text-ink-900">{vote.opinion.expert.name}</p>
                          {/* Not independently clickable — the whole row already links to
                              /calls/[id], and nesting a second <a> inside it (the pattern
                              FirmLink's own doc comment warns against) would be invalid HTML. */}
                          <FirmLink organization={vote.opinion.expert.organization} linkable={false} className="text-xs text-ink-400" />
                          <DirectionChip direction={vote.opinion.direction} />
                        </div>
                        <p className="mt-1 truncate text-sm text-ink-700">{label}</p>
                        <div className="mt-1.5 flex flex-wrap items-center gap-2 text-xs text-ink-400">
                          <span>{STANCE_LABEL[stance]}</span>
                          <span aria-hidden="true">·</span>
                          <span>Voted {formatDateOnly(vote.lockedAt)}</span>
                        </div>
                      </div>
                      <VerdictBadge status={vote.opinion.resolutionStatus} />
                    </div>
                  </Link>
                );
              })}
            </CardContent>
          </Card>
        )}
      </section>
    </div>
  );
}
