/**
 * POST /api/cron/paper-trading-premium-capture
 *
 * Trading Terminal UI Overhaul (Sprint A, T3); interval-parity cadence
 * project (2026-08-07) widened this — captures one round of ATM ± 10
 * option-premium snapshots (see lib/paperTrading/premiumCapture.ts for the
 * full candidate-selection + write algorithm, including the fast/slow
 * two-track cadence split). This route is just the CRON_SECRET-gated
 * entrypoint, identical convention to every other cron route in this app
 * (see /api/cron/paper-trading-squareoff).
 *
 * Recommended cadence — EVERY MINUTE during NSE market hours (tightened from
 * every-5-minutes; runPremiumCapture internally decides on every invocation
 * whether the slower stock track also fires this run — see that function's
 * own doc). The crontab bound below is a coarse hour-window filter only; the
 * route itself ALSO self-gates on isNseWeekdayMarketHours() (see
 * runPremiumCapture), so a slightly-loose crontab bound never writes
 * off-session ticks:
 *   asterisk 3-10 * * 1-5 curl -s -X POST https://<host>/api/cron/paper-trading-premium-capture \
 *       -H "Authorization: Bearer $CRON_SECRET"
 * (03:00-10:59 UTC = 08:30-16:29 IST, comfortably bracketing the 09:15-15:30
 * IST market-hours window on both sides. CORRECTED 2026-08-07 from the prior
 * `4-10` bound, which started at 04:00 UTC = 09:30 IST — 15 minutes AFTER
 * the real 09:15 IST open, silently missing every trading day's opening
 * quarter-hour. Written out as "asterisk" above only because a literal "*"
 * here would collide with this file's own comment syntax; use a literal star
 * in the real crontab line — i.e. `* 3-10 * * 1-5`.)
 *
 * Never throws: every failure mode is caught inside runPremiumCapture and
 * reported in the JSON response body instead.
 */

import { NextResponse } from "next/server";

import { runPremiumCapture } from "@/lib/paperTrading/premiumCapture";

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
    const result = await runPremiumCapture();
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    console.error("[cron/paper-trading-premium-capture] unexpected failure:", err);
    return NextResponse.json({ ok: false, error: "Unexpected failure." }, { status: 200 });
  }
}

export const GET = run;
export const POST = run;
