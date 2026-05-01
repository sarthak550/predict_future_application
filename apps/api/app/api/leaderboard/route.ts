import { MarketCategory } from "@prisma/client";
import { NextResponse } from "next/server";

import { getUserIdFromRequest } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

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
            username: true,
            reputationScore: true,
          },
        },
      },
      orderBy: [{ accuracyScore: "desc" }, { totalNetPoints: "desc" }],
      take: 50,
    });

    // Flatten UserCategoryStat shape into ApiLeaderboardEntry shape (id, username,
    // reputationScore, accuracyScore at the top level — matches the All-tab shape
    // so the mobile renderer can use one row component).
    const entries = rawCategoryEntries.map((row) => ({
      id: row.userId,
      username: row.user.username,
      reputationScore: row.user.reputationScore,
      accuracyScore: row.accuracyScore,
      totalNetPoints: row.totalNetPoints,
    }));

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
                include: { user: { select: { username: true } } },
                orderBy: [{ accuracyScore: "asc" }, { totalNetPoints: "asc" }],
              })
            : null;

        userContext = {
          rank: userRank,
          score: userCatStat.accuracyScore,
          targetUsername: targetEntry?.user.username ?? null,
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

  const entries = await prisma.user.findMany({
    where: userIdsInWindow != null ? { id: { in: userIdsInWindow } } : undefined,
    // SECURITY: explicit select — never include the full User row, which would
    // leak email, passwordHash, expoPushToken, etc.
    select: {
      id: true,
      username: true,
      reputationScore: true,
      accuracyScore: true,
      stats: {
        select: {
          totalPredictions: true,
          totalNetPoints: true,
        },
      },
    },
    orderBy: [{ reputationScore: "desc" }, { accuracyScore: "desc" }],
    take: 50,
  });

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
              select: { username: true, reputationScore: true },
              orderBy: [{ reputationScore: "asc" }, { accuracyScore: "asc" }],
            })
          : null;

      userContext = {
        rank: userRank,
        score: currentUser.reputationScore,
        targetUsername: targetEntry?.username ?? null,
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
