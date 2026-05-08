/**
 * Quest engine — core logic for evaluating and completing daily quests.
 *
 * Design notes:
 * - All writes happen inside the caller's open transaction (tx param) so they
 *   are atomic with the triggering action.
 * - Progress is computed by counting real DB rows (MarketPosition, Vote, Market)
 *   rather than a separate counter to stay consistent with the source of truth.
 * - Wallet credits are created here (QUEST_REWARD) and a QUEST_COMPLETED
 *   notification is sent for each quest that completes.
 * - IST date is used for quest boundaries as this is an India-first product
 *   (IST = UTC+5:30). The date string 'YYYY-MM-DD' is stored as-is.
 */

import type { Prisma } from "@prisma/client";

import { updateLeagueMonthPoints } from "@/lib/leagues/processing";
import { QUEST_DEF_MAP, QUEST_DEFINITIONS, type QuestType } from "./definitions";

/** Prisma interactive transaction client type. */
export type TxClient = Omit<
  Prisma.TransactionClient,
  "$connect" | "$disconnect" | "$on" | "$transaction" | "$use" | "$extends"
>;

export type QuestAction = "PREDICTION" | "POLL_VOTE" | "MARKET_CREATE";

/** A completed quest reward returned to callers for optional UI feedback. */
export type CompletedQuestReward = {
  questType: string;
  reward: number;
};

/**
 * Returns the current IST date as a 'YYYY-MM-DD' string.
 * IST is UTC+5:30, so we add 5h30m to the current UTC time.
 */
