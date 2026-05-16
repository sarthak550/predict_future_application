/**
 * Yahoo Finance price history utilities for expert opinion auto-resolution.
 *
 * Uses the Yahoo Finance v8 chart API directly via fetch — no npm package needed.
 * All functions are safe to call in batch scripts: errors are logged and return null,
 * never thrown, so callers never need try/catch for normal use.
 */

const YAHOO_FINANCE_BASE = "https://query1.finance.yahoo.com/v8/finance/chart";

const FETCH_HEADERS = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
  "Accept": "application/json",
};

/** One day in milliseconds */
const ONE_DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Fetches raw OHLCV data from Yahoo Finance for a ticker over a date range.
 *
 * @returns Parallel arrays of timestamps (unix seconds) and closing prices, or null on failure.
 */
async function fetchYahooDailyChart(
  ticker: string,
  startDate: Date,
  endDate: Date
): Promise<{ timestamps: number[]; closes: (number | null)[] } | null> {
  const period1 = Math.floor(startDate.getTime() / 1000);
  const period2 = Math.floor(endDate.getTime() / 1000);

  const url = `${YAHOO_FINANCE_BASE}/${encodeURIComponent(ticker)}?interval=1d&period1=${period1}&period2=${period2}`;

  let response: Response;
  try {
    response = await fetch(url, { headers: FETCH_HEADERS });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`[priceHistory] Network error fetching ${ticker}: ${msg}`);
    return null;
  }

  if (response.status === 404) {
    console.warn(`[priceHistory] Unknown ticker: ${ticker} (404)`);
    return null;
  }

  if (!response.ok) {
    console.warn(`[priceHistory] Yahoo Finance returned ${response.status} for ${ticker}`);
    return null;
  }

  let data: unknown;
  try {
    data = await response.json();
  } catch (err) {
    console.warn(`[priceHistory] JSON parse error for ${ticker}: ${err instanceof Error ? err.message : err}`);
    return null;
  }

  // Navigate the chart response shape safely
  const chart = (data as Record<string, unknown>)?.chart as Record<string, unknown> | undefined;
  const result = (chart?.result as unknown[])?.at(0) as Record<string, unknown> | undefined;

  if (!result) {
    const errMsg = (chart?.error as Record<string, unknown>)?.description;
    console.warn(`[priceHistory] No chart result for ${ticker}${errMsg ? `: ${errMsg}` : ""}`);
    return null;
  }

  const timestamps = result.timestamp as number[] | undefined;
  const indicators = result.indicators as Record<string, unknown> | undefined;
  const quoteArr = (indicators?.quote as unknown[])?.at(0) as Record<string, unknown> | undefined;
  const closes = quoteArr?.close as (number | null)[] | undefined;

  if (!Array.isArray(timestamps) || !Array.isArray(closes) || timestamps.length === 0) {
    console.warn(`[priceHistory] Empty price data for ${ticker} between ${startDate.toISOString().slice(0, 10)} and ${endDate.toISOString().slice(0, 10)}`);
    return null;
  }

  return { timestamps, closes };
}

/**
 * Finds the closest non-null closing price on or after a target date.
 *
 * @param timestamps - Unix timestamps (seconds) from Yahoo Finance
 * @param closes - Parallel array of closing prices (may contain nulls for non-trading days)
 * @param targetDate - The date we want a price for
 * @param maxDaysForward - How many days forward to search for the next trading day (default 5)
 */
function findClosestPrice(
  timestamps: number[],
  closes: (number | null)[],
  targetDate: Date,
  maxDaysForward = 5
): number | null {
  const targetMs = targetDate.getTime();
  const maxMs = targetMs + maxDaysForward * ONE_DAY_MS;

  // Find the first entry on or after targetDate that has a valid close
  for (let i = 0; i < timestamps.length; i++) {
    const ts = timestamps[i];
    if (ts === undefined) continue;

    const tsMs = ts * 1000;
    if (tsMs < targetMs) continue;
    if (tsMs > maxMs) break;

    const close = closes[i];
    if (close !== null && close !== undefined && close > 0) {
      return close;
    }
  }

  return null;
}

/**
 * Returns the closing price of `ticker` on or after `date` (nearest trading day).
 * Returns null if price data is unavailable for any reason.
 *
 * @example
 *   const price = await getPriceOnDate("^NSEI", new Date("2026-01-15"));
 */
export async function getPriceOnDate(ticker: string, date: Date): Promise<number | null> {
  // Fetch a window of ±7 days around the date to handle weekends/holidays
  const startDate = new Date(date.getTime() - ONE_DAY_MS); // 1 day before to include the date itself
  const endDate = new Date(date.getTime() + 8 * ONE_DAY_MS);

  const chart = await fetchYahooDailyChart(ticker, startDate, endDate);
  if (!chart) return null;

  return findClosestPrice(chart.timestamps, chart.closes, date);
}

/**
 * Returns price metrics for a resolution window starting at `callDate`.
 *
 * - `priceAtCall`: closing price on or just after the opinion publish date
 * - `priceAtResolution`: closing price on or just after (callDate + windowDays)
 * - `pctChange`: ((priceAtResolution - priceAtCall) / priceAtCall) * 100
 *
 * Returns null if either price is unavailable.
 *
 * @example
 *   const window = await getPriceWindow("^NSEI", new Date("2026-01-01"), 30);
 *   // window?.pctChange → e.g. 3.5 means +3.5% over 30 days
 */
export async function getPriceWindow(
  ticker: string,
  callDate: Date,
  windowDays: number
): Promise<{ priceAtCall: number; priceAtResolution: number; pctChange: number } | null> {
  const resolutionDate = new Date(callDate.getTime() + windowDays * ONE_DAY_MS);

  // Fetch a single chart request covering the full window (+ buffer for trading day search)
  const bufferDays = 8;
  const startDate = new Date(callDate.getTime() - ONE_DAY_MS);
  const endDate = new Date(resolutionDate.getTime() + bufferDays * ONE_DAY_MS);

  const chart = await fetchYahooDailyChart(ticker, startDate, endDate);
  if (!chart) return null;

  const priceAtCall = findClosestPrice(chart.timestamps, chart.closes, callDate);
  const priceAtResolution = findClosestPrice(chart.timestamps, chart.closes, resolutionDate);

  if (priceAtCall === null || priceAtResolution === null) {
    console.warn(
      `[priceHistory] Could not get both prices for ${ticker}: ` +
      `callDate=${callDate.toISOString().slice(0, 10)} (${priceAtCall}), ` +
      `resolutionDate=${resolutionDate.toISOString().slice(0, 10)} (${priceAtResolution})`
    );
    return null;
  }

  const pctChange = ((priceAtResolution - priceAtCall) / priceAtCall) * 100;

  return { priceAtCall, priceAtResolution, pctChange };
}
