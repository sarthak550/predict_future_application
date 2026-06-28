/**
 * Poll accuracy helpers.
 *
 * `refreshPollAccuracy` is the single source of truth for recomputing a user's
 * poll prediction stats. It is called by the resolve route after every poll
 * resolution so that `UserStat.totalPollPredictions` and
 * `UserStat.pollAccuracyScore` remain in sync with the PollVote table.
 *
 * It is intentionally decoupled from the HTTP layer so it can be called from
 * any server-side context (route handler, background job, seed script).
 */

import { prisma } from "@/lib/prisma";

/**
 * Recompute and persist poll accuracy stats for a single user.
 *
 * Algorithm:
 *   - Count all PollVotes for the user where `isCorrect` is non-null
 *     (i.e. the poll has been resolved).
 *   - `totalPollPredictions` = that count.
 *   - `pollAccuracyScore`    = (correct / total) * 100, clamped to 0 when
 *     there are no resolved votes.
 *
 * The UserStat row is upserted if it does not yet exist.
 *
 * @param userId - The User.id whose stats should be refreshed.
 */
export async function refreshPollAccuracy(userId: string): Promise<void> {
  // Aggregate directly on the PollVote table — single round-trip.
  const [totalResult, correctResult] = await Promise.all([
    prisma.pollVote.count({
      where: { userId, isCorrect: { not: null } },
    }),
    prisma.pollVote.count({
      where: { userId, isCorrect: true },
    }),
  ]);

  const total = totalResult;
  const correct = correctResult;
  const accuracyScore = total > 0 ? (correct / total) * 100 : 0;

  await prisma.userStat.upsert({
    where: { userId },
    update: {
      totalPollPredictions: total,
      pollAccuracyScore: accuracyScore,
    },
    create: {
      userId,
      totalPollPredictions: total,
      pollAccuracyScore: accuracyScore,
    },
  });
}
