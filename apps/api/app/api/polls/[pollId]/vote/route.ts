/**
 * POST /api/polls/[pollId]/vote
 *
 * Cast or update a free-vote prediction on a Poll.
 *
 * Business rules:
 *   - Authentication required.
 *   - The poll must be OPEN and not past its closeAt time.
 *   - The supplied optionId must belong to this poll.
 *   - One prediction per user per poll (@@unique([pollId, userId])).
 *     Upsert semantics: the caller may change their pick while the poll
 *     is still OPEN. `lockedAt` is reset on every upsert.
 *   - No amount/stake/wallet operations — free-vote only.
 *
 * Request body:
 * { optionId: string }
 *
 * Response 200:
 * {
 *   ok: true,
 *   userVote: { optionId: string; lockedAt: string },
 *   options: Array<{ id: string; label: string; sortOrder: number; voteCount: number }>,
 *   totalVotes: number,
 * }
 */

import { PollStatus } from "@prisma/client";
import { NextResponse } from "next/server";

import { getUserIdFromRequest } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

interface VoteBody {
  optionId?: unknown;
}

export async function POST(
  request: Request,
  { params }: { params: { pollId: string } }
) {
  // ---- Auth ---------------------------------------------------------------

  const userId = await getUserIdFromRequest(request);
  if (!userId) {
    return NextResponse.json(
      { error: "Authentication required." },
      { status: 401 }
    );
  }

  const { pollId } = params;

  // ---- Parse body ---------------------------------------------------------

  let body: VoteBody;
  try {
    body = (await request.json()) as VoteBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  if (typeof body.optionId !== "string" || !body.optionId.trim()) {
    return NextResponse.json(
      { error: "optionId is required." },
      { status: 400 }
    );
  }
  const optionId = body.optionId.trim();

  // ---- Load poll with options ---------------------------------------------

  const poll = await prisma.poll.findUnique({
    where: { id: pollId },
    select: {
      id: true,
      status: true,
      closeAt: true,
      options: {
        select: { id: true },
      },
    },
  });

  if (!poll) {
    return NextResponse.json({ error: "Poll not found." }, { status: 404 });
  }

  // ---- Validate poll is votable -------------------------------------------

  if (poll.status !== PollStatus.OPEN) {
    return NextResponse.json(
      { error: "This poll is not open for predictions." },
      { status: 409 }
    );
  }

  if (poll.closeAt <= new Date()) {
    return NextResponse.json(
      { error: "This poll has closed and is no longer accepting predictions." },
      { status: 409 }
    );
  }

  // ---- Validate option belongs to this poll -------------------------------

  const optionBelongsToPoll = poll.options.some((opt) => opt.id === optionId);
  if (!optionBelongsToPoll) {
    return NextResponse.json(
      { error: "The supplied optionId does not belong to this poll." },
      { status: 400 }
    );
  }

  // ---- Upsert vote --------------------------------------------------------

  const lockedAt = new Date();

  await prisma.pollVote.upsert({
    where: { pollId_userId: { pollId, userId } },
    update: { optionId, lockedAt },
    create: { pollId, userId, optionId, lockedAt },
  });

  // ---- Return fresh tallies -----------------------------------------------

  const updatedOptions = await prisma.pollOption.findMany({
    where: { pollId },
    select: {
      id: true,
      label: true,
      sortOrder: true,
      _count: { select: { votes: true } },
    },
    orderBy: { sortOrder: "asc" },
  });

  const options = updatedOptions.map((opt) => ({
    id: opt.id,
    label: opt.label,
    sortOrder: opt.sortOrder,
    voteCount: opt._count.votes,
  }));

  return NextResponse.json({
    ok: true,
    userVote: { optionId, lockedAt: lockedAt.toISOString() },
    options,
    totalVotes: options.reduce((sum, o) => sum + o.voteCount, 0),
  });
}
