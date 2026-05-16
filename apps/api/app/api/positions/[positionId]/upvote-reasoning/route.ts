/**
 * POST /api/positions/[positionId]/upvote-reasoning
 *
 * Toggle reasoning upvote on a position.
 * - Cannot upvote your own position (403).
 * - If already upvoted: removes the upvote, decrements MarketPosition.reasoningUpvotes.
 * - If not upvoted: creates the upvote, increments MarketPosition.reasoningUpvotes.
 * - Wrapped in a transaction for atomicity.
 *
 * Returns: { upvoted: boolean; count: number }
 */

import { NextResponse } from "next/server";

import { getUserIdFromRequest } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function POST(
  request: Request,
  { params }: { params: { positionId: string } }
) {
  const userId = await getUserIdFromRequest(request);
  if (!userId) {
    return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  }

  const { positionId } = params;

  // Fetch the position to validate it exists and that the user isn't upvoting themselves.
  const position = await prisma.marketPosition.findUnique({
    where: { id: positionId },
    select: { id: true, userId: true, reasoning: true, reasoningUpvotes: true },
  });

  if (!position) {
    return NextResponse.json({ error: "Position not found." }, { status: 404 });
  }

  if (position.userId === userId) {
    return NextResponse.json(
      { error: "Cannot upvote your own reasoning." },
      { status: 403 }
    );
  }

  // Toggle inside a transaction.
  const result = await prisma.$transaction(async (tx) => {
    // Try to remove an existing upvote first.
    const deleted = await tx.reasoningUpvote.deleteMany({
      where: { positionId, userId },
    });

    if (deleted.count > 0) {
      // Was upvoted — now removed. Decrement counter.
      const updated = await tx.marketPosition.update({
        where: { id: positionId },
        data: { reasoningUpvotes: { decrement: 1 } },
        select: { reasoningUpvotes: true },
      });
      return { upvoted: false, count: Math.max(0, updated.reasoningUpvotes) };
    }

    // Not previously upvoted — create and increment.
    await tx.reasoningUpvote.create({
      data: { positionId, userId },
    });
    const updated = await tx.marketPosition.update({
      where: { id: positionId },
      data: { reasoningUpvotes: { increment: 1 } },
      select: { reasoningUpvotes: true },
    });
    return { upvoted: true, count: updated.reasoningUpvotes };
  });

  return NextResponse.json(result);
}
