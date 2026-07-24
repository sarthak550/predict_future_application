/**
 * POST /api/cron/paper-trading-stock-options-squareoff
 *
 * Force-closes every account's open Stock Options (Phase 3) positions whose
 * contract expires today (IST calendar date), at full manual-SELL cost (NOT
 * Phase 2's ₹0-brokerage cash-settlement path — see
 * lib/paperTrading/stockOptionSquareOff.ts's module doc for the cost trap and
 * the full algorithm). Identical CRON_SECRET-gated entrypoint convention as
 * every other cron route in this app.
 *
 * TWO PASSES PER DAY, both BEFORE the 15:30 IST close (unlike Phase 2's index
 * cron, which runs AFTER close) — the primary pass does the real work while
 * the chain is still live and tradeable; the safety pass is an idempotent
 * re-derive that only acts on anything the first pass missed (a transient
 * chain-fetch failure). Ordered to run AFTER Phase 1's equity square-off
 * (15:20 IST) and BEFORE Phase 2's index cash-settlement (15:40 IST):
 *
 *   25 9 * * 1-5 curl -s -X POST https://<host>/api/cron/paper-trading-stock-options-squareoff \
 *       -H "Authorization: Bearer $CRON_SECRET"
 *   29 9 * * 1-5 curl -s -X POST https://<host>/api/cron/paper-trading-stock-options-squareoff \
 *       -H "Authorization: Bearer $CRON_SECRET"
 * (09:25 UTC = 15:25 IST primary pass; 09:29 UTC = 15:29 IST safety pass)
 *
 * Never throws: every failure mode is caught inside runStockOptionSquareOff
 * and reported in the JSON response body instead.
 */

import { NextResponse } from "next/server";

import { runStockOptionSquareOff } from "@/lib/paperTrading/stockOptionSquareOff";

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
    const result = await runStockOptionSquareOff();
    // Loud log line for ops/alerting: a position surviving both today's
    // passes is the one true residual-risk edge case this design doesn't
    // fully close (total NSE outage) — see the module doc.
    if (result.skippedNoPrice > 0) {
      console.warn(
        `[cron/paper-trading-stock-options-squareoff] ${result.skippedNoPrice} position(s) skipped with no price available this pass.`
      );
    }
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    console.error("[cron/paper-trading-stock-options-squareoff] unexpected failure:", err);
    return NextResponse.json({ ok: false, error: "Unexpected failure." }, { status: 200 });
  }
}

export const GET = run;
export const POST = run;
