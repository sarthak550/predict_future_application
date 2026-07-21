/**
 * POST /api/cron/portfolios-settle
 *
 * Fills or cancels every eligible PENDING PortfolioTransaction (P3.1). See
 * apps/api/lib/portfolios/settlement.ts for the full execution-rule doc and
 * fill/cancel algorithm — this route is just the CRON_SECRET-gated entrypoint.
 *
 * Protected by CRON_SECRET (Bearer or x-cron-secret header), identical to every
 * other cron route in this app. Recommended cadence — after the ~19:15 IST
 * StockEodQuote EOD ingest (market-moves-movers cron), so the same-day close is
 * already available to settle against:
 *   0 14 * * 1-5 curl -s -X POST https://<host>/api/cron/portfolios-settle \
 *       -H "Authorization: Bearer $CRON_SECRET"
 * (14:00 UTC = 19:30 IST)
 *
 * Never throws: every failure mode is caught inside settlePendingTransactions and
 * reported in the JSON response body instead.
 */

import { NextResponse } from "next/server";

import { settlePendingTransactions } from "@/lib/portfolios/settlement";

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
    const result = await settlePendingTransactions();
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    console.error("[cron/portfolios-settle] unexpected failure:", err);
    return NextResponse.json({ ok: false, error: "Unexpected failure." }, { status: 200 });
  }
}

export const GET = run;
export const POST = run;
