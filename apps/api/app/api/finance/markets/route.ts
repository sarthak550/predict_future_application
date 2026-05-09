import { MarketStatus } from "@prisma/client";
import { NextResponse } from "next/server";

import { computeMarketRankScore } from "@/lib/markets/ranking";
import { prisma } from "@/lib/prisma";
import { getDisplayName } from "@/lib/users/displayName";

export const dynamic = "force-dynamic";

const MARKET_SELECT = {
  id: true,
  slug: true,
  title: true,
  description: true,
  category: true,
  status: true,
  visibility: true,
  marketType: true,
  resolutionMode: true,
  resolutionStatus: true,
  poolRewardMode: true,
  hostCommissionBps: true,
  bondCap: true,
  lockedBondAmount: true,
  maxPoolAllowed: true,
  closeAt: true,
  resolveAt: true,
  finalResolutionDeadline: true,
  challengeWindowEndsAt: true,
  yesPool: true,
  noPool: true,
  totalVolume: true,
  totalParticipants: true,
  unit: true,
  minValue: true,
  maxValue: true,
  precision: true,
  averageNumericValue: true,
  yesCount: true,
  noCount: true,
  totalVotes: true,
  createdAt: true,
  updatedAt: true,
  isFeatured: true,
  disputeCount: true,
  qualityScore: true,
  creatorReputationSnapshot: true,
  creator: {
    select: {
      id: true,
      username: true,
      displayMode: true,
      reputationScore: true,
    },
  },
  _count: {
    select: { comments: true },
  },
} as const;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function formatMarketSummary(market: any) {
  return {
    ...market,
    creator: market.creator
      ? { ...market.creator, username: getDisplayName(market.creator) }
      : market.creator,
    closeAt: market.closeAt.toISOString(),
    resolveAt: market.resolveAt.toISOString(),
    finalResolutionDeadline: market.finalResolutionDeadline?.toISOString() ?? null,
    challengeWindowEndsAt: market.challengeWindowEndsAt?.toISOString() ?? null,
    marketRankScore: computeMarketRankScore(market as Parameters<typeof computeMarketRankScore>[0]),
  };
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const cursor = searchParams.get("cursor") ?? undefined;
  const PAGE_SIZE = 10;

  const now = new Date();

  // ── 1. Sentiment-of-the-day ────────────────────────────────────────────────
  // Top FINANCE OPEN market by totalVotes (proxy for rank score without stored field)
  const topSentimentMarket = await prisma.market.findFirst({
    where: {
      category: "FINANCE",
      status: MarketStatus.OPEN,
      visibility: "PUBLIC",
    },
    orderBy: { totalVotes: "desc" },
    select: {
      id: true,
      title: true,
      yesCount: true,
      noCount: true,
      totalVotes: true,
    },
  });

  let sentimentToday = null;
  if (topSentimentMarket && topSentimentMarket.totalVotes > 0) {
    const yesPercent = Math.round(
      (topSentimentMarket.yesCount / topSentimentMarket.totalVotes) * 100
    );
    const noPercent = 100 - yesPercent;
    const leanLabel: "Bullish" | "Bearish" | "Uncertain" =
      yesPercent > 60 ? "Bullish" : yesPercent < 40 ? "Bearish" : "Uncertain";

    // Compute previous-day score: count votes cast before today's UTC midnight
    const todayUtcMidnight = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())
    );
    const yesterdayUtcMidnight = new Date(todayUtcMidnight.getTime() - 24 * 60 * 60 * 1000);
    const [prevYesCount, prevTotalCount] = await Promise.all([
      prisma.vote.count({
        where: {
          marketId: topSentimentMarket.id,
          side: "YES",
          createdAt: { lt: todayUtcMidnight, gte: yesterdayUtcMidnight },
        },
      }),
      prisma.vote.count({
        where: {
          marketId: topSentimentMarket.id,
          createdAt: { lt: todayUtcMidnight, gte: yesterdayUtcMidnight },
        },
      }),
    ]);
    const previousDayScore =
      prevTotalCount > 0 ? Math.round((prevYesCount / prevTotalCount) * 100) : null;

    sentimentToday = {
      marketId: topSentimentMarket.id,
      marketTitle: topSentimentMarket.title,
      yesPercent,
      noPercent,
      totalVotes: topSentimentMarket.totalVotes,
      leanLabel,
      previousDayScore,
    };
  }

  // ── 2. Event clusters with their markets ───────────────────────────────────
  const clusters = await prisma.marketEventCluster.findMany({
    where: { endsAt: { gte: now } },
    orderBy: { startsAt: "asc" },
    include: {
      markets: {
        where: {
          category: "FINANCE",
          status: { in: [MarketStatus.OPEN, MarketStatus.CLOSED] },
          visibility: "PUBLIC",
        },
        orderBy: { closeAt: "asc" },
        select: MARKET_SELECT,
      },
    },
  });

  // Count expert opinions per cluster via the direct FK (S18-T4)
  const clusterExpertCounts = await Promise.all(
    clusters.map((cluster) =>
      prisma.expertOpinion.count({
        where: {
          eventClusterId: cluster.id,
          suppressedAt: null,
        },
      })
    )
  );

  const eventClusters = clusters.map((cluster, idx) => ({
    id: cluster.id,
    slug: cluster.slug,
    name: cluster.name,
    description: cluster.description,
    startsAt: cluster.startsAt.toISOString(),
    endsAt: cluster.endsAt.toISOString(),
    bannerEmoji: cluster.bannerEmoji,
    category: cluster.category,
    dataPoints: (cluster.dataPoints as Array<{ label: string; value: string; subtext?: string; date?: string }> | null) ?? [],
    expertTakeCount: clusterExpertCounts[idx] ?? 0,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    markets: cluster.markets.map((m) => formatMarketSummary(m as any)),
  }));

  // ── 3. Unclustered Finance markets (paginated) ─────────────────────────────
  const whereUnclustered = {
    category: "FINANCE" as const,
    eventClusterId: null,
    visibility: "PUBLIC" as const,
    ...(cursor ? { id: { lt: cursor } } : {}),
  };

  const [unclusteredRaw, total] = await Promise.all([
    prisma.market.findMany({
      where: whereUnclustered,
      orderBy: { totalVotes: "desc" },
      take: PAGE_SIZE + 1,
      select: MARKET_SELECT,
    }),
    prisma.market.count({ where: { category: "FINANCE", eventClusterId: null, visibility: "PUBLIC" } }),
  ]);

  const hasMoreUnclustered = unclusteredRaw.length > PAGE_SIZE;
  const unclusteredItems = hasMoreUnclustered ? unclusteredRaw.slice(0, PAGE_SIZE) : unclusteredRaw;
  const nextCursor = hasMoreUnclustered ? unclusteredItems[unclusteredItems.length - 1].id : null;

  return NextResponse.json({
    sentimentToday,
    eventClusters,
    unclusteredMarkets: {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      items: unclusteredItems.map((m) => formatMarketSummary(m as any)),
      nextCursor,
      total,
    },
  });
}
