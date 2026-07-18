import { NextResponse } from "next/server";

import { prisma } from "@/lib/prisma";
import { getInstrumentVariants } from "@/lib/news/queries";

export const dynamic = "force-dynamic";

/**
 * GET /api/finance/expert-sentiment
 *
 * Returns an aggregate of all ExpertOpinion rows whose analyst made the call
 * in the last 7 days. Includes PENDING and RESOLVED — a call made this week
 * is a this-week data point regardless of whether it later resolved.
 *
 * Optional `?instrument=<canonical label>` scopes the aggregate to that
 * instrument (and all its known variants — see getInstrumentVariants) via
 * a case-insensitive match against instrument/instrumentTicker. This reuses
 * the same matching logic as the news feed's instrument filter so the gauge
 * and the feed always agree on which opinions belong to an instrument.
 *
 * No auth required — this is a public aggregate.
 */
export async function GET(request: Request) {
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const instrument = new URL(request.url).searchParams.get("instrument")?.trim() || undefined;

  // Single groupBy replaces 3 separate count() round-trips.
  // No resolutionStatus filter — resolved calls still count as "this week's sentiment".
  const directionCounts = await prisma.expertOpinion.groupBy({
    by: ["direction"],
    where: {
      suppressedAt: null,
      publishedAt: { gte: sevenDaysAgo },
      // Reuses the news feed's instrument-matching semantics (buildOpinionWhere
      // in lib/news/queries.ts): match ANY known variant on EITHER field, so
      // this must be an OR array, not AND — AND would require every variant to
      // match both fields simultaneously and return ~zero results.
      ...(instrument
        ? {
            OR: getInstrumentVariants(instrument).flatMap((v) => [
              { instrument: { contains: v, mode: "insensitive" as const } },
              { instrumentTicker: { contains: v, mode: "insensitive" as const } },
            ]),
          }
        : {}),
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
    scopedInstrument: instrument ?? null,
  });
  response.headers.set("Cache-Control", "public, max-age=120, s-maxage=120");
  return response;
}
