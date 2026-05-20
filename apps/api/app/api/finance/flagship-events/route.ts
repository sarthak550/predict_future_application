import { NextResponse } from "next/server";

import { prisma } from "@/lib/prisma";

/**
 * GET /api/finance/flagship-events
 *
 * Public endpoint — no auth required.
 * Returns OPEN markets with flagshipEventAt set in the future,
 * ordered by flagshipEventAt ASC, limit 10.
 *
 * Each market includes:
 *   - Standard summary fields
 *   - flagshipEventAt / flagshipEventType
 *   - crowdProbability: computed from all positions/votes
 *   - expertProbability: computed from verified analysts only (null if < 3 experts)
 */
export async function GET() {
  const now = new Date();

  const markets = await prisma.market.findMany({
    where: {
      status: "OPEN",
      flagshipEventAt: { not: null, gt: now },
    },
    orderBy: { flagshipEventAt: "asc" },
    take: 10,
    include: {
      creator: {
        select: {
          id: true,
          username: true,
          displayMode: true,
          isVerifiedAnalyst: true,
          analystTier: true,
        },
      },
      options: {
        select: { id: true, label: true, sortOrder: true, totalStaked: true, isWinner: true },
        orderBy: { sortOrder: "asc" },
      },
      positions: {
        select: {
          side: true,
          amount: true,
          user: {
            select: {
              isVerifiedAnalyst: true,
              analystTier: true,
            },
          },
        },
      },
      multiChoicePositions: {
        select: {
          optionId: true,
          amount: true,
          user: {
            select: {
              isVerifiedAnalyst: true,
              analystTier: true,
            },
          },
        },
      },
      _count: { select: { comments: true } },
    },
  });

  const results = markets.map((market) => {
    const crowdProbability = computeCrowdProbability(market);
    const expertResult = computeExpertProbability(market);
    const expertProbability = expertResult?.probs ?? null;
    const expertCount = expertResult?.count ?? 0;

    return {
      id: market.id,
      slug: market.slug,
      title: market.title,
      description: market.description,
      category: market.category,
      status: market.status,
      marketType: market.marketType,
      closeAt: market.closeAt?.toISOString() ?? null,
      resolveAt: market.resolveAt?.toISOString() ?? null,
      yesPool: market.yesPool,
      noPool: market.noPool,
      totalVolume: market.totalVolume,
      totalParticipants: market.totalParticipants,
      yesCount: market.yesCount,
      noCount: market.noCount,
      totalVotes: market.totalVotes,
      creator: market.creator
        ? {
            username:
              market.creator.displayMode === "ANONYMOUS"
                ? `Analyst_${market.creator.id.slice(-6)}`
                : market.creator.username,
            isVerifiedAnalyst: market.creator.isVerifiedAnalyst,
          }
        : null,
      options: market.options,
      _count: market._count,
      flagshipEventAt: market.flagshipEventAt?.toISOString() ?? null,
      flagshipEventType: market.flagshipEventType ?? null,
      crowdProbability,
      expertProbability,
      expertCount,
    };
  });

  return NextResponse.json({ events: results });
}

// ---------------------------------------------------------------------------
// Probability helpers
// ---------------------------------------------------------------------------

type PositionRow = {
  side: string | null;
  amount: number;
  user: { isVerifiedAnalyst: boolean; analystTier: string };
};

type MultiRow = {
  optionId: string;
  amount: number;
  user: { isVerifiedAnalyst: boolean; analystTier: string };
};

type IncludedMarket = Awaited<ReturnType<typeof prisma.market.findMany>>[number] & {
  positions: PositionRow[];
  multiChoicePositions: MultiRow[];
  options: Array<{ id: string; label: string; sortOrder: number; totalStaked: number; isWinner: boolean }>;
};

function isExpertUser(user: { isVerifiedAnalyst: boolean; analystTier: string }): boolean {
  return (
    user.isVerifiedAnalyst ||
    user.analystTier === "ANALYST" ||
    user.analystTier === "SENIOR_ANALYST" ||
    user.analystTier === "CHIEF_ANALYST"
  );
}

// Flagship polls use free votes (amount=0) — so we count POSITION OCCURRENCES, not amount sums.

function computeCrowdProbability(
  market: IncludedMarket
): Record<string, number> | null {
  if (market.marketType === "BINARY") {
    const positions = market.positions;
    if (positions.length === 0) return null;
    let yesCount = 0;
    let noCount = 0;
    for (const pos of positions) {
      if (pos.side === "YES") yesCount++;
      else if (pos.side === "NO") noCount++;
    }
    const total = yesCount + noCount;
    if (total === 0) return null;
    return {
      YES: parseFloat((yesCount / total).toFixed(3)),
      NO: parseFloat((noCount / total).toFixed(3)),
    };
  }

  if (market.marketType === "MULTIPLE_CHOICE") {
    const positions = market.multiChoicePositions;
    if (positions.length === 0) return null;
    const counts: Record<string, number> = {};
    for (const pos of positions) {
      counts[pos.optionId] = (counts[pos.optionId] ?? 0) + 1;
    }
    const result: Record<string, number> = {};
    for (const [optId, count] of Object.entries(counts)) {
      result[optId] = parseFloat((count / positions.length).toFixed(3));
    }
    return result;
  }

  return null;
}

function computeExpertProbability(
  market: IncludedMarket
): { probs: Record<string, number>; count: number } | null {
  if (market.marketType === "BINARY") {
    const expertPositions = market.positions.filter((p) => isExpertUser(p.user));
    if (expertPositions.length < 3) return null;

    let yesCount = 0;
    let noCount = 0;
    for (const pos of expertPositions) {
      if (pos.side === "YES") yesCount++;
      else if (pos.side === "NO") noCount++;
    }
    const total = yesCount + noCount;
    if (total === 0) return null;

    return {
      probs: {
        YES: parseFloat((yesCount / total).toFixed(3)),
        NO: parseFloat((noCount / total).toFixed(3)),
      },
      count: expertPositions.length,
    };
  }

  if (market.marketType === "MULTIPLE_CHOICE") {
    const expertPositions = market.multiChoicePositions.filter((p) =>
      isExpertUser(p.user)
    );
    if (expertPositions.length < 3) return null;

    const counts: Record<string, number> = {};
    for (const pos of expertPositions) {
      counts[pos.optionId] = (counts[pos.optionId] ?? 0) + 1;
    }
    const result: Record<string, number> = {};
    for (const [optId, count] of Object.entries(counts)) {
      result[optId] = parseFloat((count / expertPositions.length).toFixed(3));
    }
    return { probs: result, count: expertPositions.length };
  }

  return null;
}
