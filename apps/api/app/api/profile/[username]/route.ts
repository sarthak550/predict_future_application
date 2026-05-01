import { NextResponse } from "next/server";

import { prisma } from "@/lib/prisma";

export async function GET(
  _request: Request,
  { params }: { params: { username: string } }
) {
  const user = await prisma.user.findUnique({
    where: { username: params.username },
    include: {
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
    },
  });

  if (!user) {
    return NextResponse.json({ error: "User not found." }, { status: 404 });
  }

  return NextResponse.json({
    user: {
      id: user.id,
      username: user.username,
      reputationScore: user.reputationScore,
      accuracyScore: user.accuracyScore,
      level: user.level,
      streak: user.streak,
      stats: user.stats
        ? {
            totalPredictions: user.stats.totalPredictions,
            totalNetPoints: user.stats.totalNetPoints,
          }
        : null,
      badges: user.badges,
      categoryStats: user.categoryStats,
      createdMarkets: user.createdMarkets,
    },
  });
}
