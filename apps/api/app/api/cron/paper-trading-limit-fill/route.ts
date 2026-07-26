/**
 * POST /api/cron/paper-trading-limit-fill
 *
 * Limit Orders (Sprint, 2026-07-26) — T4/T5. Runs BOTH the fill-check sweep
 * (evaluates every PENDING PaperPendingOrder against the latest quote, fills
 * crossed ones) and the day-expiry sweep (marks still-PENDING rows EXPIRED
 * at/past session close) on every call — see lib/paperTrading/limitOrderFill.ts
 * for the full algorithm. Each is independently self-gated (market hours /
 * IST clock cutoff), so calling both on every tick is a cheap no-op outside
 * their respective windows, not wasted work.
 *
 * Recommended cadence — every ~2 minutes across NSE market hours (09:15-15:30
 * IST = 03:45-10:00 UTC), with margin on both ends so the self-gate (not the
 * crontab's own hour boundary) is what decides whether real work happens:
 *   (every 2nd minute) 3-10 * * 1-5 curl -s -X POST https://<host>/api/cron/paper-trading-limit-fill \
 *       -H "Authorization: Bearer $CRON_SECRET"
 * This single cadence also carries the day-expiry sweep — no separate
 * crontab entry needed: any tick at/after 15:20 IST (UTC 09:50, well inside
 * the "3-10" UTC hour range above) triggers runPendingOrderExpirySweep for
 * free.
 *
 * Never throws: every failure mode is caught inside the two run functions
 * and reported in the JSON response body instead, matching every other cron
 * route's contract in this app.
 */

import { NextResponse } from "next/server";

import { runLimitOrderFillCheck, runPendingOrderExpirySweep } from "@/lib/paperTrading/limitOrderFill";

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
    const now = new Date();
    const fill = await runLimitOrderFillCheck(now);
    const expiry = await runPendingOrderExpirySweep(now);
    return NextResponse.json({ ok: true, fill, expiry });
  } catch (err) {
    console.error("[cron/paper-trading-limit-fill] unexpected failure:", err);
    return NextResponse.json({ ok: false, error: "Unexpected failure." }, { status: 200 });
  }
}

export const GET = run;
export const POST = run;
