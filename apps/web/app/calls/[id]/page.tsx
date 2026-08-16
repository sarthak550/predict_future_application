import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowUpRight } from "lucide-react";

import { AnalystDisclaimerFooter } from "@/components/finance/disclaimer-footer";
import { DirectionChip, VerdictBadge } from "@/components/finance/analyst-badges";
import { FirmLink } from "@/components/finance/firm-link";
import { PaperTradeCta } from "@/components/finance/paper-trade-cta";
import { SaveOpinionButton } from "@/components/finance/save-opinion-button";
import { ShareCallButton } from "@/components/finance/share-call-button";
import { TakeASide } from "@/components/finance/take-a-side";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { canonicalizeOrgDisplay } from "@predict-future/business-rules/experts/firmAliases";
import { formatAccuracyCaption } from "@/components/finance/accuracy-stat";
import { computeScorecard, PROVISIONAL_MIN_RESOLVED_CALLS } from "@predict-future/business-rules";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { formatDateOnly } from "@/lib/utils";

// Every public (non-suppressed) call renders here — graded calls as a full
// share card, pending/not-graded ones with an honest state badge and live
// voting (founder 2026-08-16: "it should be call page"). Thin, single-call
// content, so it stays noindex — the sitemap only ever lists
// /analysts/[slug] pages.
//
// Saved Opinions (Ticket 3): the page now also reads getSession() to pass a
// server-known `saved` boolean into SaveOpinionButton (brief's explicit
// call — RSC-known session, no client mount-fetch). Reading the session
// cookie makes Next.js render this route dynamically on every request
// rather than serving the `revalidate` cache below — the same ISR-vs-
// session-read tradeoff FollowExpertButton's own doc comment flags for
// /analysts/[slug] (which sidesteps it by fetching client-side instead).
// Kept as directed since /calls/[id] is thin, noindex, single-call content
// with far lower traffic than the analyst directory it was traded off
// against there.
export const revalidate = 3600;

async function fetchResolvedCall(id: string, userId: string | null) {
  const opinion = await prisma.expertOpinion.findUnique({
    where: { id },
    select: {
      id: true,
      quote: true,
      instrument: true,
      instrumentTicker: true,
      direction: true,
      sourceUrl: true,
      publishedAt: true,
      resolvedAt: true,
      resolutionStatus: true,
      resolutionNote: true,
      suppressedAt: true,
      expert: {
        select: {
          name: true,
          organization: true,
          slug: true,
          verified: true,
          avatarUrl: true,
          // Growth Loop Sprint G3 (Decision 3) — the analyst's own aggregate
          // track record, rendered below the quote via formatAccuracyCaption
          // once they clear PROVISIONAL_MIN_RESOLVED_CALLS. Same shape
          // getPublicProfileStats expects (mirrors analysts/[slug]/page.tsx's
          // fetchExpertBySlug), suppressed opinions excluded.
          opinions: {
            where: { suppressedAt: null },
            select: { resolutionStatus: true },
          },
        },
      },
    },
  });

  if (!opinion) {
    return { kind: "not-found" as const };
  }

  // A suppressed opinion is REMOVED from the public scorecard — never render
  // its share artifact. But it must not 404 either (QA, 2026-08-15: ~45% of
  // opinions are suppressed, and a user's own /profile My Takes list links
  // every vote here — a third of a vote-rich user's rows dead-ended one
  // click from their own profile). It also can't deep-link into the public
  // opinions feed (suppressed rows aren't in it), so the analyst profile is
  // the honest destination.
  if (opinion.suppressedAt) {
    return { kind: "suppressed" as const, expertSlug: opinion.expert.slug };
  }

  // Founder 2026-08-16 (second pass — the first fix redirected pending
  // calls into the opinions feed and was explicitly rejected: "it should be
  // call page"): every public, non-suppressed call now RENDERS its own
  // /calls/[id] page. A graded call shows its verdict + share kit; a
  // pending call shows the same card with an honest Pending state, live
  // Take-a-Side voting (only possible while pending), and no share kit
  // (nothing gradable to share — the never-share-ungraded-as-verdict law
  // stands). NOT_GRADED renders too, labeled as such.
  const expertStats = computeScorecard(opinion.expert.opinions);

  // Single extra query, only on the render path (generateMetadata below
  // always passes userId: null, so this is skipped there entirely).
  const savedRow = userId
    ? await prisma.savedOpinion.findUnique({
        where: { userId_opinionId: { userId, opinionId: id } },
        select: { id: true },
      })
    : null;

  const isGraded =
    opinion.resolutionStatus === "RESOLVED_HIT" || opinion.resolutionStatus === "RESOLVED_MISS";

  return {
    kind: isGraded ? ("resolved" as const) : ("pending" as const),
    opinion: { ...opinion, expert: { ...opinion.expert, organization: canonicalizeOrgDisplay(opinion.expert.organization) } },
    expertStats,
    saved: Boolean(savedRow),
  };
}

