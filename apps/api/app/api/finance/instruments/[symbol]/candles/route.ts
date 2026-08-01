import { NextResponse } from "next/server";

import { fetchYahooCandles, isCandleInterval } from "@/lib/marketMoves/candles";

export const dynamic = "force-dynamic";

/**
 * GET /api/finance/instruments/[symbol]/candles?interval=1m|5m|15m|30m|60m|1d
 *
 * Charting Workbench (W1) — OHLCV candle series for the KLineCharts
 * workbench (W2), equity/stock sibling of the existing
 * `/api/finance/instruments/[symbol]/intraday` line-chart endpoint. Always
 * appends ".NS" (NSE) — same equity-only convention as that route. Sourced
 * live from Yahoo via `fetchYahooCandles` (lib/marketMoves/candles.ts —
 * server-owned range per interval, in-module cache); not stored in our DB.
 *
 * `symbol` is an NSE symbol (case-insensitive on input, uppercased before
 * any upstream call). `interval` is required and validated against the
 * fixed candle-interval set — anything else 400s rather than silently
 * defaulting, since a wrong interval would otherwise return a plausible-
 * looking but wrong-shaped series.
 *
 * Response fields (`candles[].{timestamp,open,high,low,close,volume}`)
 * match KLineCharts' `KLineData` verbatim so W2's chart wrapper can consume
 * this with zero client-side remapping.
 *
 * 404 when Yahoo returns nothing usable (unknown symbol, upstream block, or
 * a genuinely empty series) — never a 200 with an empty `candles` array,
 * since W2's chart needs to distinguish "no data" from "loading" reliably.
 *
 * Public endpoint — no auth required. Cache-Control: public, max-age=60 for
 * intraday intervals, max-age=300 for `1d` — matches the fetcher's own
 * in-module TTL per interval so a CDN never serves data staler than the
 * upstream fetch actually is.
 */
export async function GET(request: Request, { params }: { params: { symbol: string } }) {
  const rawSymbol = params.symbol;
  if (!rawSymbol || typeof rawSymbol !== "string") {
    return NextResponse.json({ error: "Symbol is required." }, { status: 400 });
  }
  const symbol = rawSymbol.trim().toUpperCase();
  if (symbol.length === 0) {
    return NextResponse.json({ error: "Symbol is required." }, { status: 400 });
  }

  const rawInterval = new URL(request.url).searchParams.get("interval");
  if (!rawInterval || !isCandleInterval(rawInterval)) {
    return NextResponse.json(
      { error: "A valid interval query param is required (1m, 5m, 15m, 30m, 60m, or 1d)." },
      { status: 400 }
    );
  }
  const interval = rawInterval;

  const series = await fetchYahooCandles(`${symbol}.NS`, interval);
  if (!series || series.candles.length === 0) {
    return NextResponse.json({ error: "No candle data available for this instrument." }, { status: 404 });
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
