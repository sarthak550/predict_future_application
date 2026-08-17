import { canonicalizeOrgDisplay } from "@predict-future/business-rules/experts/firmAliases";

import { prisma } from "@/lib/prisma";

/**
 * Portable port of apps/api/app/api/finance/big-call/route.ts's selection
 * algorithm (S35-T2) — apps/web renders this server-side (SSR/ISR) rather than
 * fetching the API route over HTTP. KEEP THE SCORING LOGIC IN LOCKSTEP with
 * that route; both must pick the same winner from the same pool at the same
 * moment. See that file for the full scoring-formula writeup; this is a
 * line-for-line port, not a simplification.
 *
 * "Serious Charts" Program, Workstream A (2026-08-17) — PENDING scoring
 * dropped its two vote-derived terms (clusterHeat, pollAVolumeNorm): a public
 * "how many people voted" input undercuts the product's seriousness goal
 * regardless of platform, even though mobile voting itself isn't touched
 * this sprint (see the brief's Correction 1). POST_RESOLUTION scoring was
 * already vote-free and is unchanged. `pollAVotes`/`agreePercent` were also
 * dropped from the returned `opinion` shape — confirmed neither
 * apps/mobile's finance-mode.tsx/combined-analyst-card.tsx nor any apps/web
 * surface rendered them.
 */

export type BigCallWindow = "live" | "closing-wrap" | "after-hours" | "pre-market" | "weekend" | "holiday";

export interface BigCallResult {
  window: BigCallWindow;
  windowLabel: string;
  opinion: {
    id: string;
    expertId: string;
    expertName: string;
    expertOrganization: string;
    avatarUrl: string | null;
    expertSlug: string | null;
    quote: string;
    headline: string | null;
    direction: "BULLISH" | "BEARISH" | "NEUTRAL";
    instrument: string | null;
    instrumentTicker: string | null;
    sourceUrl: string;
    publishedAt: Date;
    resolutionStatus: string;
    resolvedAt: Date | null;
    resolutionNote: string | null;
    isPostResolution: boolean;
  } | null;
}

function getMarketWindow(): BigCallWindow {
  const utc = new Date();
  const ist = new Date(utc.getTime() + (5 * 60 + 30) * 60 * 1000);
  const dayOfWeek = ist.getUTCDay();
  if (dayOfWeek === 0 || dayOfWeek === 6) return "weekend";
  const total = ist.getUTCHours() * 60 + ist.getUTCMinutes();
  if (total < 8 * 60) return "after-hours";
  if (total < 9 * 60 + 15) return "pre-market";
  if (total < 15 * 60 + 30) return "live";
  if (total < 20 * 60) return "closing-wrap";
  return "after-hours";
}

const WINDOW_LABELS: Record<BigCallWindow, string> = {
  live: "Today's Big Call",
  "closing-wrap": "Today's Vindicated Call",
  "after-hours": "Overnight Big Call",
  "pre-market": "Pre-market Big Call",
  weekend: "Call of the Week",
  holiday: "Call of the Week",
};

/** Exponential decay freshness: 1.0 at publish, 0.5 at 24h, 0.25 at 48h */
function freshnessScore(publishedAt: Date): number {
  const ageHours = (Date.now() - publishedAt.getTime()) / (1000 * 60 * 60);
  return Math.pow(0.5, ageHours / 24);
}

