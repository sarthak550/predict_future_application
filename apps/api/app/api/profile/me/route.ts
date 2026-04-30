import { NextResponse } from "next/server";

import { getUserIdFromRequest } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function GET(request: Request) {
  const userId = await getUserIdFromRequest(request);

  if (!userId) {
    return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  }

  const user = await prisma.user.findUnique({
    where: { id: userId },
    include: {
      stats: {
        select: {
          hostTrustScore: true,
          validFinalizedHostedMarketsCount: true,
          hostedMarketsCount: true,
          finalizedHostedMarketsCount: true,
          cleanFinalizationCount: true,
          upheldAfterChallengeCount: true,
          hostTimeoutCount: true,
          overturnedHostedMarketsCount: true,
          moderationViolationCount: true,
          avgParticipantsPerHostedMarket: true,
          avgPoolPerHostedMarket: true,
          repeatJoinRate: true,
          avgHostCommissionBps: true,
          cleanStreakCount: true,
          publicHostingEligibility: true,
          hostingLimit: true,
          totalPredictions: true,
          totalNetPoints: true,
          lastPredictionAt: true,
        },
      },
      wallet: { select: { balance: true } },
      badges: {
        include: { badge: true },
      },
      categoryStats: true,
      positions: {
        select: {
          id: true,
          side: true,
          amount: true,
          createdAt: true,
          market: {
            select: { id: true, title: true, status: true, outcome: true },
          },
        },
        orderBy: { createdAt: "desc" },
        take: 10,
      },
      createdMarkets: {
        select: { id: true, title: true, status: true },
        orderBy: { createdAt: "desc" },
        take: 6,
      },
    },
  });

  if (!user) {
    return NextResponse.json({ error: "User not found." }, { status: 404 });
  }

  const [createdPolls, votes, resolvedPositions] = await Promise.all([
    prisma.market.findMany({
      where: { creatorId: userId },
      select: {
        id: true,
        title: true,
        status: true,
        category: true,
        visibility: true,
        yesCount: true,
        noCount: true,
        totalVotes: true,
        closeAt: true,
        createdAt: true,
      },
      orderBy: { createdAt: "desc" },
      take: 50,
    }),
    prisma.vote.findMany({
      where: { userId },
      select: {
        id: true,
        side: true,
        numericValue: true,
        createdAt: true,
        market: {
          select: {
            id: true,
            title: true,
            status: true,
            category: true,
            yesCount: true,
            noCount: true,
          },
        },
      },
      orderBy: { createdAt: "desc" },
      take: 50,
    }),
    prisma.marketPosition.findMany({
      where: {
        userId,
        market: { status: "RESOLVED" },
      },
      select: {
        id: true,
        amount: true,
        payoutAmount: true,
        marketId: true,
      },
    }),
  ]);

  const resolvedMarketIds = new Set(resolvedPositions.map((p) => p.marketId));
  const totalStaked = resolvedPositions.reduce((sum, p) => sum + p.amount, 0);
  const totalReturned = resolvedPositions.reduce((sum, p) => sum + (p.payoutAmount ?? 0), 0);
  const netPnl = totalReturned - totalStaked;
  const resolvedMarketCount = resolvedMarketIds.size;

  return NextResponse.json({
    user: {
      id: user.id,
      username: user.username,
      reputationScore: user.reputationScore,
      accuracyScore: user.accuracyScore,
      level: user.level,
      streak: user.streak,
      lastPredictionAt: user.stats?.lastPredictionAt?.toISOString() ?? null,
      stats: user.stats ? {
        totalPredictions: user.stats.totalPredictions,
        totalNetPoints: user.stats.totalNetPoints,
      } : null,
      wallet: user.wallet,
      badges: user.badges,
      categoryStats: user.categoryStats,
      positions: user.positions.map((p) => ({
        ...p,
        market: {
          id: p.market.id,
          title: p.market.title,
          status: p.market.status,
          winningSide:
            p.market.outcome === "YES" ? "YES"
            : p.market.outcome === "NO" ? "NO"
            : null,
        },
      })),
      createdMarkets: user.createdMarkets,
      hostStats: user.stats ? {
        hostTrustScore: user.stats.hostTrustScore,
        validFinalizedHostedMarketsCount: user.stats.validFinalizedHostedMarketsCount,
        hostedMarketsCount: user.stats.hostedMarketsCount,
        finalizedHostedMarketsCount: user.stats.finalizedHostedMarketsCount,
        cleanFinalizationCount: user.stats.cleanFinalizationCount,
        upheldAfterChallengeCount: user.stats.upheldAfterChallengeCount,
        hostTimeoutCount: user.stats.hostTimeoutCount,
        overturnedHostedMarketsCount: user.stats.overturnedHostedMarketsCount,
        moderationViolationCount: user.stats.moderationViolationCount,
        avgParticipantsPerHostedMarket: user.stats.avgParticipantsPerHostedMarket,
        avgPoolPerHostedMarket: user.stats.avgPoolPerHostedMarket,
        repeatJoinRate: user.stats.repeatJoinRate,
        avgHostCommissionBps: user.stats.avgHostCommissionBps,
        cleanStreakCount: user.stats.cleanStreakCount,
        publicHostingEligibility: user.stats.publicHostingEligibility,
        hostingLimit: user.stats.hostingLimit,
      } : null,
    },
    createdPolls,
    votes,
    pnl: resolvedMarketCount > 0 ? {
      totalStaked,
      totalReturned,
      netPnl,
      resolvedMarketCount,
      lastUpdatedAt: new Date().toISOString(),
    } : null,
  });
}
