import { NextResponse } from "next/server";

import { fetchYahooCandles } from "@/lib/marketMoves/candles";

export const dynamic = "force-dynamic";

/**
 * GET /api/finance/market-summary
 *
 * Homepage "Indian Economy" section (2026-08-09 founder request) — a fixed,
 * honest set of India-market summary tiles: NIFTY 50, SENSEX, BANK NIFTY,
 * and USD/INR. Deliberately NOT routed through `allIndices.ts` (NSE's own
 * `/api/allIndices`, which is NIFTY-family only — no SENSEX, no forex).
 * Instead reuses `fetchYahooCandles` (the SAME fetcher the Charting
 * Workbench and equity/index candle routes already run in production)
 * against each ticker's canonical Yahoo symbol directly — proven live
 * 2026-08-09: `^NSEI` (NIFTY 50), `^BSESN` (SENSEX), `^NSEBANK` (BANK
 * NIFTY, matches `YAHOO_INDEX_SPOT_TICKER.BANKNIFTY` in
 * packages/business-rules), `INR=X` (USD/INR, Yahoo's generic FX chart
 * ticker — confirmed to resolve with `longName: "USD/INR"`).
 *
 * `interval=1d` gives each tile ~5y of daily closes from one cached fetch
 * (fetchYahooCandles's own 300s in-module TTL); this route trims to the
 * last 30 sessions for a compact sparkline, reusing InstrumentSparkline's
 * own `{sessionDate, close}` shape on the web side — no new charting code.
 *
 * A tile whose fetch fails gets `last: null, changePercent: null,
 * changeAbs: null, spark: []` — never a fabricated number. The route
 * itself always 200s (each tile degrades independently); callers render
 * a per-tile "unavailable" state rather than losing the whole section.
 *
 * **Discovered bug, worked around here, NOT fixed upstream** (2026-08-09):
 * `fetchYahooCandles`'s `prevClose` (from Yahoo's `meta.chartPreviousClose`)
 * is WRONG for the "1d" interval's 5-year `period1`/`period2` query shape —
 * verified live for both `^NSEI` (16280.1, vs a real previous close of
 * ~24636) and `RELIANCE.NS` (963.635, vs a real previous close of ~1325):
 * Yahoo appears to return the close from near the START of the requested
 * 5-year window, not yesterday's close, for this specific query shape. This
 * is a PRE-EXISTING bug that also affects the live Charting Workbench's own
 * "1d" timeframe quote chip (`use-workbench-candles.ts` reads the same
 * `prevClose` field) — flagged to the CEO/CTO separately rather than
 * silently patched here, since `candles.ts` is shared production code this
 * task has no mandate to touch. This route sidesteps it entirely: prevClose
 * is always computed from the candle ARRAY's own second-to-last daily
 * close, never from `series.prevClose`.
 *
 * `indexSlug` links a tile to its existing `/indices/[slug]` detail page
 * where one exists (NIFTY 50, BANK NIFTY — both NSE-published, so
 * `allIndices.ts` already serves them there). SENSEX (BSE, not in NSE's
 * index feed) and USD/INR (no forex detail page in this product) get
 * `indexSlug: null` — the web tile renders as non-clickable rather than
 * linking to a page that doesn't exist.
 */

const SPARK_SESSIONS = 30;

type TileDef = {
  key: string;
  label: string;
  yahooTicker: string;
  indexSlug: string | null;
};

const TILES: TileDef[] = [
  { key: "NIFTY50", label: "NIFTY 50", yahooTicker: "^NSEI", indexSlug: "nifty-50" },
  { key: "SENSEX", label: "SENSEX", yahooTicker: "^BSESN", indexSlug: null },
  { key: "BANKNIFTY", label: "BANK NIFTY", yahooTicker: "^NSEBANK", indexSlug: "nifty-bank" },
  { key: "USDINR", label: "USD/INR", yahooTicker: "INR=X", indexSlug: null },
];

type TileResult = {
  key: string;
  label: string;
  indexSlug: string | null;
  last: number | null;
  changePercent: number | null;
  changeAbs: number | null;
  spark: { sessionDate: string; close: number }[];
};

async function fetchTile(def: TileDef): Promise<TileResult> {
  const series = await fetchYahooCandles(def.yahooTicker, "1d");
  const empty: TileResult = {
    key: def.key,
    label: def.label,
    indexSlug: def.indexSlug,
    last: null,
    changePercent: null,
    changeAbs: null,
    spark: [],
  };
  if (!series || series.candles.length === 0) return empty;

  const candles = series.candles;
  const lastCandle = candles[candles.length - 1];
  // Deliberately NOT `series.prevClose` — see the module doc's "Discovered
  // bug" note. The second-to-last daily bar's own close is the real
  // previous session's close for a daily series.
  const prevClose = candles[candles.length - 2]?.close ?? series.prevClose ?? null;

  const last = lastCandle.close;
  const changeAbs = prevClose != null ? last - prevClose : null;
  const changePercent = prevClose != null && prevClose !== 0 ? (changeAbs! / prevClose) * 100 : null;

  const spark = candles.slice(-SPARK_SESSIONS).map((c) => ({
    sessionDate: new Date(c.timestamp).toISOString(),
    close: c.close,
  }));

  return { key: def.key, label: def.label, indexSlug: def.indexSlug, last, changePercent, changeAbs, spark };
}

export async function GET() {
  const tiles = await Promise.all(TILES.map(fetchTile));

  const response = NextResponse.json({ asOf: new Date().toISOString(), tiles });
  response.headers.set("Cache-Control", "public, max-age=60");
  return response;
}