export async function generateMetadata({ params }: { params: { id: string } }): Promise<Metadata> {
  const result = await fetchResolvedCall(params.id, null);

  if (result.kind !== "resolved" && result.kind !== "pending") {
    return { title: "Call not found — Predict Future" };
  }

  const { opinion } = result;
  const verdictLabel =
    result.kind === "pending"
      ? opinion.resolutionStatus === "NOT_GRADED"
        ? "Not graded"
        : "Pending"
      : opinion.resolutionStatus === "RESOLVED_HIT"
        ? "HIT"
        : "MISS";
  const title = `${opinion.expert.name}'s call on ${opinion.instrument ?? "the market"} — ${verdictLabel} | Predict Future`;
  const description =
    result.kind === "pending"
      ? `"${opinion.quote}" — ${opinion.expert.name}, ${opinion.expert.organization}. Tracked by Predict Future's Analyst Scorecard — graded HIT or MISS once its window elapses.`
      : `"${opinion.quote}" — ${opinion.expert.name}, ${opinion.expert.organization}. Graded ${verdictLabel} by Predict Future's Analyst Scorecard.`;

  return {
    title,
    description,
    // Thin, single-call content — keep it out of the index; the analyst profile page
    // (which links here) is the indexable surface.
    robots: { index: false, follow: true },
    alternates: { canonical: `https://predictfuture.app/calls/${params.id}` },
    openGraph: {
      title,
      description,
      type: "article",
      url: `https://predictfuture.app/calls/${params.id}`,
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
    },
  };
}

