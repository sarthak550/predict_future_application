import { NextResponse } from "next/server";

import { getUserIdFromRequest } from "@/lib/auth";
import { notifyFollowersOnPosition } from "@/lib/notifications";
import { recordProbabilitySnapshot } from "@/lib/markets/probabilitySnapshot";
import { prisma } from "@/lib/prisma";
import { checkAndCompleteQuests, type CompletedQuestReward } from "@/lib/quests/engine";
import { multiChoicePositionSchema } from "@/lib/validations/market";

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
        wallet: {
          select: { id: true, balance: true }
        }
      }
    });

    if (!user || user.isSuspended) {
      return NextResponse.json({ error: "Account cannot place positions." }, { status: 403 });
    }

    if (!user.wallet) {
      return NextResponse.json({ error: "Wallet not found." }, { status: 400 });
    }

    const payload = multiChoicePositionSchema.parse(await request.json());

    const market = await prisma.market.findUnique({
      where: { id: params.marketId },
      select: {
        id: true,
        title: true,
        status: true,
        marketType: true,
        closeAt: true
      }
    });

    if (!market) {
      return NextResponse.json({ error: "Market not found." }, { status: 404 });
    }

    if (market.marketType !== "MULTIPLE_CHOICE") {
      return NextResponse.json(
        { error: "This endpoint is only for multiple-choice markets." },
        { status: 400 }
      );
    }

    if (market.status !== "OPEN") {
      return NextResponse.json({ error: "Market is not open for predictions." }, { status: 409 });
    }

    if (new Date() > market.closeAt) {
      return NextResponse.json({ error: "Market has closed." }, { status: 409 });
    }

    const option = await prisma.marketOption.findUnique({
      where: { id: payload.optionId },
      select: { id: true, label: true, marketId: true }
    });

    if (!option || option.marketId !== market.id) {
      return NextResponse.json({ error: "Option not found in this market." }, { status: 404 });
    }

    if (user.wallet.balance < payload.amount) {
      return NextResponse.json({ error: "Insufficient wallet balance." }, { status: 400 });
    }

    let questRewards: CompletedQuestReward[] = [];

    await prisma.$transaction(async (tx) => {
      // Upsert position — allow adding to an existing stake on the same option.
      const existingPosition = await tx.multiChoicePosition.findUnique({
        where: {
          userId_marketId_optionId: {
            userId: user.id,
            marketId: market.id,
            optionId: payload.optionId
          }
        }
      });

      if (existingPosition) {
        await tx.multiChoicePosition.update({
          where: { id: existingPosition.id },
          data: { amount: { increment: payload.amount } }
        });
      } else {
        await tx.multiChoicePosition.create({
          data: {
            userId: user.id,
            marketId: market.id,
            optionId: payload.optionId,
            amount: payload.amount
          }
        });

        // Increment participant count only on first stake (any option).
        const previousParticipation = await tx.multiChoicePosition.count({
          where: { userId: user.id, marketId: market.id }
        });
        if (previousParticipation <= 1) {
          await tx.market.update({
            where: { id: market.id },
            data: { totalParticipants: { increment: 1 } }
          });
        }
      }

      // Deduct from wallet.
      await tx.wallet.update({
        where: { id: user.wallet!.id },
        data: { balance: { decrement: payload.amount } }
      });

      // Record wallet transaction.
      await tx.walletTransaction.create({
        data: {
          walletId: user.wallet!.id,
          type: "POSITION_COMMITMENT",
          amount: -payload.amount,
          description: `Multi-choice stake on market option`,
          marketId: market.id
        }
      });

      // Increment option pool.
      await tx.marketOption.update({
        where: { id: payload.optionId },
        data: { totalStaked: { increment: payload.amount } }
      });

      // Increment market total volume.
      await tx.market.update({
        where: { id: market.id },
        data: { totalVolume: { increment: payload.amount } }
      });

      // Quest engine — non-fatal.
      try {
        questRewards = await checkAndCompleteQuests(user.id, "PREDICTION", tx);
      } catch (questErr) {
        console.error("[quest engine] multi-choice non-fatal error:", questErr);
      }
    });

    // Fire-and-forget: notify followers that this analyst placed a multi-choice position.
    // Must run OUTSIDE the transaction — uses a fresh prisma client internally.
    void notifyFollowersOnPosition(
      user.id,
      user.username,
      { id: market.id, title: market.title },
      option.label,
      payload.amount
    ).catch((err) => console.error("[notifyFollowersOnPosition multi-choice]", err));

    // Fire-and-forget: record a probability snapshot so the chart updates on every bet.
    void recordProbabilitySnapshot(params.marketId, prisma).catch((err) =>
      console.error("[probability-snapshot on multi-choice position]", err)
    );

    return NextResponse.json({ ok: true, questRewards });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to place position.";
    console.error("[multi-choice position]", err);
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
