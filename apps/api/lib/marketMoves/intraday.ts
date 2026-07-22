/**
 * Market Pulse — intraday (1-minute tick) chart fetcher.
 *
 * Backs the "1D" timeframe on the instrument price chart. Source: Yahoo
 * Finance's keyless chart API with the `.NS` (NSE) suffix:
 *
 *   GET https://query1.finance.yahoo.com/v8/finance/chart/<SYMBOL>.NS?interval=1m&range=1d
 *
 * WHY NOT NSE's own chart-databyindex: that endpoint answers HTTP 200 but
 * with an EMPTY grapthData array to any non-browser client — its Akamai
 * bot-sensor gate is stricter than the live-analysis-variations /
 * corporate-announcements endpoints nse.ts uses (verified 2026-07-22 from
 * BOTH the dev sandbox and the production EC2 IP, with the full cookie
 * handshake + Referer). Yahoo verified from EC2 the same day: 1-minute
 * ticks flowing, and its chartPreviousClose exactly matched our own
 * StockEodQuote close for RELIANCE (₹1,303.70).
 *
 * During market hours Yahoo returns the current session's ticks so far;
 * after close it returns the last completed session. Either way it's what a
 * "1D" chart wants: the most recent full or partial trading day.
 */

import { prisma } from "../prisma";

const YAHOO_CHART_BASE = "https://query1.finance.yahoo.com/v8/finance/chart";
const YAHOO_TIMEOUT_MS = 8000;

/** One intraday tick: epoch-millis timestamp + traded price. */
export type IntradayPoint = { t: number; price: number };

export type IntradaySeries = {
  points: IntradayPoint[];
  /** Previous session's close, from our own StockEodQuote store. Null if we have no EOD row for this symbol yet. */
  prevClose: number | null;
  /** Human label for the session the points belong to, e.g. "22 Jul 2026" (IST calendar date of the last tick). */
  sessionLabel: string;
  /** Session volume so far (Yahoo's regularMarketVolume). Null when the source omits it. */
  volume: number | null;
};

/** The slice of Yahoo's v8 chart response this module reads. */
type YahooChartResponse = {
  chart?: {
    result?: Array<{
      meta?: { chartPreviousClose?: number | null; regularMarketVolume?: number | null };
      timestamp?: unknown;
      indicators?: { quote?: Array<{ close?: unknown }> };
    } | null> | null;
    error?: unknown;
  };
};

const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;

/** "22 Jul 2026" in IST, from an epoch-millis timestamp. */
function formatIstSessionLabel(epochMs: number): string {
  const ist = new Date(epochMs + IST_OFFSET_MS);
  const day = String(ist.getUTCDate()).padStart(2, "0");
  const month = ist.toLocaleString("en-US", { month: "short", timeZone: "UTC" });
  const year = ist.getUTCFullYear();
  return `${day} ${month} ${year}`;
}

/**
 * Zips Yahoo's parallel arrays (timestamp[] in SECONDS, close[] with nulls
 * for minutes with no trade) into sorted {t: epochMillis, price} points.
 */
function zipYahooTicks(timestamps: unknown, closes: unknown): IntradayPoint[] {
  if (!Array.isArray(timestamps) || !Array.isArray(closes)) return [];
  const points: IntradayPoint[] = [];
  for (let i = 0; i < timestamps.length; i++) {
    const t = Number(timestamps[i]);
    const price = Number(closes[i]);
    // price > 0: Yahoo emits 0 (not null) for the in-progress/unsettled
    // minute — a real traded price is never 0, so drop those ticks.
    if (Number.isFinite(t) && Number.isFinite(price) && price > 0) {
      points.push({ t: t * 1000, price });
    }
  }
  return points.sort((a, b) => a.t - b.t);
}

/** TTL cache entry for one symbol's intraday series. */
type CacheEntry = { at: number; data: IntradaySeries | null };

