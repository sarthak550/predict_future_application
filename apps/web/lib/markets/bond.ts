import { Prisma } from "@prisma/client";

import { isHostResolvedMode, calculateBondMetrics } from "@/lib/markets/policies";
import { createNotification } from "@/lib/notifications";
import { prisma } from "@/lib/prisma";
import { refreshUserStats } from "@/lib/stats";

type TxClient = Prisma.TransactionClient;

async function lockBondCapPoints(
  tx: TxClient,
  input: {
    marketId: string;
    marketTitle: string;
    walletId: string;
    amount: number;
    description: string;
  }
) {
  await tx.wallet.update({
    where: { id: input.walletId },
    data: {
      balance: {
        decrement: input.amount
      }
    }
  });

  await tx.walletTransaction.create({
    data: {
      walletId: input.walletId,
      type: "HOST_BOND_LOCK",
      amount: -input.amount,
      description: input.description,
      marketId: input.marketId
    }
  });
}

export async function addHostBondCap(input: {
  marketId: string;
  hostUserId: string;
  amount: number;
}) {
  const amount = Math.max(0, Math.floor(input.amount));
  if (amount <= 0) {
    throw new Error("Add a positive number of points to the bond cap.");
  }

  return prisma.$transaction(async (tx) => {
    const market = await tx.market.findUnique({
      where: { id: input.marketId },
      include: {
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

    if (market.creatorId !== input.hostUserId) {
      throw new Error("Only the host can add bond to this market.");
    }

    if (!isHostResolvedMode(market.resolutionMode)) {
      throw new Error("Only host-resolved markets can use host bond caps.");
    }

    if (["FINALIZED", "OVERTURNED", "CANCELLED", "HOST_TIMEOUT"].includes(market.resolutionStatus)) {
      throw new Error("This market is already finalized and cannot accept more bond.");
    }

    if (!market.creator.wallet) {
      throw new Error("Wallet not found.");
    }

    if (market.creator.wallet.balance < amount) {
      throw new Error("Insufficient virtual points to add to the bond cap.");
    }

    const nextBondCap = market.bondCap + amount;
    const nextLockedBondAmount = market.lockedBondAmount + amount;
    const bondMetrics = calculateBondMetrics({
      poolRewardMode: market.poolRewardMode,
      commissionBps: market.hostCommissionBps,
      bondCap: nextBondCap,
      totalPool: market.totalVolume
    });

    await tx.market.update({
      where: { id: market.id },
      data: {
        bondCap: nextBondCap,
        lockedBondAmount: nextLockedBondAmount,
        currentRequiredBond: bondMetrics.currentRequiredBond,
        dynamicPoolEnabled: false,
        maxPoolAllowed: bondMetrics.maxPoolAllowed
      }
    });

    await lockBondCapPoints(tx, {
      marketId: market.id,
      marketTitle: market.title,
      walletId: market.creator.wallet.id,
      amount,
      description: `Additional host bond cap locked for "${market.title}"`
    });

    await createNotification(tx, {
      userId: market.creatorId,
      marketId: market.id,
      type: "SYSTEM",
      title: "Bond cap increased",
      body: `You added ${amount.toLocaleString()} points to the bond cap for ${market.title}.`,
      href: `/markets/${market.id}`
    });

    await refreshUserStats(tx, market.creatorId);

    return {
      marketId: market.id,
      bondCap: nextBondCap,
      lockedBondAmount: nextLockedBondAmount,
      maxPoolAllowed: bondMetrics.maxPoolAllowed
    };
  });
}
