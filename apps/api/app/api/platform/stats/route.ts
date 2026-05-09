import { NextResponse } from "next/server";

import { prisma } from "@/lib/prisma";

// ── In-memory cache ────────────────────────────────────────────────────────────
// Keyed by 'platform-stats'. TTL: 10 minutes (matches Cache-Control: max-age=600).

type PlatformStatsPayload = {
  totalResolvedMarkets: number;
  totalActiveAnalysts: number;
  avgAccuracyScore: number;
  totalPredictions: number;
  topCategoryByAccuracy: { category: string; avgAccuracy: number } | null;
  lastUpdatedAt: string;
};

type CacheEntry = {
  payload: PlatformStatsPayload;
  expiresAt: number;
};

const CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutes
const statsCache = new Map<string, CacheEntry>();

// ── Route handler ──────────────────────────────────────────────────────────────

export async function GET() {
  const CACHE_KEY = "platform-stats";

  // Return cached value when still fresh
  const cached = statsCache.get(CACHE_KEY);
  if (cached != null && Date.now() < cached.expiresAt) {
    return NextResponse.json(cached.payload, {
      headers: {
        "Cache-Control": "public, max-age=600",
      },
    });
  }

  try {
    // Run all aggregation queries in parallel — no N+1, no transactions needed
    // (all read-only).
    const [
      totalResolvedMarkets,
      activeAnalystAgg,
      totalActiveAnalysts,
      topCategoryRows,
    ] = await Promise.all([
      // 1. Count markets that have been fully finalized (the strongest "resolved" signal)
      prisma.market.count({
        where: { resolutionStatus: "FINALIZED" },
      }),

      // 2. Aggregate accuracy + prediction totals from UserStat for users who
      //    have made at least 5 predictions (avoids noise from single lucky calls)
      prisma.userStat.aggregate({
        where: { totalPredictions: { gte: 5 } },
        _avg: { accuracyScore: true },
        _sum: { totalPredictions: true },
      }),

      // 3. Count of "active analysts" (users with >= 5 predictions)
      prisma.userStat.count({
        where: { totalPredictions: { gte: 5 } },
      }),

      // 4. Top category by average accuracy — pull all categories (small bounded set)
      //    filtered to rows with >= 10 predictions, then pick the best in application
      //    code.  groupBy is supported by Prisma and avoids a raw query.
      prisma.userCategoryStat.groupBy({
        by: ["category"],
        where: { totalPredictions: { gte: 10 } },
        _avg: { accuracyScore: true },
        orderBy: { _avg: { accuracyScore: "desc" } },
        take: 1,
      }),
    ]);

    // Derive values from aggregation results
    const rawAvg = activeAnalystAgg._avg.accuracyScore ?? 0;
    const avgAccuracyScore = Math.round(rawAvg * 10000) / 10000; // 4 decimal places

    const totalPredictions = activeAnalystAgg._sum.totalPredictions ?? 0;

    const topCategoryByAccuracy =
      topCategoryRows.length > 0 && topCategoryRows[0]._avg.accuracyScore != null
        ? {
            category: topCategoryRows[0].category as string,
            avgAccuracy:
              Math.round((topCategoryRows[0]._avg.accuracyScore ?? 0) * 10000) / 10000,
          }
        : null;

    const payload: PlatformStatsPayload = {
      totalResolvedMarkets,
      totalActiveAnalysts,
      avgAccuracyScore,
      totalPredictions,
      topCategoryByAccuracy,
      lastUpdatedAt: new Date().toISOString(),
    };

    // Populate cache
    statsCache.set(CACHE_KEY, {
      payload,
      expiresAt: Date.now() + CACHE_TTL_MS,
    });

    return NextResponse.json(payload, {
      headers: {
        "Cache-Control": "public, max-age=600",
      },
    });
  } catch (error) {
    console.error("[platform/stats] Failed to compute platform stats:", error);
    return NextResponse.json(
      { error: "Failed to compute platform stats" },
      { status: 500 }
    );
  }
}
