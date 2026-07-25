/**
 * Instrument Page v2 (T2) — keyless Yahoo Finance fetchers for the
 * Fundamentals & Performance panel. Mirrors apps/api/lib/finance/
 * priceHistory.ts's contract exactly (plain `fetch`, fixed User-Agent,
 * never throws — every failure mode resolves to `null`/`[]` so a single bad
 * or unknown symbol never breaks a page render). Duplicated rather than
 * imported from apps/api because apps/web and apps/api are separate deployed
 * Next apps with no cross-app import path — same module-boundary convention
 * already established for e.g. decodeGoogleNewsSource in
 * apps/api/lib/marketMoves/googleNews.ts (see that file's doc comment).
 *
 * ── Endpoint 1: fundamentals-timeseries (KEYLESS, verified live 2026-07-25) ──
 * GET query1.finance.yahoo.com/ws/fundamentals-timeseries/v1/finance/timeseries/<SYM>.NS
 *   ?type=<comma-separated type keys>&period1=<epoch>&period2=<epoch>
 * Response shape: `timeseries.result[]`, one element per requested `type`
 * key, each `{ meta: { type: [key] }, timestamp: number[], [key]: Row[] }`
 * where `Row = { asOfDate: "YYYY-MM-DD", reportedValue: { raw: number, fmt: string } }`.
 * A symbol/type combination with zero coverage still returns HTTP 200 with
 * that result element missing its data-array key entirely (not an empty
 * array, not a zero) — treated identically to "series absent" here.
 *
 * Spot-checked 2026-07-25 across 10 diverse NSE names (large-cap: RELIANCE,
 * TCS, HDFCBANK, TATAMOTORS; recent-IPO/new-economy: ZOMATO, IREDA, PAYTM;
 * mid-cap: SUZLON, IRFC, CDSL) for all six type keys below:
 *   - RELIANCE.NS: verified exact match against the founder's reference
 *     values — annualTotalRevenue FY26 raw 10,572,190,000,000 ("10.57T"),
 *     annualNetIncome FY26 raw 807,750,000,000 ("807.75B"), 4 annual points
 *     each. Quarterly series: 5 points each.
 *   - 8/10 tickers returned full coverage on all 6 keys (annual: 4 points,
 *     quarterly: 3-5 points — HDFCBANK's quarterlyDilutedEPS was thinner at
 *     2 points, still non-empty).
 *   - 2/10 tickers (ZOMATO, TATAMOTORS) returned ZERO coverage on every key
 *     — HTTP 200, but every result element has no data array. This is a
 *     genuine per-ticker Yahoo coverage gap, not a bug: ZOMATO is indexed
 *     under its post-rename ticker ETERNAL.NS on Yahoo (confirmed: ETERNAL.NS
 *     returns full data), and TATAMOTORS' 2025 demerger appears to have
 *     reset Yahoo's series for the old symbol. This is exactly why every
 *     card in T5 must degrade gracefully per-series/per-symbol rather than
 *     assume coverage — a real, observed failure mode, not a hypothetical one.
 * Conclusion: all six enumerated type keys below are worth requesting for
 * any NSE symbol; coverage is a per-symbol Yahoo-side fact the UI must
 * treat as optional, not a subset of keys to drop entirely.
 *
 * ── Endpoint 2: v8 chart with events=div (KEYLESS, verified live 2026-07-25) ──
 * Same endpoint apps/api/lib/finance/priceHistory.ts already polls, with
 * `&events=div` appended. `chart.result[0].events.dividends` is a map of
 * `{ [epochSeconds]: { amount: number, date: number (epoch seconds) } }`.
 * Verified: RELIANCE.NS 1y window -> exactly 2 events (matches the founder's
 * reference count), TCS.NS -> 4 events, IREDA.NS -> 1 event.
 *
 * ── INR unit decision (documented per house honesty convention) ──
 * Yahoo's `reportedValue.raw` for every series above is the RAW rupee
 * figure, NOT lakhs/crores (sanity-checked: RELIANCE annualNetIncome raw
 * 807,750,000,000 = ₹807.75 billion = ₹80,775 crore, matching Reliance's
 * publicly reported FY26 net profit order of magnitude). Dividend `amount`
 * is raw rupees-per-share (RELIANCE ₹5.50 and ₹6.00 per share — matches
 * its actual interim/final dividend history). All formatting in T5 must
 * treat these as plain INR and apply Indian crore/lakh-compact display via
 * `formatCompactINR` (packages/utils) — never divide by 100,000 or
 * 10,000,000 again on top of this (that would be a double-conversion bug).
 */

import { fetchQuoteSummary } from "@/lib/finance/yahooCrumb";

const FUNDAMENTALS_TIMESERIES_BASE =
  "https://query1.finance.yahoo.com/ws/fundamentals-timeseries/v1/finance/timeseries";
const CHART_BASE = "https://query1.finance.yahoo.com/v8/finance/chart";

