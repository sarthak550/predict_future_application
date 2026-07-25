/**
 * Trading Terminal UI Overhaul (Sprint A, T2) — index intraday (1-minute tick)
 * chart fetcher for NIFTY / BANKNIFTY, promoting
 * lib/paperTrading/optionsExpiry.ts's single-number `fetchIndexSpotFallback`
 * into a real series fetch. Same Yahoo chart endpoint, same
 * `YAHOO_INDEX_TICKER` map (imported from optionsExpiry.ts, not duplicated),
 * same `^NSEI` / `^NSEBANK` tickers already proven live in that file.
 *
 * Returns the EXACT SAME shape as the equity `IntradaySeries`
 * (lib/marketMoves/intraday.ts) so the apps/api route, the apps/web proxy, and
 * ultimately PriceChart's `intradaySource` prop are all thin wrappers rather
 * than a parallel implementation — one response shape, two upstream fetchers.
 *
 * `prevClose` source: an index has no StockEodQuote row (that table is
 * equity-only), so unlike the equity fetcher there is no DB fallback — this
 * relies entirely on Yahoo's own `meta.chartPreviousClose` (verified present
 * on the live index chart payload, same field name as the equity payload).
 * Null when Yahoo omits it, never a fabricated number.
 */

import { YAHOO_INDEX_TICKER } from "../paperTrading/optionsExpiry";

const YAHOO_CHART_BASE = "https://query1.finance.yahoo.com/v8/finance/chart";
const YAHOO_TIMEOUT_MS = 8000;
const CACHE_TTL_MS = 60 * 1000; // same in-module TTL convention as the equity fetcher's cache

export type IndexUnderlying = "NIFTY" | "BANKNIFTY";

export type IndexIntradayPoint = { t: number; price: number };

/** Same shape as marketMoves/intraday.ts's IntradaySeries — this is what makes the apps/api route and PriceChart integration thin wrappers instead of a parallel type. */
export type IndexIntradaySeries = {
  points: IndexIntradayPoint[];
  prevClose: number | null;
  sessionLabel: string;
  volume: number | null;
};

type YahooChartResponse = {
  chart?: {
    result?: Array<{
      meta?: { chartPreviousClose?: number | null; previousClose?: number | null; regularMarketVolume?: number | null };
      timestamp?: unknown;
      indicators?: { quote?: Array<{ close?: unknown }> };
    } | null> | null;
    error?: unknown;
  };
};

const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;

/** "22 Jul 2026" in IST, from an epoch-millis timestamp — identical formatting to the equity fetcher's formatIstSessionLabel, deliberately duplicated (not exported from intraday.ts) to keep this file's only cross-module dependency the YAHOO_INDEX_TICKER map. */
function formatIstSessionLabel(epochMs: number): string {
  const ist = new Date(epochMs + IST_OFFSET_MS);
  const day = String(ist.getUTCDate()).padStart(2, "0");
  const month = ist.toLocaleString("en-US", { month: "short", timeZone: "UTC" });
  const year = ist.getUTCFullYear();
  return `${day} ${month} ${year}`;
}

function zipYahooTicks(timestamps: unknown, closes: unknown): IndexIntradayPoint[] {
  if (!Array.isArray(timestamps) || !Array.isArray(closes)) return [];
  const points: IndexIntradayPoint[] = [];
  for (let i = 0; i < timestamps.length; i++) {
    const t = Number(timestamps[i]);
    const price = Number(closes[i]);
    if (Number.isFinite(t) && Number.isFinite(price) && price > 0) {
      points.push({ t: t * 1000, price });
    }
  }
  return points.sort((a, b) => a.t - b.t);
}

type CacheEntry = { at: number; data: IndexIntradaySeries | null };
const cache = new Map<IndexUnderlying, CacheEntry>();

/**
 * Fetches today's (or, after close, the last session's) 1-minute intraday tick
 * series for NIFTY or BANKNIFTY. Never throws — returns null on any
 * fetch/parse failure or an empty series, matching the equity fetcher's
 * clean-failure contract exactly (verified against
 * lib/marketMoves/intraday.ts's fetchIntradaySeries return shape). Cached
 * in-module per underlying for CACHE_TTL_MS (60s).
 */
export async function fetchIndexIntradaySeries(underlying: IndexUnderlying): Promise<IndexIntradaySeries | null> {
  const cached = cache.get(underlying);
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) return cached.data;

  const result = await fetchIndexIntradaySeriesUncached(underlying);
  cache.set(underlying, { at: Date.now(), data: result });
  return result;
}

async function fetchIndexIntradaySeriesUncached(underlying: IndexUnderlying): Promise<IndexIntradaySeries | null> {
  const ticker = YAHOO_INDEX_TICKER[underlying];
  if (!ticker) return null;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), YAHOO_TIMEOUT_MS);
  try {
    const res = await fetch(`${YAHOO_CHART_BASE}/${encodeURIComponent(ticker)}?interval=1m&range=1d&includePrePost=false`, {
      headers: { "User-Agent": "Mozilla/5.0", Accept: "application/json" },
      cache: "no-store",
      signal: controller.signal
    });
    if (!res.ok) return null;
    const raw = (await res.json()) as YahooChartResponse;

    const result = raw?.chart?.result?.[0];
    if (!result) return null;

    const points = zipYahooTicks(result.timestamp, result.indicators?.quote?.[0]?.close);
    if (points.length === 0) return null;

    // Verified empirically against the live index chart payload: Yahoo carries
    // this as `chartPreviousClose` (same field name as the equity payload) —
    // `previousClose` is checked as a defensive fallback only, never the
    // primary path.
    const rawPrevClose = result.meta?.chartPreviousClose ?? result.meta?.previousClose;
    const prevClose = Number.isFinite(rawPrevClose as number) && (rawPrevClose as number) > 0 ? (rawPrevClose as number) : null;

    const sessionLabel = formatIstSessionLabel(points[points.length - 1].t);
    const rawVolume = result.meta?.regularMarketVolume;
    const volume = Number.isFinite(rawVolume as number) && (rawVolume as number) > 0 ? (rawVolume as number) : null;

    return { points, prevClose, sessionLabel, volume };
  } catch (err) {
    console.warn(`[marketMoves/indexIntraday] fetch failed for ${underlying}: ${err instanceof Error ? err.message : err}`);
    return null;
  } finally {
    clearTimeout(timeout);
  }
}