export function getIstDateString(now?: Date): string {
  const d = now ?? new Date();
  // Add IST offset: 5 hours 30 minutes = 19800 seconds
  const istMs = d.getTime() + 5.5 * 60 * 60 * 1000;
  const istDate = new Date(istMs);
  const yyyy = istDate.getUTCFullYear();
  const mm = String(istDate.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(istDate.getUTCDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

/**
 * Ensures the user has a DailyQuest row for today and every quest type.
 * Idempotent — safe to call multiple times (@@unique constraint guards duplicates).
 * Uses upsert in a loop; for 4 quest types this is acceptable.
 */
export async function getOrCreateTodayQuests(
  userId: string,
  tx: TxClient
): Promise<Array<{ questType: string; rewardAmount: number; completed: boolean; completedAt: Date | null; createdAt: Date }>> {
  const date = getIstDateString();

  await Promise.all(
    QUEST_DEFINITIONS.map((def) =>
      tx.dailyQuest.upsert({
        where: { userId_date_questType: { userId, date, questType: def.questType } },
        create: {
          userId,
          date,
          questType: def.questType,
          rewardAmount: def.rewardAmount,
          completed: false,
        },
        update: {}, // No-op update — row already exists
      })
    )
  );

  return tx.dailyQuest.findMany({
    where: { userId, date },
    orderBy: { createdAt: "asc" },
  });
}

/**
 * Checks if any quests should be completed based on the triggering action,
 * and completes + credits them if so.
 *
 * Must be called inside an existing Prisma transaction (tx).
 *
 * For PREDICTION:
 *   - Counts today's MarketPosition rows for the user
 *   - Completes PREDICT_3 if count >= 3 and not yet done
 *   - Completes PREDICT_5 if count >= 5 and not yet done
 *
 * For POLL_VOTE:
 *   - Completes VOTE_ON_POLL if not yet done today
 *
 * For MARKET_CREATE:
 *   - Completes CREATE_MARKET if not yet done today
 *
 * Returns an array of completed quest rewards so callers can surface them in
 * API responses for UI feedback (e.g. "Quest complete! +50 pts").
 */
export async function checkAndCompleteQuests(
  userId: string,
  action: QuestAction,
  tx: TxClient
): Promise<CompletedQuestReward[]> {
  const completedRewards: CompletedQuestReward[] = [];
  const date = getIstDateString();

  // Ensure quest rows exist for today
  await getOrCreateTodayQuests(userId, tx);

  // Determine which quest types are relevant for this action
  const relevantQuestTypes = getRelevantQuestTypes(action);
  if (relevantQuestTypes.length === 0) return completedRewards;

  // Load existing (incomplete) quest rows for relevant types
  const existingQuests = await tx.dailyQuest.findMany({
    where: {
      userId,
      date,
      questType: { in: relevantQuestTypes },
      completed: false,
    },
  });

  if (existingQuests.length === 0) return completedRewards; // All already completed

  // Compute current progress count for PREDICTION actions
  let predictionCountToday = 0;
  if (action === "PREDICTION") {
    // IST-day boundaries for counting positions
    const { startOfDayUtc, endOfDayUtc } = getIstDayBoundsUtc();
    predictionCountToday = await tx.marketPosition.count({
      where: {
        userId,
        createdAt: {
          gte: startOfDayUtc,
          lt: endOfDayUtc,
        },
      },
    });
  }

  // Find the user's wallet once
  const wallet = await tx.wallet.findUnique({ where: { userId } });
  if (!wallet) return completedRewards; // No wallet — skip quest rewards silently

  // Evaluate each incomplete quest
  for (const quest of existingQuests) {
    const def = QUEST_DEF_MAP[quest.questType as QuestType];
    if (!def) continue;

    let shouldComplete = false;

    if (action === "PREDICTION") {
      if (quest.questType === "PREDICT_3" && predictionCountToday >= def.goal) {
        shouldComplete = true;
      } else if (quest.questType === "PREDICT_5" && predictionCountToday >= def.goal) {
        shouldComplete = true;
      }
    } else if (action === "POLL_VOTE" && quest.questType === "VOTE_ON_POLL") {
      shouldComplete = true;
    } else if (action === "MARKET_CREATE" && quest.questType === "CREATE_MARKET") {
      shouldComplete = true;
    }

    if (!shouldComplete) continue;

    const now = new Date();

    // Mark quest complete
    await tx.dailyQuest.update({
      where: { id: quest.id },
      data: {
        completed: true,
        completedAt: now,
      },
    });

    // Credit wallet
    await tx.wallet.update({
      where: { id: wallet.id },
      data: { balance: { increment: def.rewardAmount } },
    });

    await tx.walletTransaction.create({
      data: {
        walletId: wallet.id,
        type: "QUEST_REWARD",
        amount: def.rewardAmount,
        description: `Quest completed: ${def.description}`,
      },
    });

    // League points accumulation — wrapped in try/catch so a league failure
    // never rolls back the quest completion (systemic rule: in-tx side effects
    // must be isolated, per S24-T4/T5 post-mortems).
    try {
      await updateLeagueMonthPoints(userId, def.rewardAmount, tx);
    } catch (leagueErr) {
      console.error("[leagues] updateLeagueMonthPoints failed (quest reward):", leagueErr);
    }

    // In-app notification
    await tx.notification.create({
      data: {
        userId,
        type: "QUEST_COMPLETED",
        title: "Quest complete!",
        body: `${def.description} — you earned ${def.rewardAmount} pts`,
        href: "/quests",
      },
    });

    completedRewards.push({ questType: quest.questType, reward: def.rewardAmount });
  }

  return completedRewards;
}

// ---------------------------------------------------------------------------
// Streak milestone rewards
// ---------------------------------------------------------------------------

/**
 * Milestone payout configuration.
 * Key = streak day count, value = bonus points.
 */
const STREAK_MILESTONES: Record<number, number> = {
  7: 500,
  14: 1000,
  30: 2500,
  60: 5000,
};

/**
 * Awards a DAILY_BONUS wallet credit when the user's streak hits a milestone.
 * Idempotent — checks for an existing WalletTransaction with the milestone
 * description before crediting to prevent duplicate payouts.
 *
 * Must be called inside an existing Prisma transaction (tx), after the streak
 * field on User/UserStat has been incremented.
 */
export async function checkStreakMilestone(
  userId: string,
  newStreak: number,
  tx: TxClient
): Promise<void> {
  const bonusAmount = STREAK_MILESTONES[newStreak];
  if (!bonusAmount) return; // Not a milestone day

  const milestoneDescription = `${newStreak}-day streak milestone bonus`;

  // Idempotency guard — look for a prior transaction with the same description
  const wallet = await tx.wallet.findUnique({
    where: { userId },
    include: {
      transactions: {
        where: {
          type: "DAILY_BONUS",
          description: milestoneDescription,
        },
        take: 1,
      },
    },
  });

  if (!wallet) return; // No wallet — skip silently
  if (wallet.transactions.length > 0) return; // Already paid this milestone

  // Credit the wallet
  await tx.wallet.update({
    where: { id: wallet.id },
    data: { balance: { increment: bonusAmount } },
  });

  await tx.walletTransaction.create({
    data: {
      walletId: wallet.id,
      type: "DAILY_BONUS",
      amount: bonusAmount,
      description: milestoneDescription,
    },
  });

  // League points accumulation — wrapped in try/catch so a league failure
  // never rolls back the streak milestone credit.
  try {
    await updateLeagueMonthPoints(userId, bonusAmount, tx);
  } catch (leagueErr) {
    console.error("[leagues] updateLeagueMonthPoints failed (streak milestone):", leagueErr);
  }

  // In-app notification
  await tx.notification.create({
    data: {
      userId,
      type: "STREAK_MILESTONE",
      title: `${newStreak}-day streak!`,
      body: `You've maintained a ${newStreak}-day streak. Bonus: +${bonusAmount} pts`,
      href: "/quests",
    },
  });
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getRelevantQuestTypes(action: QuestAction): QuestType[] {
  switch (action) {
    case "PREDICTION":
      return ["PREDICT_3", "PREDICT_5"];
    case "POLL_VOTE":
      return ["VOTE_ON_POLL"];
    case "MARKET_CREATE":
      return ["CREATE_MARKET"];
  }
}

/**
 * Returns UTC Date boundaries corresponding to the start and end of the
 * current IST calendar day.
 */
function getIstDayBoundsUtc(now?: Date): { startOfDayUtc: Date; endOfDayUtc: Date } {
  const istDateStr = getIstDateString(now);
  const [yyyy, mm, dd] = istDateStr.split("-").map(Number);
  // IST midnight = UTC midnight minus 5h30m
  const istOffsetMs = 5.5 * 60 * 60 * 1000;
  const startOfDayUtc = new Date(Date.UTC(yyyy, mm - 1, dd) - istOffsetMs);
  const endOfDayUtc = new Date(startOfDayUtc.getTime() + 24 * 60 * 60 * 1000);
  return { startOfDayUtc, endOfDayUtc };
}
