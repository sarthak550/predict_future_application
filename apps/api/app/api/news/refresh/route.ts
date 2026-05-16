import { NextResponse } from "next/server";

import { getUserIdFromRequest } from "@/lib/auth";
import { runNewsIngestionJob } from "@/lib/jobs/newsIngestion";

/**
 * POST /api/news/refresh
 *
 * Triggers a news ingestion cycle in the background. Returns immediately.
 * Rate-limited to prevent abuse — only runs if the last ingestion was > 2 minutes ago.
 */

let lastRefreshAt = 0;
const MIN_REFRESH_INTERVAL_MS = 2 * 60 * 1000; // 2 minutes

export async function POST(request: Request) {
  try {
    const userId = await getUserIdFromRequest(request);
    if (!userId) {
      return NextResponse.json({ error: "Authentication required." }, { status: 401 });
    }

    const now = Date.now();
    if (now - lastRefreshAt < MIN_REFRESH_INTERVAL_MS) {
      return NextResponse.json({
        skipped: true,
        message: "Feed was recently refreshed.",
        nextRefreshIn: Math.ceil((MIN_REFRESH_INTERVAL_MS - (now - lastRefreshAt)) / 1000),
      });
    }

    lastRefreshAt = now;

    const result = await runNewsIngestionJob();
    console.info(`[news:refresh] ingested=${result.ingested} fetched=${result.fetched}`);

    return NextResponse.json({ triggered: true, ingested: result.ingested, fetched: result.fetched });
  } catch (error) {
    console.error("Feed refresh error:", error);
    return NextResponse.json({ error: "Failed to refresh feed." }, { status: 500 });
  }
}
