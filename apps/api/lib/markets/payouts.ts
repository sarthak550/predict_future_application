import { MarketOutcome, Prisma, WalletTransactionType } from "@prisma/client";

import {
  calculateNumericWinnerPayouts,
  parseNumericPayoutDistribution
} from "@/lib/markets/numeric";
import { calculateHostReward, isHostResolvedMode } from "@/lib/markets/policies";
import { createNotification } from "@/lib/notifications";
import { refreshUserStats } from "@/lib/stats";

type TxClient = Prisma.TransactionClient;

function buildWinnerPayouts(
  winners: Array<{ id: string; amount: number }>,
  losingPool: number
) {
  const totalWinningPool = winners.reduce((sum, winner) => sum + winner.amount, 0);
  if (totalWinningPool === 0) {
    return new Map<string, number>();
  }

  const base = winners.map((winner) => ({
    id: winner.id,
    payout:
      winner.amount +
      Math.floor((winner.amount / totalWinningPool) * losingPool)
  }));
  const distributed = base.reduce((sum, winner) => sum + winner.payout, 0);
  let remainder = totalWinningPool + losingPool - distributed;

  base.sort((left, right) => right.payout - left.payout);
  let cursor = 0;
  while (remainder > 0 && base.length > 0) {
    base[cursor % base.length].payout += 1;
    remainder -= 1;
    cursor += 1;
  }

  return new Map(base.map((winner) => [winner.id, winner.payout]));
}

async function createUniqueWalletTransaction(
  tx: TxClient,
  input: {
    walletId: string;
    marketId: string;
    type: WalletTransactionType;
    amount: number;
    description: string;
    positionId?: string;
  }
) {
  const existing = await tx.walletTransaction.findFirst({
    where: {
      walletId: input.walletId,
      marketId: input.marketId,
      type: input.type,
      ...(input.positionId ? { positionId: input.positionId } : {})
    }
  });

  if (existing) {
    return existing;
  }

  return tx.walletTransaction.create({
    data: input
  });
}

async function releaseOrForfeitHostBond(
  tx: TxClient,
  input: {
    market:
      | {
          id: string;
          title: string;
          lockedBondAmount: number;
          creator: {
            wallet: {
              id: string;
            } | null;
          } | null;
        }
      | null;
    releaseHostBond: boolean;
    forfeitHostBond: boolean;
  }
) {
  const market = input.market;
  if (!market || market.lockedBondAmount <= 0 || !market.creator?.wallet) {
    return;
  }

  if (input.releaseHostBond) {
    const existingRelease = await tx.walletTransaction.findFirst({
      where: {
        walletId: market.creator.wallet.id,
        marketId: market.id,
        type: "HOST_BOND_RELEASE"
      }
    });

    if (!existingRelease) {
      await tx.wallet.update({
        where: { id: market.creator.wallet.id },
        data: {
          balance: {
            increment: market.lockedBondAmount
          }
        }
      });

      await tx.walletTransaction.create({
        data: {
          walletId: market.creator.wallet.id,
          type: "HOST_BOND_RELEASE",
          amount: market.lockedBondAmount,
          description: `Host bond cap released for "${market.title}"`,
          marketId: market.id
        }
      });
    }
  }

  if (input.forfeitHostBond) {
    const existingForfeit = await tx.walletTransaction.findFirst({
      where: {
        walletId: market.creator.wallet.id,
        marketId: market.id,
        type: "HOST_BOND_FORFEIT"
      }
    });

    if (!existingForfeit) {
      await tx.walletTransaction.create({
        data: {
          walletId: market.creator.wallet.id,
          type: "HOST_BOND_FORFEIT",
          amount: 0,
          description: `Host bond cap forfeited for "${market.title}"`,
          marketId: market.id
        }
      });
    }
  }
}

