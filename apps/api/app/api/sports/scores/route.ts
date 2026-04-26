import { NextResponse } from "next/server";

import { getLiveScores } from "@/lib/sports/espn";

/**
 * GET /api/sports/scores
 *
 * Returns live and recent sports scores from ESPN.
 * Cached in-memory for 2 minutes on the server side.
 */
export async function GET() {
  try {
    const scores = await getLiveScores();
    return NextResponse.json(
      { scores },
      { headers: { "Cache-Control": "public, s-maxage=60, stale-while-revalidate=120" } }
    );
  } catch (error) {
    console.error("[sports:scores] error:", error);
    return NextResponse.json({ scores: [] }, { status: 200 });
  }
}
