/**
 * POST /api/users/me/daily-bonus
 *
 * Daily login bonus: +100 points once per IST calendar day, awarded through
 * the existing Daily Quests engine (DAILY_LOGIN quest, triggered by the
 * "APP_OPEN" action). This is the missing points faucet — users who bust
 * their 10,000-point starting balance previously had no way back in.
 *
 * No new schema. Reuses DailyQuest (questType is a plain String, not a
 * Prisma enum) + WalletTransaction (type QUEST_REWARD), exactly like every
 * other quest reward. The wallet transaction description reads "Quest
 * completed: Open the app today" — intentional, not DAILY_BONUS type.
 *
 * Auth: required (Bearer token).
 * Idempotent: safe to call on every app open. Only the first call of the IST
 * day actually credits; the DailyQuest.completed atomic race guard inside
 * checkAndCompleteQuests ensures concurrent calls credit at most once.
 *
 * Suspension: not enforced at the auth layer (a valid token still resolves a
 * suspended user's id), so it is guarded explicitly here — suspended users
 * get a no-op response and no quest progress is touched.
 *
 * Response: { credited: boolean; amount: number; newBalance: number; alreadyClaimedToday: boolean }
 */

import { NextResponse } from "next/server";

import { getUserIdFromRequest } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { checkAndCompleteQuests } from "@/lib/quests/engine";

export async function POST(request: Request) {
  try {
    const userId = await getUserIdFromRequest(request);
    if (!userId) {
      return NextResponse.json({ error: "Authentication required." }, { status: 401 });
    }

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { isSuspended: true },
    });
    if (!user) {
      return NextResponse.json({ error: "User not found." }, { status: 404 });
    }

    if (user.isSuspended) {
      const wallet = await prisma.wallet.findUnique({
        where: { userId },
        select: { balance: true },
      });
      return NextResponse.json({
        credited: false,
        alreadyClaimedToday: false,
        amount: 0,
        newBalance: wallet?.balance ?? 0,
      });
    }

    const completedRewards = await prisma.$transaction((tx) =>
      checkAndCompleteQuests(userId, "APP_OPEN", tx)
    );

    const dailyLoginReward = completedRewards.find((r) => r.questType === "DAILY_LOGIN");
    const credited = Boolean(dailyLoginReward);

    const wallet = await prisma.wallet.findUnique({
      where: { userId },
      select: { balance: true },
    });

    return NextResponse.json({
      credited,
      amount: dailyLoginReward?.reward ?? 0,
      newBalance: wallet?.balance ?? 0,
      alreadyClaimedToday: !credited,
    });
  } catch (error) {
    console.error("[daily-bonus POST]", error);
    return NextResponse.json(
      { error: "Unable to process daily bonus." },
      { status: 500 }
    );
  }
}
