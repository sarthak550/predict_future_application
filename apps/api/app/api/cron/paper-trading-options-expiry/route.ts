/**
 * POST /api/cron/paper-trading-options-expiry
 *
 * Settles every account's open Index Options (Phase 2) positions whose
 * contract expires today (IST calendar date) at intrinsic value — see
 * apps/api/lib/paperTrading/optionsExpiry.ts for the full algorithm. Identical
 * CRON_SECRET-gated entrypoint convention as every other cron route in this
 * app (see /api/cron/paper-trading-squareoff).
 *
 * Recommended cadence — AFTER Phase 1's equity square-off cron (15:20 IST) and
 * after NSE's 15:30 IST close, once the day's final option-chain quotes have
 * settled:
 *   10 10 * * 1-5 curl -s -X POST https://<host>/api/cron/paper-trading-options-expiry \
 *       -H "Authorization: Bearer $CRON_SECRET"
 * (10:10 UTC = 15:40 IST)
 *
 * Never throws: every failure mode is caught inside runOptionsExpirySettlement
 * and reported in the JSON response body instead.
 */

import { NextResponse } from "next/server";

import { runOptionsExpirySettlement } from "@/lib/paperTrading/optionsExpiry";

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
    const result = await runOptionsExpirySettlement();
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    console.error("[cron/paper-trading-options-expiry] unexpected failure:", err);
    return NextResponse.json({ ok: false, error: "Unexpected failure." }, { status: 200 });
  }
}

export const GET = run;
export const POST = run;
