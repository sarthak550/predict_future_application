/**
 * Live data for /methodology (Trust Layer Sprint T3, 2026-08-15).
 *
 * Every number this page shows is a real query run at render time — nothing here is a
 * typed-in constant. This module exists specifically so the page component stays
 * presentational and every stat has one obvious place to audit: if a number on
 * /methodology looks wrong, this file is where to check the query that produced it.
 *
 * The denominator/era-split queries deliberately mirror
 * apps/api/scripts/investigate-accuracy-discrepancy.ts (Trust Layer Sprint T0) exactly —
 * same "graded" definition, same era cutoff, same recent-N slice — so a skeptic can
 * re-run that script against prod and get numbers that agree with this page. Do not let
 * these two drift into two different definitions of "graded."
 */
import { ANALYST_OPINION_SOURCES, computeWilsonInterval } from "@predict-future/business-rules";

import { prisma } from "@/lib/prisma";

// Same cutoff T0 tested: the date of commit e3b3a89 ("Opinions: fix resolution-pipeline
// starvation + add verdict quality gate"), which changed preprocessing order (FIFO) and
// added a low-confidence-verdict quality gate on the same day.
const ERA_CUTOFF = new Date("2026-07-20T00:00:00.000Z");
const RECENT_N = 25;

const STATUSES = ["PENDING", "RESOLVED_HIT", "RESOLVED_MISS", "NOT_GRADED"] as const;

export interface StatusCounts {
  PENDING: number;
  RESOLVED_HIT: number;
  RESOLVED_MISS: number;
  NOT_GRADED: number;
}

export interface DenominatorReconciliation {
  nonSuppressed: StatusCounts;
  suppressed: StatusCounts;
  nonSuppressedTotal: number;
  suppressedTotal: number;
  grandTotal: number;
  /** non-suppressed AND status IN (RESOLVED_HIT, RESOLVED_MISS) — the one true "graded" definition. */
  gradedCount: number;
  gradedPct: number;
  suppressionRate: number;
}

async function fetchDenominatorReconciliation(): Promise<DenominatorReconciliation> {
  const nonSuppressed = {} as StatusCounts;
  const suppressed = {} as StatusCounts;

  for (const status of STATUSES) {
    nonSuppressed[status] = await prisma.expertOpinion.count({
      where: { suppressedAt: null, resolutionStatus: status },
    });
    suppressed[status] = await prisma.expertOpinion.count({
      where: { suppressedAt: { not: null }, resolutionStatus: status },
    });
  }

  const nonSuppressedTotal = STATUSES.reduce((sum, s) => sum + nonSuppressed[s], 0);
  const suppressedTotal = STATUSES.reduce((sum, s) => sum + suppressed[s], 0);
  const grandTotal = nonSuppressedTotal + suppressedTotal;
  const gradedCount = nonSuppressed.RESOLVED_HIT + nonSuppressed.RESOLVED_MISS;

  return {
    nonSuppressed,
    suppressed,
    nonSuppressedTotal,
    suppressedTotal,
    grandTotal,
    gradedCount,
    gradedPct: nonSuppressedTotal > 0 ? (gradedCount / nonSuppressedTotal) * 100 : 0,
    suppressionRate: grandTotal > 0 ? (suppressedTotal / grandTotal) * 100 : 0,
  };
}

export interface DirectionSplit {
  bullish: number;
  bearish: number;
  neutral: number;
  total: number;
  bullishPct: number;
  bearishPct: number;
  neutralPct: number;
}

/** All-time extraction split (non-suppressed opinions, any resolution status) — this is
 *  about what direction the extraction pipeline TAGGED a claim, not about grading. */
async function fetchDirectionSplit(): Promise<DirectionSplit> {
  const [bullish, bearish, neutral] = await Promise.all([
    prisma.expertOpinion.count({ where: { suppressedAt: null, direction: "BULLISH" } }),
    prisma.expertOpinion.count({ where: { suppressedAt: null, direction: "BEARISH" } }),
    prisma.expertOpinion.count({ where: { suppressedAt: null, direction: "NEUTRAL" } }),
  ]);
  const total = bullish + bearish + neutral;
  return {
    bullish,
    bearish,
    neutral,
    total,
    bullishPct: total > 0 ? (bullish / total) * 100 : 0,
    bearishPct: total > 0 ? (bearish / total) * 100 : 0,
    neutralPct: total > 0 ? (neutral / total) * 100 : 0,
  };
}

