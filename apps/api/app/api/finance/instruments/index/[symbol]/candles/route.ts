import { NextResponse } from "next/server";

import { isIndexOptionUnderlying, type IndexOptionUnderlying } from "@predict-future/business-rules/papertrading/optionContract";
import { getIndexUniverseEntry } from "@predict-future/business-rules/finance/indexUniverse";
import { getBseIndexUniverseEntry } from "@predict-future/business-rules/finance/bseIndexUniverse";

import { YAHOO_INDEX_TICKER } from "@/lib/paperTrading/optionsExpiry";
import { fetchYahooCandles, isCandleInterval } from "@/lib/marketMoves/candles";

export const dynamic = "force-dynamic";

/**
 * Index Universe SPRINT B (2026-08-12) — same two-registry resolution as the
 * sibling `/intraday` and `/quote` routes (see those files' own docs): the 5
 * tradable underlyings (`YAHOO_INDEX_TICKER`, unchanged) fall through to
 * `INDEX_UNIVERSE` (NSE view-only) then `BSE_INDEX_UNIVERSE` (BSE view-only).
 * Was previously the ONE index route still hardcoded to `isIndexOptionUnderlying`
 * only — this closes that gap so the charting workbench's full
 * indicator/drawing toolkit works for every Yahoo-verified index, not just
 * the 5 F&O underlyings. `null` when `symbol` is in none of the three.
 */
function resolveIndexYahooTicker(symbol: string): string | null {
  if (isIndexOptionUnderlying(symbol)) return YAHOO_INDEX_TICKER[symbol as IndexOptionUnderlying];
  return getIndexUniverseEntry(symbol)?.yahooTicker ?? getBseIndexUniverseEntry(symbol)?.yahooTicker ?? null;
}

/**
 * GET /api/finance/instruments/index/[symbol]/candles?interval=1m|5m|15m|30m|60m|1d
 *
 * Charting Workbench (W1) — index sibling of the equity candles route.
 * `symbol` must resolve via `resolveIndexYahooTicker` above — either one of
 * the 5 tradable F&O underlyings or a view-only `INDEX_UNIVERSE`/
 * `BSE_INDEX_UNIVERSE` index (Index Universe SPRINT B, 2026-08-12) —
 * anything else 400s. The futures terminal charts this same endpoint under
 * its underlying's `INDEX:` key (see the ChartDrawing schema doc comment) —
 * there is deliberately no separate futures-specific candles route.
 *
 * Response shape is byte-identical to the equity candles route's success
 * body so a chart wrapper can point at either endpoint with zero branching.
 *
 * Public endpoint — no auth required. Same Cache-Control convention as the
 * equity route (60s intraday / 300s daily).
 */
export async function GET(request: Request, { params }: { params: { symbol: string } }) {
  const rawSymbol = params.symbol;
  if (!rawSymbol || typeof rawSymbol !== "string") {
    return NextResponse.json({ error: "Symbol is required." }, { status: 400 });
  }
  const symbol = rawSymbol.trim().toUpperCase();
  const yahooTicker = resolveIndexYahooTicker(symbol);
  if (!yahooTicker) {
    return NextResponse.json({ error: "Unsupported index symbol." }, { status: 400 });
  }

  const rawInterval = new URL(request.url).searchParams.get("interval");
  if (!rawInterval || !isCandleInterval(rawInterval)) {
    return NextResponse.json(
      { error: "A valid interval query param is required (1m, 5m, 15m, 30m, 60m, or 1d)." },
      { status: 400 }
    );
  }
  const interval = rawInterval;

  const series = await fetchYahooCandles(yahooTicker, interval);
  if (!series || series.candles.length === 0) {
    return NextResponse.json({ error: "No candle data available for this index." }, { status: 404 });
  }

  const response = NextResponse.json({
    symbol,
    interval,
    prevClose: series.prevClose,
    candles: series.candles,
    asOf: new Date().toISOString(),
  });
  response.headers.set("Cache-Control", `public, max-age=${interval === "1d" ? 300 : 60}`);
  return response;
}
