import { NextResponse } from "next/server";

import { getUserIdFromRequest } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import type { AnalystTier } from "@prisma/client";

// Tier thresholds — kept in sync with lib/analysts.ts
const TIER_THRESHOLDS: Array<{
  tier: AnalystTier;
  predictionsNeeded: number;
  accuracyNeeded: number;
  requiresVerified: boolean;
}> = [
  { tier: "CHIEF_ANALYST", predictionsNeeded: 200, accuracyNeeded: 0.65, requiresVerified: true },
  { tier: "SENIOR_ANALYST", predictionsNeeded: 50,  accuracyNeeded: 0.60, requiresVerified: false },
  { tier: "ANALYST",        predictionsNeeded: 10,  accuracyNeeded: 0.55, requiresVerified: false },
  { tier: "ROOKIE",         predictionsNeeded: 0,   accuracyNeeded: 0,    requiresVerified: false },
];

function computeTierProgress(
  currentTier: AnalystTier,
  totalPredictions: number,
  currentAccuracy: number,
  isVerifiedAnalyst: boolean
) {
  // CHIEF_ANALYST is the top tier — no next tier
  if (currentTier === "CHIEF_ANALYST") {
    return {
      currentTier,
      nextTier: null as AnalystTier | null,
      predictionsNeeded: 200,
      predictionsToGo: 0,
      accuracyNeeded: 0.65,
      currentAccuracy,
      isEligible: false,
    };
  }

  // Find the next tier up from current
  const tierOrder: AnalystTier[] = ["ROOKIE", "ANALYST", "SENIOR_ANALYST", "CHIEF_ANALYST"];
  const currentIdx = tierOrder.indexOf(currentTier);
  const nextTier = tierOrder[currentIdx + 1] as AnalystTier;
  const nextThreshold = TIER_THRESHOLDS.find((t) => t.tier === nextTier)!;

  // Skip CHIEF_ANALYST if not verified (show SENIOR_ANALYST as next if not verified)
  const effectiveNextTier =
    nextTier === "CHIEF_ANALYST" && !isVerifiedAnalyst ? nextTier : nextTier;

  const predictionsToGo = Math.max(0, nextThreshold.predictionsNeeded - totalPredictions);
  const isEligible =
    totalPredictions >= nextThreshold.predictionsNeeded &&
    currentAccuracy >= nextThreshold.accuracyNeeded &&
    (!nextThreshold.requiresVerified || isVerifiedAnalyst);

  return {
    currentTier,
    nextTier: effectiveNextTier,
    predictionsNeeded: nextThreshold.predictionsNeeded,
    predictionsToGo,
    accuracyNeeded: nextThreshold.accuracyNeeded,
    currentAccuracy,
    isEligible,
  };
}

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
          reasoning: true,
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

  const totalPredictions = user.stats?.totalPredictions ?? 0;
  const currentAccuracy = user.accuracyScore ?? 0;
  const tierProgress = computeTierProgress(
    user.analystTier,
    totalPredictions,
    currentAccuracy,
    user.isVerifiedAnalyst
  );

  // Aggregate total reasoning upvotes across all of the user's positions (S30-T1).
  const upvoteAggregate = await prisma.marketPosition.aggregate({
    where: { userId },
    _sum: { reasoningUpvotes: true },
  });
  const totalReasoningUpvotes = upvoteAggregate._sum.reasoningUpvotes ?? 0;

  return NextResponse.json({
    user: {
      id: user.id,
      // Own-view exception (S26-T5): always return the real username for the
      // authenticated user's own profile. Anonymity affects public-facing
      // surfaces only — the user always sees their actual username.
      username: user.username,
      displayMode: user.displayMode,
      reputationScore: user.reputationScore,
      accuracyScore: user.accuracyScore,
      level: user.level,
      streak: user.streak,
      lastPredictionAt: user.stats?.lastPredictionAt?.toISOString() ?? null,
      isVerifiedAnalyst: user.isVerifiedAnalyst,
      analystTier: user.analystTier,
      phoneVerified: user.phoneVerified,
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
      tierProgress,
      totalReasoningUpvotes,
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