const CACHE_TTL_MS = 60 * 1000;
const CACHE_MAX_SYMBOLS = 200;
const cache = new Map<string, CacheEntry>();

/** Evicts the oldest cache entry when the cache is at capacity — simple insertion-order eviction (Map preserves insertion order). */
function evictOldestIfFull(): void {
  if (cache.size < CACHE_MAX_SYMBOLS) return;
  const oldestKey = cache.keys().next().value;
  if (oldestKey !== undefined) cache.delete(oldestKey);
}

/**
 * Fetches the latest StockEodQuote close for `symbol`, used as the 1D
 * chart's "previous close" baseline. Returns null on any error or when no
 * row exists yet — callers must fall back to the series' own first tick.
 */
async function fetchPrevCloseFromEod(symbol: string): Promise<number | null> {
  try {
    const latest = await prisma.stockEodQuote.findFirst({
      where: { symbol },
      orderBy: { sessionDate: "desc" },
      select: { close: true },
    });
    return latest?.close ?? null;
  } catch (err) {
    console.warn(`[marketMoves/intraday] StockEodQuote lookup failed for ${symbol}: ${err instanceof Error ? err.message : err}`);
    return null;
  }
}

/**
 * Fetches today's (or, after close, the last session's) 1-minute intraday
 * tick series for an NSE equity symbol, from NSE's own chart-databyindex
 * endpoint — the same one the exchange's quote-page sparkline uses.
 *
 * Never throws — returns null on any fetch/parse failure or an empty series,
 * so the route layer can 404 cleanly rather than propagate a 500.
 *
 * Cached in-module per symbol for `CACHE_TTL_MS` (60s) with a simple
 * insertion-order eviction once `CACHE_MAX_SYMBOLS` distinct symbols have
 * been requested in the current process lifetime — bounds memory on a
 * long-running container without needing a real LRU.
 */
export async function fetchIntradaySeries(symbol: string): Promise<IntradaySeries | null> {
  const cleanSymbol = symbol.trim().toUpperCase();
  if (!cleanSymbol) return null;

  const cached = cache.get(cleanSymbol);
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) {
    return cached.data;
  }

  const result = await fetchIntradaySeriesUncached(cleanSymbol);

  evictOldestIfFull();
  cache.set(cleanSymbol, { at: Date.now(), data: result });
  return result;
}

async function fetchIntradaySeriesUncached(symbol: string): Promise<IntradaySeries | null> {
  try {
    const url = `${YAHOO_CHART_BASE}/${encodeURIComponent(symbol)}.NS?interval=1m&range=1d&includePrePost=false`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), YAHOO_TIMEOUT_MS);
    let raw: unknown;
    try {
      const res = await fetch(url, {
        headers: { "User-Agent": "Mozilla/5.0", Accept: "application/json" },
        cache: "no-store",
        signal: controller.signal,
      });
      if (!res.ok) return null;
      raw = await res.json();
    } finally {
      clearTimeout(timeout);
    }

    const result = (raw as YahooChartResponse)?.chart?.result?.[0];
    if (!result) return null;

    const points = zipYahooTicks(result.timestamp, result.indicators?.quote?.[0]?.close);
    if (points.length === 0) return null;

    const metaPrevClose = result.meta?.chartPreviousClose;
    const prevClose =
      Number.isFinite(metaPrevClose as number) && (metaPrevClose as number) > 0
        ? (metaPrevClose as number)
        : await fetchPrevCloseFromEod(symbol);
    const sessionLabel = formatIstSessionLabel(points[points.length - 1].t);
    const rawVolume = result.meta?.regularMarketVolume;
    const volume = Number.isFinite(rawVolume as number) && (rawVolume as number) > 0 ? (rawVolume as number) : null;

    return { points, prevClose, sessionLabel, volume };
  } catch (err) {
    console.warn(`[marketMoves/intraday] fetch failed for ${symbol}: ${err instanceof Error ? err.message : err}`);
    return null;
  }
}