async function distributeForfeitedBondCompensation(
  tx: TxClient,
  input: {
    marketId: string;
    marketTitle: string;
    lockedBondAmount: number;
    positions: Array<{
      id: string;
      amount: number;
      user: {
        wallet: {
          id: string;
        } | null;
      };
    }>;
  }
) {
  if (input.lockedBondAmount <= 0 || input.positions.length === 0) {
    return;
  }

  const totalStake = input.positions.reduce((sum, position) => sum + position.amount, 0);
  if (totalStake <= 0) {
    return;
  }

  const payouts = input.positions.map((position) => ({
    position,
    payout: Math.floor((position.amount / totalStake) * input.lockedBondAmount)
  }));
  let remainder = input.lockedBondAmount - payouts.reduce((sum, entry) => sum + entry.payout, 0);

  payouts.sort((left, right) => right.position.amount - left.position.amount);
  let cursor = 0;
  while (remainder > 0 && payouts.length > 0) {
    payouts[cursor % payouts.length].payout += 1;
    remainder -= 1;
    cursor += 1;
  }

  for (const entry of payouts) {
    if (!entry.position.user.wallet || entry.payout <= 0) {
      continue;
    }

    await tx.wallet.update({
      where: { id: entry.position.user.wallet.id },
      data: {
        balance: {
          increment: entry.payout
        }
      }
    });

    await createUniqueWalletTransaction(tx, {
      walletId: entry.position.user.wallet.id,
      type: "HOST_BOND_COMPENSATION",
      amount: entry.payout,
      description: `Host bond compensation for "${input.marketTitle}"`,
      marketId: input.marketId,
      positionId: entry.position.id
    });
  }
}

