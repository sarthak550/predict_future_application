import { NextResponse } from "next/server";

import { isIndexOptionUnderlying, type IndexOptionUnderlying } from "@predict-future/business-rules/papertrading/optionContract";

import { YAHOO_INDEX_TICKER } from "@/lib/paperTrading/optionsExpiry";
import { fetchYahooCandles, isCandleInterval } from "@/lib/marketMoves/candles";

export const dynamic = "force-dynamic";

function isIndexUnderlying(value: string): value is IndexOptionUnderlying {
  return isIndexOptionUnderlying(value);
}

/**
 * GET /api/finance/instruments/index/[symbol]/candles?interval=1m|5m|15m|30m|60m|1d
 *
 * Charting Workbench (W1) — index sibling of the equity candles route,
 * mirroring `/api/finance/instruments/index/[symbol]/intraday`'s symbol
 * validation exactly: `symbol` must be one of the index underlyings in
 * `YAHOO_INDEX_TICKER` (NIFTY/BANKNIFTY/FINNIFTY/MIDCPNIFTY/NIFTYNXT50 —
 * the same set the futures/options terminals already trade), anything else
 * 400s. The futures terminal charts this same endpoint under its
 * underlying's `INDEX:` key (see the ChartDrawing schema doc comment) —
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
  if (!isIndexUnderlying(symbol)) {
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

  const yahooTicker = YAHOO_INDEX_TICKER[symbol];
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
