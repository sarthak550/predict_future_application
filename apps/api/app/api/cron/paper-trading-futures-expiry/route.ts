/**
 * POST /api/cron/paper-trading-futures-expiry
 *
 * Cash-settles every account's open Index Futures (Phase 4) positions whose
 * contract expires today (IST calendar date) at the day's real F&O bhavcopy
 * settlement price — see apps/api/lib/paperTrading/futuresExpiry.ts for the
 * full algorithm. Identical CRON_SECRET-gated entrypoint convention as every
 * other cron route in this app.
 *
 * MUST run AFTER the daily-MTM cron (see that cron's own doc comment for the
 * F&O-bhavcopy timing rationale) — on an expiry day, the MTM cron marks
 * every open position to today's settlement price FIRST, so this cron's
 * close leg is (by design, not a bug) a near-zero-incremental-P&L event that
 * mainly releases margin. Scheduled 15 minutes after:
 *
 *   45 15 * * 1-5 curl -s -X POST https://<host>/api/cron/paper-trading-futures-expiry \
 *       -H "Authorization: Bearer $CRON_SECRET"
 * (15:45 UTC = 21:15 IST)
 *
 * Self-gating regardless of crontab timing (same posture as every bhavcopy-
 * dependent cron in this app): if the F&O bhavcopy isn't published yet, this
 * responds 200 with `ok: true, settlementAvailable: false` — safely
 * retryable, not an error.
 *
 * Never throws: every failure mode is caught inside runFuturesExpirySettlement
 * and reported in the JSON response body instead.
 */

import { NextResponse } from "next/server";

import { runFuturesExpirySettlement } from "@/lib/paperTrading/futuresExpiry";

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
    const result = await runFuturesExpirySettlement();
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    console.error("[cron/paper-trading-futures-expiry] unexpected failure:", err);
    return NextResponse.json({ ok: false, error: "Unexpected failure." }, { status: 200 });
  }
}

export const GET = run;
export const POST = run;
