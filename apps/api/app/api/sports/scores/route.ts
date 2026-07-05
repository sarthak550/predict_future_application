import { NextResponse } from "next/server";

import { getLiveScores } from "@/lib/sports/espn";

/**
 * GET /api/sports/scores
 *
 * Returns live and recent sports scores from ESPN.
 *
 * Cache-Control is live-aware:
 *   - Any match live → s-maxage=5 (stale-while-revalidate=3) for CDN freshness.
 *   - No live match   → s-maxage=30 (stale-while-revalidate=60).
 *
 * On EC2/Caddy with no CDN these headers have no effect on caching behaviour —
 * the real cache is the in-memory one in espn.ts.  They are set correctly so
 * that adding a CDN in future requires no code changes.
 */
export async function GET() {
  try {
    const scores = await getLiveScores();
    const hasLive = scores.some((s) => s.status === "in");
    const cacheControl = hasLive
      ? "public, s-maxage=5, stale-while-revalidate=3"
      : "public, s-maxage=30, stale-while-revalidate=60";
    return NextResponse.json({ scores }, { headers: { "Cache-Control": cacheControl } });
  } catch (error) {
    console.error("[sports:scores] error:", error);
    return NextResponse.json({ scores: [] }, { status: 200 });
  }
}
