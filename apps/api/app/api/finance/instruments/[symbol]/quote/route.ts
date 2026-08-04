import { NextResponse } from "next/server";

import { fetchLiveEquityQuote } from "@/lib/marketMoves/liveQuote";

export const dynamic = "force-dynamic";

/**
 * GET /api/finance/instruments/[symbol]/quote
 *
 * Quote-driven intrabar ticks — a FAST (~4s server-cached, see
 * lib/marketMoves/liveQuote.ts), minimal last-price fetch. Sibling of
 * `/intraday` (the full 1-minute tick series, 60s cache): this endpoint
 * never replaces it — callers still need `/intraday` or `/candles` for real
 * bar history, this one only ever answers "what's the latest traded price
 * right now," cheaply enough to poll every few seconds.
 *
 * `symbol` is an NSE symbol (case-insensitive on input, uppercased before
 * any upstream call), matching every sibling route's convention.
 *
 * Public endpoint — no auth required. `Cache-Control: no-store`, not
 * `public, max-age=60` like the sibling routes — this response is stale
 * within ~4s by design and must never be served from a shared/browser cache
 * a poll interval later.
 */
export async function GET(_request: Request, { params }: { params: { symbol: string } }) {
  const rawSymbol = params.symbol;
  if (!rawSymbol || typeof rawSymbol !== "string" || rawSymbol.trim().length === 0) {
    return NextResponse.json({ error: "Symbol is required." }, { status: 400 });
  }
  const symbol = rawSymbol.trim().toUpperCase();

  const quote = await fetchLiveEquityQuote(symbol);
  if (!quote) {
    return NextResponse.json({ error: "No live quote available for this instrument." }, { status: 404 });
  }

  const response = NextResponse.json({
    symbol,
    price: quote.price,
    asOf: new Date(quote.asOf).toISOString()
  });
  response.headers.set("Cache-Control", "no-store");
  return response;
}
