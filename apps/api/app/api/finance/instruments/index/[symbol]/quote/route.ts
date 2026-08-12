import { NextResponse } from "next/server";

import { fetchLiveIndexQuote } from "@/lib/marketMoves/liveQuote";
import { isIndexOptionUnderlying, type IndexOptionUnderlying, YAHOO_INDEX_SPOT_TICKER } from "@predict-future/business-rules/papertrading/optionContract";
import { getIndexUniverseEntry } from "@predict-future/business-rules/finance/indexUniverse";
import { getBseIndexUniverseEntry } from "@predict-future/business-rules/finance/bseIndexUniverse";

export const dynamic = "force-dynamic";

/**
 * Same two-registry resolution as the sibling intraday route — see that
 * file's own doc. BSE Expansion Phase 2 (2026-08-12) — additive third
 * fallback for the 18 BSE_INDEX_UNIVERSE symbols (business-rules); `symbol`
 * here is only ever a cache/response key (see liveQuote.ts's own doc), so
 * this widening is safe for every existing NSE/tradable caller.
 */
function resolveIndexYahooTicker(symbol: string): string | null {
  if (isIndexOptionUnderlying(symbol)) return YAHOO_INDEX_SPOT_TICKER[symbol as IndexOptionUnderlying];
  return getIndexUniverseEntry(symbol)?.yahooTicker ?? getBseIndexUniverseEntry(symbol)?.yahooTicker ?? null;
}

/**
 * GET /api/finance/instruments/index/[symbol]/quote
 *
 * Quote-driven intrabar ticks — index-only sibling of
 * `/api/finance/instruments/[symbol]/quote` (equity, always appends
 * ".NS"). Originally scoped to the 5 tradable underlyings only; widened
 * 2026-08-09 (Index Universe Expansion, Sprint A) to also accept any
 * `INDEX_UNIVERSE` view-only index, same two-registry resolution as the
 * sibling `/intraday` route. Response shape is byte-identical to the equity
 * quote route's success body so apps/web callers can point at either with
 * zero branching, same convention as the intraday routes.
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
  const yahooTicker = resolveIndexYahooTicker(symbol);
  if (!yahooTicker) {
    return NextResponse.json({ error: "Unsupported index symbol." }, { status: 400 });
  }

  const quote = await fetchLiveIndexQuote(symbol, yahooTicker);
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
