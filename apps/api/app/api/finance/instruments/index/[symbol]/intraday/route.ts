import { NextResponse } from "next/server";

import { fetchIndexIntradaySeries } from "@/lib/marketMoves/indexIntraday";
import { YAHOO_INDEX_TICKER } from "@/lib/paperTrading/optionsExpiry";

export const dynamic = "force-dynamic";

import { isIndexOptionUnderlying, type IndexOptionUnderlying } from "@predict-future/business-rules/papertrading/optionContract";
import { getIndexUniverseEntry } from "@predict-future/business-rules/finance/indexUniverse";

/**
 * Resolves `symbol` to a Yahoo ticker from EITHER of the two independent
 * index registries — the 5 tradable underlyings (`YAHOO_INDEX_TICKER`,
 * unchanged) or the view-only `INDEX_UNIVERSE` (Index Universe Expansion,
 * Sprint A, 2026-08-09) — without widening `isIndexOptionUnderlying` itself,
 * which stays scoped to "can this trade." Null when `symbol` is in neither.
 */
function resolveIndexYahooTicker(symbol: string): string | null {
  if (isIndexOptionUnderlying(symbol)) return YAHOO_INDEX_TICKER[symbol as IndexOptionUnderlying];
  return getIndexUniverseEntry(symbol)?.yahooTicker ?? null;
}

/**
 * GET /api/finance/instruments/index/[symbol]/intraday
 *
 * Trading Terminal UI Overhaul (Sprint A, T2) — index-only sibling of
 * /api/finance/instruments/[symbol]/intraday (which is equity-only, always
 * appends ".NS"). Originally "symbol MUST be exactly NIFTY or BANKNIFTY";
 * widened 2026-08-09 (Index Universe Expansion, Sprint A) to accept any of
 * the 5 tradable underlyings OR any `INDEX_UNIVERSE` view-only index —
 * still not a fully general index-symbol endpoint, every other value 400s.
 *
 * Response shape is byte-identical to the equity intraday route's success
 * body ({ symbol, prevClose, points, asOf, sessionLabel, volume }) so
 * PriceChart's `intradaySource` prop can point at either endpoint with zero
 * client-side branching.
 *
 * Public endpoint — no auth required. Same Cache-Control: public, max-age=60
 * convention as every other market-data route here.
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

  const series = await fetchIndexIntradaySeries(symbol, yahooTicker);
  if (!series || series.points.length === 0) {
    // Same clean-failure shape as the equity route's 404 — the caller (via
    // the apps/web proxy) already knows how to render this.
    return NextResponse.json({ error: "No intraday data available for this index." }, { status: 404 });
  }

  const response = NextResponse.json({
    symbol,
    prevClose: series.prevClose,
    points: series.points.map((p) => [p.t, p.price] as [number, number]),
    asOf: new Date().toISOString(),
    sessionLabel: series.sessionLabel,
    volume: series.volume
  });
  response.headers.set("Cache-Control", "public, max-age=60");
  return response;
}
