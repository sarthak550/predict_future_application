import { MarketCategory } from "@prisma/client";
import { NextResponse } from "next/server";

import { prisma } from "@/lib/prisma";
import { getDisplayName } from "@/lib/users/displayName";

function hasCronAccess(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return false;
  }
  const authHeader = request.headers.get("authorization");
  const cronHeader = request.headers.get("x-cron-secret");
  return authHeader === `Bearer ${secret}` || cronHeader === secret;
}

type TimeWindow = "week" | "month" | "all";

function getCutoff(timeWindow: TimeWindow): Date | null {
  if (timeWindow === "all") return null;
  const now = new Date();
  if (timeWindow === "week") {
    return new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  }
  return new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
}

/**
 * Compute ranked list for a given timeWindow + category and return
 * an array of { userId, rank } tuples.
 */
async function computeRankedList(
  timeWindow: TimeWindow,
  category: MarketCategory | null
): Promise<Array<{ userId: string; rank: number }>> {
  const cutoff = getCutoff(timeWindow);

  if (category !== null) {
    // Category-scoped leaderboard
    let userIdsInWindow: string[] | undefined;
    if (cutoff !== null) {
      const activeStats = await prisma.userStat.findMany({
        where: { lastPredictionAt: { gte: cutoff } },
        select: { userId: true },
      });
      userIdsInWindow = activeStats.map((s) => s.userId);
    }

    const rows = await prisma.userCategoryStat.findMany({
      where: {
        category,
        ...(userIdsInWindow !== undefined ? { userId: { in: userIdsInWindow } } : {}),
      },
      select: { userId: true, accuracyScore: true, totalNetPoints: true },
      orderBy: [{ accuracyScore: "desc" }, { totalNetPoints: "desc" }],
      take: 500,
    });

    return rows.map((row, idx) => ({ userId: row.userId, rank: idx + 1 }));
  }

  // All-categories leaderboard
  let userIdsInWindow: string[] | undefined;
  if (cutoff !== null) {
    const activeStats = await prisma.userStat.findMany({
      where: { lastPredictionAt: { gte: cutoff } },
      select: { userId: true },
    });
    userIdsInWindow = activeStats.map((s) => s.userId);
  }

  const rows = await prisma.user.findMany({
    where: userIdsInWindow !== undefined ? { id: { in: userIdsInWindow } } : undefined,
    select: { id: true, reputationScore: true, accuracyScore: true },
    orderBy: [{ reputationScore: "desc" }, { accuracyScore: "desc" }],
    take: 500,
  });

  return rows.map((row, idx) => ({ userId: row.id, rank: idx + 1 }));
}

export async function POST(request: Request) {
  if (!hasCronAccess(request)) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const timeWindows: TimeWindow[] = ["week", "month", "all"];
  const categories: Array<MarketCategory | null> = [
    null,
    ...Object.values(MarketCategory),
  ];

  let snapshotsWritten = 0;
  const snapshotAt = new Date();

  for (const timeWindow of timeWindows) {
    for (const category of categories) {
      try {
        const ranked = await computeRankedList(timeWindow, category);

        if (ranked.length === 0) continue;

        // Batch-create snapshots for all users in this combination.
        // skipDuplicates prevents errors on retries without needing a unique index.
        await prisma.leaderboardSnapshot.createMany({
          data: ranked.map(({ userId, rank }) => ({
            userId,
            rank,
            timeWindow,
            category: category ?? null,
            snapshotAt,
          })),
          skipDuplicates: true,
        });

        snapshotsWritten += ranked.length;
      } catch (err) {
        console.error(
          `[leaderboard-snapshot] Failed for timeWindow=${timeWindow} category=${category}:`,
          err
        );
      }
    }
  }

  return NextResponse.json({ snapshotsWritten });
}

export async function GET(request: Request) {
  return POST(request);
}
