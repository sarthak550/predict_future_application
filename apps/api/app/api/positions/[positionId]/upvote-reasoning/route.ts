/**
 * POST /api/positions/[positionId]/upvote-reasoning
 *
 * Toggle reasoning upvote on a position.
 * - Cannot upvote your own position (403).
 * - If already upvoted: removes the upvote, decrements MarketPosition.reasoningUpvotes.
 * - If not upvoted: creates the upvote, increments MarketPosition.reasoningUpvotes.
 * - Uses atomic Prisma increment/decrement to avoid read-modify-write races under
 *   READ COMMITTED isolation. The @@unique([positionId, userId]) constraint on
 *   ReasoningUpvote already prevents the same user voting twice.
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
    select: { id: true, userId: true, reasoning: true },
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
  // Atomic increment/decrement avoids the read-modify-write race where two concurrent
  // upvotes from different users both read count=N and both write count=N+1 (last-writer-wins).
  // Postgres evaluates SET col = col + 1 atomically — no JS-side arithmetic on the counter.
  const result = await prisma.$transaction(async (tx) => {
    // Try to remove an existing upvote first.
    const deleted = await tx.reasoningUpvote.deleteMany({
      where: { positionId, userId },
    });

    const upvoted = deleted.count === 0;

    if (!upvoted) {
      // Upvote row removed — decrement counter atomically.
      const updated = await tx.marketPosition.update({
        where: { id: positionId },
        data: { reasoningUpvotes: { decrement: 1 } },
        select: { reasoningUpvotes: true },
      });
      return { upvoted: false, count: Math.max(0, updated.reasoningUpvotes) };
    }

    // Not previously upvoted — create row, then increment counter atomically.
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
