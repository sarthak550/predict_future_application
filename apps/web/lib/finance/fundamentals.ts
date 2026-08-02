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
/** Dividend history window shown in the panel (per-payout events within this range are rendered as bars). */
const DIVIDEND_LOOKBACK_YEARS = 3;
/** Trailing window (calendar days) for the per-payout "annualised yield" figure — see fetchDividendHistory. */
const DIVIDEND_TTM_WINDOW_DAYS = 365;

/** One point in a fundamentals series, oldest-first — matches InstrumentEnrichment's JSON column shape exactly. */
export type FundamentalsPoint = { periodEnd: string; value: number };

/** Raw per-payout event, internal building block below — not exported, callers only see `DividendPayoutRow`. */
type DividendPoint = { date: string; amount: number };

/**
 * One dividend PAYOUT event (founder 2026-08-02b: reverted the dividends
 * chart from the previous per-calendar-year rollup back to per-payout
 * granularity — interim/final/special payouts must be visible as separate
 * bars again — while keeping a yield line, now computed per-payout as a
 * trailing-12-month "annualised yield" rather than a calendar-year figure).
 *
 * CRITICAL (founder explicit): never present this as a bare "dividend
 * yield" anywhere in the UI — it is a trailing-12-month figure as of one
 * point in time, not a forward-looking or calendar-year yield. Always label
 * it "Annualised yield" and disclose both inputs (`ttmDividendTotal`,
 * `priceOnDate`) in any hover/readout, per house honesty convention.
 */
export type DividendPayoutRow = {
  /** Ex/payout date as reported by Yahoo, ISO "YYYY-MM-DD". */
  date: string;
  /** Per-share amount of THIS payout event only (not a period total). */
  amount: number;
  /**
   * Sum of all payout amounts (this one included) in the 12 months ending
   * on `date`. Nullable for type-safety/forward-compat only — in practice
   * always computable once the payout event itself is known (derived
   * purely from other dividend events, no price dependency).
   */
  ttmDividendTotal: number | null;
  /** Share close price on `date`, or the last trading-day close before it. Null when no resolvable price (whole-fetch failure or `date` falls before any close in the fetched window). */
  priceOnDate: number | null;
  /** `ttmDividendTotal / priceOnDate * 100`. Null (never a fabricated 0%) whenever `priceOnDate` is null. */
  annualisedYieldPct: number | null;
};

/** Deprecated per-calendar-year shape, briefly written 2026-08-02 — superseded same-day by `DividendPayoutRow` above. Kept only so the reader can render whatever a not-yet-refetched cached row still holds; no code writes this shape anymore. */
export type LegacyDividendYearRow = {
  year: number;
  totalDividend: number;
  yieldPct: number | null;
  isYtd: boolean;
};

/** Original pre-yield-work per-event shape (`{date, amount}` only, no yield fields at all) — still what the wide (non-targeted) universe's cached rows hold, since only the 6 iteration tickers have been refetched since. */
export type LegacyDividendEventRow = { date: string; amount: number };

/**
 * Every shape ever persisted to `InstrumentEnrichment.dividends` — a Json
 * column with no schema-level shape enforcement, so a row read back from the
 * DB could be ANY of these three depending on when it was last refetched.
 * Callers must runtime-detect which one they have (see
 * fundamentals-panel.tsx's `classifyDividendRows`) rather than assume the
 * latest shape.
 */
export type DividendRow = DividendPayoutRow | LegacyDividendYearRow | LegacyDividendEventRow;

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
 * Raw per-payout dividend events (interim/final/special, each its own row)
 * over `[period1, period2]`. Null (not []) when the fetch itself failed — an
 * empty array is a valid, honest "no dividends declared" answer and must
 * render differently from "we couldn't check."
 */
