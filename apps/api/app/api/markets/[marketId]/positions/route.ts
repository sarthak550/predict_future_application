import { NextResponse } from "next/server";

import { validateNumericGuess } from "@/lib/markets/numeric";
import { getSession, getUserIdFromRequest } from "@/lib/auth";
import { canViewMarket } from "@/lib/markets/access";
import {
  calculateBondMetrics,
  canCreatorParticipateInMarket,
  isHostResolvedMode,
  supportsProjectedPool
} from "@/lib/markets/policies";
import { createNotification, notifyFollowersOnPosition } from "@/lib/notifications";
import { calculateEstimatedReturn, calculateProbabilities } from "@/lib/markets/probability";
import { recordProbabilitySnapshot } from "@/lib/markets/probabilitySnapshot";
import { prisma } from "@/lib/prisma";
import { checkAndCompleteQuests, type CompletedQuestReward } from "@/lib/quests/engine";
import { marketPositionSchema } from "@/lib/validations/market";

export async function POST(
  request: Request,
  { params }: { params: { marketId: string } }
) {
  try {
    const userId = await getUserIdFromRequest(request);
    if (!userId) {
      return NextResponse.json({ error: "Authentication required." }, { status: 401 });
    }

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        username: true,
        isSuspended: true,
        role: true,
        referredById: true
      }
    });
    if (!user || user.isSuspended) {
      return NextResponse.json({ error: "Account cannot place positions." }, { status: 403 });
    }

    const payload = marketPositionSchema.parse(await request.json());

    let questRewards: CompletedQuestReward[] = [];

    // Captured inside the transaction; used for fire-and-forget notification after tx commits.
    let positionMarketSnapshot: { id: string; title: string } | null = null;
    let positionSideLabel: string | null = null;

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
      // Flagship polls allow amount=0 (free vote, no wallet deduction). Reject 0 for everything else.
      const isFlagshipPoll = market.flagshipEventAt !== null;
      if (payload.amount === 0 && !isFlagshipPoll) {
        throw new Error("Minimum bet is 50 points.");
      }
      if (payload.amount > 0 && payload.amount < 50) {
        throw new Error("Minimum bet is 50 points.");
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
        // Capture for follower notification outside the transaction.
        positionMarketSnapshot = { id: market.id, title: market.title };
        positionSideLabel = String(payload.numericValue);
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
        // Capture for follower notification outside the transaction.
        positionMarketSnapshot = { id: market.id, title: market.title };
        positionSideLabel = payload.side;
      }

      const position = await tx.marketPosition.create({
        data: {
          userId: user.id,
          marketId: market.id,
          side,
          numericValue,
          amount: payload.amount,
          probabilityAtEntry,
          estimatedReturnAtEntry: estimatedReturn,
          reasoning: payload.reasoning ?? null,
        }
      });

      // Skip wallet update for flagship-poll votes (amount=0). They're free votes, not stakes.
      if (payload.amount > 0) {
        // Guarded atomic decrement — prevents double-spend under concurrent requests.
        // updateMany with balance >= amount fails (count=0) if funds are insufficient.
        const walletUpdateResult = await tx.wallet.updateMany({
          where: { id: wallet.id, balance: { gte: payload.amount } },
          data: { balance: { decrement: payload.amount } }
        });
        if (walletUpdateResult.count === 0) {
          throw new Error("Insufficient virtual points.");
        }

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
      }

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

      // Quest engine — check if any daily prediction quests are now complete.
      // Non-fatal: a quest engine error must never roll back the bet itself.
      try {
        questRewards = await checkAndCompleteQuests(user.id, "PREDICTION", tx);
      } catch (questErr) {
        console.error("[quest engine] non-fatal error:", questErr);
      }

      // Referral reward — fires on the user's FIRST ever position, if they were referred.
      // Race-condition fix (S42-T8): use a guarded updateMany on User.referralBonusCreditedAt
      // as the idempotency gate instead of a read-then-write count check. The DB-level conditional
      // update is atomic under READ COMMITTED, so two concurrent first-position requests can only
      // both pass the gate if referralBonusCreditedAt is null in both reads — but only ONE write
      // will succeed (count === 1). The other gets count === 0 and skips the credit.
      // Non-fatal: errors must never roll back the position itself.
      try {
        if (user.referredById) {
          const REFERRAL_BONUS = 250;

          // Atomic gate: stamp referralBonusCreditedAt only if it is still null.
          const claimResult = await tx.user.updateMany({
            where: { id: user.id, referralBonusCreditedAt: null },
            data: { referralBonusCreditedAt: new Date() },
          });

          if (claimResult.count === 1) {
            // We won the race — credit both parties.
            const [referrerWallet, refereeWallet] = await Promise.all([
              tx.wallet.findUnique({
                where: { userId: user.referredById },
                select: { id: true },
              }),
              tx.wallet.findUnique({
                where: { userId: user.id },
                select: { id: true },
              }),
            ]);

            if (refereeWallet) {
              // Credit the referee (+250 pts)
              await tx.wallet.update({
                where: { id: refereeWallet.id },
                data: { balance: { increment: REFERRAL_BONUS } },
              });
              await tx.walletTransaction.create({
                data: {
                  walletId: refereeWallet.id,
                  type: "REFERRAL_BONUS_REFEREE",
                  amount: REFERRAL_BONUS,
                  description: "Referral bonus — your first prediction",
                },
              });
            }

            if (referrerWallet) {
              // Credit the referrer (+250 pts)
              await tx.wallet.update({
                where: { id: referrerWallet.id },
                data: { balance: { increment: REFERRAL_BONUS } },
              });
              await tx.walletTransaction.create({
                data: {
                  walletId: referrerWallet.id,
                  type: "REFERRAL_BONUS_REFERRER",
                  amount: REFERRAL_BONUS,
                  description: `Referral bonus — ${user.username} made their first prediction`,
                },
              });

              // Notify the referrer
              await tx.notification.create({
                data: {
                  userId: user.referredById,
                  type: "REFERRAL_REWARD",
                  title: "Referral reward!",
                  body: `${user.username} made their first prediction. You both earned ${REFERRAL_BONUS} pts!`,
                  href: "/profile",
                },
              });
            }
          }
          // claimResult.count === 0 means another concurrent request already claimed the bonus —
          // silently skip without error.
        }
      } catch (referralErr) {
        console.error("[referral reward] non-fatal error:", referralErr);
      }
    });

    // Fire-and-forget: notify followers that this analyst placed a position.
    // Must run OUTSIDE the transaction — uses a fresh prisma client internally.
    if (positionMarketSnapshot && positionSideLabel) {
      void notifyFollowersOnPosition(
        user.id,
        user.username,
        positionMarketSnapshot,
        positionSideLabel,
        payload.amount
      ).catch((err) => console.error("[notifyFollowersOnPosition binary/numeric]", err));
    }

    // Fire-and-forget: record a probability snapshot so the chart updates on every bet.
    // Must run OUTSIDE the transaction to avoid extending the transaction window.
    void recordProbabilitySnapshot(params.marketId, prisma).catch((err) =>
      console.error("[probability-snapshot on position]", err)
    );

    return NextResponse.json({ ok: true, questRewards }, { status: 201 });
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