export async function settleMarket(
  tx: TxClient,
  marketId: string,
  options?: {
    payHostReward?: boolean;
    releaseHostBond?: boolean;
    forfeitHostBond?: boolean;
  }
) {
  const market = await tx.market.findUnique({
    where: { id: marketId },
    include: {
      positions: {
        where: {
          settledAt: null
        },
        include: {
          user: {
            include: {
              wallet: true
            }
          }
        }
      },
      creator: {
        include: {
          wallet: true
        }
      }
    }
  });

  if (!market) {
    throw new Error("Market not found.");
  }

  if (market.marketType === "BINARY" && market.outcome === MarketOutcome.UNRESOLVED) {
    throw new Error("Cannot settle a market without an outcome.");
  }

  if (market.marketType === "NUMERIC" && market.actualValue === null && market.outcome !== MarketOutcome.CANCELLED) {
    throw new Error("Cannot settle a numeric market without the actual value.");
  }

  const participants = Array.from(new Set(market.positions.map((position) => position.userId)));

  if (market.outcome === MarketOutcome.CANCELLED) {
    for (const position of market.positions) {
      if (!position.user.wallet) {
        continue;
      }

      await tx.wallet.update({
        where: { id: position.user.wallet.id },
        data: {
          balance: {
            increment: position.amount
          }
        }
      });

      await createUniqueWalletTransaction(tx, {
        walletId: position.user.wallet.id,
        type: "MARKET_REFUND",
        amount: position.amount,
        description: `Refund for cancelled market "${market.title}"`,
        marketId: market.id,
        positionId: position.id
      });

      await tx.marketPosition.update({
        where: { id: position.id },
        data: {
          payoutAmount: position.amount,
          settledAt: new Date()
        }
      });
    }

    if (Boolean(options?.forfeitHostBond)) {
      await distributeForfeitedBondCompensation(tx, {
        marketId: market.id,
        marketTitle: market.title,
        lockedBondAmount: market.lockedBondAmount,
        positions: market.positions
      });
    }

    await releaseOrForfeitHostBond(tx, {
      market,
      releaseHostBond: Boolean(options?.releaseHostBond),
      forfeitHostBond: Boolean(options?.forfeitHostBond)
    });

    for (const userId of participants) {
      await createNotification(tx, {
        userId,
        marketId: market.id,
        type: "MARKET_RESOLVED",
        title: "Market cancelled",
        body: `${market.title} was cancelled and your points were refunded.`,
        href: `/markets/${market.id}`
      });
      await refreshUserStats(tx, userId);
    }

    await refreshUserStats(tx, market.creatorId);
    return;
  }

  const winners = market.positions.filter(
    (position) =>
      (market.outcome === "YES" && position.side === "YES") ||
      (market.outcome === "NO" && position.side === "NO")
  );
  const losers = market.positions.filter(
    (position) =>
      (market.outcome === "YES" && position.side === "NO") ||
      (market.outcome === "NO" && position.side === "YES")
  );
  const losingPool = losers.reduce((sum, position) => sum + position.amount, 0);
  const grossPool = market.marketType === "NUMERIC" ? market.totalVolume : market.yesPool + market.noPool;
  const shouldPayHostReward =
    Boolean(options?.payHostReward) && isHostResolvedMode(market.resolutionMode);
  const hostReward = shouldPayHostReward
    ? calculateHostReward({
        poolRewardMode: market.poolRewardMode,
        commissionBps: market.hostCommissionBps,
        grossPool,
        losingPool,
        bondCap: market.lockedBondAmount
      })
    : { amount: 0, source: "commission" as const };
  const poolDeductedHostReward = hostReward.source === "commission" ? hostReward.amount : 0;
  const distributableLosingPool = Math.max(0, losingPool - poolDeductedHostReward);

  if (market.marketType === "NUMERIC") {
    if (market.actualValue === null) {
      throw new Error("Numeric markets require an actual value before settlement.");
    }

    const payoutDistribution = parseNumericPayoutDistribution(market.payoutDistributionJson);
    const numericPositions = market.positions
      .filter((position): position is typeof position & { numericValue: number } => position.numericValue !== null)
      .map((position) => ({
        id: position.id,
        userId: position.userId,
        amount: position.amount,
        numericValue: position.numericValue,
        createdAt: position.createdAt
      }));

    const winnerPayouts = calculateNumericWinnerPayouts({
      positions: numericPositions,
      actualValue: market.actualValue,
      winnersCount: market.winnersCount,
      payoutDistribution,
      tieBreakerRule: market.tieBreakerRule ?? "EARLIEST",
      grossPool,
      hostCommission: poolDeductedHostReward
    });
    const distributed = winnerPayouts.reduce((sum, winner) => sum + winner.payout, 0);
    let remainder = Math.max(0, grossPool - poolDeductedHostReward - distributed);

    for (const winner of winnerPayouts) {
      if (!remainder) {
        break;
      }

      winner.payout += 1;
      remainder -= 1;
    }

    const winnerIds = new Set(winnerPayouts.map((winner) => winner.positionId));

    for (const position of market.positions) {
      const winner = winnerPayouts.find((entry) => entry.positionId === position.id);
      const payout = winner?.payout ?? 0;

      if (payout > 0 && position.user.wallet) {
        await tx.wallet.update({
          where: { id: position.user.wallet.id },
          data: {
            balance: {
              increment: payout
            }
          }
        });

        await createUniqueWalletTransaction(tx, {
          walletId: position.user.wallet.id,
          type: "MARKET_WIN",
          amount: payout,
          description: `Payout for winning "${market.title}"`,
          marketId: market.id,
          positionId: position.id
        });
      }

      await tx.marketPosition.update({
        where: { id: position.id },
        data: {
          payoutAmount: payout,
          settledAt: new Date(),
          absoluteError: position.numericValue === null ? null : Math.abs(position.numericValue - market.actualValue)
        }
      });
    }

    if (hostReward.amount > 0 && market.creator.wallet) {
      await tx.wallet.update({
        where: { id: market.creator.wallet.id },
        data: {
          balance: {
            increment: hostReward.amount
          }
        }
      });

      await createUniqueWalletTransaction(tx, {
        walletId: market.creator.wallet.id,
        type: hostReward.source === "commission" ? "HOST_COMMISSION" : "HOST_REWARD",
        amount: hostReward.amount,
        description:
          hostReward.source === "commission"
            ? `Host commission for "${market.title}"`
            : `Host bond-based reward for "${market.title}"`,
        marketId: market.id
      });
    }

    await releaseOrForfeitHostBond(tx, {
      market,
      releaseHostBond: Boolean(options?.releaseHostBond),
      forfeitHostBond: Boolean(options?.forfeitHostBond)
    });

    for (const userId of participants) {
      const won = market.positions.some((position) => position.userId === userId && winnerIds.has(position.id));
      await createNotification(tx, {
        userId,
        marketId: market.id,
        type: "MARKET_RESOLVED",
        title: won ? "Winning forecast" : "Market finalized",
        body: won
          ? `${market.title} finalized and your numeric guess placed in the payout band.`
          : `${market.title} finalized. Review the actual result and the ranked guesses.`,
        href: `/markets/${market.id}`
      });

      await refreshUserStats(tx, userId);
    }

    if (shouldPayHostReward && hostReward.amount > 0) {
      await createNotification(tx, {
        userId: market.creatorId,
        marketId: market.id,
        type: "MARKET_RESOLVED",
        title: hostReward.source === "commission" ? "Host commission paid" : "Host reward paid",
        body:
          hostReward.source === "commission"
            ? `${market.title} was finalized and your fixed host commission was released.`
            : `${market.title} was finalized and your bond-based host reward was released.`,
        href: `/markets/${market.id}`
      });
    }

    await refreshUserStats(tx, market.creatorId);
    return;
  }

  const payoutMap = buildWinnerPayouts(
    winners.map((winner) => ({ id: winner.id, amount: winner.amount })),
    distributableLosingPool
  );

  for (const winner of winners) {
    if (!winner.user.wallet) {
      continue;
    }

    const payout = payoutMap.get(winner.id) ?? winner.amount;
    await tx.wallet.update({
      where: { id: winner.user.wallet.id },
      data: {
        balance: {
          increment: payout
        }
      }
    });

    await createUniqueWalletTransaction(tx, {
      walletId: winner.user.wallet.id,
      type: "MARKET_WIN",
      amount: payout,
      description: `Payout for winning "${market.title}"`,
      marketId: market.id,
      positionId: winner.id
    });

    await tx.marketPosition.update({
      where: { id: winner.id },
      data: {
        payoutAmount: payout,
        settledAt: new Date()
      }
    });
  }

  for (const loser of losers) {
    await tx.marketPosition.update({
      where: { id: loser.id },
      data: {
        payoutAmount: 0,
        settledAt: new Date()
      }
    });
  }

  if (hostReward.amount > 0 && market.creator.wallet) {
    await tx.wallet.update({
      where: { id: market.creator.wallet.id },
      data: {
        balance: {
          increment: hostReward.amount
        }
      }
    });

    await createUniqueWalletTransaction(tx, {
      walletId: market.creator.wallet.id,
      type: hostReward.source === "commission" ? "HOST_COMMISSION" : "HOST_REWARD",
      amount: hostReward.amount,
      description:
        hostReward.source === "commission"
          ? `Trusted host commission for "${market.title}"`
          : `Host bond-based reward for "${market.title}"`,
      marketId: market.id
    });
  }

  await releaseOrForfeitHostBond(tx, {
    market,
    releaseHostBond: Boolean(options?.releaseHostBond),
    forfeitHostBond: Boolean(options?.forfeitHostBond)
  });

  for (const userId of participants) {
    const won = winners.some((winner) => winner.userId === userId);
    await createNotification(tx, {
      userId,
      marketId: market.id,
      type: "MARKET_RESOLVED",
      title: won ? "Winning forecast" : "Market resolved",
      body: won
        ? `${market.title} resolved in your favor. Your wallet has been updated.`
        : `${market.title} has resolved. Review the final result and updated rankings.`,
      href: `/markets/${market.id}`
    });

    await refreshUserStats(tx, userId);
  }

  if (shouldPayHostReward && hostReward.amount > 0) {
    await createNotification(tx, {
      userId: market.creatorId,
      marketId: market.id,
      type: "MARKET_RESOLVED",
      title: hostReward.source === "commission" ? "Trusted host commission paid" : "Host reward paid",
      body:
        hostReward.source === "commission"
          ? `${market.title} was finalized and your fixed host commission was released.`
          : `${market.title} was finalized and your bond-based host reward was released.`,
      href: `/markets/${market.id}`
    });
  }

  await refreshUserStats(tx, market.creatorId);
}
