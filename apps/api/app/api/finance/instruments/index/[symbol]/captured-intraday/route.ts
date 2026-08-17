import { NextResponse } from "next/server";

import { getSelfCapturedIndexSeries } from "@/lib/marketMoves/indexIntradaySeries";

export const dynamic = "force-dynamic";

/** Matches PriceChart's 1M window (RANGE_INTERVAL["1M"].sessions in price-chart.tsx). */
const DEFAULT_SESSIONS = 22;
/** Matches IndexIntradaySnapshot's own 60-day prune retention window — never worth requesting more than could possibly exist. */
const MAX_SESSIONS = 60;

/**
 * GET /api/finance/instruments/index/[symbol]/captured-intraday?indexName=<NSE display name>&sessions=<N>
 *
 * "Serious Charts" Program, Workstream B (2026-08-17) — self-captured-series
 * sibling of the `/candles` route, for long-tail NSE indices that have no
 * Yahoo ticker to resolve (see indexLongTail.ts's own module doc). `[symbol]`
 * is kept in the path purely for URL-family consistency with the sibling
 * `/candles`, `/intraday`, `/quote` routes — the real lookup key is
 * `indexName` (IndexIntradaySnapshot.indexName, NSE's own verbatim display
 * name), already resolved server-side by the caller (apps/web's
 * instrument.ts already computes this for its own long-tail branch — no
 * second resolver is invented here).
 *
 * Line-series only — no OHLC fields, ever (see IndexIntradaySnapshot's own
 * schema doc: one `last` value per snapshot, never a real bar).
 *
 * Public endpoint — no auth required. Short cache: near-live data during
 * market hours, same 60s convention as the candles route's intraday tier.
 */
export async function GET(request: Request, { params }: { params: { symbol: string } }) {
  const rawSymbol = params.symbol;
  if (!rawSymbol || typeof rawSymbol !== "string") {
    return NextResponse.json({ error: "Symbol is required." }, { status: 400 });
  }

  const url = new URL(request.url);
  const indexName = url.searchParams.get("indexName")?.trim();
  if (!indexName) {
    return NextResponse.json({ error: "indexName query param is required." }, { status: 400 });
  }

  const rawSessions = url.searchParams.get("sessions");
  const parsedSessions = rawSessions ? Number.parseInt(rawSessions, 10) : DEFAULT_SESSIONS;
  const sessions =
    Number.isFinite(parsedSessions) && parsedSessions > 0 ? Math.min(parsedSessions, MAX_SESSIONS) : DEFAULT_SESSIONS;

  const series = await getSelfCapturedIndexSeries(indexName, sessions);

  const response = NextResponse.json({
    symbol: rawSymbol.trim().toUpperCase(),
    indexName,
    points: series.points,
    from: series.from,
    sessionsAvailable: series.sessionsAvailable,
    asOf: new Date().toISOString(),
  });
  response.headers.set("Cache-Control", "public, max-age=60");
  return response;
}
