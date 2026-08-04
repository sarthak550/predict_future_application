import { NextResponse } from "next/server";

import { fetchLiveIndexQuote } from "@/lib/marketMoves/liveQuote";
import { isIndexOptionUnderlying, type IndexOptionUnderlying } from "@predict-future/business-rules/papertrading/optionContract";

export const dynamic = "force-dynamic";

function isIndexUnderlying(value: string): value is IndexOptionUnderlying {
  return isIndexOptionUnderlying(value);
}

/**
 * GET /api/finance/instruments/index/[symbol]/quote
 *
 * Quote-driven intrabar ticks — index-only sibling of
 * `/api/finance/instruments/[symbol]/quote` (equity, always appends
 * ".NS"), matching `/index/[symbol]/intraday`'s own scope: `symbol` must be
 * one of the 5 registry index underlyings (NIFTY/BANKNIFTY/FINNIFTY/
 * MIDCPNIFTY/NIFTYNXT50), same `isIndexOptionUnderlying` guard that route
 * already uses. Response shape is byte-identical to the equity quote
 * route's success body so apps/web callers can point at either with zero
 * branching, same convention as the intraday routes.
 *
 * Public endpoint — no auth required. `Cache-Control: no-store` (see the
 * equity quote route's own doc for why, unlike the 60s-cacheable sibling
 * routes).
 */
export async function GET(_request: Request, { params }: { params: { symbol: string } }) {
  const rawSymbol = params.symbol;
  if (!rawSymbol || typeof rawSymbol !== "string") {
    return NextResponse.json({ error: "Symbol is required." }, { status: 400 });
  }
  const symbol = rawSymbol.trim().toUpperCase();
  if (!isIndexUnderlying(symbol)) {
    return NextResponse.json(
      { error: "underlying must be one of NIFTY, BANKNIFTY, FINNIFTY, MIDCPNIFTY, NIFTYNXT50." },
      { status: 400 }
    );
  }

  const quote = await fetchLiveIndexQuote(symbol);
  if (!quote) {
    return NextResponse.json({ error: "No live quote available for this index." }, { status: 404 });
  }

  const response = NextResponse.json({
    symbol,
    price: quote.price,
    asOf: new Date(quote.asOf).toISOString()
  });
  response.headers.set("Cache-Control", "no-store");
  return response;
}
