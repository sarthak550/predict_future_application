import { NextResponse } from "next/server";
import { z } from "zod";

import { getUserIdFromRequest } from "@/lib/auth";
import { createNotification } from "@/lib/notifications";
import { prisma } from "@/lib/prisma";
import { getIstDateString } from "@/lib/quests/engine";

const TIP_DAILY_CAP = 50;
const TIP_DEFAULT_AMOUNT = 5;
const TIP_MIN = 1;
const TIP_MAX = 50;

const tipSchema = z.object({
  amount: z
    .number()
    .int()
    .min(TIP_MIN, `Minimum tip is ${TIP_MIN} pts`)
    .max(TIP_MAX, `Maximum tip is ${TIP_MAX} pts`)
    .optional()
});

/**
 * Returns UTC Date boundaries for the current IST calendar day.
 * IST = UTC+5:30, so IST midnight is UTC midnight minus 5h30m.
 */
function getIstDayBoundsUtc(now?: Date): { startOfDayUtc: Date; endOfDayUtc: Date } {
  const istDateStr = getIstDateString(now);
  const parts = istDateStr.split("-").map(Number) as [number, number, number];
  const [yyyy, mm, dd] = parts;
  const istOffsetMs = 5.5 * 60 * 60 * 1000;
  const startOfDayUtc = new Date(Date.UTC(yyyy, mm - 1, dd) - istOffsetMs);
  const endOfDayUtc = new Date(startOfDayUtc.getTime() + 24 * 60 * 60 * 1000);
  return { startOfDayUtc, endOfDayUtc };
}

