import { NextResponse } from "next/server";

import { getUserIdFromRequest } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { QUEST_DEF_MAP, QUEST_DEFINITIONS, type QuestType } from "@/lib/quests/definitions";
import { getIstDateString, getOrCreateTodayQuests } from "@/lib/quests/engine";

/**
 * GET /api/quests/today
 *
 * Returns the authenticated user's daily quests for today (IST date).
 * Progress is computed live from DB counts so it is always accurate even if
 * checkAndCompleteQuests hasn't been called yet for some actions.
 *
 * Response shape:
 * {
 *   date: string;           // 'YYYY-MM-DD' IST
 *   quests: Array<{
 *     questType: string;
 *     description: string;
 *     reward: number;
 *     completed: boolean;
 *     completedAt: string | null;  // ISO datetime
 *     progress: number;   // current count of qualifying actions today
 *     goal: number;       // target count to complete quest
 *   }>;
 *   totalEarnedToday: number;  // sum of rewardAmount for completed quests today
 * }
 */
export async function GET(request: Request) {
  try {
    const userId = await getUserIdFromRequest(request);
    if (!userId) {
      return NextResponse.json({ error: "Authentication required." }, { status: 401 });
    }

    const date = getIstDateString();

    // Ensure quest rows exist and retrieve them
    const questRows = await prisma.$transaction(async (tx) => {
      return getOrCreateTodayQuests(userId, tx);
    });

    // IST-day boundaries for counting actions
    const [yyyy, mm, dd] = date.split("-").map(Number);
    const istOffsetMs = 5.5 * 60 * 60 * 1000;
    const startOfDayUtc = new Date(Date.UTC(yyyy, mm - 1, dd) - istOffsetMs);
    const endOfDayUtc = new Date(startOfDayUtc.getTime() + 24 * 60 * 60 * 1000);

    // Count today's qualifying actions in parallel
    const [predictionCount, pollVoteCount, marketCount] = await Promise.all([
      prisma.marketPosition.count({
        where: {
          userId,
          createdAt: { gte: startOfDayUtc, lt: endOfDayUtc },
        },
      }),
      prisma.vote.count({
        where: {
          userId,
          createdAt: { gte: startOfDayUtc, lt: endOfDayUtc },
        },
      }),
      prisma.market.count({
        where: {
          creatorId: userId,
          createdAt: { gte: startOfDayUtc, lt: endOfDayUtc },
        },
      }),
    ]);

    // Build progress map per quest type
    const progressMap: Record<QuestType, number> = {
      PREDICT_3: predictionCount,
      PREDICT_5: predictionCount,
      VOTE_ON_POLL: pollVoteCount,
      CREATE_MARKET: marketCount,
    };

    // Build quest map by questType for lookup
    const questRowMap = new Map(questRows.map((r) => [r.questType, r]));

    const quests = QUEST_DEFINITIONS.map((def) => {
      const row = questRowMap.get(def.questType);
      const progress = Math.min(progressMap[def.questType] ?? 0, def.goal);
      return {
        questType: def.questType,
        description: def.description,
        reward: def.rewardAmount,
        completed: row?.completed ?? false,
        completedAt: row?.completedAt?.toISOString() ?? null,
        progress,
        goal: def.goal,
      };
    });

    const totalEarnedToday = questRows
      .filter((r) => r.completed)
      .reduce((sum, r) => sum + r.rewardAmount, 0);

    // Fetch current streak from UserStat; default to 0 if no row exists yet.
    const userStat = await prisma.userStat.findUnique({
      where: { userId },
      select: { streak: true },
    });
    const streak = userStat?.streak ?? 0;

    return NextResponse.json({ date, quests, totalEarnedToday, streak });
  } catch (error) {
    console.error("[quests/today] error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to load quests." },
      { status: 500 }
    );
  }
}
