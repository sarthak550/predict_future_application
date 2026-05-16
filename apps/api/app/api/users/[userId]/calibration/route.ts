import { NextResponse } from "next/server";

import { prisma } from "@/lib/prisma";

/**
 * GET /api/users/[userId]/calibration
 *
 * Returns a user's calibration data — overall accuracy stats and a per-category
 * breakdown. Auth: optional (public read path).
 *
 * Response shape: ApiUserCalibration (defined in @predict-future/types)
 */
export async function GET(
  _request: Request,
  { params }: { params: { userId: string } }
) {
  const { userId } = params;

  // Verify the user exists.
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true },
  });

  if (!user) {
    return NextResponse.json({ error: "User not found." }, { status: 404 });
  }

  // Fetch UserStat (may not exist if user has never predicted).
  const userStat = await prisma.userStat.findUnique({
    where: { userId },
    select: {
      totalPredictions: true,
      totalWins: true,
      bestStreak: true,
      accuracyScore: true,
    },
  });

  // Fetch all category stats where the user has at least one prediction.
  const categoryStats = await prisma.userCategoryStat.findMany({
    where: {
      userId,
      totalPredictions: { gte: 1 },
    },
    select: {
      category: true,
      totalPredictions: true,
      totalWins: true,
      accuracyScore: true,
      totalNetPoints: true,
    },
    orderBy: { accuracyScore: "desc" },
  });

  const overallAccuracy = userStat?.accuracyScore ?? 0;
  const totalPredictions = userStat?.totalPredictions ?? 0;
  const totalWins = userStat?.totalWins ?? 0;
  const bestStreak = userStat?.bestStreak ?? 0;

  const categoryBreakdown = categoryStats.map((cs) => ({
    category: cs.category as string,
    totalPredictions: cs.totalPredictions,
    totalWins: cs.totalWins,
    accuracyScore: cs.accuracyScore,
    totalNetPoints: cs.totalNetPoints,
  }));

  return NextResponse.json(
    {
      overallAccuracy,
      totalPredictions,
      totalWins,
      bestStreak,
      categoryBreakdown,
    },
    {
      headers: {
        "Cache-Control": "public, max-age=60",
      },
    }
  );
}
