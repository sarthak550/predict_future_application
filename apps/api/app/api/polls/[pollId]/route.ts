/**
 * GET /api/polls/[pollId]
 *
 * Fetch a single poll with:
 *   - All options and per-option vote counts
 *   - The calling user's existing PollVote (if authenticated)
 *
 * Auth: optional — unauthenticated callers receive the poll without `userVote`.
 *
 * Response 200:
 * {
 *   poll: ApiPollDetail
 * }
 */

import { NextResponse } from "next/server";

import { getUserIdFromRequest } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function GET(
  request: Request,
  { params }: { params: { pollId: string } }
) {
  const { pollId } = params;
  const userId = (await getUserIdFromRequest(request)) ?? null;

  const poll = await prisma.poll.findUnique({
    where: { id: pollId },
    select: {
      id: true,
      question: true,
      description: true,
      category: true,
      status: true,
      closeAt: true,
      eventAt: true,
      packId: true,
      structuredData: true,
      winningOptionId: true,
      resolvedAt: true,
      createdAt: true,
      options: {
        select: {
          id: true,
          label: true,
          sortOrder: true,
          _count: { select: { votes: true } },
        },
        orderBy: { sortOrder: "asc" },
      },
    },
  });

  if (!poll) {
    return NextResponse.json({ error: "Poll not found." }, { status: 404 });
  }

  // Fetch the calling user's vote for this poll, if any.
  const userVote =
    userId !== null
      ? await prisma.pollVote.findUnique({
          where: { pollId_userId: { pollId, userId } },
          select: { optionId: true, lockedAt: true, createdAt: true },
        })
      : null;

  return NextResponse.json({
    poll: {
      id: poll.id,
      question: poll.question,
      description: poll.description ?? null,
      category: poll.category,
      status: poll.status,
      closeAt: poll.closeAt.toISOString(),
      eventAt: poll.eventAt?.toISOString() ?? null,
      packId: poll.packId ?? null,
      structuredData: (poll.structuredData as Record<string, unknown>) ?? null,
      winningOptionId: poll.winningOptionId ?? null,
      resolvedAt: poll.resolvedAt?.toISOString() ?? null,
      createdAt: poll.createdAt.toISOString(),
      options: poll.options.map((opt) => ({
        id: opt.id,
        label: opt.label,
        sortOrder: opt.sortOrder,
        voteCount: opt._count.votes,
      })),
      totalVotes: poll.options.reduce((sum, opt) => sum + opt._count.votes, 0),
      userVote: userVote
        ? {
            optionId: userVote.optionId,
            lockedAt: userVote.lockedAt?.toISOString() ?? null,
            createdAt: userVote.createdAt.toISOString(),
          }
        : null,
    },
  });
}
