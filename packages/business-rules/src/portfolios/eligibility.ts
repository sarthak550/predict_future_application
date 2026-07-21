/**
 * Portfolio eligibility thresholds (P3.1) — mirrors the
 * INDEXABLE_MIN_RESOLVED_CALLS pattern in ./experts/scorecard.ts.
 *
 * P3.1 ships schema + engine + crons only (no public pages), so nothing calls
 * `isEligibleForPublicRanking` yet. It exists now so the constant lives in one
 * place from day one — P3.2's public directory / leaderboard surfaces will gate
 * on it rather than inventing their own thresholds.
 */

/**
 * Minimum age, in days, of a portfolio's FIRST EXECUTED transaction before it's
 * eligible for public ranking / leaderboard inclusion. Deliberately anchored to the
 * first fill, NOT Portfolio.createdAt — anchoring to creation date would let someone
 * create an empty portfolio, let it "age" untouched, then dump in winning picks right
 * before the age gate opens, appearing on a leaderboard with an artificially long
 * apparent track record. Anchoring to the first real trade closes that gaming path.
 */
export const PORTFOLIO_MIN_AGE_DAYS = 30;

/** Minimum EXECUTED transaction count before a portfolio is eligible for public
 * ranking / leaderboard inclusion. A portfolio that has only ever placed 1-2 trades
 * hasn't demonstrated enough of a track record to rank against portfolios with a
 * real trade history. */
export const PORTFOLIO_MIN_TXN_COUNT = 3;

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * Whether a portfolio qualifies for public ranking / leaderboard surfaces.
 * Pure function of (firstExecutedTransactionAt, executedTxnCount, now) — no DB access.
 * `firstExecutedTransactionAt` is null for a portfolio that has never had a fill,
 * which is never eligible regardless of `now` (falls out naturally: age is undefined
 * and executedTxnCount will also be 0 in that case).
 */
export function isEligibleForPublicRanking(
  firstExecutedTransactionAt: Date | null,
  executedTxnCount: number,
  now: Date = new Date()
): boolean {
  if (firstExecutedTransactionAt === null) return false;
  const ageDays = (now.getTime() - firstExecutedTransactionAt.getTime()) / MS_PER_DAY;
  return ageDays >= PORTFOLIO_MIN_AGE_DAYS && executedTxnCount >= PORTFOLIO_MIN_TXN_COUNT;
}
