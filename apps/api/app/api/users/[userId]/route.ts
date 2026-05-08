import { NextResponse } from "next/server";

import { getUserIdFromRequest } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

/**
 * GET /api/users/[userId]
 *
 * Public user profile by user ID. Extends the basic profile shape with social
 * graph counts and, when the caller is authenticated, whether they follow this user.
 *
 * Auth: optional. `isFollowedByMe` is always false when unauthenticated.
 *
 * Response shape is additive on top of ApiUserProfile — does not break existing
 * callers of GET /api/profile/[username] which uses username-based lookup.
 */
export async function GET(
  request: Request,
  { params }: { params: { userId: string } }
) {
  const { userId } = params;

  // Optional auth — used only for isFollowedByMe computation.
  const requestingUserId = await getUserIdFromRequest(request);

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      username: true,
      avatarUrl: true,
      reputationScore: true,
      accuracyScore: true,
      level: true,
      streak: true,
      createdAt: true,
      stats: {
        select: {
          totalPredictions: true,
          totalNetPoints: true,
          lastPredictionAt: true,
        },
      },
      badges: {
        include: { badge: true },
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
  if (requestingUserId && requestingUserId !== userId) {
    const followRow = await prisma.follow.findUnique({
      where: {
        followerId_followeeId: {
          followerId: requestingUserId,
          followeeId: userId,
        },
      },
      select: { id: true },
    });
    isFollowedByMe = followRow !== null;
  }

  return NextResponse.json({
    user: {
      id: user.id,
      username: user.username,
      avatarUrl: user.avatarUrl,
      reputationScore: user.reputationScore,
      accuracyScore: user.accuracyScore,
      level: user.level,
      streak: user.streak,
      stats: user.stats
        ? {
            totalPredictions: user.stats.totalPredictions,
            totalNetPoints: user.stats.totalNetPoints,
            lastPredictionAt: user.stats.lastPredictionAt?.toISOString() ?? null,
          }
        : null,
      badges: user.badges,
      followerCount: user._count.followers,
      followingCount: user._count.following,
      isFollowedByMe,
    },
  });
}
