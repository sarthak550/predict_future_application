import { NextResponse } from "next/server";

import { getUserIdFromRequest } from "@/lib/auth";
import { notifyFollowersOnPosition } from "@/lib/notifications";
import { canCreatorParticipateInMarket } from "@/lib/markets/policies";
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
        closeAt: true,
        flagshipEventAt: true,
        creatorId: true,
        resolutionMode: true
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

    // Mirror the binary positions check: creators cannot stake in their own host-resolved markets.
    if (market.creatorId === userId && !canCreatorParticipateInMarket(market.resolutionMode)) {
      return NextResponse.json(
        { error: "Hosts cannot take positions in their own host-resolved markets." },
        { status: 403 }
      );
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

    // Flagship polls allow amount=0 (free vote). Reject 0 elsewhere; enforce 10 min for stakes.
    const isFlagshipPoll = market.flagshipEventAt !== null;
    if (payload.amount === 0 && !isFlagshipPoll) {
      return NextResponse.json({ error: "Minimum stake is 10 points." }, { status: 400 });
    }
    if (payload.amount > 0 && payload.amount < 10) {
      return NextResponse.json({ error: "Minimum stake is 10 points." }, { status: 400 });
    }

    // For flagship polls, only ONE option per user (it's a poll, not a stake spread).
    // If user already voted on a different option, reject.
    if (isFlagshipPoll) {
      const existingDifferent = await prisma.multiChoicePosition.findFirst({
        where: {
          userId: user.id,
          marketId: market.id,
          optionId: { not: payload.optionId }
        },
        select: { id: true }
      });
      if (existingDifferent) {
        return NextResponse.json(
          { error: "You already voted on a different option. Edit your reasoning instead." },
          { status: 409 }
        );
      }
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

      // Resolve the canonical positionId so the POSITION_COMMITMENT wallet
      // transaction below can attach it (M2). We update-or-create on the
      // commit row so the @@unique([walletId, marketId, type, multiChoicePositionId])
      // constraint is satisfied by a single per-position row whose amount
      // tracks the running total stake.
      let positionId: string;

      if (existingPosition) {
        await tx.multiChoicePosition.update({
          where: { id: existingPosition.id },
          data: {
            amount: { increment: payload.amount },
            // For flagship polls, allow the user to refresh their reasoning when they re-submit.
            ...(isFlagshipPoll && payload.reasoning !== undefined ? { reasoning: payload.reasoning } : {}),
          }
        });
        positionId = existingPosition.id;
      } else {
        const created = await tx.multiChoicePosition.create({
          data: {
            userId: user.id,
            marketId: market.id,
            optionId: payload.optionId,
            amount: payload.amount,
            reasoning: payload.reasoning ?? null,
          }
        });
        positionId = created.id;

        // Increment participant count only on the user's first stake (any
        // option). M3: under default READ COMMITTED isolation, two concurrent
        // first-stake requests on different options for the same user could
        // both observe count=1 (each seeing only its own insert), causing a
        // double-increment of totalParticipants.
        //
        // Fix: take a row lock on the Market row before the count read, so
        // the second transaction blocks until the first commits and then
        // sees the full count. Postgres FOR UPDATE serializes only the rows
        // we touch, so this doesn't bottleneck unrelated markets.
        await tx.$executeRaw`SELECT id FROM "Market" WHERE id = ${market.id} FOR UPDATE`;
        const previousParticipation = await tx.multiChoicePosition.count({
          where: { userId: user.id, marketId: market.id }
        });
        if (previousParticipation === 1) {
          await tx.market.update({
            where: { id: market.id },
            data: { totalParticipants: { increment: 1 } }
          });
        }
      }

      // Skip wallet update for flagship-poll votes (amount=0). They're free votes, not stakes.
      if (payload.amount > 0) {
        // Guarded atomic decrement — prevents double-spend under concurrent requests.
        const walletUpdateResult = await tx.wallet.updateMany({
          where: { id: user.wallet!.id, balance: { gte: payload.amount } },
          data: { balance: { decrement: payload.amount } }
        });
        if (walletUpdateResult.count === 0) {
          throw new Error("Insufficient wallet balance.");
        }

        // Upsert the POSITION_COMMITMENT row so a re-stake adds to the
        // existing row's amount instead of creating a duplicate (which would
        // collide with the unique constraint now that multiChoicePositionId
        // is set).
        const existingCommitWT = await tx.walletTransaction.findFirst({
          where: {
            walletId: user.wallet!.id,
            marketId: market.id,
            type: "POSITION_COMMITMENT",
            multiChoicePositionId: positionId,
          },
        });
        if (existingCommitWT) {
          await tx.walletTransaction.update({
            where: { id: existingCommitWT.id },
            data: { amount: { decrement: payload.amount } },
          });
        } else {
          await tx.walletTransaction.create({
            data: {
              walletId: user.wallet!.id,
              type: "POSITION_COMMITMENT",
              amount: -payload.amount,
              description: `Multi-choice stake on market option`,
              marketId: market.id,
              multiChoicePositionId: positionId,
            }
          });
        }

        await tx.marketOption.update({
          where: { id: payload.optionId },
          data: { totalStaked: { increment: payload.amount } }
        });

        await tx.market.update({
          where: { id: market.id },
          data: { totalVolume: { increment: payload.amount } }
        });
      }

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
