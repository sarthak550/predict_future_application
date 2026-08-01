/**
 * Charting Workbench (W1) — OHLCV candle fetcher backing the KLineCharts
 * workbench (W2/W3). Sibling of `intraday.ts` (the "1D" line-chart tick
 * fetcher this file deliberately does NOT touch or refactor) reusing the
 * same discipline — in-module TTL cache, 8s abort, never throws — but reads
 * `indicators.quote[0]` as full OHLCV bars instead of a single `close`
 * series, because a candlestick chart needs open/high/low/volume that the
 * line chart never did.
 *
 * One shared fetcher for BOTH equity and index tickers (unlike intraday.ts's
 * split into `intraday.ts` + `indexIntraday.ts`) — callers pass the fully
 * resolved Yahoo ticker (`"RELIANCE.NS"` or `"^NSEI"`), so this module has no
 * opinion on how a symbol maps to a ticker; that resolution lives in the two
 * route files.
 *
 * Interval → range is SERVER-OWNED, never client-supplied — each interval
 * gets exactly the window that makes sense for it (a 1-minute chart showing
 * 5 years of bars would be both useless and a multi-megabyte response):
 *
 *   1m         → range=1d   (today's/last session's minute bars)
 *   5m         → range=5d
 *   15m / 30m  → range=1mo
 *   60m        → range=3mo
 *   1d         → period1=(now-5y) .. period2=now, the same period1/period2
 *                query shape proven in lib/finance/priceHistory.ts
 */

import { prisma } from "../prisma";

const YAHOO_CHART_BASE = "https://query1.finance.yahoo.com/v8/finance/chart";
const YAHOO_TIMEOUT_MS = 8000;
const ONE_DAY_MS = 24 * 60 * 60 * 1000;
const FIVE_YEARS_MS = 5 * 365 * ONE_DAY_MS;

export const CANDLE_INTERVALS = ["1m", "5m", "15m", "30m", "60m", "1d"] as const;
export type CandleInterval = (typeof CANDLE_INTERVALS)[number];

export function isCandleInterval(value: string): value is CandleInterval {
  return (CANDLE_INTERVALS as readonly string[]).includes(value);
}

/** One OHLCV bar. Field names match KLineCharts' `KLineData` verbatim — the route layer passes these straight through with zero remapping. */
export type Candle = {
  timestamp: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
};

export type CandleSeries = {
  candles: Candle[];
  /** Previous session's close. From Yahoo's own `meta.chartPreviousClose`, falling back to our StockEodQuote store (equity tickers only — an index ticker has no StockEodQuote row and simply gets null from that lookup). Null if neither source has it. */
  prevClose: number | null;
};

/** The slice of Yahoo's v8 chart response this module reads — wider than intraday.ts's, since a candle needs the full OHLCV quote array, not just `close`. */
type YahooCandleChartResponse = {
  chart?: {
    result?: Array<{
      meta?: { chartPreviousClose?: number | null } | null;
      timestamp?: unknown;
      indicators?: {
        quote?: Array<{
          open?: unknown;
          high?: unknown;
          low?: unknown;
          close?: unknown;
          volume?: unknown;
        }> | null;
      } | null;
    } | null> | null;
    error?: unknown;
  };
};

/**
 * Zips Yahoo's parallel OHLCV arrays into sorted, deduped `Candle[]`.
 * A bar is dropped (not zero-filled) when any of open/high/low/close is
 * non-finite or <= 0 — Yahoo emits these for the in-progress/unsettled bar
 * and for illiquid minutes, and a candlestick chart must never render a
 * fabricated zero-price wick. `volume` nulls become 0 (a real "no trades
 * this bar" is a valid, distinct-from-missing value for a candle, unlike
 * intraday.ts's price series where a missing tick is simply skipped).
 * Dedupes by timestamp keeping the LAST occurrence (Yahoo occasionally
 * repeats the boundary bar between adjacent requests/cache states).
 */
function zipYahooCandles(
  timestamps: unknown,
  quote: { open?: unknown; high?: unknown; low?: unknown; close?: unknown; volume?: unknown } | undefined
): Candle[] {
  if (!Array.isArray(timestamps) || !quote) return [];
  const opens = quote.open;
  const highs = quote.high;
  const lows = quote.low;
  const closes = quote.close;
  const volumes = quote.volume;
  if (!Array.isArray(opens) || !Array.isArray(highs) || !Array.isArray(lows) || !Array.isArray(closes)) return [];

  const byTimestamp = new Map<number, Candle>();
  for (let i = 0; i < timestamps.length; i++) {
    const t = Number(timestamps[i]);
    const open = Number(opens[i]);
    const high = Number(highs[i]);
    const low = Number(lows[i]);
    const close = Number(closes[i]);
    if (!Number.isFinite(t) || !Number.isFinite(open) || !Number.isFinite(high) || !Number.isFinite(low) || !Number.isFinite(close)) {
      continue;
    }
    if (open <= 0 || high <= 0 || low <= 0 || close <= 0) continue;

    const rawVolume = Array.isArray(volumes) ? Number(volumes[i]) : NaN;
    const volume = Number.isFinite(rawVolume) && rawVolume > 0 ? rawVolume : 0;

    // Insertion order into a Map with a numeric key naturally keeps-last on
    // a repeated timestamp (a later same-key `set` overwrites in place
    // without moving the key's position), so a final sort by timestamp is
    // still required but no separate dedupe pass is needed.
    byTimestamp.set(t, { timestamp: t * 1000, open, high, low, close, volume });
  }

  return Array.from(byTimestamp.values()).sort((a, b) => a.timestamp - b.timestamp);
}

