import { NextResponse } from "next/server";

import { fetchIndexFuturesQuote, isIndexOptionUnderlying } from "@/lib/marketMoves/futuresQuote";

export const dynamic = "force-dynamic";

/**
 * GET /api/finance/futures/quote?underlying=<NIFTY|BANKNIFTY|FINNIFTY|MIDCPNIFTY|NIFTYNXT50>
 *
 * Near-month index-futures price for the requested underlying, live when the
 * direct NSE endpoint resolves, put-call-parity-derived otherwise — see
 * lib/marketMoves/futuresQuote.ts for the full fetch/fallback pipeline.
 * `source` in the response is load-bearing, not cosmetic: every render
 * surface that shows this price must visibly tag a `"PCP_DERIVED"` quote as
 * "derived from option prices" per the Phase 4 brief's honesty requirement.
 *
 * Public endpoint — no auth required, same posture as the sibling option
 * chain endpoint. 502 (not 500, not a hang) when both the live and PCP paths
 * fail, so apps/web's proxy — and ultimately any UI built on this in Sprint 2
 * — can render an honest "temporarily unavailable" state.
 */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const underlying = searchParams.get("underlying")?.toUpperCase();

  if (!underlying || !isIndexOptionUnderlying(underlying)) {
    return NextResponse.json(
      { error: "underlying must be one of NIFTY, BANKNIFTY, FINNIFTY, MIDCPNIFTY, NIFTYNXT50." },
      { status: 400 }
    );
  }

  const quote = await fetchIndexFuturesQuote(underlying);
  if (!quote) {
    return NextResponse.json({ error: "Futures quote temporarily unavailable." }, { status: 502 });
  }

  const response = NextResponse.json({
    underlying: quote.underlying,
    price: quote.price,
    expiry: quote.expiry,
    asOf: quote.asOf.toISOString(),
    source: quote.source,
    openInterest: quote.openInterest,
    changePercent: quote.changePercent,
    // Sprint 2 (T7): per-contract lot size, resolved from fo_mktlots.csv —
    // order placement/margin math needs this; see futuresQuote.ts.
    lotSize: quote.lotSize,
    allContracts: quote.allContracts
  });
  response.headers.set("Cache-Control", "public, max-age=60");
  return response;
}
