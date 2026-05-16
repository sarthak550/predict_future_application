import { AnalystTier } from "@prisma/client";

import { prisma } from "./prisma";

/**
 * Tier thresholds for the Analyst Tier system.
 *
 * ROOKIE        default (everyone starts here)
 * ANALYST       totalPredictions >= 10  AND avgAccuracyScore >= 0.55
 * SENIOR_ANALYST totalPredictions >= 50  AND avgAccuracyScore >= 0.60
 * CHIEF_ANALYST  totalPredictions >= 200 AND avgAccuracyScore >= 0.65 AND isVerifiedAnalyst = true
 */

interface TierInput {
  totalPredictions: number;
  accuracyScore: number;
  isVerifiedAnalyst: boolean;
}

export function computeTierFromStats(input: TierInput): AnalystTier {
  const { totalPredictions, accuracyScore, isVerifiedAnalyst } = input;

  if (
    isVerifiedAnalyst &&
    totalPredictions >= 200 &&
    accuracyScore >= 0.65
  ) {
    return AnalystTier.CHIEF_ANALYST;
  }

  if (totalPredictions >= 50 && accuracyScore >= 0.60) {
    return AnalystTier.SENIOR_ANALYST;
  }

  if (totalPredictions >= 10 && accuracyScore >= 0.55) {
    return AnalystTier.ANALYST;
  }

  return AnalystTier.ROOKIE;
}

/**
 * Read the given user's stats from the database and compute their
 * current AnalystTier without updating anything.
 */
export async function computeAnalystTier(userId: string): Promise<AnalystTier> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      isVerifiedAnalyst: true,
      stats: {
        select: {
          totalPredictions: true,
          accuracyScore: true,
        },
      },
    },
  });

  if (!user) return AnalystTier.ROOKIE;

  return computeTierFromStats({
    totalPredictions: user.stats?.totalPredictions ?? 0,
    accuracyScore: user.stats?.accuracyScore ?? 0,
    isVerifiedAnalyst: user.isVerifiedAnalyst,
  });
}

/**
 * Recompute the AnalystTier for the given user and persist it to the database.
 * Returns the new tier value.
 *
 * Non-throwing: any database error is logged and the function returns the
 * computed tier even if the update failed.
 */
export async function updateAnalystTier(userId: string): Promise<AnalystTier> {
  const newTier = await computeAnalystTier(userId);

  try {
    await prisma.user.update({
      where: { id: userId },
      data: { analystTier: newTier },
    });
  } catch (err) {
    console.error(`[analyst-tier] Failed to persist tier for userId=${userId}:`, err);
  }

  return newTier;
}

/**
 * Recompute and persist analyst tiers for all users whose predictions were
 * resolved after the given cutoff date. Intended for the nightly cron job.
 *
 * Returns the number of users updated.
 */
export async function recalculateAnalystTiersForRecentlyResolved(
  since: Date
): Promise<number> {
  // Find users who had positions on markets resolved since `since`.
  const recentlyAffectedUsers = await prisma.marketPosition.findMany({
    where: {
      settledAt: { gte: since },
    },
    select: { userId: true },
    distinct: ["userId"],
  });

  let updated = 0;
  for (const { userId } of recentlyAffectedUsers) {
    try {
      await updateAnalystTier(userId);
      updated++;
    } catch (err) {
      console.error(`[analyst-tier] Failed to update tier for userId=${userId}:`, err);
    }
  }

  return updated;
}