/** Server-owned `range` query param per intraday/short-daily interval — never accepted from the caller. */
const INTERVAL_RANGE: Record<Exclude<CandleInterval, "1d">, string> = {
  "1m": "1d",
  "5m": "5d",
  "15m": "1mo",
  "30m": "1mo",
  "60m": "3mo",
};

/** TTL cache entry for one `${ticker}|${interval}` key. */
type CacheEntry = { at: number; data: CandleSeries | null };

const CACHE_TTL_INTRADAY_MS = 60 * 1000;
const CACHE_TTL_DAILY_MS = 300 * 1000;
const CACHE_MAX_ENTRIES = 300;
const cache = new Map<string, CacheEntry>();

/** Simple insertion-order eviction (Map preserves insertion order) once the cache is at capacity — same posture as intraday.ts's evictOldestIfFull, bounds memory on a long-running container without needing a real LRU. */
function evictOldestIfFull(): void {
  if (cache.size < CACHE_MAX_ENTRIES) return;
  const oldestKey = cache.keys().next().value;
  if (oldestKey !== undefined) cache.delete(oldestKey);
}

/**
 * Fallback StockEodQuote lookup for `prevClose` when Yahoo's own
 * `meta.chartPreviousClose` is absent. Equity tickers only in practice — an
 * index ticker (e.g. "^NSEI") never matches a StockEodQuote row (that table
 * is NSE-equity-only, bare symbol like "RELIANCE"), so this naturally
 * no-ops for index candles rather than needing an index/equity branch here.
 * `bareSymbol` is the ticker with a trailing ".NS" stripped, uppercased.
 */
async function fetchPrevCloseFromEod(yahooTicker: string): Promise<number | null> {
  const bareSymbol = yahooTicker.toUpperCase().endsWith(".NS") ? yahooTicker.slice(0, -3).toUpperCase() : null;
  if (!bareSymbol) return null;
  try {
    const latest = await prisma.stockEodQuote.findFirst({
      where: { symbol: bareSymbol },
      orderBy: { sessionDate: "desc" },
      select: { close: true },
    });
    return latest?.close ?? null;
  } catch (err) {
    console.warn(`[marketMoves/candles] StockEodQuote lookup failed for ${bareSymbol}: ${err instanceof Error ? err.message : err}`);
    return null;
  }
}

/**
 * Fetches OHLCV candles for `yahooTicker` at `interval`, with a
 * server-owned range/period window (see the module doc comment's table).
 *
 * Never throws — any network/parse failure, upstream error, or an empty
 * result set after filtering returns `null`, so the route layer can 404
 * cleanly rather than propagate a 500.
 *
 * Cached in-module per `${yahooTicker}|${interval}` key: 60s TTL for every
 * intraday interval (1m/5m/15m/30m/60m), 300s for `1d` (daily bars change
 * far less often — no need to re-hit Yahoo every minute for a 5-year
 * series). Insertion-order eviction once `CACHE_MAX_ENTRIES` distinct keys
 * have been requested in the current process lifetime.
 */
export async function fetchYahooCandles(yahooTicker: string, interval: CandleInterval): Promise<CandleSeries | null> {
  const ticker = yahooTicker.trim();
  if (!ticker) return null;

  const cacheKey = `${ticker}|${interval}`;
  const cached = cache.get(cacheKey);
  const ttl = interval === "1d" ? CACHE_TTL_DAILY_MS : CACHE_TTL_INTRADAY_MS;
  if (cached && Date.now() - cached.at < ttl) {
    return cached.data;
  }

  const result = await fetchYahooCandlesUncached(ticker, interval);

  evictOldestIfFull();
  cache.set(cacheKey, { at: Date.now(), data: result });
  return result;
}

async function fetchYahooCandlesUncached(ticker: string, interval: CandleInterval): Promise<CandleSeries | null> {
  try {
    const url = buildYahooChartUrl(ticker, interval);
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

    const result = (raw as YahooCandleChartResponse)?.chart?.result?.[0];
    if (!result) return null;

    const candles = zipYahooCandles(result.timestamp, result.indicators?.quote?.[0]);
    if (candles.length === 0) return null;

    const metaPrevClose = result.meta?.chartPreviousClose;
    const prevClose =
      Number.isFinite(metaPrevClose as number) && (metaPrevClose as number) > 0
        ? (metaPrevClose as number)
        : await fetchPrevCloseFromEod(ticker);

    return { candles, prevClose };
  } catch (err) {
    console.warn(`[marketMoves/candles] fetch failed for ${ticker} (${interval}): ${err instanceof Error ? err.message : err}`);
    return null;
  }
}

function buildYahooChartUrl(ticker: string, interval: CandleInterval): string {
  const encodedTicker = encodeURIComponent(ticker);
  if (interval === "1d") {
    const period2 = Math.floor(Date.now() / 1000);
    const period1 = Math.floor((Date.now() - FIVE_YEARS_MS) / 1000);
    return `${YAHOO_CHART_BASE}/${encodedTicker}?interval=1d&period1=${period1}&period2=${period2}&includePrePost=false`;
  }
  const range = INTERVAL_RANGE[interval];
  return `${YAHOO_CHART_BASE}/${encodedTicker}?interval=${interval}&range=${range}&includePrePost=false`;
}
