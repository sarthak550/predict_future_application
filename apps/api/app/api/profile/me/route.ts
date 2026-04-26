import { NextResponse } from "next/server";

import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

/**
 * GET /api/profile/me — returns the authenticated user's full profile
 * including stats, badges, category expertise, recent positions, and created markets.
 *
 * For dev/demo: also accepts ?userId=<id> query param as fallback.
 */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const session = await getSession();
  const userId = session?.user?.id ?? searchParams.get("userId");

  if (!userId) {
    return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  }

  const user = await prisma.user.findUnique({
    where: { id: userId },
    include: {
      stats: true,
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
            select: { id: true, title: true, status: true },
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

  const [createdPolls, votes] = await Promise.all([
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
  ]);

  return NextResponse.json({
    user: {
      id: user.id,
      username: user.username,
      reputationScore: user.reputationScore,
      accuracyScore: user.accuracyScore,
      level: user.level,
      streak: user.streak,
      stats: user.stats,
      wallet: user.wallet,
      badges: user.badges,
      categoryStats: user.categoryStats,
      positions: user.positions,
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
  });
}
