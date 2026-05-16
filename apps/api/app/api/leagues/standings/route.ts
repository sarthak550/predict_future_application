import type { LeagueTier } from "@prisma/client";
import { NextResponse } from "next/server";

import { getLeagueStandings } from "@/lib/leagues/monthEnd";

const VALID_TIERS = new Set<string>([
  "BRONZE",
  "SILVER",
  "GOLD",
  "PLATINUM",
  "DIAMOND",
]);

/**
 * GET /api/leagues/standings?tier=GOLD&month=2026-05&cursor=
 *
 * Paginated standings for a given tier and month. Auth: optional.
 * Returns 20 entries per page ordered by netPointsMonth DESC.
 */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);

  const tier = searchParams.get("tier");
  const month = searchParams.get("month");
  const cursor = searchParams.get("cursor") ?? undefined;

  if (!tier || !VALID_TIERS.has(tier)) {
    return NextResponse.json(
      { error: "Missing or invalid 'tier' parameter. Expected one of: BRONZE, SILVER, GOLD, PLATINUM, DIAMOND." },
      { status: 400 }
    );
  }

  if (!month || !/^\d{4}-\d{2}$/.test(month)) {
    return NextResponse.json(
      { error: "Missing or invalid 'month' parameter. Expected YYYY-MM format." },
      { status: 400 }
    );
  }

  try {
    const result = await getLeagueStandings({
      tier: tier as LeagueTier,
      month,
      cursor,
    });

    return NextResponse.json(result);
  } catch (error) {
    console.error("[api/leagues/standings] Error:", error);
    return NextResponse.json(
      { error: "Failed to fetch standings." },
      { status: 500 }
    );
  }
}
