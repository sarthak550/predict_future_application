import { NextResponse } from "next/server";

import { getUserIdFromRequest } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

/**
 * POST /api/markets/[marketId]/save
 *
 * Idempotent toggle: if the market is already saved, unsave it; otherwise save it.
 * Returns { saved: boolean }.
 */
export async function POST(
  request: Request,
  { params }: { params: { marketId: string } }
) {
  const userId = await getUserIdFromRequest(request).catch(() => null);
  if (!userId) {
    return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  }

  const { marketId } = params;

  // Verify the market exists and is publicly accessible.
  const market = await prisma.market.findFirst({
    where: {
      id: marketId,
      visibility: "PUBLIC",
      status: { notIn: ["DRAFT", "PENDING_REVIEW", "REJECTED", "HOST_TIMEOUT"] },
    },
    select: { id: true },
  });

  if (!market) {
    return NextResponse.json({ error: "Market not found." }, { status: 404 });
  }

  // Check if already saved
  const existing = await prisma.savedMarket.findUnique({
    where: { userId_marketId: { userId, marketId } },
    select: { id: true },
  });

  if (existing) {
    // Already saved — toggle off (unsave)
    await prisma.savedMarket.delete({
      where: { userId_marketId: { userId, marketId } },
    });
    return NextResponse.json({ saved: false });
  }

  // Not yet saved — save it
  await prisma.savedMarket.create({
    data: { userId, marketId },
  });

  return NextResponse.json({ saved: true });
}
