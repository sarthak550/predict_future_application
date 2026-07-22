/**
 * POST /api/cron/portfolios-shadow
 *
 * Nightly incremental shadow-portfolio generation (P3.3): picks up newly
 * graded BULLISH ExpertOpinion calls since the last run (new experts get a
 * fresh SHADOW Portfolio, existing shadow portfolios get any newly-eligible
 * calls appended as transactions), backfilling whatever StockEodQuote
 * sessions those new calls need along the way. See
 * apps/api/lib/portfolios/shadowGenerator.ts for the full algorithm — this
 * route is just the CRON_SECRET-gated entrypoint, identical in shape to
 * every other cron route in this app.
 *
 * Recommended cadence — AFTER portfolios-value (which is 14:15 UTC / 19:45
 * IST), so a shadow portfolio's first day of history already has a cached
 * NAV by the time a user could see it, and well after the ~19:15 IST bhavcopy
 * publish time this route's own quote backfill also depends on:
 *   30 14 * * 1-5 curl -s -X POST https://<host>/api/cron/portfolios-shadow \
 *       -H "Authorization: Bearer $CRON_SECRET"
 * (14:30 UTC = 20:00 IST)
 *
 * Bounded per run: at most 80 bhavcopy sessions fetched (MAX_SESSIONS_PER_RUN
 * in shadowGenerator.ts) — on a normal night with only a handful of newly
 * graded calls this is nowhere close to the cap; it only matters if a large
 * backlog of newly-graded historical calls lands in one run, in which case
 * the run makes partial forward progress and the next night's run picks up
 * the rest (see runShadowGeneration's idempotent-by-design coverage cache).
 *
 * Never throws: every failure mode is caught inside runShadowGeneration
 * (per-expert) or reported in the JSON response body instead.
 */

import { NextResponse } from "next/server";

import { runShadowGeneration } from "@/lib/portfolios/shadowGenerator";

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
    const result = await runShadowGeneration({ dryRun: false });
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    console.error("[cron/portfolios-shadow] unexpected failure:", err);
    return NextResponse.json({ ok: false, error: "Unexpected failure." }, { status: 200 });
  }
}

export const GET = run;
export const POST = run;
