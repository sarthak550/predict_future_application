import { prisma } from "@/lib/prisma";
import { buildInstrumentWhereOr } from "@/lib/finance/instruments";

export type DominantLean = "BULLISH" | "BEARISH" | "NEUTRAL" | "MIXED";

export interface SentimentSplit {
  bullishCount: number;
  bearishCount: number;
  neutralCount: number;
  totalCount: number;
  bullishPercent: number;
  bearishPercent: number;
  neutralPercent: number;
  dominantLean: DominantLean;
  samplePeriod: "7d";
  scopedInstrument: string | null;
}

/**
 * Shared by every sentiment aggregator in the app — the homepage/instrument-
 * unfiltered 7-day split here AND /opinions' filtered, all-time split
 * (lib/finance/opinionsQuery.ts's fetchOpinionsSentimentSplit) — so the
 * percent-rounding and "what counts as a lean" rules can never drift apart
 * between the two.
 */
export function computeSentimentPercentages(
  bullishCount: number,
  bearishCount: number,
  neutralCount: number,
): { bullishPercent: number; bearishPercent: number; neutralPercent: number } {
  const totalCount = bullishCount + bearishCount + neutralCount;
  if (totalCount === 0) {
    return { bullishPercent: 0, bearishPercent: 0, neutralPercent: 0 };
  }
  return {
    bullishPercent: Math.round((bullishCount / totalCount) * 1000) / 10,
    bearishPercent: Math.round((bearishCount / totalCount) * 1000) / 10,
    neutralPercent: Math.round((neutralCount / totalCount) * 1000) / 10,
  };
}

export function computeDominantLean(
  bullishPercent: number,
  bearishPercent: number,
  neutralPercent: number,
): DominantLean {
  if (bullishPercent > 55) return "BULLISH";
  if (bearishPercent > 55) return "BEARISH";
  if (neutralPercent > 55) return "NEUTRAL";
  return "MIXED";
}

/**
 * Portable port of apps/api/app/api/finance/expert-sentiment/route.ts — apps/web
 * renders this server-side (SSR/ISR) rather than fetching the API route over
 * HTTP, so the math is reimplemented here against the same Prisma models. KEEP
 * THE AGGREGATION LOGIC IN LOCKSTEP with that route; both must agree on what
 * counts as "this week's sentiment" (PENDING and RESOLVED both count — a call
 * made this week is a data point regardless of whether it later resolved).
 */
export async function getSentimentSplit(instrument?: string): Promise<SentimentSplit> {
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

  const directionCounts = await prisma.expertOpinion.groupBy({
    by: ["direction"],
    where: {
      suppressedAt: null,
      publishedAt: { gte: sevenDaysAgo },
      ...(instrument ? { OR: buildInstrumentWhereOr(instrument) } : {}),
    },
    _count: { _all: true },
  });

  const bullishCount = directionCounts.find((c) => c.direction === "BULLISH")?._count._all ?? 0;
  const bearishCount = directionCounts.find((c) => c.direction === "BEARISH")?._count._all ?? 0;
  const neutralCount = directionCounts.find((c) => c.direction === "NEUTRAL")?._count._all ?? 0;

  const totalCount = bullishCount + bearishCount + neutralCount;
  const { bullishPercent, bearishPercent, neutralPercent } = computeSentimentPercentages(
    bullishCount,
    bearishCount,
    neutralCount,
  );
  const dominantLean = computeDominantLean(bullishPercent, bearishPercent, neutralPercent);

  return {
    bullishCount,
    bearishCount,
    neutralCount,
    totalCount,
    bullishPercent,
    bearishPercent,
    neutralPercent,
    dominantLean,
    samplePeriod: "7d",
    scopedInstrument: instrument ?? null,
  };
}
