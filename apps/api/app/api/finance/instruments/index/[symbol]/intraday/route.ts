import { NextResponse } from "next/server";

import { fetchIndexIntradaySeries, type IndexUnderlying } from "@/lib/marketMoves/indexIntraday";

export const dynamic = "force-dynamic";

const VALID_SYMBOLS = new Set<IndexUnderlying>(["NIFTY", "BANKNIFTY"]);

function isIndexUnderlying(value: string): value is IndexUnderlying {
  return VALID_SYMBOLS.has(value as IndexUnderlying);
}

/**
 * GET /api/finance/instruments/index/[symbol]/intraday
 *
 * Trading Terminal UI Overhaul (Sprint A, T2) — index-only sibling of
 * /api/finance/instruments/[symbol]/intraday (which is equity-only, always
 * appends ".NS"). `symbol` MUST be exactly "NIFTY" or "BANKNIFTY" — this is
 * deliberately not a general index-symbol endpoint (the brief's own scope
 * note), every other value 400s.
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
  if (!isIndexUnderlying(symbol)) {
    return NextResponse.json({ error: "Only NIFTY and BANKNIFTY are supported on this endpoint." }, { status: 400 });
  }

  const series = await fetchIndexIntradaySeries(symbol);
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
