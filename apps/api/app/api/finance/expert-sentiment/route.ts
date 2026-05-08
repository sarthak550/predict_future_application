import { NextResponse } from "next/server";

import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

/**
 * GET /api/finance/expert-sentiment
 *
 * Returns an aggregate of all PENDING ExpertOpinion rows created in the last
 * 7 days. No auth required — this is a public aggregate.
 */
export async function GET() {
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

  // Count by direction for PENDING opinions in the last 7 days
  const [bullishCount, bearishCount, neutralCount] = await Promise.all([
    prisma.expertOpinion.count({
      where: {
        resolutionStatus: "PENDING",
        suppressedAt: null,
        createdAt: { gte: sevenDaysAgo },
        direction: "BULLISH",
      },
    }),
    prisma.expertOpinion.count({
      where: {
        resolutionStatus: "PENDING",
        suppressedAt: null,
        createdAt: { gte: sevenDaysAgo },
        direction: "BEARISH",
      },
    }),
    prisma.expertOpinion.count({
      where: {
        resolutionStatus: "PENDING",
        suppressedAt: null,
        createdAt: { gte: sevenDaysAgo },
        direction: "NEUTRAL",
      },
    }),
  ]);

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

  return NextResponse.json({
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
}
