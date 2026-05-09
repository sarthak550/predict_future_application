import { type Prisma, PrismaClient } from "@prisma/client";

/**
 * Compute the current YES-probability for a market based on live position data.
 *
 * - BINARY: probability = yesPositionCount / totalPositionCount, or 0.5 if no positions yet.
 * - MULTIPLE_CHOICE: probability of the highest-staked option = optionStaked / totalStaked, or 0.5 if no stakes.
 * - NUMERIC: not supported (returns null) — callers should skip NUMERIC markets.
 *
 * The `tx` parameter accepts a Prisma transaction client so this can be called
 * inside a transaction if needed (though the normal pattern is fire-and-forget outside).
 */
export async function computeMarketProbability(
  marketId: string,
  client: PrismaClient | Prisma.TransactionClient
): Promise<number | null> {
  const market = await client.market.findUnique({
    where: { id: marketId },
    select: { marketType: true },
  });

  if (!market) return null;

  if (market.marketType === "NUMERIC") {
    // Not charted in v1
    return null;
  }

  if (market.marketType === "BINARY") {
    const [total, yesCount] = await Promise.all([
      client.marketPosition.count({ where: { marketId } }),
      client.marketPosition.count({ where: { marketId, side: "YES" } }),
    ]);
    if (total === 0) return 0.5;
    return yesCount / total;
  }

  // MULTIPLE_CHOICE — probability of highest-staked option
  if (market.marketType === "MULTIPLE_CHOICE") {
    const options = await client.marketOption.findMany({
      where: { marketId },
      select: { totalStaked: true },
      orderBy: { totalStaked: "desc" },
    });

    if (options.length === 0) return 0.5;

    const totalStaked = options.reduce((sum, o) => sum + o.totalStaked, 0);
    if (totalStaked === 0) return 0.5;

    // Highest-staked option's share
    return (options[0]?.totalStaked ?? 0) / totalStaked;
  }

  return null;
}

/**
 * Insert a single MarketProbabilitySnapshot for the given market using the
 * current position data. Safe to call fire-and-forget; the caller must catch errors.
 *
 * Returns the probability that was snapshotted, or null if the market type is unsupported.
 */
export async function recordProbabilitySnapshot(
  marketId: string,
  client: PrismaClient | Prisma.TransactionClient
): Promise<number | null> {
  const probability = await computeMarketProbability(marketId, client);
  if (probability === null) return null;

  await client.marketProbabilitySnapshot.create({
    data: { marketId, probability },
  });

  return probability;
}
