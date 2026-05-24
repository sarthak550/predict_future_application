import { MarketCategory } from "@prisma/client";
import { NextResponse } from "next/server";

import { getUserIdFromRequest } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getDisplayName } from "@/lib/users/displayName";

/**
 * Look up the most recent LeaderboardSnapshot for each userId in the given
 * timeWindow + category and return a map of userId → previousRank.
 */
async function getPreviousRankMap(
  userIds: string[],
  timeWindow: string,
  category: MarketCategory | null
): Promise<Map<string, number>> {
  if (userIds.length === 0) return new Map();

  // For each user, get their most recent snapshot for this combination.
  // We use a raw query for efficient "latest per group" retrieval.
  const snapshots = await prisma.leaderboardSnapshot.findMany({
    where: {
      userId: { in: userIds },
      timeWindow,
      category: category ?? null,
    },
    orderBy: { snapshotAt: "desc" },
    // Fetch up to 10 snapshots per user (we only need the latest but Prisma
    // doesn't support DISTINCT ON; we'll deduplicate in JS).
    take: userIds.length * 10,
  });

  const rankMap = new Map<string, number>();
  for (const snap of snapshots) {
    if (!rankMap.has(snap.userId)) {
      rankMap.set(snap.userId, snap.rank);
    }
  }
  return rankMap;
}

type TimeWindow = "week" | "month" | "all";

