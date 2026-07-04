/**
 * GET /api/polls/packs
 *
 * List NEW Poll-model polls (the lightweight free-vote prediction system — e.g. the
 * RBI MPC packs). Kept on a distinct path from the legacy `/api/polls` (which still
 * serves the Market-based news polls) until those are migrated in Phase 2.
 *
 * Returns each poll with options + per-option vote counts. Mobile groups by `packId`.
 * Auth optional — when authenticated, each poll includes `userVote` so the mobile
 * client can lock MpcOptionChips without a per-poll detail fetch.
 *
 * Query parameters:
 *   packId?  string  — restrict to polls sharing this packId
 *   status?  "open" | "closed" | "resolved" | "all"  — default: "open"
 *
 * Response 200: { polls: ApiPoll[] }
 */

import { PollStatus } from "@prisma/client";
import { NextResponse } from "next/server";

import { getUserIdFromRequest } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);

  const packId = searchParams.get("packId") ?? undefined;
  const rawStatus = (searchParams.get("status") ?? "open").toLowerCase();

  // Auth is optional — we use userId only to attach the caller's vote per poll.
  const userId = (await getUserIdFromRequest(request)) ?? null;

  let statusFilter: { status?: PollStatus | { in: PollStatus[] } } = {
    status: PollStatus.OPEN,
  };
  if (rawStatus === "closed") {
    statusFilter = { status: PollStatus.CLOSED };
  } else if (rawStatus === "resolved") {
    statusFilter = { status: PollStatus.RESOLVED };
  } else if (rawStatus === "all") {
    statusFilter = {};
  }

  const polls = await prisma.poll.findMany({
    where: {
      ...(packId ? { packId } : {}),
      ...statusFilter,
    },
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
      // Left-join the calling user's vote so mobile can lock chips immediately.
      ...(userId !== null
        ? {
            votes: {
              where: { userId },
              select: { optionId: true, lockedAt: true },
              take: 1,
            },
          }
        : {}),
    },
    orderBy: [{ eventAt: "asc" }, { createdAt: "desc" }],
    take: 100,
  });

  return NextResponse.json({
    polls: polls.map((poll) => {
      const rawVotes = (poll as typeof poll & { votes?: { optionId: string; lockedAt: Date | null }[] }).votes;
      const myVote = rawVotes && rawVotes.length > 0 ? rawVotes[0] : null;
      return {
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
        userVote: myVote
          ? { optionId: myVote.optionId, lockedAt: myVote.lockedAt?.toISOString() ?? null }
          : null,
      };
    }),
  });
}
