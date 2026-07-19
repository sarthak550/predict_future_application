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

  let bullishPercent = 0;
  let bearishPercent = 0;
  let neutralPercent = 0;

  if (totalCount > 0) {
    bullishPercent = Math.round((bullishCount / totalCount) * 1000) / 10;
    bearishPercent = Math.round((bearishCount / totalCount) * 1000) / 10;
    neutralPercent = Math.round((neutralCount / totalCount) * 1000) / 10;
  }

  let dominantLean: DominantLean = "MIXED";
  if (bullishPercent > 55) {
    dominantLean = "BULLISH";
  } else if (bearishPercent > 55) {
    dominantLean = "BEARISH";
  } else if (neutralPercent > 55) {
    dominantLean = "NEUTRAL";
  }

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
