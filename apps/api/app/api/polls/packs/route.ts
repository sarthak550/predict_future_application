/**
 * GET /api/polls/packs
 *
 * List NEW Poll-model polls (the lightweight free-vote prediction system — e.g. the
 * RBI MPC packs). Kept on a distinct path from the legacy `/api/polls` (which still
 * serves the Market-based news polls) until those are migrated in Phase 2.
 *
 * Returns each poll with options + per-option vote counts. Mobile groups by `packId`.
 * Public — no auth required.
 *
 * Query parameters:
 *   packId?  string  — restrict to polls sharing this packId
 *   status?  "open" | "closed" | "resolved" | "all"  — default: "open"
 *
 * Response 200: { polls: ApiPoll[] }
 */

import { PollStatus } from "@prisma/client";
import { NextResponse } from "next/server";

import { prisma } from "@/lib/prisma";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);

  const packId = searchParams.get("packId") ?? undefined;
  const rawStatus = (searchParams.get("status") ?? "open").toLowerCase();

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
    },
    orderBy: [{ eventAt: "asc" }, { createdAt: "desc" }],
    take: 100,
  });

  return NextResponse.json({
    polls: polls.map((poll) => ({
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
    })),
  });
}
