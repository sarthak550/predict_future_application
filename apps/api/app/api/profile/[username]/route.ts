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

  // ── Finance streak + accuracy (S35-T3) ──────────────────────────────────────
  // Fetch locked Poll A (IMPLICATION) votes only — drafts don't count.
  const allFinanceVotes = await prisma.expertOpinionVote.findMany({
    where: { userId: user.id, pollType: "IMPLICATION", lockedAt: { not: null } },
    select: {
      choice: true,
      createdAt: true,
      opinion: {
        select: {
          resolutionStatus: true,
          resolvedAt: true,
        },
      },
    },
    orderBy: { createdAt: "desc" },
  });

  const financeTotalVotes = allFinanceVotes.length;

  // Streak: consecutive IST calendar days with at least one Poll A vote.
  // IST = UTC+5:30. All date comparisons are done in IST to avoid midnight edge cases.
  function toIstDateKey(d: Date): string {
    const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;
    return new Date(d.getTime() + IST_OFFSET_MS).toISOString().slice(0, 10);
  }

  // Move an IST date-key back by one IST calendar day.
  function prevIstDateKey(istKey: string): string {
    const [y, m, d] = istKey.split("-").map(Number);
    // Reconstruct the UTC instant that corresponds to the start of this IST day,
    // then subtract 24 h to reach the previous IST day, then re-key.
    const istMidnightUtc = new Date(Date.UTC(y, m - 1, d) - 5.5 * 60 * 60 * 1000);
    istMidnightUtc.setUTCDate(istMidnightUtc.getUTCDate() - 1);
    return toIstDateKey(istMidnightUtc);
  }

  const voteDates = new Set(allFinanceVotes.map((v) => toIstDateKey(v.createdAt)));
  let financeStreak = 0;

  if (voteDates.size > 0) {
    const todayIst = toIstDateKey(new Date());
    let cursor = todayIst;

    // Walk back from today counting consecutive IST days with votes.
    while (voteDates.has(cursor)) {
      financeStreak++;
      cursor = prevIstDateKey(cursor);
    }

    // Grace period: if today has no vote yet, try starting from yesterday.
    if (financeStreak === 0) {
      cursor = prevIstDateKey(todayIst);
      while (voteDates.has(cursor)) {
        financeStreak++;
        cursor = prevIstDateKey(cursor);
      }
    }
  }

  // Accuracy: among resolved opinions the user voted on, what % did they agree with (opinion was HIT)?
  const resolvedVotes = allFinanceVotes.filter(
    (v) =>
      v.opinion.resolutionStatus === "RESOLVED_HIT" ||
      v.opinion.resolutionStatus === "RESOLVED_MISS"
  );
  const financeResolvedVotes = resolvedVotes.length;

  let financeAccuracy: number | null = null;
  if (financeResolvedVotes > 0) {
    // "Correct" = user agreed (AGREE/STRONGLY_AGREE) and opinion was HIT,
    //          OR user disagreed (DISAGREE/STRONGLY_DISAGREE) and opinion was MISS.
    const correct = resolvedVotes.filter((v) => {
      const isHit = v.opinion.resolutionStatus === "RESOLVED_HIT";
      const userAgreed = v.choice === "AGREE" || v.choice === "STRONGLY_AGREE";
      const userDisagreed = v.choice === "STRONGLY_DISAGREE" || v.choice === "DISAGREE";
      return (isHit && userAgreed) || (!isHit && userDisagreed);
    }).length;
    financeAccuracy = Math.round((correct / financeResolvedVotes) * 100);
  }

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
      financeStreak,
      financeAccuracy,
      financeTotalVotes,
      financeResolvedVotes,
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
