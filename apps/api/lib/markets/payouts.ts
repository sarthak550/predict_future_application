import { MarketOutcome, Prisma, WalletTransactionType } from "@prisma/client";

import {
  calculateNumericWinnerPayouts,
  parseNumericPayoutDistribution
} from "@/lib/markets/numeric";
import { calculateHostReward, isHostResolvedMode } from "@/lib/markets/policies";
import { updateLeagueMonthPoints } from "@/lib/leagues/processing";
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
    forfeitBondAmount?: number;
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
      const totalBond = market.lockedBondAmount;
      const forfeitAmount =
        options?.forfeitBondAmount !== undefined
          ? Math.min(Math.max(0, options.forfeitBondAmount), totalBond)
          : totalBond;
      const returnAmount = totalBond - forfeitAmount;

      await distributeForfeitedBondCompensation(tx, {
        marketId: market.id,
        marketTitle: market.title,
        lockedBondAmount: forfeitAmount,
        positions: market.positions
      });

      if (returnAmount > 0 && market.creator?.wallet) {
        const existingReturn = await tx.walletTransaction.findFirst({
          where: {
            walletId: market.creator.wallet.id,
            marketId: market.id,
            type: "HOST_BOND_RELEASE"
          }
        });

        if (!existingReturn) {
          await tx.wallet.update({
            where: { id: market.creator.wallet.id },
            data: { balance: { increment: returnAmount } }
          });

          await tx.walletTransaction.create({
            data: {
              walletId: market.creator.wallet.id,
              type: "HOST_BOND_RELEASE",
              amount: returnAmount,
              description: `Partial host bond return for "${market.title}"`,
              marketId: market.id
            }
          });
        }
      }
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

        // League points: net gain only (payout minus original stake)
        const netGain = payout - position.amount;
        if (netGain > 0) {
          try {
            await updateLeagueMonthPoints(position.userId, netGain, tx);
          } catch (leagueErr) {
            console.error("[leagues] updateLeagueMonthPoints failed (numeric win):", leagueErr);
          }
        }
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

    // League points: net gain only (payout minus original stake)
    const netGain = payout - winner.amount;
    if (netGain > 0) {
      try {
        await updateLeagueMonthPoints(winner.userId, netGain, tx);
      } catch (leagueErr) {
        console.error("[leagues] updateLeagueMonthPoints failed (binary win):", leagueErr);
      }
    }

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

/**
 * Settle a MULTIPLE_CHOICE market. The caller must have already written
 * `market.winningOptionId` and `market.outcome = RESOLVED` before invoking.
 *
 * Payout formula: for each winner,
 *   payout = floor((user_amount / winning_total) * total_pool)
 * Remainder cents are distributed to top winners (largest stake first).
 */
