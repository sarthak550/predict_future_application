import { NextResponse } from "next/server";

import { getUserIdFromRequest } from "@/lib/auth";
import { getIstDateString } from "@/lib/quests/engine";
import { prisma } from "@/lib/prisma";

/**
 * POST /api/markets/[marketId]/big-call-tap
 *
 * Analytics endpoint — increments bigCallNotificationOpenedCount for the Big Call card.
 * Auth required to prevent anonymous engagement inflation.
 * Idempotent per (userId, marketId, IST calendar day) — a user tapping the same
 * card multiple times on the same day only counts once.
 *
 * Returns: { count: number; alreadyTapped: boolean }
 */
export async function POST(
  request: Request,
  { params }: { params: { marketId: string } }
) {
  const userId = await getUserIdFromRequest(request);
  if (!userId) {
    return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  }

  const dateIST = getIstDateString();

  try {
    // Attempt to record the tap — unique constraint (userId, marketId, dateIST) enforces idempotency.
    await prisma.bigCallTap.create({
      data: {
        userId,
        marketId: params.marketId,
        dateIST,
      },
    });
  } catch (err: unknown) {
    // Unique constraint violation = user already tapped today. Return current count without incrementing.
    const isUniqueViolation =
      err instanceof Error &&
      (err.message.includes("Unique constraint") ||
        (err as { code?: string }).code === "P2002");

    if (isUniqueViolation) {
      const market = await prisma.market.findUnique({
        where: { id: params.marketId },
        select: { bigCallNotificationOpenedCount: true },
      });
      return NextResponse.json({
        count: market?.bigCallNotificationOpenedCount ?? 0,
        alreadyTapped: true,
      });
    }

    // Market not found or other DB error — log but don't block the user.
    console.error("[big-call-tap]", err);
    return NextResponse.json({ count: 0, alreadyTapped: false });
  }

  // Fresh tap — increment the market counter.
  try {
    const updated = await prisma.market.update({
      where: { id: params.marketId },
      data: { bigCallNotificationOpenedCount: { increment: 1 } },
      select: { bigCallNotificationOpenedCount: true },
    });
    return NextResponse.json({
      count: updated.bigCallNotificationOpenedCount,
      alreadyTapped: false,
    });
  } catch (error) {
    console.error("[big-call-tap] market update error:", error);
    // BigCallTap row was created but market update failed — analytics is fire-and-forget, return 200.
    return NextResponse.json({ count: 0, alreadyTapped: false });
  }
}