export interface EraBucket {
  hitCount: number;
  missCount: number;
  n: number;
  hitRatePct: number;
  ci: { lowerPct: number; upperPct: number } | null;
}

export interface EraSplit {
  cutoffLabel: string;
  pre: EraBucket;
  post: EraBucket;
  recent: EraBucket & { spanLabel: string | null };
  allTime: EraBucket;
}

function toBucket(hitCount: number, missCount: number): EraBucket {
  const n = hitCount + missCount;
  const ci = computeWilsonInterval(hitCount, n);
  return {
    hitCount,
    missCount,
    n,
    hitRatePct: n > 0 ? (hitCount / n) * 100 : 0,
    ci: ci ? { lowerPct: Math.round(ci.lower * 100), upperPct: Math.round(ci.upper * 100) } : null,
  };
}

/** Reproduces investigate-accuracy-discrepancy.ts's era split (a) live, at render time. */
async function fetchEraSplit(): Promise<EraSplit> {
  const [preHit, preMiss, postHit, postMiss] = await Promise.all([
    prisma.expertOpinion.count({
      where: { suppressedAt: null, resolutionStatus: "RESOLVED_HIT", resolvedAt: { lt: ERA_CUTOFF } },
    }),
    prisma.expertOpinion.count({
      where: { suppressedAt: null, resolutionStatus: "RESOLVED_MISS", resolvedAt: { lt: ERA_CUTOFF } },
    }),
    prisma.expertOpinion.count({
      where: { suppressedAt: null, resolutionStatus: "RESOLVED_HIT", resolvedAt: { gte: ERA_CUTOFF } },
    }),
    prisma.expertOpinion.count({
      where: { suppressedAt: null, resolutionStatus: "RESOLVED_MISS", resolvedAt: { gte: ERA_CUTOFF } },
    }),
  ]);

  const recentRows = await prisma.expertOpinion.findMany({
    where: { suppressedAt: null, resolutionStatus: { in: ["RESOLVED_HIT", "RESOLVED_MISS"] } },
    orderBy: { resolvedAt: "desc" },
    take: RECENT_N,
    select: { resolutionStatus: true, resolvedAt: true },
  });
  const recentHit = recentRows.filter((r) => r.resolutionStatus === "RESOLVED_HIT").length;
  const recentMiss = recentRows.length - recentHit;
  const spanLabel =
    recentRows.length > 0
      ? `${recentRows[recentRows.length - 1]?.resolvedAt?.toISOString().slice(0, 10)} to ${recentRows[0]?.resolvedAt?.toISOString().slice(0, 10)}`
      : null;

  return {
    cutoffLabel: ERA_CUTOFF.toISOString().slice(0, 10),
    pre: toBucket(preHit, preMiss),
    post: toBucket(postHit, postMiss),
    recent: { ...toBucket(recentHit, recentMiss), spanLabel },
    allTime: toBucket(preHit + postHit, preMiss + postMiss),
  };
}

export interface MethodologyData {
  reconciliation: DenominatorReconciliation;
  directionSplit: DirectionSplit;
  eraSplit: EraSplit;
  /** Founder's own worked example (Decision 2/3), computed live by the same function
   *  every accuracy surface on the site uses — never hardcoded. */
  sampleSizeExample: { hitCount: number; resolvedCount: number; ci: { lowerPct: number; upperPct: number } };
  trackedSources: string[];
}

export async function fetchMethodologyData(): Promise<MethodologyData> {
  const [reconciliation, directionSplit, eraSplit] = await Promise.all([
    fetchDenominatorReconciliation(),
    fetchDirectionSplit(),
    fetchEraSplit(),
  ]);

  const exampleCi = computeWilsonInterval(4, 6);

  return {
    reconciliation,
    directionSplit,
    eraSplit,
    sampleSizeExample: {
      hitCount: 4,
      resolvedCount: 6,
      ci: exampleCi
        ? { lowerPct: Math.round(exampleCi.lower * 100), upperPct: Math.round(exampleCi.upper * 100) }
        : { lowerPct: 0, upperPct: 100 },
    },
    trackedSources: ANALYST_OPINION_SOURCES,
  };
}
