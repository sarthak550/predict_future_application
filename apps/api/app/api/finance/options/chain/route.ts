import { NextResponse } from "next/server";

import { fetchOptionChain, isTradableOptionUnderlying } from "@/lib/marketMoves/optionChain";

export const dynamic = "force-dynamic";

/**
 * GET /api/finance/options/chain?underlying=<NIFTY|BANKNIFTY|F&O stock symbol>&expiry=DD-MMM-YYYY
 *
 * Full strike ladder (CE + PE premiums per strike), live underlying spot value,
 * and the contract-month-snapshotted lot size for the requested underlying+
 * expiry — see lib/marketMoves/optionChain.ts for the full fetch/parse/cache
 * pipeline (built on the existing NSE cookie-handshake fetcher). Phase 3:
 * `underlying` is no longer restricted to the two indices — any live member of
 * the F&O stock universe (see GET /api/finance/options/fo-universe) is valid
 * too, checked at runtime via isTradableOptionUnderlying (never a hardcoded
 * stock allowlist).
 *
 * `expiry` must be exactly one of the strings GET /api/finance/options/expiries
 * returned for the same underlying — passed straight through to NSE, not
 * reparsed here.
 *
 * Public endpoint — no auth required. 502 (not 500, not a hang) on any upstream
 * failure or an unexpectedly empty chain, so apps/web's proxy — and ultimately
 * the chain browser UI — can render an honest "temporarily unavailable" state.
 * `asOf` in the response body is the upstream's own last-computed timestamp
 * (IST) — after market close this naturally reads as the last session's close,
 * which the UI uses for the "market closed, showing last session" label rather
 * than inventing its own staleness heuristic.
 */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const underlying = searchParams.get("underlying")?.toUpperCase();
  const expiry = searchParams.get("expiry");

  if (!underlying || !(await isTradableOptionUnderlying(underlying))) {
    return NextResponse.json({ error: "underlying must be NIFTY, BANKNIFTY, or a live F&O-eligible stock symbol." }, { status: 400 });
  }
  if (!expiry || expiry.trim().length === 0) {
    return NextResponse.json({ error: "expiry is required." }, { status: 400 });
  }

  const snapshot = await fetchOptionChain(underlying, expiry.trim());
  if (!snapshot) {
    return NextResponse.json({ error: "Option chain temporarily unavailable." }, { status: 502 });
  }

  const response = NextResponse.json({
    underlying: snapshot.underlying,
    expiry: snapshot.expiry,
    underlyingValue: snapshot.underlyingValue,
    asOf: snapshot.asOf ? snapshot.asOf.toISOString() : null,
    lotSize: snapshot.lotSize,
    strikes: snapshot.strikes
  });
  response.headers.set("Cache-Control", "public, max-age=60");
  return response;
}
