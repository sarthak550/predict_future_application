import { NextResponse } from "next/server";

import { getUserIdFromRequest } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

/**
 * Returns the current IST month as 'YYYY-MM'.
 * IST = UTC+5:30.
 */
function getIstMonthString(now?: Date): string {
  const d = now ?? new Date();
  const istMs = d.getTime() + 5.5 * 60 * 60 * 1000;
  const istDate = new Date(istMs);
  const yyyy = istDate.getUTCFullYear();
  const mm = String(istDate.getUTCMonth() + 1).padStart(2, "0");
  return `${yyyy}-${mm}`;
}

/**
 * GET /api/leagues/current
 *
 * Auth required. Returns the authenticated user's MonthlyLeagueEntry for the
 * current IST month. If no entry exists it is auto-created at BRONZE tier.
 *
 * Response:
 * {
 *   month: string;           // 'YYYY-MM'
 *   tier: LeagueTier;        // current tier
 *   netPointsMonth: number;
 *   rank: number | null;     // computed rank within tier+month (1-based), null if only entry
 * }
 */
export async function GET(request: Request) {
  try {
    const userId = await getUserIdFromRequest(request);
    if (!userId) {
      return NextResponse.json({ error: "Authentication required." }, { status: 401 });
    }

    const month = getIstMonthString();

    // Fetch or create the user's entry for this month
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { currentLeagueTier: true }
    });

    if (!user) {
      return NextResponse.json({ error: "User not found." }, { status: 404 });
    }

    // Auto-create entry if missing (idempotent)
    const entry = await prisma.monthlyLeagueEntry.upsert({
      where: { userId_month: { userId, month } },
      update: {},
      create: {
        userId,
        month,
        tier: user.currentLeagueTier ?? "BRONZE",
        startingTier: user.currentLeagueTier ?? "BRONZE",
        netPointsMonth: 0
      }
    });

    // Compute rank: count users in same tier+month with strictly higher netPointsMonth, +1
    const higherCount = await prisma.monthlyLeagueEntry.count({
      where: {
        month,
        tier: entry.tier,
        netPointsMonth: { gt: entry.netPointsMonth }
      }
    });

    const rank = higherCount + 1;

    return NextResponse.json({
      month: entry.month,
      tier: entry.tier,
      netPointsMonth: entry.netPointsMonth,
      rank
    });
  } catch (error) {
    console.error("[leagues/current] error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to load league entry." },
      { status: 500 }
    );
  }
}