async function fetchDividendEvents(symbol: string, period1: number, period2: number): Promise<DividendPoint[] | null> {
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

/** One resolved trading-day close, ascending-date-sorted — output of `fetchDailyCloses`. */
type DailyClose = { date: string; close: number };

/**
 * Daily close prices for `symbol` over `[period1, period2]`, oldest first.
 * Generalizes what was originally `fetchYearEndCloses` (which reduced this
 * same feed down to one close per calendar year for the now-superseded
 * per-year dividend-yield shape) — Change 1 of the 2026-08-02b sprint needs
 * an arbitrary-date "close on or before X" lookup instead, so this now
 * returns the full daily series and leaves the reduction to
 * `closeOnOrBefore` below.
 *
 * Returns null on a total fetch failure (network/HTTP/parse/empty) — never
 * an empty array — so callers can tell "no price data at all" (blanket null
 * price/yield across every payout) apart from "priced, just no close
 * resolves for one specific date" (array present, that date simply has no
 * entry on/before it — e.g. a payout date at the very start of the fetched
 * window with zero prior trading days in range).
 */
async function fetchDailyCloses(symbol: string, period1: number, period2: number): Promise<DailyClose[] | null> {
  const url = `${CHART_BASE}/${encodeURIComponent(symbol)}.NS?interval=1d&period1=${period1}&period2=${period2}`;

  let response: Response;
  try {
    response = await fetchWithTimeout(url);
  } catch (err) {
    console.warn(`[fundamentals] Network error fetching daily closes for ${symbol}: ${err instanceof Error ? err.message : err}`);
    return null;
  }

  if (!response.ok) {
    console.warn(`[fundamentals] Yahoo chart(daily close) returned ${response.status} for ${symbol}`);
    return null;
  }

  let data: unknown;
  try {
    data = await response.json();
  } catch (err) {
    console.warn(`[fundamentals] Daily close JSON parse error for ${symbol}: ${err instanceof Error ? err.message : err}`);
    return null;
  }

  const chart = (data as Record<string, unknown>)?.chart as Record<string, unknown> | undefined;
  const result = (chart?.result as unknown[] | undefined)?.at(0) as Record<string, unknown> | undefined;
  if (!result) return null; // unknown ticker / no chart data at all — genuine failure.

  const timestamps = result.timestamp as number[] | undefined;
  const quoteArr = (result.indicators as Record<string, unknown> | undefined)?.quote as Record<string, unknown>[] | undefined;
  const closes = quoteArr?.[0]?.close as (number | null)[] | undefined;
  if (!Array.isArray(timestamps) || !Array.isArray(closes) || timestamps.length === 0) return null;

  const rows: DailyClose[] = [];
  for (let i = 0; i < timestamps.length; i++) {
    const close = closes[i];
    if (typeof close !== "number" || !Number.isFinite(close)) continue;
    rows.push({ date: new Date(timestamps[i] * 1000).toISOString().slice(0, 10), close });
  }
  // Yahoo returns timestamps ascending already; sort defensively rather than assume.
  rows.sort((a, b) => a.date.localeCompare(b.date));
  return rows.length > 0 ? rows : null;
}

/** Last close on or before `targetDate` (ISO "YYYY-MM-DD"), or null if `closes` has no entry that old. `closes` must be ascending-sorted (as `fetchDailyCloses` returns). Linear scan — the series is at most a few years of trading days, called once per rendered payout during a background refresh, not a hot path. */
function closeOnOrBefore(closes: DailyClose[], targetDate: string): number | null {
  let result: number | null = null;
  for (const c of closes) {
    if (c.date > targetDate) break;
    result = c.close;
  }
  return result;
}

/**
 * Dividend history as individual PAYOUT events (founder 2026-08-02b —
 * reverted from the previous per-calendar-year rollup: interim vs final vs
 * special payouts must be visible as separate bars again), each joined with
 * a trailing-12-month "annualised yield" computed AT that payout's date.
 *
 * Two windows are in play:
 *  - DISPLAY window `[period1, period2]`: `DIVIDEND_LOOKBACK_YEARS` back
 *    from today — only payout events in this range become rows.
 *  - FETCH window: extended `DIVIDEND_TTM_WINDOW_DAYS` further back than
 *    `period1`, so the TTM sum for the OLDEST displayed payout still has a
 *    complete trailing year of events to sum, even though those earlier
 *    events themselves never become their own row. Without this extension
 *    the oldest displayed payout's annualised yield would be silently
 *    understated (a partial-year sum masquerading as a trailing-12-month
 *    one) — the same class of bug the previous per-year shape's window
 *    alignment fix addressed, now reapplied to the per-payout window.
 *
 * Prices come from the SAME daily-close feed (`fetchDailyCloses`, itself a
 * generalization of the prior per-year shape's `fetchYearEndCloses`) over
 * the same extended fetch window, so `closeOnOrBefore` can always resolve a
 * payout near the display window's edge.
 *
 * Null (not []) when the underlying events fetch itself failed — an empty
 * array is a valid, honest "no dividends declared" answer. A stock with
 * real payout events but no resolvable price data still returns rows —
 * `priceOnDate`/`annualisedYieldPct` are null in that case, never a
 * fabricated price or 0% yield; `ttmDividendTotal` is unaffected since it
 * has no price dependency.
 */
export async function fetchDividendHistory(symbol: string): Promise<DividendPayoutRow[] | null> {
  const period2 = Math.floor(Date.now() / 1000);
  const displayPeriod1 = period2 - Math.floor(DIVIDEND_LOOKBACK_YEARS * 365.25 * ONE_DAY_S);
  const fetchPeriod1 = displayPeriod1 - DIVIDEND_TTM_WINDOW_DAYS * ONE_DAY_S;
  const displayPeriod1Iso = new Date(displayPeriod1 * 1000).toISOString().slice(0, 10);

  const events = await fetchDividendEvents(symbol, fetchPeriod1, period2);
  if (events === null) return null; // genuine fetch failure — distinct from "no dividends."
  if (events.length === 0) return []; // valid chart, zero dividend events — honest empty answer.

  // A close-price failure degrades every priceOnDate/annualisedYieldPct to
  // null; the ₹ bars and ttmDividendTotal still render on their own —
  // dividends without price context is a normal, honest partial state here.
  const closes = await fetchDailyCloses(symbol, fetchPeriod1, period2);

  const rows: DividendPayoutRow[] = [];
  for (const e of events) {
    if (e.date < displayPeriod1Iso) continue; // only within the display window — earlier events exist solely to feed TTM sums below.

    const windowStartMs = new Date(e.date).getTime() - DIVIDEND_TTM_WINDOW_DAYS * 24 * 60 * 60 * 1000;
    const windowStartIso = new Date(windowStartMs).toISOString().slice(0, 10);
    const ttmDividendTotal = events
      .filter((x) => x.date > windowStartIso && x.date <= e.date)
      .reduce((sum, x) => sum + x.amount, 0);

    const priceOnDate = closes ? closeOnOrBefore(closes, e.date) : null;
    const annualisedYieldPct = priceOnDate != null && priceOnDate > 0 ? (ttmDividendTotal / priceOnDate) * 100 : null;

    rows.push({ date: e.date, amount: e.amount, ttmDividendTotal, priceOnDate, annualisedYieldPct });
  }

  return rows;
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

// ── Debt level and coverage (TradingView-style, founder 2026-07-26) ──────────

/**
 * Each series null when Yahoo has no coverage. Quarterly FCF is empty for
 * NSE names (cash-flow reports annually); balance-sheet items report
 * semi-annually — expect ~2 quarterly points, not 4. Verified EC2
 * 2026-07-26: RELIANCE annualTotalDebt 3.98T / annualFreeCashFlow 691.97B /
 * annualCashAndCashEquivalents 1.37T, 4 pts each.
 *
 * `annualEbitda`/`quarterlyEbitda` (founder 2026-08-02b, Change 2 — EBITDA
 * as a third series on the Financials chart) are fetched in the SAME
 * fundamentals-timeseries batch call as the debt/FCF/cash series above and
 * PERSISTED IN THE SAME `debtCoverage` JSON column — a deliberate storage
 * reuse, not a semantic claim that EBITDA is a debt/coverage metric. This
 * sprint's gates forbid any `schema.prisma` change (no new column, no `db
 * push`), and `debtCoverage` was the closest-fit existing JSON bucket
 * already on the identical fetch cadence (7-day TTL,
 * `refreshFundamentalsInBackground`) and fetch mechanism (one
 * `fetchFundamentalsTimeseries` batch call). At the UI layer (`fundamentals-panel.tsx`) these two fields are consumed
 * by `FinancialsBars`, NOT `DebtCoverageBars` — they render on the
 * Revenue/Net-income chart, never the debt chart, despite the shared
 * storage column.
 *
 * Empirically verified live 2026-08-02 across the 6 targeted tickers +
 * SUZLON: annualEBITDA/quarterlyEBITDA return full coverage (4 annual / 5
 * quarterly points) for RELIANCE, TCS, ITC, INFY, COALINDIA, SUZLON.
 * HDFCBANK returns ZERO coverage on both keys (HTTP 200, empty result) — a
 * genuine, permanent Yahoo-side absence for banks (EBITDA isn't a
 * meaningful metric for a lender's income statement), not a bug; the UI
 * must render the Financials chart with EBITDA simply absent for HDFCBANK,
 * same as any other per-series gap already handled by this file's
 * conventions. Also observed (pre-existing, NOT introduced by this change):
 * INFY's entire fundamentals-timeseries feed — revenue, net income, EPS,
 * and now EBITDA alike — reports in USD (`currencyCode: "USD"`), not INR,
 * unlike every other symbol checked. This file has never been currency-code
 * aware (see the file's top doc comment's "INR unit decision"), so INFY's
 * Financials chart has silently mislabeled USD figures as INR since T2
 * shipped — EBITDA merely inherits the SAME existing mislabeling
 * consistently with its two sibling series, not a new inconsistency. Left
 * unfixed as out-of-scope for this ticket; flagged for a dedicated
 * currency-code-aware formatting follow-up.
 */
export interface DebtCoverage {
  annualDebt: FundamentalsPoint[] | null;
  annualFreeCashFlow: FundamentalsPoint[] | null;
  annualCash: FundamentalsPoint[] | null;
  quarterlyDebt: FundamentalsPoint[] | null;
  quarterlyCash: FundamentalsPoint[] | null;
  /** EBITDA, annual — see the interface doc comment for the storage-reuse rationale and empirical coverage findings. */
  annualEbitda: FundamentalsPoint[] | null;
  /** EBITDA, quarterly — see the interface doc comment for the storage-reuse rationale and empirical coverage findings. */
  quarterlyEbitda: FundamentalsPoint[] | null;
}

export async function fetchDebtCoverage(symbol: string): Promise<DebtCoverage> {
  const map = await fetchFundamentalsTimeseries(
    symbol,
    [
      "annualTotalDebt",
      "annualFreeCashFlow",
      "annualCashAndCashEquivalents",
      "quarterlyTotalDebt",
      "quarterlyCashAndCashEquivalents",
      "annualEBITDA",
      "quarterlyEBITDA",
    ],
    ANNUAL_LOOKBACK_YEARS
  );
  return {
    annualDebt: map.get("annualTotalDebt") ?? null,
    annualFreeCashFlow: map.get("annualFreeCashFlow") ?? null,
    annualCash: map.get("annualCashAndCashEquivalents") ?? null,
    quarterlyDebt: map.get("quarterlyTotalDebt") ?? null,
    quarterlyCash: map.get("quarterlyCashAndCashEquivalents") ?? null,
    annualEbitda: map.get("annualEBITDA") ?? null,
    quarterlyEbitda: map.get("quarterlyEBITDA") ?? null,
  };
}
