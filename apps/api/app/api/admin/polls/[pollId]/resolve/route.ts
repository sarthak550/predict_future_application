/**
 * POST /api/admin/polls/[pollId]/resolve
 *
 * Admin/Moderator endpoint to resolve a single Poll.
 *
 * Steps performed atomically:
 *   1. Validates the poll exists and has not already been resolved (idempotent).
 *   2. Validates that winningOptionId belongs to the poll.
 *   3. Sets Poll.winningOptionId, Poll.status = RESOLVED, Poll.resolvedAt.
 *   4. Sets PollVote.isCorrect for every vote on this poll
 *      (true where optionId === winningOptionId, false otherwise).
 *   5. After the transaction, calls refreshPollAccuracy() for each distinct voter.
 *
 * The RBI MPC pack has two polls — admin calls this endpoint once per poll,
 * supplying the winning option for each independently.
 *
 * Request body:
 * { winningOptionId: string }
 *
 * Response 200:
 * {
 *   ok: true,
 *   pollId: string,
 *   winningOptionId: string,
 *   votersUpdated: number,
 * }
 */

import { PollStatus } from "@prisma/client";
import { NextResponse } from "next/server";

import { getUserIdFromRequest } from "@/lib/auth";
import { refreshPollAccuracy } from "@/lib/polls/accuracy";
import { prisma } from "@/lib/prisma";

// ---------------------------------------------------------------------------
// Auth helper
// ---------------------------------------------------------------------------

async function requireAdminActor(request: Request) {
  const userId = await getUserIdFromRequest(request);
  if (!userId) {
    return {
      actor: null,
      error: NextResponse.json(
        { error: "Authentication required." },
        { status: 401 }
      ),
    };
  }

  const actor = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, role: true, isSuspended: true },
  });

  if (!actor || actor.isSuspended) {
    return {
      actor: null,
      error: NextResponse.json(
        { error: "Account cannot perform this action." },
        { status: 403 }
      ),
    };
  }

  if (actor.role !== "ADMIN" && actor.role !== "MODERATOR") {
    return {
      actor: null,
      error: NextResponse.json(
        { error: "Admin access required." },
        { status: 403 }
      ),
    };
  }

  return { actor, error: null };
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

interface ResolveBody {
  winningOptionId?: unknown;
}

export async function POST(
  request: Request,
  { params }: { params: { pollId: string } }
) {
  const { error } = await requireAdminActor(request);
  if (error) return error;

  const { pollId } = params;

  // ---- Parse body ---------------------------------------------------------

  let body: ResolveBody;
  try {
    body = (await request.json()) as ResolveBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  if (typeof body.winningOptionId !== "string" || !body.winningOptionId.trim()) {
    return NextResponse.json(
      { error: "winningOptionId is required." },
      { status: 400 }
    );
  }
  const winningOptionId = body.winningOptionId.trim();

  // ---- Load poll ----------------------------------------------------------

  const poll = await prisma.poll.findUnique({
    where: { id: pollId },
    select: {
      id: true,
      status: true,
      winningOptionId: true,
      options: { select: { id: true } },
    },
  });

  if (!poll) {
    return NextResponse.json({ error: "Poll not found." }, { status: 404 });
  }

  // ---- Idempotency guard --------------------------------------------------

  if (poll.status === PollStatus.RESOLVED) {
    return NextResponse.json({
      ok: true,
      pollId,
      winningOptionId: poll.winningOptionId,
      votersUpdated: 0,
      note: "Poll was already resolved — no changes made.",
    });
  }

  // ---- Validate winning option --------------------------------------------

  const optionBelongsToPoll = poll.options.some((opt) => opt.id === winningOptionId);
  if (!optionBelongsToPoll) {
    return NextResponse.json(
      { error: "winningOptionId does not belong to this poll." },
      { status: 400 }
    );
  }

  // ---- Resolve atomically -------------------------------------------------

  let distinctVoterIds: string[] = [];

  try {
    const resolvedAt = new Date();

    await prisma.$transaction(async (tx) => {
      // 1. Resolve the poll itself.
      await tx.poll.update({
        where: { id: pollId },
        data: {
          status: PollStatus.RESOLVED,
          winningOptionId,
          resolvedAt,
        },
      });

      // 2. Mark all votes as correct or incorrect.
      //    Two targeted updateMany calls — avoids a row-by-row loop.
      await tx.pollVote.updateMany({
        where: { pollId, optionId: winningOptionId },
        data: { isCorrect: true },
      });

      await tx.pollVote.updateMany({
        where: { pollId, optionId: { not: winningOptionId } },
        data: { isCorrect: false },
      });
    });

    // 3. Collect distinct voters to refresh accuracy stats.
    const votes = await prisma.pollVote.findMany({
      where: { pollId },
      select: { userId: true },
    });
    distinctVoterIds = [...new Set(votes.map((v) => v.userId))];
  } catch (err) {
    console.error("[admin/polls/[pollId]/resolve POST]", err);
    return NextResponse.json(
      { error: "Failed to resolve poll." },
      { status: 500 }
    );
  }

  // ---- Refresh accuracy for each voter (outside the transaction) ----------
  // Failures here are logged but do not fail the HTTP response — the poll
  // is already resolved and votes are marked; stats are eventually consistent.

  await Promise.allSettled(
    distinctVoterIds.map((uid) =>
      refreshPollAccuracy(uid).catch((err) =>
        console.error(`[resolve poll] refreshPollAccuracy failed for ${uid}`, err)
      )
    )
  );

  return NextResponse.json({
    ok: true,
    pollId,
    winningOptionId,
    votersUpdated: distinctVoterIds.length,
  });
}
