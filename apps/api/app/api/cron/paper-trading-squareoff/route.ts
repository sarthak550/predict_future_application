/**
 * POST /api/cron/paper-trading-squareoff
 *
 * Force-closes every account's open INTRADAY Paper Trading positions for today
 * (Phase 1). See apps/api/lib/paperTrading/squareoff.ts for the full algorithm —
 * this route is just the CRON_SECRET-gated entrypoint, identical convention to
 * every other cron route in this app (see /api/cron/portfolios-settle).
 *
 * Recommended cadence — real discount brokers force-close intraday positions
 * ~15:15-15:20 IST, before the 15:30 close:
 *   50 9 * * 1-5 curl -s -X POST https://<host>/api/cron/paper-trading-squareoff \
 *       -H "Authorization: Bearer $CRON_SECRET"
 * (09:50 UTC = 15:20 IST)
 *
 * Never throws: every failure mode is caught inside runIntradaySquareOff and
 * reported in the JSON response body instead.
 */

import { NextResponse } from "next/server";

import { runIntradaySquareOff } from "@/lib/paperTrading/squareoff";

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

  try {
    const result = await runIntradaySquareOff();
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    console.error("[cron/paper-trading-squareoff] unexpected failure:", err);
    return NextResponse.json({ ok: false, error: "Unexpected failure." }, { status: 200 });
  }
}

export const GET = run;
export const POST = run;
