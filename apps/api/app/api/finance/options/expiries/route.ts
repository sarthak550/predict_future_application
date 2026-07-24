import { NextResponse } from "next/server";

import { fetchOptionChainExpiries, type OptionUnderlying } from "@/lib/marketMoves/optionChain";

export const dynamic = "force-dynamic";

const VALID_UNDERLYINGS: OptionUnderlying[] = ["NIFTY", "BANKNIFTY"];

/**
 * GET /api/finance/options/expiries?underlying=NIFTY|BANKNIFTY
 *
 * Live expiry list for the requested index, nearest-first, straight from NSE's
 * option-chain-contract-info endpoint (see lib/marketMoves/optionChain.ts).
 * Cadence (weekly vs monthly) is never assumed here — the client reads it from
 * this list's own spacing.
 *
 * Public endpoint — no auth required (same posture as the equity intraday
 * endpoint this mirrors). Cache-Control matches the fetcher's own 60s in-module
 * TTL so a CDN/proxy in front of this never serves data staler than the
 * upstream fetch itself.
 */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const underlying = searchParams.get("underlying")?.toUpperCase();

  if (!underlying || !VALID_UNDERLYINGS.includes(underlying as OptionUnderlying)) {
    return NextResponse.json({ error: "underlying must be NIFTY or BANKNIFTY." }, { status: 400 });
  }

  const expiries = await fetchOptionChainExpiries(underlying as OptionUnderlying);
  if (expiries.length === 0) {
    return NextResponse.json({ error: "Option chain expiries temporarily unavailable." }, { status: 502 });
  }

  const response = NextResponse.json({ underlying, expiries });
  response.headers.set("Cache-Control", "public, max-age=60");
  return response;
}