function getCutoff(timeWindow: TimeWindow): Date | null {
  if (timeWindow === "all") return null;
  const now = new Date();
  if (timeWindow === "week") {
    return new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  }
  // month
  return new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const category = searchParams.get("category");
  const timeWindowParam = searchParams.get("timeWindow") ?? "all";
  const timeWindow: TimeWindow =
    timeWindowParam === "week" || timeWindowParam === "month" ? timeWindowParam : "all";
  const topMode = searchParams.get("top") === "true";
  const limitParam = parseInt(searchParams.get("limit") ?? "10", 10);
  const limit = Number.isFinite(limitParam) && limitParam > 0 ? Math.min(limitParam, 50) : 10;

  // ── Top-N category leaderboard (calibration scorecard surface) ─────────────
  // GET /api/leaderboard?top=true&category=FINANCE&limit=10
  // Auth: optional. Cache-Control: public 5 min.
  if (topMode && category && Object.values(MarketCategory).includes(category as MarketCategory)) {
    const rows = await prisma.userCategoryStat.findMany({
      where: {
        category: category as MarketCategory,
        totalPredictions: { gte: 1 },
      },
      include: {
        user: {
          select: {
            id: true,
            username: true,
            displayMode: true,
            isVerifiedAnalyst: true,
            _count: { select: { followers: true } },
          },
        },
      },
      orderBy: [{ accuracyScore: "desc" }, { totalPredictions: "desc" }],
      take: limit,
    });

    const entries = rows.map((row, idx) => ({
      rank: idx + 1,
      id: row.userId,
      username: getDisplayName(row.user),
      isVerifiedAnalyst: row.user.isVerifiedAnalyst,
      accuracyScore: row.accuracyScore,
      totalPredictions: row.totalPredictions,
      followerCount: row.user._count.followers,
    }));

    return NextResponse.json(
      { category, entries },
      {
        headers: {
          "Cache-Control": "public, max-age=300",
        },
      }
    );
  }

  const cutoff = getCutoff(timeWindow);

  // Optionally read the current user to compute their rank
  const userId = await getUserIdFromRequest(request).catch(() => null);

  if (category && Object.values(MarketCategory).includes(category as MarketCategory)) {
    // Category-scoped leaderboard: sort by accuracy DESC in that category.
    // When a time window is active, restrict to users who had prediction activity
    // within the window (use lastPredictionAt from UserStat as a proxy — windowed
    // accuracy recomputation is deferred to a future sprint).
    let userIdsInWindow: string[] | null = null;
    if (cutoff != null) {
      const activeStats = await prisma.userStat.findMany({
        where: { lastPredictionAt: { gte: cutoff } },
        select: { userId: true },
      });
      userIdsInWindow = activeStats.map((s) => s.userId);
    }

    const rawCategoryEntries = await prisma.userCategoryStat.findMany({
      where: {
        category: category as MarketCategory,
        ...(userIdsInWindow != null ? { userId: { in: userIdsInWindow } } : {}),
      },
      include: {
        user: {
          select: {
            id: true,
            username: true,
            displayMode: true,
            reputationScore: true,
            isVerifiedAnalyst: true,
            _count: { select: { followers: true } },
          },
        },
      },
      orderBy: [{ accuracyScore: "desc" }, { totalNetPoints: "desc" }],
      take: 50,
    });

    // Flatten UserCategoryStat shape into ApiLeaderboardEntry shape (id, username,
    // reputationScore, accuracyScore at the top level — matches the All-tab shape
    // so the mobile renderer can use one row component).
    const categoryUserIds = rawCategoryEntries.map((r) => r.userId);
    const categoryPrevRanks = await getPreviousRankMap(
      categoryUserIds,
      timeWindow,
      category as MarketCategory
    );

    const entries = rawCategoryEntries.map((row, idx) => {
      const currentRank = idx + 1;
      const prevRank = categoryPrevRanks.get(row.userId);
      const rankDelta = prevRank !== undefined ? prevRank - currentRank : null;
      return {
        id: row.userId,
        username: getDisplayName(row.user),
        reputationScore: row.user.reputationScore,
        isVerifiedAnalyst: row.user.isVerifiedAnalyst,
        accuracyScore: row.accuracyScore,
        totalNetPoints: row.totalNetPoints,
        followerCount: row.user._count.followers,
        rankDelta,
      };
    });

    // Compute user's rank within this category if authenticated
    let userRank: number | null = null;
    let userContext = null;

    if (userId) {
      const userCatStat = await prisma.userCategoryStat.findUnique({
        where: { userId_category: { userId, category: category as MarketCategory } },
      });

      if (userCatStat) {
        const rankWhere = {
          category: category as MarketCategory,
          ...(userIdsInWindow != null ? { userId: { in: userIdsInWindow } } : {}),
        };
        const higherCount = await prisma.userCategoryStat.count({
          where: {
            ...rankWhere,
            OR: [
              { accuracyScore: { gt: userCatStat.accuracyScore } },
              {
                accuracyScore: userCatStat.accuracyScore,
                totalNetPoints: { gt: userCatStat.totalNetPoints },
              },
            ],
          },
        });
        userRank = higherCount + 1;

        // Find the entry ranked immediately above the user
        const targetEntry =
          userRank > 1
            ? await prisma.userCategoryStat.findFirst({
                where: {
                  ...rankWhere,
                  OR: [
                    { accuracyScore: { gt: userCatStat.accuracyScore } },
                    {
                      accuracyScore: userCatStat.accuracyScore,
                      totalNetPoints: { gt: userCatStat.totalNetPoints },
                    },
                  ],
                },
                include: { user: { select: { id: true, username: true, displayMode: true } } },
                orderBy: [{ accuracyScore: "asc" }, { totalNetPoints: "asc" }],
              })
            : null;

        userContext = {
          rank: userRank,
          score: userCatStat.accuracyScore,
          targetUsername: targetEntry ? getDisplayName(targetEntry.user) : null,
          targetRank: userRank > 1 ? userRank - 1 : null,
          targetScore: targetEntry?.accuracyScore ?? null,
          gap:
            targetEntry != null
              ? Math.round((targetEntry.accuracyScore - userCatStat.accuracyScore) * 100) / 100
              : null,
          gapUnit: "accuracy" as const,
        };
      }
    }

    return NextResponse.json({ entries, userRank, userContext });
  }

  // All-categories leaderboard: sort by reputationScore DESC, accuracyScore DESC.
  // When a time window is active, restrict to users with recent prediction activity.
  let userIdsInWindow: string[] | null = null;
  if (cutoff != null) {
    const activeStats = await prisma.userStat.findMany({
      where: { lastPredictionAt: { gte: cutoff } },
      select: { userId: true },
    });
    userIdsInWindow = activeStats.map((s) => s.userId);
  }

  const rawEntries = await prisma.user.findMany({
    where: userIdsInWindow != null ? { id: { in: userIdsInWindow } } : undefined,
    // SECURITY: explicit select — never include the full User row, which would
    // leak email, passwordHash, expoPushToken, etc.
    select: {
      id: true,
      username: true,
      displayMode: true,
      reputationScore: true,
      accuracyScore: true,
      isVerifiedAnalyst: true,
      analystTier: true,
      stats: {
        select: {
          totalPredictions: true,
          totalNetPoints: true,
        },
      },
      _count: { select: { followers: true } },
    },
    orderBy: [{ reputationScore: "desc" }, { accuracyScore: "desc" }],
    take: 50,
  });

  // Flatten _count into followerCount; apply displayMode pseudonym; fall back to 0 on count error.
  // Look up previous ranks for rank delta computation.
  const allUserIds = rawEntries.map((u) => u.id);
  const prevRankMap = await getPreviousRankMap(allUserIds, timeWindow, null);

  type LeaderboardEntry = {
    id: string;
    username: string;
    reputationScore: number;
    accuracyScore: number;
    isVerifiedAnalyst: boolean;
    followerCount: number;
    rankDelta: number | null;
    stats: { totalPredictions: number; totalNetPoints: number } | null;
  };
  let entries: LeaderboardEntry[];
  try {
    entries = rawEntries.map((u, idx) => {
      const currentRank = idx + 1;
      const prevRank = prevRankMap.get(u.id);
      const rankDelta = prevRank !== undefined ? prevRank - currentRank : null;
      return {
        id: u.id,
        username: getDisplayName(u),
        reputationScore: u.reputationScore,
        accuracyScore: u.accuracyScore,
        isVerifiedAnalyst: u.isVerifiedAnalyst,
        analystTier: u.analystTier,
        followerCount: u._count.followers,
        stats: u.stats,
        rankDelta,
      };
    });
  } catch (countErr) {
    console.error("[leaderboard] follower count mapping failed, falling back to 0", countErr);
    entries = rawEntries.map((u, idx) => {
      const currentRank = idx + 1;
      const prevRank = prevRankMap.get(u.id);
      const rankDelta = prevRank !== undefined ? prevRank - currentRank : null;
      return {
        id: u.id,
        username: getDisplayName(u),
        reputationScore: u.reputationScore,
        accuracyScore: u.accuracyScore,
        isVerifiedAnalyst: u.isVerifiedAnalyst,
        analystTier: u.analystTier,
        followerCount: 0,
        stats: u.stats,
        rankDelta,
      };
    });
  }

  // Compute user's overall rank if authenticated
  let userRank: number | null = null;
  let userContext = null;

  if (userId) {
    const currentUser = await prisma.user.findUnique({
      where: { id: userId },
      select: { reputationScore: true, accuracyScore: true },
    });

    if (currentUser) {
      const rankWhere = userIdsInWindow != null ? { id: { in: userIdsInWindow } } : {};
      const higherCount = await prisma.user.count({
        where: {
          ...rankWhere,
          OR: [
            { reputationScore: { gt: currentUser.reputationScore } },
            {
              reputationScore: currentUser.reputationScore,
              accuracyScore: { gt: currentUser.accuracyScore },
            },
          ],
        },
      });
      userRank = higherCount + 1;

      // Find the entry ranked immediately above the user
      const targetEntry =
        userRank > 1
          ? await prisma.user.findFirst({
              where: {
                ...rankWhere,
                OR: [
                  { reputationScore: { gt: currentUser.reputationScore } },
                  {
                    reputationScore: currentUser.reputationScore,
                    accuracyScore: { gt: currentUser.accuracyScore },
                  },
                ],
              },
              select: { id: true, username: true, displayMode: true, reputationScore: true },
              orderBy: [{ reputationScore: "asc" }, { accuracyScore: "asc" }],
            })
          : null;

      userContext = {
        rank: userRank,
        score: currentUser.reputationScore,
        targetUsername: targetEntry ? getDisplayName(targetEntry) : null,
        targetRank: userRank > 1 ? userRank - 1 : null,
        targetScore: targetEntry?.reputationScore ?? null,
        gap:
          targetEntry != null
            ? targetEntry.reputationScore - currentUser.reputationScore
            : null,
        gapUnit: "rep" as const,
      };
    }
  }

  return NextResponse.json({ entries, userRank, userContext });
}
