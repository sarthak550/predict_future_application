import { NextResponse } from "next/server";

import { validateNumericGuess } from "@/lib/markets/numeric";
import { getSession } from "@/lib/auth";
import { canViewMarket } from "@/lib/markets/access";
import {
  calculateBondMetrics,
  canCreatorParticipateInMarket,
  isHostResolvedMode,
  supportsProjectedPool
} from "@/lib/markets/policies";
import { createNotification } from "@/lib/notifications";
import { calculateEstimatedReturn, calculateProbabilities } from "@/lib/markets/probability";
import { prisma } from "@/lib/prisma";
import { marketPositionSchema } from "@/lib/validations/market";

export async function POST(
  request: Request,
  { params }: { params: { marketId: string } }
) {
  try {
    const session = await getSession();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Authentication required." }, { status: 401 });
    }

    const user = await prisma.user.findUnique({
      where: { id: session.user.id },
      select: {
        id: true,
        username: true,
        isSuspended: true,
        role: true
      }
    });
    if (!user || user.isSuspended) {
      return NextResponse.json({ error: "Account cannot place positions." }, { status: 403 });
    }

    const payload = marketPositionSchema.parse(await request.json());

    await prisma.$transaction(async (tx) => {
      const market = await tx.market.findUnique({
        where: { id: params.marketId },
        include: {
          group: {
            select: {
              ownerId: true,
              memberships: {
                where: {
                  userId: user.id
                },
                select: {
                  userId: true
                }
              }
            }
          }
        }
      });
      const wallet = await tx.wallet.findUnique({
        where: { userId: user.id }
      });
      if (!market) {
        throw new Error("Market not found.");
      }
      if (!canViewMarket(market, user)) {
        throw new Error("You do not have access to this market.");
      }
      if (!wallet) {
        throw new Error("Wallet not found.");
      }
      if (market.status !== "OPEN" || market.closeAt <= new Date()) {
        throw new Error("This market is closed.");
      }
      if (market.creatorId === user.id && !canCreatorParticipateInMarket(market.resolutionMode)) {
        throw new Error("Hosts cannot take positions in their own host-resolved markets.");
      }
      if (wallet.balance < payload.amount) {
        throw new Error("Insufficient virtual points.");
      }

      const projectedTotalVolume = market.totalVolume + payload.amount;
      if (
        isHostResolvedMode(market.resolutionMode) &&
        !supportsProjectedPool({
          poolRewardMode: market.poolRewardMode,
          commissionBps: market.hostCommissionBps,
          bondCap: market.bondCap,
          projectedPool: projectedTotalVolume
        })
      ) {
        throw new Error("This market has reached the host's current bond-supported pool cap.");
      }

      const priorPositions = await tx.marketPosition.count({
        where: {
          userId: user.id,
          marketId: market.id
        }
      });

      let probabilityAtEntry: number | null = null;
      let estimatedReturn: number | null = null;
      let side = payload.side ?? null;
      let numericValue: number | null = null;

      if (market.marketType === "NUMERIC") {
        if (payload.numericValue === undefined) {
          throw new Error("Numeric markets require a numeric guess.");
        }

        validateNumericGuess({
          value: payload.numericValue,
          minValue: market.minValue,
          maxValue: market.maxValue,
          precision: market.precision
        });

        const existingNumericEntry = await tx.marketPosition.findFirst({
          where: {
            marketId: market.id,
            userId: user.id
          }
        });

        if (existingNumericEntry) {
          throw new Error("You can only submit one guess in a numeric market.");
        }

        numericValue = payload.numericValue;
        side = null;
      } else {
        if (!payload.side) {
          throw new Error("Binary markets require YES or NO.");
        }

        const probability = calculateProbabilities(market.yesPool, market.noPool);
        probabilityAtEntry =
          payload.side === "YES" ? probability.yesProbability : probability.noProbability;
        estimatedReturn = calculateEstimatedReturn(
          payload.side,
          payload.amount,
          market.yesPool,
          market.noPool
        );
      }

      const position = await tx.marketPosition.create({
        data: {
          userId: user.id,
          marketId: market.id,
          side,
          numericValue,
          amount: payload.amount,
          probabilityAtEntry,
          estimatedReturnAtEntry: estimatedReturn
        }
      });

      await tx.wallet.update({
        where: {
          id: wallet.id
        },
        data: {
          balance: {
            decrement: payload.amount
          }
        }
      });

      await tx.walletTransaction.create({
        data: {
          walletId: wallet.id,
          type: "POSITION_COMMITMENT",
          amount: -payload.amount,
          description: `Position on "${market.title}"`,
          marketId: market.id,
          positionId: position.id
        }
      });

      const updatedBondMetrics = calculateBondMetrics({
        poolRewardMode: market.poolRewardMode,
        commissionBps: market.hostCommissionBps,
        bondCap: market.bondCap,
        totalPool: projectedTotalVolume
      });

      await tx.market.update({
        where: { id: market.id },
        data: {
          yesPool: market.marketType === "BINARY" && payload.side === "YES" ? { increment: payload.amount } : undefined,
          noPool: market.marketType === "BINARY" && payload.side === "NO" ? { increment: payload.amount } : undefined,
          totalVolume: { increment: payload.amount },
          totalParticipants: priorPositions === 0 ? { increment: 1 } : undefined,
          currentRequiredBond: updatedBondMetrics.currentRequiredBond,
          maxPoolAllowed: updatedBondMetrics.maxPoolAllowed,
          rulesLockedAt: market.rulesLockedAt ? undefined : new Date()
        }
      });

      if (market.creatorId !== user.id) {
        await createNotification(tx, {
          userId: market.creatorId,
          marketId: market.id,
          type: "SYSTEM",
          title: "New market activity",
          body:
            market.marketType === "NUMERIC"
              ? `@${user.username} submitted a new guess on ${market.title}.`
              : `@${user.username} took a ${payload.side} position on ${market.title}.`,
          href: `/markets/${market.id}`
        });
      }
    });

    return NextResponse.json({ ok: true }, { status: 201 });
  } catch (error) {
    console.error(error);
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Unable to place position."
      },
      { status: 400 }
    );
  }
}
