/**
 * POST /api/cron/paper-trading-futures-daily-mtm
 *
 * Daily mark-to-market + margin-call square-off for every account's open
 * Index Futures (Phase 4) positions — see
 * apps/api/lib/paperTrading/futuresDailyMtm.ts for the full algorithm.
 * Identical CRON_SECRET-gated entrypoint convention as every other cron
 * route in this app.
 *
 * TIMING: F&O bhavcopy (foBhavcopy.ts) historically publishes LATER in the
 * evening than the cash-equity bhavcopy the Portfolios EOD valuation cron
 * depends on (that one's precedent: EOD movers pass at 19:15 IST / 13:45
 * UTC, portfolios-value 30 min after at 19:45 IST / 14:15 UTC). Since this
 * is the FIRST consumer of the F&O bhavcopy in production, its real publish
 * time hasn't been observed yet — scheduled with a wider buffer than the
 * cash-equity precedent as a conservative starting point:
 *
 *   30 15 * * 1-5 curl -s -X POST https://<host>/api/cron/paper-trading-futures-daily-mtm \
 *       -H "Authorization: Bearer $CRON_SECRET"
 * (15:30 UTC = 21:00 IST)
 *
 * This route is self-gating regardless of crontab timing (matches this
 * app's established "the route's own gates are the source of truth" cron
 * posture — see market-moves-movers's own doc comment): if the F&O bhavcopy
 * isn't published yet, runFuturesDailyMtm returns `settlementAvailable:
 * false` and this route responds 200 with `ok: true, settlementAvailable:
 * false` — a clean, safely-retryable no-op, not an error. RECOMMEND: once
 * this has run in production for a few sessions, check
 * `settlementAvailable` in the response logs and tighten this crontab time
 * to whatever the F&O bhavcopy's real observed publish time turns out to be
 * (see the CTO report for this sprint).
 *
 * Never throws: every failure mode is caught inside runFuturesDailyMtm and
 * reported in the JSON response body instead.
 */

import { NextResponse } from "next/server";

import { runFuturesDailyMtm } from "@/lib/paperTrading/futuresDailyMtm";

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
    const result = await runFuturesDailyMtm();
    if (result.accountsMarginCalled > 0) {
      console.warn(
        `[cron/paper-trading-futures-daily-mtm] ${result.accountsMarginCalled} account(s) margin-called, ${result.positionsForceClosed} position(s) force-closed.`
      );
    }
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    console.error("[cron/paper-trading-futures-daily-mtm] unexpected failure:", err);
    return NextResponse.json({ ok: false, error: "Unexpected failure." }, { status: 200 });
  }
}

export const GET = run;
export const POST = run;
