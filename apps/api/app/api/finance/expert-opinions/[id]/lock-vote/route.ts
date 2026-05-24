import { NextResponse } from "next/server";
import { getUserIdFromRequest } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { buildTalliesResponse } from "@/lib/finance/tallies";

/**
 * POST /api/finance/expert-opinions/[id]/lock-vote
 *
 * Locks the authenticated user's IMPLICATION vote on this opinion.
 * Locking is one-way — once locked the vote cannot be changed. Only locked
 * votes count toward accuracy / leaderboard.
 *
 * Returns the updated tallies so the client can re-render immediately.
 */
export async function POST(
  request: Request,
  { params }: { params: { id: string } }
) {
  const userId = await getUserIdFromRequest(request);
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Verify the vote exists first — must have cast before locking.
  const existing = await prisma.expertOpinionVote.findUnique({
    where: {
      userId_opinionId_pollType: {
        userId,
        opinionId: params.id,
        pollType: "IMPLICATION",
      },
    },
    select: { id: true },
  });

  if (!existing) {
    return NextResponse.json(
      { error: "Cast a vote before locking it." },
      { status: 400 }
    );
  }

  // Atomic conditional update: only succeeds when the vote is not yet locked
  // AND the opinion is still PENDING. Guards against concurrent admin resolve.
  // Prisma's updateMany does not support nested relation filters directly, so
  // we use a transaction to re-read the opinion status atomically.
  let locked = false;
  try {
    await prisma.$transaction(async (tx) => {
      const opinion = await tx.expertOpinion.findUnique({
        where: { id: params.id },
        select: { resolutionStatus: true },
      });
      if (!opinion) throw new Error("NOT_FOUND");
      if (opinion.resolutionStatus !== "PENDING") throw new Error("RESOLVED");

      const result = await tx.expertOpinionVote.updateMany({
        where: { id: existing.id, lockedAt: null },
        data: { lockedAt: new Date() },
      });
      locked = result.count > 0;
    });
  } catch (err) {
    if (err instanceof Error) {
      if (err.message === "NOT_FOUND") {
        return NextResponse.json({ error: "Opinion not found." }, { status: 404 });
      }
      if (err.message === "RESOLVED") {
        return NextResponse.json(
          { error: "Vote cannot be locked (opinion has already resolved)." },
          { status: 409 }
        );
      }
    }
    console.error("[lock-vote] transaction error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }

  if (!locked) {
    // updateMany matched 0 rows — vote was already locked by a concurrent request.
    return NextResponse.json(
      { error: "Vote cannot be locked (already locked or opinion resolved)." },
      { status: 409 }
    );
  }

  const tallies = await buildTalliesResponse(params.id, userId);
  return NextResponse.json(tallies);
}
