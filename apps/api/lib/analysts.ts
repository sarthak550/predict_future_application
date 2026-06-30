import { AnalystTier } from "@prisma/client";

import { prisma } from "./prisma";

/**
 * Tier thresholds for the Analyst Tier system.
 *
 * ROOKIE         default — also catches anyone with totalNetPoints below the
 *                ANALYST gate, including analysts with negative lifetime PnL.
 * ANALYST        totalPredictions >= 10  AND totalNetPoints >= 200
 * SENIOR_ANALYST totalPredictions >= 50  AND totalNetPoints >= 1000
 * CHIEF_ANALYST  totalPredictions >= 200 AND totalNetPoints >= 4000 AND isVerifiedAnalyst = true
 */

interface TierInput {
  totalPredictions: number;
  totalNetPoints: number;
  isVerifiedAnalyst: boolean;
}

export function computeTierFromStats(input: TierInput): AnalystTier {
  const { totalPredictions, totalNetPoints, isVerifiedAnalyst } = input;

  if (
    isVerifiedAnalyst &&
    totalPredictions >= 200 &&
    totalNetPoints >= 4000
  ) {
    return AnalystTier.CHIEF_ANALYST;
  }

  if (totalPredictions >= 50 && totalNetPoints >= 1000) {
    return AnalystTier.SENIOR_ANALYST;
  }

  if (totalPredictions >= 10 && totalNetPoints >= 200) {
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
          totalNetPoints: true,
        },
      },
    },
  });

  if (!user) return AnalystTier.ROOKIE;

  return computeTierFromStats({
    totalPredictions: user.stats?.totalPredictions ?? 0,
    totalNetPoints: user.stats?.totalNetPoints ?? 0,
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
 * Batch-recompute and persist AnalystTiers for the given user IDs.
 *
 * Fetches all UserStat rows and user flags in two queries, computes new tiers
 * in JS, then writes back in chunks of 50 concurrent updates.
 *
 * Returns the number of users successfully updated.
 */
export async function updateAnalystTiersBatch(userIds: string[]): Promise<number> {
  if (userIds.length === 0) return 0;

  // One query for all relevant users (flags + embedded stats).
  const users = await prisma.user.findMany({
    where: { id: { in: userIds } },
    select: {
      id: true,
      isVerifiedAnalyst: true,
      stats: {
        select: {
          totalPredictions: true,
          totalNetPoints: true,
        },
      },
    },
  });

  // Compute new tier for every user in JS — no extra DB round-trips.
  const updates = users.map((u) => ({
    userId: u.id,
    newTier: computeTierFromStats({
      totalPredictions: u.stats?.totalPredictions ?? 0,
      totalNetPoints: u.stats?.totalNetPoints ?? 0,
      isVerifiedAnalyst: u.isVerifiedAnalyst,
    }),
  }));

  // Write back in chunks of 50 concurrent updates to avoid connection exhaustion.
  const CHUNK = 50;
  let updated = 0;
  for (let i = 0; i < updates.length; i += CHUNK) {
    const chunk = updates.slice(i, i + CHUNK);
    const results = await Promise.allSettled(
      chunk.map(({ userId, newTier }) =>
        prisma.user.update({ where: { id: userId }, data: { analystTier: newTier } })
      )
    );
    for (const r of results) {
      if (r.status === "fulfilled") {
        updated++;
      } else {
        console.error("[analyst-tier] batch update failed:", r.reason);
      }
    }
  }

  return updated;
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

  const userIds = recentlyAffectedUsers.map((r) => r.userId);
  return updateAnalystTiersBatch(userIds);
}
