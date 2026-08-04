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
 * Public endpoint — no auth required. Graceful degradation (founder complaint
 * 2026-08-04, 9:15-9:30 IST market-open flake window): this route opts into
 * fetchOptionChain's `allowStale` behavior, so a single transient upstream
 * miss re-serves the last known-good snapshot (bounded to 15 minutes old,
 * see CHAIN_STALE_SERVE_MS in optionChain.ts) tagged `stale: true` with 200,
 * instead of a bodyless 502 — the chain browser UI can then keep the ladder
 * on screen instead of blanking it. 502 is now reserved for the genuine
 * "nothing usable at all" case: either no successful fetch has ever happened
 * for this (underlying, expiry) pair, or the last good snapshot fell outside
 * the 15-minute stale-serve window.
 *
 * `asOf` in the response body is ALWAYS the upstream's own last-computed
 * timestamp (IST) from whichever fetch actually produced the returned data —
 * never re-stamped on a stale re-serve, so a caller reading `asOf` never sees
 * a falsely-recent time even while `stale: true` softens the presentation.
 * After market close this naturally reads as the last session's close, which
 * the UI uses for the "market closed, showing last session" label rather than
 * inventing its own staleness heuristic.
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

  const snapshot = await fetchOptionChain(underlying, expiry.trim(), { allowStale: true });
  if (!snapshot) {
    return NextResponse.json({ error: "Option chain temporarily unavailable." }, { status: 502 });
  }

  const response = NextResponse.json({
    underlying: snapshot.underlying,
    expiry: snapshot.expiry,
    underlyingValue: snapshot.underlyingValue,
    asOf: snapshot.asOf ? snapshot.asOf.toISOString() : null,
    stale: snapshot.stale,
    lotSize: snapshot.lotSize,
    strikes: snapshot.strikes
  });
  // A stale re-served snapshot must never ride the normal edge cache as if it
  // were fresh — force a re-check on every request while stale so recovery is
  // picked up as soon as the next live fetch succeeds. A fresh snapshot keeps
  // the original 60s cache window.
  response.headers.set("Cache-Control", snapshot.stale ? "no-store" : "public, max-age=60");
  return response;
}
