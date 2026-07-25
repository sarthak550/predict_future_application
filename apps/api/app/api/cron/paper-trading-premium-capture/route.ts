/**
 * POST /api/cron/paper-trading-premium-capture
 *
 * Trading Terminal UI Overhaul (Sprint A, T3) — captures one round of ATM ± 5
 * option-premium snapshots (see lib/paperTrading/premiumCapture.ts for the
 * full candidate-selection + write algorithm). This route is just the
 * CRON_SECRET-gated entrypoint, identical convention to every other cron
 * route in this app (see /api/cron/paper-trading-squareoff).
 *
 * Recommended cadence — every 5 minutes during NSE market hours. The crontab
 * bound below is a coarse hour-window filter only; the route itself ALSO
 * self-gates on isNseWeekdayMarketHours() (see runPremiumCapture), so a
 * slightly-loose crontab bound never writes off-session ticks:
 *   asterisk/5 4-10 * * 1-5 curl -s -X POST https://<host>/api/cron/paper-trading-premium-capture \
 *       -H "Authorization: Bearer $CRON_SECRET"
 * (04:00-10:59 UTC = 09:30-16:29 IST, comfortably bracketing the 09:15-15:30
 * IST market-hours window on both sides — written out as "asterisk/5" above
 * only because a literal "*" here would collide with this file's own comment
 * syntax; use a literal star in the real crontab line.)
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
