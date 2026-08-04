/**
 * POST /api/cron/paper-trading-options-expiry
 *
 * Settles every account's open Index Options (Phase 2) positions whose
 * contract expires today (IST calendar date) at intrinsic value, backfills
 * any INDEX_OPTION/STOCK_OPTION position whose expiry has already passed, and
 * cancels stale pending orders on expired contracts — see
 * apps/api/lib/paperTrading/optionsExpiry.ts for the full algorithm
 * (including the 2026-08-04 "EXPIRY SETTLEMENT BACKFILL" addition). Identical
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
 * dryRun: pass `?dryRun=true` (or POST body `{"dryRun": true}`) to compute and
 * return exactly what a live run would settle/cancel WITHOUT writing
 * anything — use this to sanity-check the historical backlog before/after
 * (re-)installing the crontab.
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

async function resolveDryRun(request: Request): Promise<boolean> {
  const url = new URL(request.url);
  if (url.searchParams.get("dryRun") === "true") return true;
  if (request.method !== "POST") return false;
  try {
    const body = await request.clone().json();
    return body?.dryRun === true;
  } catch {
    return false;
  }
}

async function run(request: Request) {
  if (!hasCronAccess(request)) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  try {
    const dryRun = await resolveDryRun(request);
    const result = await runOptionsExpirySettlement(new Date(), { dryRun });
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    console.error("[cron/paper-trading-options-expiry] unexpected failure:", err);
    return NextResponse.json({ ok: false, error: "Unexpected failure." }, { status: 200 });
  }
}

export const GET = run;
export const POST = run;
