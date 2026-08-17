/**
 * GET /api/finance/big-call
 *
 * Returns the "Today's Big Call" spotlight opinion — the single highest-scored
 * PENDING ExpertOpinion across the current pool, determined by:
 *
 *   score = analystTierWeight × freshnessScore
 *
 * Where:
 *   analystTierWeight : derived from the expert's own resolved HIT rate (see
 *                       tierFor below), not vote count — Expert model has no
 *                       manual tier field. Base tier 0.5 (0.7 for a verified
 *                       expert with no track record yet) climbing toward 1.5
 *                       as HIT rate + sample-size confidence increase.
 *   freshnessScore    : exp decay with 24-hour half-life (1.0 at publish, 0.5 at 24h)
 *
 * Post-resolution spotlight exception:
 *   If an opinion resolved as RESOLVED_HIT recently enough to be eligible (see
 *   `eligibleHitIds` below), it may enter a post-resolution spotlight window.
 *   Score = tierWeight × 1.5 × (freshness of the resolution, not the publish
 *   date). Displayed with "CALLED IT" badge.
 *
 * "Serious Charts" Program, Workstream A (2026-08-17) — dropped the two
 * vote-derived scoring terms (clusterHeatScore, pollAVolumeScore) and the
 * `pollAVotes`/`agreePercent` response fields: a public "how many people
 * voted" input undercuts the product's seriousness goal, regardless of
 * platform (mobile voting itself is untouched this sprint — see the brief's
 * Correction 1). Confirmed neither apps/mobile's finance-mode.tsx/
 * combined-analyst-card.tsx nor any apps/web surface rendered either field
 * before dropping them. KEEP IN LOCKSTEP with apps/web/lib/finance/bigCall.ts
 * — both must pick the same winner from the same pool at the same moment.
 *
 * Public endpoint — no authentication required.
 * Cache-Control: 60-minute cache via s-maxage.
 *
 * (S35-T2)
 */

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

// ── IST market-window helpers ───────────────────────────────────────────────

type MarketWindow =
  | "live"
  | "closing-wrap"
  | "after-hours"
  | "pre-market"
  | "weekend"
  | "holiday";