export async function settleMultiChoiceMarket(
  tx: TxClient,
  marketId: string
) {
  const market = await tx.market.findUnique({
    where: { id: marketId },
    include: {
      creator: { include: { wallet: true } }
    }
  });

  if (!market) {
    throw new Error("Market not found.");
  }

  if (market.marketType !== "MULTIPLE_CHOICE") {
    throw new Error("settleMultiChoiceMarket called on a non-MULTIPLE_CHOICE market.");
  }

  // Gather all positions for this market.
  const allPositions = await tx.multiChoicePosition.findMany({
    where: { marketId, settledAt: null },
    include: {
      user: { include: { wallet: true } }
    }
  });

  const totalPool = allPositions.reduce((sum, p) => sum + p.amount, 0);

  // CANCELLED path — full refund.
  if (market.outcome === MarketOutcome.CANCELLED) {
    for (const position of allPositions) {
      if (!position.user.wallet) continue;

      await tx.wallet.update({
        where: { id: position.user.wallet.id },
        data: { balance: { increment: position.amount } }
      });

      await tx.walletTransaction.create({
        data: {
          walletId: position.user.wallet.id,
          type: "MARKET_REFUND",
          amount: position.amount,
          description: `Refund for cancelled multi-choice market "${market.title}"`,
          marketId: market.id
        }
      });

      await tx.multiChoicePosition.update({
        where: { id: position.id },
        data: { payoutAmount: position.amount, settledAt: new Date() }
      });
    }

    // Notify participants.
    const participantIds = Array.from(new Set(allPositions.map((p) => p.userId)));
    for (const userId of participantIds) {
      try {
        await createNotification(tx, {
          userId,
          marketId: market.id,
          type: "MARKET_RESOLVED",
          title: "Market cancelled",
          body: `${market.title} was cancelled and your stake was refunded.`,
          href: `/markets/${market.id}`
        });
        await refreshUserStats(tx, userId);
      } catch (notifErr) {
        console.error("[settleMultiChoiceMarket] cancelled notification error:", notifErr);
      }
    }
    return;
  }

  if (!market.winningOptionId) {
    throw new Error("Winning option not set for MULTIPLE_CHOICE resolution.");
  }

  const winningPositions = allPositions.filter(
    (p) => p.optionId === market.winningOptionId
  );
  const winningTotal = winningPositions.reduce((sum, p) => sum + p.amount, 0);

  // Build payout map.
  const payoutMap = new Map<string, { positionId: string; userId: string; payout: number }>();

  if (winningTotal === 0) {
    // No one bet on the winning option — refund everyone.
    for (const position of allPositions) {
      payoutMap.set(position.id, {
        positionId: position.id,
        userId: position.userId,
        payout: position.amount
      });
    }
  } else {
    // Proportional payouts for winners.
    const rawPayouts = winningPositions.map((p) => ({
      positionId: p.id,
      userId: p.userId,
      payout: Math.floor((p.amount / winningTotal) * totalPool)
    }));

    // Distribute remainder (rounding dust) to highest stakers first.
    const distributed = rawPayouts.reduce((sum, p) => sum + p.payout, 0);
    let remainder = totalPool - distributed;
    rawPayouts.sort((a, b) => b.payout - a.payout);
    let cursor = 0;
    while (remainder > 0 && rawPayouts.length > 0) {
      rawPayouts[cursor % rawPayouts.length].payout += 1;
      remainder -= 1;
      cursor += 1;
    }

    for (const entry of rawPayouts) {
      payoutMap.set(entry.positionId, entry);
    }
  }

  // Credit wallets.
  const settledUserIds = new Set<string>();
  for (const [positionId, entry] of payoutMap.entries()) {
    const position = allPositions.find((p) => p.id === positionId);
    if (!position?.user.wallet) continue;

    await tx.wallet.update({
      where: { id: position.user.wallet.id },
      data: { balance: { increment: entry.payout } }
    });

    await tx.walletTransaction.create({
      data: {
        walletId: position.user.wallet.id,
        type: "MARKET_WIN",
        amount: entry.payout,
        description: `Payout for multi-choice market "${market.title}"`,
        marketId: market.id
      }
    });

    await tx.multiChoicePosition.update({
      where: { id: positionId },
      data: { payoutAmount: entry.payout, settledAt: new Date() }
    });

    settledUserIds.add(entry.userId);

    // League points — net gain = payout - amount staked.
    const netGain = entry.payout - position.amount;
    if (netGain > 0) {
      try {
        await updateLeagueMonthPoints(entry.userId, netGain, tx);
      } catch (leagueErr) {
        console.error("[league] multi-choice non-fatal error:", leagueErr);
      }
    }
  }

  // For losing positions — mark settled, no credit.
  for (const position of allPositions) {
    if (!payoutMap.has(position.id)) {
      await tx.multiChoicePosition.update({
        where: { id: position.id },
        data: { payoutAmount: 0, settledAt: new Date() }
      });

      // Negative league points for the loss.
      try {
        await updateLeagueMonthPoints(position.userId, -position.amount, tx);
      } catch (leagueErr) {
        console.error("[league] multi-choice loss non-fatal error:", leagueErr);
      }
    }
  }

  // Notify all participants.
  const allParticipantIds = Array.from(new Set(allPositions.map((p) => p.userId)));
  for (const userId of allParticipantIds) {
    const won = settledUserIds.has(userId);
    try {
      await createNotification(tx, {
        userId,
        marketId: market.id,
        type: "MARKET_RESOLVED",
        title: won ? "Winning prediction" : "Market resolved",
        body: won
          ? `${market.title} resolved and you won!`
          : `${market.title} has resolved. Better luck next time.`,
        href: `/markets/${market.id}`
      });
      await refreshUserStats(tx, userId);
    } catch (notifErr) {
      console.error("[settleMultiChoiceMarket] notification error:", notifErr);
    }
  }
}
