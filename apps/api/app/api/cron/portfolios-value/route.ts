/**
 * POST /api/cron/portfolios-value
 *
 * Incrementally backfills PortfolioDailyValue for every portfolio with at least one
 * EXECUTED transaction (P3.1). See apps/api/lib/portfolios/valuation.ts for the
 * full algorithm — this route is just the CRON_SECRET-gated entrypoint.
 *
 * Protected by CRON_SECRET (Bearer or x-cron-secret header), identical to every
 * other cron route in this app. Recommended cadence — shortly after
 * portfolios-settle so same-day fills are reflected in the same day's cached value:
 *   15 14 * * 1-5 curl -s -X POST https://<host>/api/cron/portfolios-value \
 *       -H "Authorization: Bearer $CRON_SECRET"
 * (14:15 UTC = 19:45 IST)
 *
 * Never throws: every failure mode is caught inside backfillDailyValues and
 * reported in the JSON response body instead.
 */

import { NextResponse } from "next/server";
import { notifyWebRevalidate } from "@/lib/webRevalidate";

import { backfillDailyValues } from "@/lib/portfolios/valuation";

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
    const result = await backfillDailyValues();
    await notifyWebRevalidate(["/portfolios", ["/portfolios/[slug]", "page"]]);
  return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    console.error("[cron/portfolios-value] unexpected failure:", err);
    return NextResponse.json({ ok: false, error: "Unexpected failure." }, { status: 200 });
  }
}

export const GET = run;
export const POST = run;