export default async function CallSharePage({ params }: { params: { id: string } }) {
  const session = await getSession();
  const userId = session?.user?.id ?? null;
  const result = await fetchResolvedCall(params.id, userId);

  if (result.kind === "not-found") {
    notFound();
  }

  if (result.kind === "suppressed") {
    // Removed from the public record — the analyst profile is the only honest
    // destination (see fetchResolvedCall's comment).
    if (result.expertSlug) {
      redirect(`/analysts/${result.expertSlug}`);
    }
    notFound();
  }

  const { opinion, expertStats, saved } = result;
  const isGraded = result.kind === "resolved";
  const isHit = opinion.resolutionStatus === "RESOLVED_HIT";
  // Decision 3: only render the aggregate line once the analyst clears the
  // same provisional-track-record gate used everywhere else on the site —
  // below that, the analyst's own profile already handles "building a track
  // record," so we just omit the line here rather than duplicate it.
  const showAccuracyCaption = expertStats.resolvedCount >= PROVISIONAL_MIN_RESOLVED_CALLS;

  return (
    <div className="space-y-8">
      <Card className="overflow-hidden border-0 bg-ink-900 text-white">
        <CardHeader>
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <Avatar name={opinion.expert.name} src={opinion.expert.avatarUrl} />
              <div>
                {opinion.expert.slug ? (
                  <Link href={`/analysts/${opinion.expert.slug}`} className="text-lg font-semibold text-white hover:underline">
                    {opinion.expert.name}
                  </Link>
                ) : (
                  <p className="text-lg font-semibold text-white">{opinion.expert.name}</p>
                )}
                <p className="text-sm text-white/60">
                  <FirmLink organization={opinion.expert.organization} className="hover:underline" />
                </p>
              </div>
            </div>
            {isGraded ? (
              <Badge variant={isHit ? "success" : "default"} className={isHit ? "" : "bg-white/10 text-white"}>
                {isHit ? "HIT" : "MISS"}
              </Badge>
            ) : opinion.resolutionStatus === "NOT_GRADED" ? (
              <Badge className="bg-white/10 text-white">Not graded</Badge>
            ) : (
              <Badge className="bg-amber-500/20 text-amber-300">Pending — not yet graded</Badge>
            )}
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <blockquote className="rounded-[24px] bg-white/10 p-5 text-lg leading-8 text-white">
            &ldquo;{opinion.quote}&rdquo;
          </blockquote>
          {showAccuracyCaption && (
            <p className="text-sm text-white/60">
              {opinion.expert.name}&rsquo;s track record: {formatAccuracyCaption(expertStats.hitCount, expertStats.resolvedCount)}
            </p>
          )}
          <div className="flex flex-wrap items-center gap-3">
            {opinion.instrument && <Badge className="bg-white/10 text-white">{opinion.instrument}</Badge>}
            <DirectionChip direction={opinion.direction} />
            <span className="text-sm text-white/60">Called {formatDateOnly(opinion.publishedAt)}</span>
            {opinion.resolvedAt && (
              <span className="text-sm text-white/60">Graded {formatDateOnly(opinion.resolvedAt)}</span>
            )}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="flex flex-col gap-4 p-6">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-ink-100 pb-4">
            <div className="flex items-center gap-2 text-sm text-ink-500">
              <span>Verdict:</span>
              <VerdictBadge status={opinion.resolutionStatus} />
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <SaveOpinionButton opinionId={opinion.id} initialSaved={saved} variant="labeled" />
              {/* Share kit: graded AND pending (founder 2026-08-16 — a
                  pending share reads "will it land?", never a verdict; the
                  OG image renders an explicit amber PENDING). NOT_GRADED is
                  the one state with nothing to share: it will never resolve. */}
              {(isGraded || opinion.resolutionStatus === "PENDING") && (
                <ShareCallButton
                  callId={opinion.id}
                  analystName={opinion.expert.name}
                  direction={opinion.direction}
                  instrument={opinion.instrument}
                  resolutionStatus={isGraded ? (isHit ? "RESOLVED_HIT" : "RESOLVED_MISS") : "PENDING"}
                />
              )}
            </div>
          </div>
          {isGraded && opinion.resolutionNote && (
            <p className="text-sm leading-6 text-ink-600">{opinion.resolutionNote}</p>
          )}
          {!isGraded && opinion.resolutionStatus === "PENDING" && (
            <p className="text-sm leading-6 text-ink-500">
              This call hasn&apos;t reached its evaluation window yet — the HIT/MISS verdict will appear here once
              it&apos;s graded against real price data. Save it above to find it again from your profile.
            </p>
          )}
          <TakeASide opinionId={opinion.id} resolutionStatus={opinion.resolutionStatus} />
          <PaperTradeCta opinionId={opinion.id} direction={opinion.direction} instrumentTicker={opinion.instrumentTicker} />
          <a
            href={opinion.sourceUrl}
            target="_blank"
            rel="noreferrer"
            className="inline-flex w-fit items-center gap-2 text-sm font-medium text-signal-sky hover:underline"
          >
            Read the original article
            <ArrowUpRight className="h-4 w-4" />
          </a>
          {opinion.expert.slug && (
            <Link
              href={`/analysts/${opinion.expert.slug}`}
              className="inline-flex w-fit items-center gap-2 text-sm font-medium text-ink-700 hover:underline"
            >
              See {opinion.expert.name}&rsquo;s full track record
              <ArrowUpRight className="h-4 w-4" />
            </Link>
          )}
        </CardContent>
      </Card>

      <AnalystDisclaimerFooter />
    </div>
  );
}
