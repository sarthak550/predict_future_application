import { NextResponse } from "next/server";

import { getUserIdFromRequest } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getDisplayName } from "@/lib/users/displayName";

export async function GET(
  request: Request,
  { params }: { params: { username: string } }
) {
  // Optional auth — used only for isFollowedByMe computation.
  const requestingUserId = await getUserIdFromRequest(request);

  const user = await prisma.user.findUnique({
    where: { username: params.username },
    include: {
      // displayMode is needed to compute getDisplayName for public responses.
      stats: {
        select: {
          totalPredictions: true,
          totalNetPoints: true,
          hostTrustScore: true,
          hostedMarketsCount: true,
          cleanStreakCount: true,
        },
      },

      badges: {
        include: {
          badge: true,
        },
      },
      categoryStats: true,
      createdMarkets: {
        where: { visibility: "PUBLIC", status: "OPEN" },
        select: { id: true, title: true, status: true },
        orderBy: { createdAt: "desc" },
        take: 6,
      },
      _count: {
        select: {
          followers: true,
          following: true,
        },
      },
    },
  });

  if (!user) {
    return NextResponse.json({ error: "User not found." }, { status: 404 });
  }

  // Determine whether the requesting user follows this profile.
  let isFollowedByMe = false;
  if (requestingUserId && requestingUserId !== user.id) {
    const followRow = await prisma.follow.findUnique({
      where: {
        followerId_followeeId: {
          followerId: requestingUserId,
          followeeId: user.id,
        },
      },
      select: { id: true },
    });
    isFollowedByMe = followRow !== null;
  }

  // Fetch recent calls (S30-T3): up to 5, preferring positions with reasoning.
  // Query positions on public markets only.
  const recentPositionsWithReasoning = await prisma.marketPosition.findMany({
    where: {
      userId: user.id,
      reasoning: { not: null },
      market: {
        visibility: "PUBLIC",
        status: { notIn: ["DRAFT", "PENDING_REVIEW", "REJECTED"] },
      },
    },
    orderBy: { createdAt: "desc" },
    take: 5,
    select: {
      id: true,
      side: true,
      reasoning: true,
      reasoningUpvotes: true,
      createdAt: true,
      market: {
        select: {
          id: true,
          title: true,
          status: true,
          outcome: true,
        },
      },
    },
  });

  // Fall back to recent positions regardless of reasoning if we have fewer than 5.
  let recentCalls = recentPositionsWithReasoning;
  if (recentCalls.length < 5) {
    const existingIds = new Set(recentCalls.map((p) => p.id));
    const fallbackPositions = await prisma.marketPosition.findMany({
      where: {
        userId: user.id,
        id: { notIn: Array.from(existingIds) },
        market: {
          visibility: "PUBLIC",
          status: { notIn: ["DRAFT", "PENDING_REVIEW", "REJECTED"] },
        },
      },
      orderBy: { createdAt: "desc" },
      take: 5 - recentCalls.length,
      select: {
        id: true,
        side: true,
        reasoning: true,
        reasoningUpvotes: true,
        createdAt: true,
        market: {
          select: {
            id: true,
            title: true,
            status: true,
            outcome: true,
          },
        },
      },
    });
    recentCalls = [...recentCalls, ...fallbackPositions]
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      .slice(0, 5);
  }

  // Compute totalReasoningUpvotes (S30-T1): sum of upvotes across all user's positions.
  const upvoteAggregate = await prisma.marketPosition.aggregate({
    where: { userId: user.id },
    _sum: { reasoningUpvotes: true },
  });
  const totalReasoningUpvotes = upvoteAggregate._sum.reasoningUpvotes ?? 0;

  // Resolve the public display name. When displayMode=ANONYMOUS, the username
  // field in the response is replaced with the deterministic pseudonym. The
  // URL continues to resolve via the real username (anonymity is display-only).
  const displayName = getDisplayName(user);

  return NextResponse.json({
    user: {
      id: user.id,
      username: displayName,
      displayMode: user.displayMode,
      reputationScore: user.reputationScore,
      accuracyScore: user.accuracyScore,
      level: user.level,
      streak: user.streak,
      isVerifiedAnalyst: user.isVerifiedAnalyst,
      analystTier: user.analystTier,
      tipsReceivedTotal: user.tipsReceivedTotal,
      totalReasoningUpvotes,
      stats: user.stats
        ? {
            totalPredictions: user.stats.totalPredictions,
            totalNetPoints: user.stats.totalNetPoints,
          }
        : null,
      badges: user.badges,
      categoryStats: user.categoryStats,
      createdMarkets: user.createdMarkets,
      followerCount: user._count.followers,
      followingCount: user._count.following,
      isFollowedByMe,
    },
    recentCalls: recentCalls.map((p) => ({
      marketId: p.market.id,
      marketTitle: p.market.title,
      side: p.side ?? "UNKNOWN",
      reasoning: p.reasoning,
      reasoningUpvotes: p.reasoningUpvotes,
      createdAt: p.createdAt.toISOString(),
      marketStatus: p.market.status,
      outcome: p.market.outcome === "UNRESOLVED" ? null : p.market.outcome,
    })),
  });
}
