import { NextResponse } from "next/server";

import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

/**
 * GET /api/finance/expert-sentiment
 *
 * Returns an aggregate of all ExpertOpinion rows whose analyst made the call
 * in the last 7 days. Includes PENDING and RESOLVED — a call made this week
 * is a this-week data point regardless of whether it later resolved.
 *
 * No auth required — this is a public aggregate.
 */
export async function GET() {
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

  // Single groupBy replaces 3 separate count() round-trips.
  // No resolutionStatus filter — resolved calls still count as "this week's sentiment".
  const directionCounts = await prisma.expertOpinion.groupBy({
    by: ["direction"],
    where: {
      suppressedAt: null,
      publishedAt: { gte: sevenDaysAgo },
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
    bullishPercent = Math.round((bullishCount / totalCount) * 1000) / 10; // 1 decimal
    bearishPercent = Math.round((bearishCount / totalCount) * 1000) / 10;
    neutralPercent = Math.round((neutralCount / totalCount) * 1000) / 10;
  }

  let dominantLean: "BULLISH" | "BEARISH" | "NEUTRAL" | "MIXED" = "MIXED";
  if (bullishPercent > 55) {
    dominantLean = "BULLISH";
  } else if (bearishPercent > 55) {
    dominantLean = "BEARISH";
  } else if (neutralPercent > 55) {
    dominantLean = "NEUTRAL";
  }

  const response = NextResponse.json({
    bullishCount,
    bearishCount,
    neutralCount,
    totalCount,
    bullishPercent,
    bearishPercent,
    neutralPercent,
    dominantLean,
    samplePeriod: "7d" as const,
  });
  response.headers.set("Cache-Control", "public, max-age=120, s-maxage=120");
  return response;
}
