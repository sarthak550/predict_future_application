/**
 * League points tracking helpers.
 *
 * updateLeagueMonthPoints — increments (or decrements) netPointsMonth for the
 * user's MonthlyLeagueEntry for the current IST calendar month.
 *
 * Design notes:
 * - Must be called inside an existing Prisma transaction so that league points
 *   are always atomic with the wallet credit that triggers them.
 * - On upsert-create the tier falls back to the user's currentLeagueTier,
 *   then to BRONZE if the user has never been placed. This ensures new users
 *   who earn their first points in a month get a valid row.
 * - Negative deltas are supported (unused today but future-safe).
 * - The call must be wrapped in try/catch by the caller so a league update
 *   failure never rolls back the core wallet transaction (systemic rule from
 *   S24-T4/T5 post-mortems).
 */

import type { LeagueTier, Prisma } from "@prisma/client";

export type TxClient = Omit<
  Prisma.TransactionClient,
  "$connect" | "$disconnect" | "$on" | "$transaction" | "$use" | "$extends"
>;

/**
 * Returns the current IST month as a 'YYYY-MM' string.
 * IST = UTC+5:30 (19800 seconds ahead).
 */
export function getIstMonthString(now?: Date): string {
  const d = now ?? new Date();
  const istMs = d.getTime() + 5.5 * 60 * 60 * 1000;
  const istDate = new Date(istMs);
  const yyyy = istDate.getUTCFullYear();
  const mm = String(istDate.getUTCMonth() + 1).padStart(2, "0");
  return `${yyyy}-${mm}`;
}

/**
 * Upserts the user's MonthlyLeagueEntry for the current IST month and
 * increments netPointsMonth by deltaPoints.
 *
 * MUST be called inside an active transaction.
 * MUST be wrapped in try/catch by the caller — failure must not roll back
 * the core wallet operation.
 */
export async function updateLeagueMonthPoints(
  userId: string,
  deltaPoints: number,
  tx: TxClient
): Promise<void> {
  const month = getIstMonthString();

  // Resolve the user's current tier for the create-fallback path.
  // We need this only when no entry exists yet for this month.
  const user = await tx.user.findUnique({
    where: { id: userId },
    select: { currentLeagueTier: true },
  });

  const fallbackTier: LeagueTier = user?.currentLeagueTier ?? "BRONZE";

  await tx.monthlyLeagueEntry.upsert({
    where: { userId_month: { userId, month } },
    update: {
      netPointsMonth: { increment: deltaPoints },
    },
    create: {
      userId,
      month,
      tier: fallbackTier,
      startingTier: fallbackTier,
      netPointsMonth: deltaPoints,
    },
  });
}
