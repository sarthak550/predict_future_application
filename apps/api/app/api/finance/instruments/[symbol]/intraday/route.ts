import { NextResponse } from "next/server";

import { fetchIntradaySeries } from "@/lib/marketMoves/intraday";

export const dynamic = "force-dynamic";

/**
 * GET /api/finance/instruments/[symbol]/intraday
 *
 * Public "1D" tick series for the instrument price chart — 1-minute ticks
 * for the current (or, after close, the last completed) NSE trading session,
 * sourced live from Yahoo's chart API via `fetchIntradaySeries`
 * (lib/marketMoves/intraday.ts — see there for why not NSE's own endpoint).
 * Not stored in our DB — always a live upstream fetch (cached in-module 60s).
 *
 * `symbol` is an NSE symbol (case-insensitive on input, uppercased before
 * any upstream call), matching the sibling `/api/finance/instruments/[symbol]`
 * route's convention.
 *
 * 404 when NSE returns nothing usable (unknown symbol, upstream block, or a
 * genuinely empty session) — the caller falls back to daily-close timeframes.
 *
 * Public endpoint — no auth required. Cache-Control: public, max-age=60,
 * matching the fetcher's own in-module TTL so we never serve a CDN-cached
 * response staler than the upstream data actually is.
 */
export async function GET(_request: Request, { params }: { params: { symbol: string } }) {
  const rawSymbol = params.symbol;
  if (!rawSymbol || typeof rawSymbol !== "string") {
    return NextResponse.json({ error: "Symbol is required." }, { status: 400 });
  }
  const symbol = rawSymbol.trim().toUpperCase();
  if (symbol.length === 0) {
    return NextResponse.json({ error: "Symbol is required." }, { status: 400 });
  }

  const series = await fetchIntradaySeries(symbol);
  if (!series || series.points.length === 0) {
    return NextResponse.json({ error: "No intraday data available for this instrument." }, { status: 404 });
  }

  const response = NextResponse.json({
    symbol,
    prevClose: series.prevClose,
    points: series.points.map((p) => [p.t, p.price] as [number, number]),
    asOf: new Date().toISOString(),
    sessionLabel: series.sessionLabel,
    volume: series.volume,
  });
  response.headers.set("Cache-Control", "public, max-age=60");
  return response;
}