export async function getTodaysBigCall(): Promise<BigCallResult> {
  const window = getMarketWindow();

  const cutoff = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const pendingWhere = {
    resolutionStatus: "PENDING" as const,
    suppressedAt: null,
    publishedAt: { gte: cutoff },
    isSourceAttribution: false,
    ...(window === "after-hours" || window === "pre-market" ? { expert: { verified: true } } : {}),
  };

  const pendingOpinions = await prisma.expertOpinion.findMany({
    where: pendingWhere,
    include: {
      expert: {
        select: { id: true, name: true, organization: true, avatarUrl: true, verified: true, slug: true },
      },
    },
    orderBy: { publishedAt: "desc" },
    take: 200,
  });

  const isClosingWrap = window === "closing-wrap";
  const recentHitCutoff = isClosingWrap
    ? (() => {
        const now = new Date();
        const ist = new Date(now.getTime() + (5 * 60 + 30) * 60 * 1000);
        ist.setUTCHours(0, 0, 0, 0);
        return new Date(ist.getTime() - (5 * 60 + 30) * 60 * 1000);
      })()
    : new Date(Date.now() - 7 * 24 * 60 * 60 * 1000); // 7d, not 24h (2026-08-15 audit #3): a graded receipt is showcase-worthy all week — see minVotesForHit below

  const hitOpinionIds = await prisma.expertOpinion.findMany({
    where: {
      resolutionStatus: "RESOLVED_HIT",
      resolvedAt: { gte: recentHitCutoff },
      suppressedAt: null,
      isSourceAttribution: false,
    },
    select: { id: true },
    take: 50,
  });

  const allCandidateIds = [...pendingOpinions.map((op) => op.id), ...hitOpinionIds.map((op) => op.id)];

  const pollAVoteCounts = await prisma.expertOpinionVote.groupBy({
    by: ["opinionId"],
    where: { opinionId: { in: allCandidateIds }, pollType: "IMPLICATION", lockedAt: { not: null } },
    _count: { id: true },
  });
  const pollAMap = new Map<string, number>();
  for (const row of pollAVoteCounts) {
    pollAMap.set(row.opinionId, row._count.id);
  }

  // 2026-08-15 (audit critical #3, founder-picked): the old "≥20 poll votes
  // outside closing-wrap" gate structurally locked graded HITs out of the
  // hero (polls have ~zero votes pre-launch), so the page's single largest
  // visual element was almost always an UNGRADED claim — on a product whose
  // pitch is grading. Any recent graded HIT now qualifies in every window;
  // pending calls remain the fallback when no recent receipt exists.
  const minVotesForHit = 0;
  const eligibleHitIds = hitOpinionIds
    .filter((op) => (pollAMap.get(op.id) ?? 0) >= minVotesForHit)
    .map((op) => op.id);

  const hitOpinions =
    eligibleHitIds.length > 0
      ? await prisma.expertOpinion.findMany({
          where: { id: { in: eligibleHitIds } },
          include: {
            expert: {
              select: { id: true, name: true, organization: true, avatarUrl: true, verified: true, slug: true },
            },
          },
        })
      : [];

  type OpinionWithExpert = (typeof pendingOpinions)[number];
  const pendingPool: Array<OpinionWithExpert & { isPostResolution: boolean }> = pendingOpinions.map((op) => ({
    ...op,
    isPostResolution: false,
  }));
  const hitPool: Array<OpinionWithExpert & { isPostResolution: boolean }> = hitOpinions.map((op) => ({
    ...op,
    isPostResolution: true,
  }));

  const allCandidates = [...pendingPool, ...hitPool];

  if (allCandidates.length === 0) {
    return { window, windowLabel: WINDOW_LABELS[window], opinion: null };
  }

  const expertIds = [...new Set(allCandidates.map((op) => op.expert.id))];
  const expertHistory = await prisma.expertOpinion.groupBy({
    by: ["expertId", "resolutionStatus"],
    where: { expertId: { in: expertIds }, resolutionStatus: { in: ["RESOLVED_HIT", "RESOLVED_MISS"] }, suppressedAt: null },
    _count: { id: true },
  });
  const hitRateMap = new Map<string, { hits: number; total: number }>();
  for (const row of expertHistory) {
    const existing = hitRateMap.get(row.expertId) ?? { hits: 0, total: 0 };
    existing.total += row._count.id;
    if (row.resolutionStatus === "RESOLVED_HIT") existing.hits += row._count.id;
    hitRateMap.set(row.expertId, existing);
  }
  function tierFor(expertId: string, isVerifiedFallback: boolean): number {
    const h = hitRateMap.get(expertId);
    if (!h || h.total === 0) {
      return isVerifiedFallback ? 0.7 : 0.5;
    }
    const hitRate = h.hits / h.total;
    const confidence = Math.min(1, h.total / 10);
    return 0.5 + hitRate * confidence;
  }

  // "Serious Charts" Program (2026-08-17) — PENDING score is now just
  // tierWeight × freshnessScore (clusterHeat and pollAVolumeNorm dropped, see
  // this file's own module doc). POST_RESOLUTION is unchanged.
  const scored = allCandidates.map((op) => {
    const tierWeight = tierFor(op.expert.id, op.expert.verified);

    let score: number;
    if (op.isPostResolution) {
      // 1.5x keeps any receipt above every pending call's tiny score; the
      // recency factor ranks receipts among themselves (newest resolution wins).
      score = tierWeight * 1.5 * (0.5 + 0.5 * freshnessScore(op.resolvedAt ?? op.publishedAt));
    } else {
      score = tierWeight * freshnessScore(op.publishedAt);
    }

    return { op, score };
  });

  scored.sort((a, b) => b.score - a.score);
  const winner = scored[0];
  if (!winner) {
    return { window, windowLabel: WINDOW_LABELS[window], opinion: null };
  }

  const { op } = winner;

  return {
    window,
    windowLabel: WINDOW_LABELS[window],
    opinion: {
      id: op.id,
      expertId: op.expert.id,
      expertName: op.expert.name,
      // Canonicalized so a stray pre-merge acronym spelling never displays next
      // to its spelled-out sibling elsewhere on the page (same belt-and-
      // suspenders convention as lib/finance/analysts.ts).
      expertOrganization: canonicalizeOrgDisplay(op.expert.organization),
      avatarUrl: op.expert.avatarUrl ?? null,
      expertSlug: op.expert.slug ?? null,
      quote: op.quote,
      headline: op.headline ?? null,
      direction: op.direction,
      instrument: op.instrument ?? null,
      instrumentTicker: op.instrumentTicker ?? null,
      sourceUrl: op.sourceUrl,
      publishedAt: op.publishedAt,
      resolutionStatus: op.resolutionStatus,
      resolvedAt: op.resolvedAt ?? null,
      resolutionNote: op.resolutionNote ?? null,
      isPostResolution: op.isPostResolution,
    },
  };
}
