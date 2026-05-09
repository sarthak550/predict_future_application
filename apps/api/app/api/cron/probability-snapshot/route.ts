import { NextResponse } from "next/server";

import { snapshotMarketProbabilities } from "@/lib/crons/probability-snapshot";

/**
 * POST /api/cron/probability-snapshot
 *
 * Runs hourly (via Vercel Cron or external scheduler) to snapshot market
 * probabilities for the consensus-line chart.
 *
 * Auth: Bearer CRON_SECRET header required.
 *
 * Returns:
 *   { ok: true, processed: number, snapshotsCreated: number }
 */
export async function POST(request: Request) {
  const expectedSecret = process.env.CRON_SECRET;
  if (!expectedSecret || request.headers.get("Authorization") !== `Bearer ${expectedSecret}`) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  try {
    const result = await snapshotMarketProbabilities();
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    console.error("[cron/probability-snapshot]", error);
    return NextResponse.json(
      { error: "Snapshot run failed." },
      { status: 500 }
    );
  }
}
