import { NextResponse } from "next/server";

import { getUserIdFromRequest } from "@/lib/auth";
import { runNewsIngestionJob } from "@/lib/jobs/newsIngestion";
import { checkRateLimit } from "@/lib/rate-limit";

/**
 * POST /api/news/refresh
 *
 * Triggers a news ingestion cycle in the background. Returns immediately.
 *
 * Rate-limited via Upstash Redis so the cap holds across every serverless
 * instance: 1 refresh per 2 minutes globally. Previously each instance kept
 * its own `let lastRefreshAt`, so a fan-out caller could trigger N ingestion
 * cycles in parallel (one per warm Lambda).
 */
const REFRESH_LIMIT = 1;
const REFRESH_WINDOW_MS = 2 * 60 * 1000;

export async function POST(request: Request) {
  try {
    const userId = await getUserIdFromRequest(request);
    if (!userId) {
      return NextResponse.json({ error: "Authentication required." }, { status: 401 });
    }

    // Global key (not per-user): the ingestion job is feed-wide, so we don't
    // want each user to get their own 2-min budget.
    const rl = await checkRateLimit("news:refresh:global", REFRESH_LIMIT, REFRESH_WINDOW_MS);
    if (!rl.allowed) {
      return NextResponse.json({
        skipped: true,
        message: "Feed was recently refreshed.",
        nextRefreshIn: Math.max(1, Math.ceil((rl.resetAt - Date.now()) / 1000)),
      });
    }

    const result = await runNewsIngestionJob();
    console.info(`[news:refresh] ingested=${result.ingested} fetched=${result.fetched}`);

    return NextResponse.json({ triggered: true, ingested: result.ingested, fetched: result.fetched });
  } catch (error) {
    console.error("Feed refresh error:", error);
    return NextResponse.json({ error: "Failed to refresh feed." }, { status: 500 });
  }
}
