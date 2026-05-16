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
      tipsReceivedTotal: user.tipsReceivedTotal,
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
  });
}