const FETCH_HEADERS = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
  Accept: "application/json",
};

const FETCH_TIMEOUT_MS = 8_000;
const ONE_DAY_S = 24 * 60 * 60;
/** ~6 years back covers every annual series Yahoo tends to carry for an NSE name (observed max: 4 annual points). */
const ANNUAL_LOOKBACK_YEARS = 6;
/** ~2.5 years back comfortably covers 5 quarterly points with buffer for a late-reporting quarter. */
const QUARTERLY_LOOKBACK_YEARS = 2.5;
/** Dividend history window shown in the panel. */
const DIVIDEND_LOOKBACK_YEARS = 3;

/** One point in a fundamentals series, oldest-first — matches InstrumentEnrichment's JSON column shape exactly. */
export type FundamentalsPoint = { periodEnd: string; value: number };

export type DividendPoint = { date: string; amount: number };

export type AnnualFundamentals = {
  revenue: FundamentalsPoint[] | null;
  netIncome: FundamentalsPoint[] | null;
  dilutedEps: FundamentalsPoint[] | null;
};

export type QuarterlyFundamentals = {
  revenue: FundamentalsPoint[] | null;
  netIncome: FundamentalsPoint[] | null;
  dilutedEps: FundamentalsPoint[] | null;
};

async function fetchWithTimeout(url: string): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    return await fetch(url, { headers: FETCH_HEADERS, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

type TimeseriesResultRow = { asOfDate?: string; reportedValue?: { raw?: number } };
type TimeseriesResultElement = {
  meta?: { type?: string[] };
  [dataKey: string]: unknown;
};

/**
 * Fetches a batch of `type` keys from fundamentals-timeseries in one request
 * and returns a map of type-key -> its series (oldest first), or an empty
 * map on total failure. Per-key absence (see file doc comment) is NOT an
 * error — it just means that key is missing from the returned map, which
 * callers read as "series absent" via `?? null`.
 */
async function fetchFundamentalsTimeseries(
  symbol: string,
  typeKeys: string[],
  lookbackYears: number
): Promise<Map<string, FundamentalsPoint[]>> {
  const result = new Map<string, FundamentalsPoint[]>();
  const period2 = Math.floor(Date.now() / 1000);
  const period1 = period2 - Math.floor(lookbackYears * 365.25 * ONE_DAY_S);
  const url = `${FUNDAMENTALS_TIMESERIES_BASE}/${encodeURIComponent(symbol)}.NS?type=${typeKeys.join(",")}&period1=${period1}&period2=${period2}`;

  let response: Response;
  try {
    response = await fetchWithTimeout(url);
  } catch (err) {
    console.warn(`[fundamentals] Network error fetching ${symbol}: ${err instanceof Error ? err.message : err}`);
    return result;
  }

  if (!response.ok) {
    console.warn(`[fundamentals] Yahoo fundamentals-timeseries returned ${response.status} for ${symbol}`);
    return result;
  }

  let data: unknown;
  try {
    data = await response.json();
  } catch (err) {
    console.warn(`[fundamentals] JSON parse error for ${symbol}: ${err instanceof Error ? err.message : err}`);
    return result;
  }

  const elements = (data as Record<string, unknown>)?.timeseries as Record<string, unknown> | undefined;
  const resultElements = (elements?.result as TimeseriesResultElement[] | undefined) ?? [];

  for (const element of resultElements) {
    const typeKey = element.meta?.type?.[0];
    if (!typeKey) continue;
    const rows = element[typeKey] as TimeseriesResultRow[] | undefined;
    if (!Array.isArray(rows) || rows.length === 0) continue; // absent series — see file doc comment

    const points: FundamentalsPoint[] = [];
    for (const row of rows) {
      if (!row || !row.asOfDate || typeof row.reportedValue?.raw !== "number") continue;
      points.push({ periodEnd: row.asOfDate, value: row.reportedValue.raw });
    }
    if (points.length > 0) {
      result.set(
        typeKey,
        points.sort((a, b) => a.periodEnd.localeCompare(b.periodEnd))
      );
    }
  }

  return result;
}

/** Annual revenue, net income, diluted EPS. Each field null when Yahoo has no coverage for that series on this symbol. */
export async function fetchAnnualFundamentals(symbol: string): Promise<AnnualFundamentals> {
  const map = await fetchFundamentalsTimeseries(
    symbol,
    ["annualTotalRevenue", "annualNetIncome", "annualDilutedEPS"],
    ANNUAL_LOOKBACK_YEARS
  );
  return {
    revenue: map.get("annualTotalRevenue") ?? null,
    netIncome: map.get("annualNetIncome") ?? null,
    dilutedEps: map.get("annualDilutedEPS") ?? null,
  };
}

/** Quarterly revenue, net income, diluted EPS (latest ~5 quarters). Each field null when Yahoo has no coverage. */
export async function fetchQuarterlyFundamentals(symbol: string): Promise<QuarterlyFundamentals> {
  const map = await fetchFundamentalsTimeseries(
    symbol,
    ["quarterlyTotalRevenue", "quarterlyNetIncome", "quarterlyDilutedEPS"],
    QUARTERLY_LOOKBACK_YEARS
  );
  return {
    revenue: map.get("quarterlyTotalRevenue") ?? null,
    netIncome: map.get("quarterlyNetIncome") ?? null,
    dilutedEps: map.get("quarterlyDilutedEPS") ?? null,
  };
}

/**
 * Dividend history over the last DIVIDEND_LOOKBACK_YEARS, oldest first.
 * Null (not []) when the fetch itself failed — an empty array is a valid,
 * honest "no dividends declared" answer and must render differently from
 * "we couldn't check."
 */
export async function fetchDividendHistory(symbol: string): Promise<DividendPoint[] | null> {
  const period2 = Math.floor(Date.now() / 1000);
  const period1 = period2 - Math.floor(DIVIDEND_LOOKBACK_YEARS * 365.25 * ONE_DAY_S);
  const url = `${CHART_BASE}/${encodeURIComponent(symbol)}.NS?interval=1d&period1=${period1}&period2=${period2}&events=div`;

  let response: Response;
  try {
    response = await fetchWithTimeout(url);
  } catch (err) {
    console.warn(`[fundamentals] Network error fetching dividends for ${symbol}: ${err instanceof Error ? err.message : err}`);
    return null;
  }

  if (!response.ok) {
    console.warn(`[fundamentals] Yahoo chart(events=div) returned ${response.status} for ${symbol}`);
    return null;
  }

  let data: unknown;
  try {
    data = await response.json();
  } catch (err) {
    console.warn(`[fundamentals] Dividend JSON parse error for ${symbol}: ${err instanceof Error ? err.message : err}`);
    return null;
  }

  const chart = (data as Record<string, unknown>)?.chart as Record<string, unknown> | undefined;
  const result = (chart?.result as unknown[] | undefined)?.at(0) as Record<string, unknown> | undefined;
  if (!result) {
    // Unknown ticker / no chart data at all — genuine failure, distinct from "no dividends."
    return null;
  }

  const events = result.events as Record<string, unknown> | undefined;
  const dividendsMap = events?.dividends as Record<string, { amount?: number; date?: number }> | undefined;
  if (!dividendsMap) return []; // valid chart, zero dividend events ever — honest empty answer.

  const points: DividendPoint[] = [];
  for (const entry of Object.values(dividendsMap)) {
    if (typeof entry?.amount !== "number" || typeof entry?.date !== "number") continue;
    points.push({ date: new Date(entry.date * 1000).toISOString().slice(0, 10), amount: entry.amount });
  }

  return points.sort((a, b) => a.date.localeCompare(b.date));
}

// ── Key Stats (TradingView-style) — crumb-authenticated quoteSummary ─────────

/** Raw-value snapshot; every field optional — Yahoo omits per-symbol, we never fabricate. dividendYield is a FRACTION (0.0047 = 0.47%). */
export interface KeyStats {
  marketCap?: number;
  trailingPE?: number;
  dividendYield?: number;
  beta?: number;
  floatShares?: number;
  trailingEps?: number;
}

/**
 * Fetches Key Stats via the crumb-authenticated quoteSummary (see
 * yahooCrumb.ts — verified from EC2 2026-07-26 with values matching
 * TradingView's display for RELIANCE). Returns null on any transport/auth
 * failure; an empty object when the symbol resolves but carries no stats.
 * NOTE: Yahoo's `beta` here is its 5Y-monthly convention — label it as such,
 * it is NOT TradingView's "Beta (1Y)".
 */
export async function fetchKeyStats(symbol: string): Promise<KeyStats | null> {
  const data = await fetchQuoteSummary(`${symbol}.NS`, ["summaryDetail", "defaultKeyStatistics"]);
  if (!data) return null;
  const result = ((data as Record<string, unknown>)?.quoteSummary as Record<string, unknown> | undefined)?.result as
    | Record<string, unknown>[]
    | undefined;
  const row = result?.[0];
  if (!row) return null;

  const raw = (module: unknown, key: string): number | undefined => {
    const v = ((module as Record<string, unknown> | undefined)?.[key] as { raw?: unknown } | undefined)?.raw;
    return typeof v === "number" && Number.isFinite(v) ? v : undefined;
  };
  const sd = row.summaryDetail;
  const ks = row.defaultKeyStatistics;

  const stats: KeyStats = {};
  const put = (k: keyof KeyStats, v: number | undefined) => {
    if (v !== undefined) stats[k] = v;
  };
  put("marketCap", raw(sd, "marketCap"));
  put("trailingPE", raw(sd, "trailingPE"));
  put("dividendYield", raw(sd, "dividendYield"));
  put("beta", raw(sd, "beta"));
  put("floatShares", raw(ks, "floatShares"));
  put("trailingEps", raw(ks, "trailingEps"));
  return stats;
}
