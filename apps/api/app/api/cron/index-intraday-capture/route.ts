/**
 * POST /api/cron/index-intraday-capture
 *
 * "Serious Charts" Program, Workstream B (2026-08-17) — thin CRON_SECRET-gated
 * entrypoint; the real logic lives in lib/marketMoves/indexIntradayCapture.ts
 * (see that file's own doc for the full algorithm, idempotency, and
 * null-feed/off-hours contract). Identical convention to every other cron
 * route in this app (see /api/cron/paper-trading-premium-capture).
 *
 * Dual-gate, mirroring market-moves-movers' own convention: a coarse
 * crontab hour-window (outer bound) PLUS the in-route isNseWeekdayMarketHours()
 * self-gate inside runIndexIntradayCapture (never trust crontab minute
 * precision alone). `?force=1` bypasses the market-hours gate for a manual
 * backfill/dry-run — never set by the crontab entry itself.
 *
 * Recommended cadence — every 15 minutes, within a coarse IST market-hours
 * UTC window (03:30-10:00 UTC = 09:00-15:30 IST, matching the movers cron's
 * own bracketing convention), self-gated the rest of the way by
 * isNseWeekdayMarketHours():
 *   0,15,30,45 3-9 * * 1-5 curl -s -X POST https://<host>/api/cron/index-intraday-capture \
 *       -H "Authorization: Bearer $CRON_SECRET"
 *
 * Never throws: every failure mode is caught here and reported in the JSON
 * response body instead of a 500, matching every other cron route's contract.
 */

import { NextResponse } from "next/server";

import { runIndexIntradayCapture } from "@/lib/marketMoves/indexIntradayCapture";

function hasCronAccess(request: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const authHeader = request.headers.get("authorization");
  const cronHeader = request.headers.get("x-cron-secret");
  return authHeader === `Bearer ${secret}` || cronHeader === secret;
}

async function run(request: Request) {
  if (!hasCronAccess(request)) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const force = new URL(request.url).searchParams.get("force") === "1";

  try {
    const result = await runIndexIntradayCapture({ force });
    return NextResponse.json(result);
  } catch (err) {
    console.error("[cron/index-intraday-capture] unexpected failure:", err);
    return NextResponse.json({ ok: false, error: "Unexpected failure." }, { status: 200 });
  }
}

export const GET = run;
export const POST = run;