function getMarketWindow(): MarketWindow {
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

const WINDOW_LABELS: Record<MarketWindow, string> = {
  live:           "Today's Big Call",
  "closing-wrap": "Today's Vindicated Call",
  "after-hours":  "Overnight Big Call",
  "pre-market":   "Pre-market Big Call",
  weekend:        "Call of the Week",
  holiday:        "Call of the Week",
};

// ── Scoring helpers ──────────────────────────────────────────────────────────

/** Exponential decay freshness: 1.0 at publish, 0.5 at 24h, 0.25 at 48h */
function freshnessScore(publishedAt: Date): number {
  const ageHours = (Date.now() - publishedAt.getTime()) / (1000 * 60 * 60);
  return Math.pow(0.5, ageHours / 24);
}

// Serves live DB data — render dynamically so `next build` does not statically
// evaluate this route (which would hit the DB with no connection at build time).
export const dynamic = "force-dynamic";

export async function GET() {
  const window = getMarketWindow();

  // Window-aware candidate selection — keeps the scoring algorithm below intact,
  // just biases what enters the pool. Empty pools naturally fall back via the
  // scoring tie-breakers.

  // PENDING candidates: 7-day rolling window for most cases; for after-hours and
  // pre-market we bias toward verified analysts only (the user wants curated
  // overnight reads, not raw activity).
  const cutoff = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const pendingWhere = {
    resolutionStatus: "PENDING" as const,
    suppressedAt: null,
    publishedAt: { gte: cutoff },
    isSourceAttribution: false,
    ...(window === "after-hours" || window === "pre-market"
      ? { expert: { verified: true } }
      : {}),
  };

  const pendingOpinions = await prisma.expertOpinion.findMany({
    where: pendingWhere,
    include: {
      expert: {
        select: {
          id: true,
          name: true,
          organization: true,
          avatarUrl: true,
          verified: true,
        },
      },
    },
    orderBy: { publishedAt: "desc" },
    take: 200,
  });

  // Post-resolution spotlight: for closing-wrap, ANY HIT today qualifies (no
  // vote threshold) because the editorial intent is "show today's winners".
  // For other windows, keep the 24h + ≥20 votes gate so we don't surface low-
  // engagement HITs as the spotlight.
  const isClosingWrap = window === "closing-wrap";
  const recentHitCutoff = isClosingWrap
    ? (() => {
        // Start of today IST
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

  // ── 3. Get Poll A vote counts for all candidates ──────────────────────────
  const allCandidateIds = [
    ...pendingOpinions.map((op) => op.id),
    ...hitOpinionIds.map((op) => op.id),
  ];

  const pollAVoteCounts = await prisma.expertOpinionVote.groupBy({
    by: ["opinionId"],
    where: {
      opinionId: { in: allCandidateIds },
      pollType: "IMPLICATION",
      lockedAt: { not: null }, // Only locked votes count toward heat
    },
    _count: { id: true },
  });
  const pollAMap = new Map<string, number>();
  for (const row of pollAVoteCounts) {
    pollAMap.set(row.opinionId, row._count.id);
  }

  // ── 4. Filter HIT candidates ──────────────────────────────────────────────
  // Closing-wrap: ANY HIT today qualifies (no vote threshold) — editorial intent
  // is "show today's winners". Other windows: keep the ≥20 votes gate.
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

  // Fetch full data for eligible HIT opinions
  const hitOpinions = eligibleHitIds.length > 0
    ? await prisma.expertOpinion.findMany({
        where: { id: { in: eligibleHitIds } },
        include: {
          expert: {
            select: {
              id: true,
              name: true,
              organization: true,
              avatarUrl: true,
              verified: true,
            },
          },
        },
      })
    : [];

  // ── 5. Build combined pool ─────────────────────────────────────────────────
  type OpinionWithExpert = (typeof pendingOpinions)[number];
  const pendingPool: Array<OpinionWithExpert & { isPostResolution: boolean }> =
    pendingOpinions.map((op) => ({ ...op, isPostResolution: false }));
  const hitPool: Array<OpinionWithExpert & { isPostResolution: boolean }> =
    hitOpinions.map((op) => ({ ...op, isPostResolution: true }));

  const allCandidates = [...pendingPool, ...hitPool];

  if (allCandidates.length === 0) {
    return NextResponse.json(
      { opinion: null, window, windowLabel: WINDOW_LABELS[window] },
      { headers: { "Cache-Control": "public, s-maxage=3600, stale-while-revalidate=300" } }
    );
  }

  // ── 7b. Compute hit-rate-based tier for each candidate's expert ────────────
  // Replaces the old binary tier=verified flag (which had ~zero discriminating
  // power because tier=1.0 candidates were almost never in the pool).
  // tier = baseline + (hitRate × confidence), where confidence ramps with sample
  //        size and saturates beyond 10 resolved calls. Stays in [0.3, 1.5].
  const expertIds = [...new Set(allCandidates.map((op) => op.expert.id))];
  const expertHistory = await prisma.expertOpinion.groupBy({
    by: ["expertId", "resolutionStatus"],
    where: {
      expertId: { in: expertIds },
      resolutionStatus: { in: ["RESOLVED_HIT", "RESOLVED_MISS"] },
      suppressedAt: null,
    },
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
      // No track record. Verified individuals still get a small bump (we
      // trust the manual flag) but it's weaker than a proven hit-rate.
      return isVerifiedFallback ? 0.7 : 0.5;
    }
    const hitRate = h.hits / h.total; // 0..1
    // Confidence climbs with sample size, saturates at 10 resolutions.
    const confidence = Math.min(1, h.total / 10);
    // hitRate=0.5 with full confidence → tier=1.0; hitRate=1.0 → tier=1.5; hitRate=0.0 → tier=0.5
    return 0.5 + hitRate * confidence;
  }

  // ── 8. Score each candidate ────────────────────────────────────────────────
  // "Serious Charts" Program (2026-08-17) — dropped clusterHeat and
  // pollAVolumeNorm (see this file's own module doc). PENDING score is now
  // just tierWeight × freshnessScore.
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
    return NextResponse.json(
      { opinion: null, window, windowLabel: WINDOW_LABELS[window] },
      { headers: { "Cache-Control": "public, s-maxage=3600, stale-while-revalidate=300" } }
    );
  }

  const { op, score } = winner;

  return NextResponse.json(
    {
      window,
      windowLabel: WINDOW_LABELS[window],
      opinion: {
        id: op.id,
        expertId: op.expert.id,
        expertName: op.expert.name,
        expertOrganization: op.expert.organization,
        avatarUrl: op.expert.avatarUrl ?? null,
        analystTier: op.expert.verified ? "CHIEF_ANALYST" : "ANALYST",
        accuracyScore: null, // Expert table has no accuracy — not displayed
        quote: op.quote,
        headline: op.headline ?? null,
        direction: op.direction,
        instrument: op.instrument ?? null,
        instrumentTicker: op.instrumentTicker ?? null,
        sourceUrl: op.sourceUrl,
        publishedAt: op.publishedAt.toISOString(),
        resolutionStatus: op.resolutionStatus,
        resolvedAt: op.resolvedAt?.toISOString() ?? null,
        resolutionNote: op.resolutionNote ?? null,
        isPostResolution: op.isPostResolution,
        score,
      },
    },
    { headers: { "Cache-Control": "public, s-maxage=3600, stale-while-revalidate=300" } }
  );
}
