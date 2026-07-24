import { NextResponse } from "next/server";

import { fetchOptionChainExpiries, isTradableOptionUnderlying } from "@/lib/marketMoves/optionChain";

export const dynamic = "force-dynamic";

/**
 * GET /api/finance/options/expiries?underlying=<NIFTY|BANKNIFTY|F&O stock symbol>
 *
 * Live expiry list for the requested underlying, nearest-first, straight from
 * NSE's option-chain-contract-info endpoint (see lib/marketMoves/optionChain.ts)
 * — no `type` param needed for either an index or a stock underlying, confirmed
 * empirically to work unmodified for both (Phase 3). Cadence (weekly vs
 * monthly) is never assumed here — the client reads it from this list's own
 * spacing; single-stock underlyings are monthly-only in practice (confirmed
 * empirically), but this endpoint doesn't hardcode that assumption either.
 *
 * Public endpoint — no auth required (same posture as the equity intraday
 * endpoint this mirrors). Cache-Control matches the fetcher's own 60s in-module
 * TTL so a CDN/proxy in front of this never serves data staler than the
 * upstream fetch itself.
 */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const underlying = searchParams.get("underlying")?.toUpperCase();

  if (!underlying || !(await isTradableOptionUnderlying(underlying))) {
    return NextResponse.json({ error: "underlying must be NIFTY, BANKNIFTY, or a live F&O-eligible stock symbol." }, { status: 400 });
  }

  const expiries = await fetchOptionChainExpiries(underlying);
  if (expiries.length === 0) {
    return NextResponse.json({ error: "Option chain expiries temporarily unavailable." }, { status: 502 });
  }

  const response = NextResponse.json({ underlying, expiries });
  response.headers.set("Cache-Control", "public, max-age=60");
  return response;
}
