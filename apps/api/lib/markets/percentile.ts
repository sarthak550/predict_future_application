import { Prisma } from "@prisma/client";

/**
 * Compute a percentile rank for a winning user on a resolved market.
 *
 * Semantics: "You beat X% of other participants."
 *   percentileRank = Math.round(((positionsOnWinningSide - 1) / totalPositions) * 100)
 *   Clamped to [0, 99].
 *
 * Special cases:
 *   - Returns -1 if the user did not hold the winning position (loser).
 *   - Returns 50 if totalPositions === 1 (solo market — not meaningful to show 0% or 100%).
 *   - Handles BINARY, MULTIPLE_CHOICE markets. Returns -1 for NUMERIC markets (too complex).
 *
 * @param marketId   The market being resolved.
 * @param userId     The winning user.
 * @param tx         Active Prisma transaction client.
 * @returns          Percentile rank (0–99), or -1 if user is a loser / market is numeric.
 */
export async function computePercentileRank(
  marketId: string,
  userId: string,
  tx: Prisma.TransactionClient
): Promise<number> {
  const market = await tx.market.findUnique({
    where: { id: marketId },
    select: {
      marketType: true,
      outcome: true,
      winningOptionId: true
    }
  });

  if (!market) {
    return -1;
  }

  // NUMERIC markets: skip — too complex to rank by closeness here.
  if (market.marketType === "NUMERIC") {
    return -1;
  }

  if (market.marketType === "MULTIPLE_CHOICE") {
    if (!market.winningOptionId) {
      return -1;
    }

    // All settled positions for this market.
    const allPositions = await tx.multiChoicePosition.findMany({
      where: { marketId },
      select: { userId: true, optionId: true }
    });

    const totalPositions = allPositions.length;
    if (totalPositions === 0) {
      return -1;
    }
    if (totalPositions === 1) {
      return 50;
    }

    const userHeldWinner = allPositions.some(
      (p) => p.userId === userId && p.optionId === market.winningOptionId
    );
    if (!userHeldWinner) {
      return -1;
    }

    const winnersCount = allPositions.filter(
      (p) => p.optionId === market.winningOptionId
    ).length;

    const rank = Math.round(((winnersCount - 1) / totalPositions) * 100);
    return Math.min(99, Math.max(0, rank));
  }

  // BINARY market.
  if (market.outcome === "UNRESOLVED" || market.outcome === "CANCELLED") {
    return -1;
  }

  const winningSide = market.outcome === "YES" ? "YES" : "NO";

  const allPositions = await tx.marketPosition.findMany({
    where: { marketId },
    select: { userId: true, side: true }
  });

  const totalPositions = allPositions.length;
  if (totalPositions === 0) {
    return -1;
  }
  if (totalPositions === 1) {
    return 50;
  }

  const userHeldWinner = allPositions.some(
    (p) => p.userId === userId && p.side === winningSide
  );
  if (!userHeldWinner) {
    return -1;
  }

  const winnersCount = allPositions.filter((p) => p.side === winningSide).length;

  const rank = Math.round(((winnersCount - 1) / totalPositions) * 100);
  return Math.min(99, Math.max(0, rank));
}

/**
 * Build the percentile notification suffix for a MARKET_WIN.
 *
 * @param percentileRank  Value returned by computePercentileRank (−1 means skip).
 * @param category        Market category — "FINANCE" uses "analysts", others use "predictors".
 * @returns               Suffix string to append to the notification body, or "" if not applicable.
 */
export function buildPercentileSuffix(
  percentileRank: number,
  category: string
): string {
  if (percentileRank < 0) {
    return "";
  }
  const beaten = 100 - percentileRank;
  const label = category === "FINANCE" ? "analysts" : "predictors";
  return ` You beat ${beaten}% of ${label} on this call.`;
}
