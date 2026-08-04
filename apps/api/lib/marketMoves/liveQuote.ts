/**
 * Quote-driven intrabar ticks — founder complaint (live market open,
 * 2026-08-04): "The candles are stale and I dont see the live fluctuations,
 * for any trading platform live price change is necessary."
 *
 * Root cause (diagnosed separately, not re-litigated here): the workbench's
 * candle poll (candles.ts, 60s server cache) and the SVG chart's intraday
 * poll (intraday.ts / indexIntraday.ts, 60s server cache) are both correct
 * and genuinely live — the gap is CADENCE. Between polls, the current bar
 * simply never visibly moves.
 *
 * This module is a FAST, minimal sibling of those two — deliberately NOT a
 * replacement, NOT a new Yahoo integration: it reuses the EXACT same proven
 * request shape those modules already run in production every day
 * (`https://query1.finance.yahoo.com/v8/finance/chart/<ticker>`, same
 * headers, same no-store/abort discipline), because this is a live
 * production fix and an unverified new upstream shape (e.g. Yahoo's
 * separate `v7/finance/quote` endpoint, which has historically required a
 * crumb/cookie handshake this codebase doesn't implement) is not a
 * responsible gamble to take mid-incident.
 *
 * The one deliberate difference from intraday.ts/candles.ts: `range=1d`
 * with `interval=1d` instead of `interval=1m` — Yahoo's `meta` block
 * (`regularMarketPrice`/`regularMarketTime`) is a session-quote snapshot
 * that's populated independent of the bar granularity requested, so this
 * fetches a MUCH smaller payload (one daily bar) purely to read that
 * snapshot, appropriate for a poll running every ~4-5s rather than every
 * 60s. Falls back to reading the (still present, just coarser) array's own
 * last point if `meta.regularMarketPrice` is ever absent — never a second
 * upstream shape, just a defensive read of data already in the response.
 *
 * Cache: a SEPARATE, much shorter TTL (~4s, not 60s) from
 * candles.ts/intraday.ts/indexIntraday.ts's own caches — sized to the
 * client's ~4-5s poll cadence (see apps/web's `use-live-quote-tick.ts`) so
 * every concurrent viewer of the same symbol shares ONE upstream Yahoo hit
 * per ~4s window, never one hit per browser tab. This is intentionally a
 * DIFFERENT cache from the 60s ones — reusing those would cap the effective
 * update rate at 60s regardless of how often the client asks, defeating the
 * whole point of this module.
 */

import { YAHOO_INDEX_SPOT_TICKER, type IndexOptionUnderlying } from "@predict-future/business-rules/papertrading/optionContract";

const YAHOO_CHART_BASE = "https://query1.finance.yahoo.com/v8/finance/chart";
const YAHOO_TIMEOUT_MS = 8000;

/** ~4-5s client poll cadence (see use-live-quote-tick.ts) minus a little headroom, so a client tick essentially always finds a fresh cache entry waiting rather than racing a just-expired one. */
const QUOTE_CACHE_TTL_MS = 4000;
const QUOTE_CACHE_MAX_ENTRIES = 200;

export interface LiveQuote {
  price: number;
  /** Epoch ms. From Yahoo's own `regularMarketTime` when present, else the fallback array's own last timestamp. Informational only on the wire — apps/web's fold logic uses its OWN client-side receipt clock for bar-boundary decisions (see use-live-quote-tick.ts's doc for why), so a moderately stale/skewed value here can never cause a dishonest chart, only a slightly-off debugging figure. */
  asOf: number;
}

type YahooQuoteResponse = {
  chart?: {
    result?: Array<{
      meta?: { regularMarketPrice?: number | null; regularMarketTime?: number | null } | null;
      timestamp?: unknown;
      indicators?: { quote?: Array<{ close?: unknown }> | null } | null;
    } | null> | null;
    error?: unknown;
  };
};

type CacheEntry = { at: number; data: LiveQuote | null };
const cache = new Map<string, CacheEntry>();

