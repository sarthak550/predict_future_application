import { NextResponse } from "next/server";

import { prisma } from "@/lib/prisma";

/**
 * POST /api/markets/[marketId]/big-call-tap
 *
 * Lightweight analytics endpoint — increments bigCallNotificationOpenedCount.
 * No auth required. Fire-and-forget from the mobile client on Big Call card tap.
 * Returns: { count: number }
 */
export async function POST(
  _request: Request,
  { params }: { params: { marketId: string } }
) {
  try {
    const updated = await prisma.market.update({
      where: { id: params.marketId },
      data: { bigCallNotificationOpenedCount: { increment: 1 } },
      select: { bigCallNotificationOpenedCount: true },
    });
    return NextResponse.json({ count: updated.bigCallNotificationOpenedCount });
  } catch (error) {
    console.error("[big-call-tap]", error);
    // Return 200 even on error — analytics must never block the user
    return NextResponse.json({ count: 0 });
  }
}