export async function POST(
  request: Request,
  { params }: { params: { commentId: string } }
) {
  try {
    const requestingUserId = await getUserIdFromRequest(request);
    if (!requestingUserId) {
      return NextResponse.json({ error: "Authentication required." }, { status: 401 });
    }

    const rawBody = await request.json() as unknown;
    const parsed = tipSchema.safeParse(rawBody);
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.errors[0]?.message ?? "Invalid request body." },
        { status: 400 }
      );
    }

    const amount = parsed.data.amount ?? TIP_DEFAULT_AMOUNT;

    // Fetch comment with market and author info
    const comment = await prisma.marketComment.findUnique({
      where: { id: params.commentId },
      select: {
        id: true,
        userId: true,
        tipsReceived: true,
        market: {
          select: { id: true, title: true }
        },
        user: {
          select: { id: true, username: true }
        }
      }
    });

    if (!comment) {
      return NextResponse.json({ error: "Comment not found." }, { status: 404 });
    }

    // Cannot tip own comment
    if (comment.userId === requestingUserId) {
      return NextResponse.json(
        { error: "You cannot tip your own comment." },
        { status: 400 }
      );
    }

    // Fetch tipper info (username for notification, wallet for balance)
    const [tipper, tipperWallet] = await Promise.all([
      prisma.user.findUnique({
        where: { id: requestingUserId },
        select: { id: true, username: true }
      }),
      prisma.wallet.findUnique({
        where: { userId: requestingUserId },
        select: { id: true, balance: true }
      })
    ]);

    if (!tipper) {
      return NextResponse.json({ error: "Tipper account not found." }, { status: 404 });
    }

    if (!tipperWallet) {
      return NextResponse.json({ error: "Wallet not found." }, { status: 400 });
    }

    // Check tipper wallet balance (fast-fail UX optimisation — transaction enforces this too)
    if (tipperWallet.balance < amount) {
      return NextResponse.json(
        { error: "Insufficient balance." },
        { status: 400 }
      );
    }

    // Fetch commenter wallet
    const commenterWallet = await prisma.wallet.findUnique({
      where: { userId: comment.userId },
      select: { id: true }
    });

    if (!commenterWallet) {
      return NextResponse.json({ error: "Recipient wallet not found." }, { status: 400 });
    }

    // Compute IST day bounds outside the transaction (pure function, no DB hit)
    const { startOfDayUtc, endOfDayUtc } = getIstDayBoundsUtc();

    // Execute tip in a single transaction — daily-cap check is the FIRST step so concurrent
    // requests cannot both pass the cap before either TIP_GIVEN row is committed.
    type TxResult = { newTipsReceived: number; alreadyGivenToday: number };
    let txResult: TxResult;
    try {
      txResult = await prisma.$transaction(async (tx): Promise<TxResult> => {
        // 1. Daily cap check (serialised inside the transaction)
        const dailyTipAggregate = await tx.walletTransaction.aggregate({
          where: {
            wallet: { userId: requestingUserId },
            type: "TIP_GIVEN",
            createdAt: { gte: startOfDayUtc, lt: endOfDayUtc }
          },
          _sum: { amount: true }
        });

        // TIP_GIVEN amounts are stored as negative values (debit)
        const givenToday = Math.abs(dailyTipAggregate._sum.amount ?? 0);

        if (givenToday + amount > TIP_DAILY_CAP) {
          throw Object.assign(new Error("CAP_EXCEEDED"), {
            code: "CAP_EXCEEDED",
            remaining: TIP_DAILY_CAP - givenToday
          });
        }

        // 2. Deduct from tipper wallet
        await tx.wallet.update({
          where: { id: tipperWallet.id },
          data: { balance: { decrement: amount } }
        });

        await tx.walletTransaction.create({
          data: {
            walletId: tipperWallet.id,
            type: "TIP_GIVEN",
            amount: -amount,
            description: `Tipped @${comment.user.username}'s comment on "${comment.market.title}"`,
            marketId: comment.market.id
          }
        });

        // Credit to commenter wallet
        await tx.wallet.update({
          where: { id: commenterWallet.id },
          data: { balance: { increment: amount } }
        });

        await tx.walletTransaction.create({
          data: {
            walletId: commenterWallet.id,
            type: "TIP_RECEIVED",
            amount: amount,
            description: `Tip from @${tipper.username} on "${comment.market.title}"`,
            marketId: comment.market.id
          }
        });

        // Increment comment tip total
        const updatedComment = await tx.marketComment.update({
          where: { id: comment.id },
          data: { tipsReceived: { increment: amount } },
          select: { tipsReceived: true }
        });

        // Increment user lifetime tip total
        await tx.user.update({
          where: { id: comment.userId },
          data: { tipsReceivedTotal: { increment: amount } }
        });

        // In-transaction notification (non-critical, wrapped in try/catch per systemic rule)
        try {
          await createNotification(tx, {
            userId: comment.userId,
            type: "COMMENT_TIPPED",
            title: `@${tipper.username} tipped your comment`,
            body: `+${amount} pts on your comment on "${comment.market.title}"`,
            href: `/market/${comment.market.id}`,
            marketId: comment.market.id
          });
        } catch (notifErr) {
          console.error("[tipComment] notification creation failed:", notifErr);
        }

        return { newTipsReceived: updatedComment.tipsReceived, alreadyGivenToday: givenToday };
      });
    } catch (txError) {
      const err = txError as { code?: string; remaining?: number };
      if (err.code === "CAP_EXCEEDED") {
        return NextResponse.json(
          { error: "Daily tip cap exceeded", dailyTipsRemaining: err.remaining ?? 0 },
          { status: 429 }
        );
      }
      throw txError;
    }

    const newDailyGiven = txResult.alreadyGivenToday + amount;
    const newDailyRemaining = Math.max(0, TIP_DAILY_CAP - newDailyGiven);

    return NextResponse.json({
      ok: true,
      newTipsReceived: txResult.newTipsReceived,
      dailyTipsRemaining: newDailyRemaining
    });
  } catch (error) {
    console.error("[POST /api/comments/[commentId]/tip]", error);
    return NextResponse.json({ error: "Failed to process tip." }, { status: 500 });
  }
}