/** Same insertion-order eviction convention as candles.ts/intraday.ts's own caches. */
function evictOldestIfFull(): void {
  if (cache.size < QUOTE_CACHE_MAX_ENTRIES) return;
  const oldestKey = cache.keys().next().value;
  if (oldestKey !== undefined) cache.delete(oldestKey);
}

async function fetchYahooLiveQuoteUncached(ticker: string): Promise<LiveQuote | null> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), YAHOO_TIMEOUT_MS);
  try {
    const url = `${YAHOO_CHART_BASE}/${encodeURIComponent(ticker)}?interval=1d&range=1d&includePrePost=false`;
    const res = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0", Accept: "application/json" },
      cache: "no-store",
      signal: controller.signal
    });
    if (!res.ok) return null;
    const raw = (await res.json()) as YahooQuoteResponse;

    const result = raw?.chart?.result?.[0];
    if (!result) return null;

    const metaPrice = result.meta?.regularMarketPrice;
    if (Number.isFinite(metaPrice as number) && (metaPrice as number) > 0) {
      const metaTime = result.meta?.regularMarketTime;
      const asOf = Number.isFinite(metaTime as number) ? (metaTime as number) * 1000 : Date.now();
      return { price: metaPrice as number, asOf };
    }

    // Meta price absent (not expected in practice, but never assumed) —
    // fall back to the array's own last non-null point, same read every
    // other fetcher in this directory already performs.
    const timestamps = result.timestamp;
    const closes = result.indicators?.quote?.[0]?.close;
    if (!Array.isArray(timestamps) || !Array.isArray(closes)) return null;
    for (let i = timestamps.length - 1; i >= 0; i--) {
      const price = Number(closes[i]);
      const t = Number(timestamps[i]);
      if (Number.isFinite(price) && price > 0 && Number.isFinite(t)) {
        return { price, asOf: t * 1000 };
      }
    }
    return null;
  } catch (err) {
    const isAbort = err instanceof Error && err.name === "AbortError";
    console.warn(`[marketMoves/liveQuote] fetch failed for ${ticker}: ${isAbort ? "timed out" : err instanceof Error ? err.message : err}`);
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchCached(cacheKey: string, ticker: string): Promise<LiveQuote | null> {
  const cached = cache.get(cacheKey);
  if (cached && Date.now() - cached.at < QUOTE_CACHE_TTL_MS) return cached.data;

  const result = await fetchYahooLiveQuoteUncached(ticker);
  evictOldestIfFull();
  cache.set(cacheKey, { at: Date.now(), data: result });
  return result;
}

/**
 * Fast last-price tick for an NSE equity symbol (bare symbol, e.g.
 * "RELIANCE" — ".NS" appended here, same convention as
 * lib/marketMoves/intraday.ts). Never throws; null on any upstream/parse
 * failure so the route layer can 404 cleanly.
 */
export async function fetchLiveEquityQuote(symbol: string): Promise<LiveQuote | null> {
  const clean = symbol.trim().toUpperCase();
  if (!clean) return null;
  return fetchCached(`EQ:${clean}`, `${clean}.NS`);
}

/**
 * Fast last-price tick for an index underlying, via the same
 * `YAHOO_INDEX_SPOT_TICKER` map lib/marketMoves/indexIntraday.ts and
 * lib/paperTrading/optionsExpiry.ts already use (not duplicated). Covers all
 * 5 registry underlyings (NIFTY/BANKNIFTY/FINNIFTY/MIDCPNIFTY/NIFTYNXT50) —
 * the same scope indexIntraday.ts's own route already accepts today (its
 * type guard checks full `IndexOptionUnderlying` membership, not just the
 * two named in that file's doc comment).
 */
export async function fetchLiveIndexQuote(underlying: IndexOptionUnderlying): Promise<LiveQuote | null> {
  const ticker = YAHOO_INDEX_SPOT_TICKER[underlying];
  if (!ticker) return null;
  return fetchCached(`IDX:${underlying}`, ticker);
}
