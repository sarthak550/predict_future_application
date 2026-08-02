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
  /**
   * Fundamentals Panel v2 (Sprint 1, T1.1) — same trailing-12-month sum as
   * `ttmDividendTotal`, but for the window ending exactly ONE YEAR before
   * `date` (i.e. the (date−24mo, date−12mo] window) — the comparison basis
   * for `growthPct` below. Nullable for the same type-safety/forward-compat
   * reason as `ttmDividendTotal` (also derived purely from dividend events,
   * no price dependency) — in practice always computable, including a
   * genuine `0` for a symbol with no payouts in that earlier window (e.g. a
   * recent IPO or a new dividend payer), which is an honest zero, not an
   * absent one.
   */
  ttmDividendTotalPrevYear: number | null;
  /**
   * `ttmDividendTotalPrevYear > 0 ? (ttmDividendTotal − ttmDividendTotalPrevYear) / ttmDividendTotalPrevYear × 100 : null`.
   * Null — NEVER a fabricated 0% or ∞% — whenever the prior-year TTM total
   * is 0 (a new payer has no meaningful "growth" from a zero base) or
   * unresolvable.
   */
  growthPct: number | null;
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

type TimeseriesResultRow = { asOfDate?: string; reportedValue?: { raw?: number }; currencyCode?: string };
type TimeseriesResultElement = {
  meta?: { type?: string[] };
  [dataKey: string]: unknown;
};

/** Return shape of `fetchFundamentalsTimeseries` — the parsed per-key series PLUS the per-key `currencyCode` observed on that series' rows (verified live: `currencyCode` is a per-ROW field, e.g. INFY.NS's `annualTotalRevenue` rows each carry `"currencyCode": "USD"` — see `fetchDebtCoverage`'s doc comment for how callers reduce this to one blob-level code). */
type FundamentalsTimeseriesResult = {
  series: Map<string, FundamentalsPoint[]>;
  /** type-key -> the currencyCode found on its rows (first non-empty one seen; a series' rows are expected to agree within themselves). Only set for keys that also made it into `series` (i.e. had at least one valid point). */
  currencyCodes: Map<string, string>;
};

/**
 * Fetches a batch of `type` keys from fundamentals-timeseries in one request
 * and returns each key's series (oldest first) plus its currencyCode, or
 * empty maps on total failure. Per-key absence (see file doc comment) is NOT
 * an error — it just means that key is missing from the returned maps,
 * which callers read as "series absent" via `?? null`.
 */
async function fetchFundamentalsTimeseries(
  symbol: string,
  typeKeys: string[],
  lookbackYears: number
): Promise<FundamentalsTimeseriesResult> {
  const series = new Map<string, FundamentalsPoint[]>();
  const currencyCodes = new Map<string, string>();
  const empty: FundamentalsTimeseriesResult = { series, currencyCodes };
  const period2 = Math.floor(Date.now() / 1000);
  const period1 = period2 - Math.floor(lookbackYears * 365.25 * ONE_DAY_S);
  const url = `${FUNDAMENTALS_TIMESERIES_BASE}/${encodeURIComponent(symbol)}.NS?type=${typeKeys.join(",")}&period1=${period1}&period2=${period2}`;

  let response: Response;
  try {
    response = await fetchWithTimeout(url);
  } catch (err) {
    console.warn(`[fundamentals] Network error fetching ${symbol}: ${err instanceof Error ? err.message : err}`);
    return empty;
  }

  if (!response.ok) {
    console.warn(`[fundamentals] Yahoo fundamentals-timeseries returned ${response.status} for ${symbol}`);
    return empty;
  }

  let data: unknown;
  try {
    data = await response.json();
  } catch (err) {
    console.warn(`[fundamentals] JSON parse error for ${symbol}: ${err instanceof Error ? err.message : err}`);
    return empty;
  }

  const elements = (data as Record<string, unknown>)?.timeseries as Record<string, unknown> | undefined;
  const resultElements = (elements?.result as TimeseriesResultElement[] | undefined) ?? [];

  for (const element of resultElements) {
    const typeKey = element.meta?.type?.[0];
    if (!typeKey) continue;
    const rows = element[typeKey] as TimeseriesResultRow[] | undefined;
    if (!Array.isArray(rows) || rows.length === 0) continue; // absent series — see file doc comment

    const points: FundamentalsPoint[] = [];
    let currencyCode: string | undefined;
    for (const row of rows) {
      if (!row || !row.asOfDate || typeof row.reportedValue?.raw !== "number") continue;
      points.push({ periodEnd: row.asOfDate, value: row.reportedValue.raw });
      if (!currencyCode && typeof row.currencyCode === "string" && row.currencyCode) currencyCode = row.currencyCode;
    }
    if (points.length > 0) {
      series.set(
        typeKey,
        points.sort((a, b) => a.periodEnd.localeCompare(b.periodEnd))
      );
      if (currencyCode) currencyCodes.set(typeKey, currencyCode);
    }
  }

  return { series, currencyCodes };
}

/** Annual revenue, net income, diluted EPS. Each field null when Yahoo has no coverage for that series on this symbol. */
export async function fetchAnnualFundamentals(symbol: string): Promise<AnnualFundamentals> {
  const { series } = await fetchFundamentalsTimeseries(
    symbol,
    ["annualTotalRevenue", "annualNetIncome", "annualDilutedEPS"],
    ANNUAL_LOOKBACK_YEARS
  );
  return {
    revenue: series.get("annualTotalRevenue") ?? null,
    netIncome: series.get("annualNetIncome") ?? null,
    dilutedEps: series.get("annualDilutedEPS") ?? null,
  };
}

/** Quarterly revenue, net income, diluted EPS (latest ~5 quarters). Each field null when Yahoo has no coverage. */
export async function fetchQuarterlyFundamentals(symbol: string): Promise<QuarterlyFundamentals> {
  const { series } = await fetchFundamentalsTimeseries(
    symbol,
    ["quarterlyTotalRevenue", "quarterlyNetIncome", "quarterlyDilutedEPS"],
    QUARTERLY_LOOKBACK_YEARS
  );
  return {
    revenue: series.get("quarterlyTotalRevenue") ?? null,
    netIncome: series.get("quarterlyNetIncome") ?? null,
    dilutedEps: series.get("quarterlyDilutedEPS") ?? null,
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
 * a trailing-12-month "annualised yield" computed AT that payout's date,
 * PLUS (Fundamentals Panel v2, Sprint 1, T1.1) a TTM-dividend-growth figure
 * comparing that trailing-12-month total against the SAME trailing-12-month
 * window exactly one year earlier.
 *
 * THREE windows are in play now (widened from two — Sprint 1, T1.1):
 *  - DISPLAY window `[displayPeriod1, period2]`: `DIVIDEND_LOOKBACK_YEARS`
 *    back from today — only payout events in this range become rows.
 *  - PRICES fetch window `[pricesPeriod1, period2]`: extended ONE
 *    `DIVIDEND_TTM_WINDOW_DAYS` further back than `displayPeriod1` — same
 *    as before this ticket, UNCHANGED — so `closeOnOrBefore` can still
 *    resolve a price for a payout near the display window's edge. Prices
 *    are only ever needed for `ttmDividendTotal` (whose window never
 *    reaches further back than this), never for the new prior-year
 *    comparison (`ttmDividendTotalPrevYear`/`growthPct` have no price
 *    dependency at all), so this window does NOT need to widen further.
 *  - EVENTS fetch window `[eventsPeriod1, period2]`: extended TWO
 *    `DIVIDEND_TTM_WINDOW_DAYS` back — one more full year further than the
 *    prices window. The oldest displayed payout's `ttmDividendTotalPrevYear`
 *    needs events reaching back to (that payout's date − 2 years); since
 *    the oldest displayed payout's date is by construction >=
 *    `displayPeriod1`, `eventsPeriod1 = displayPeriod1 − 2×TTM_WINDOW`
 *    always reaches far enough for every row, by construction — no payout
 *    can ever see a partially-covered prior-year window.
 *
 * Null (not []) when the underlying events fetch itself failed — an empty
 * array is a valid, honest "no dividends declared" answer. A stock with
 * real payout events but no resolvable price data still returns rows —
 * `priceOnDate`/`annualisedYieldPct` are null in that case, never a
 * fabricated price or 0% yield; `ttmDividendTotal`/`ttmDividendTotalPrevYear`
 * are unaffected since neither has a price dependency. `growthPct` is null
 * (never 0%/∞%) whenever the prior-year TTM total is 0 — a new payer's
 * "growth" from a zero base isn't a meaningful percentage.
 */
export async function fetchDividendHistory(symbol: string): Promise<DividendPayoutRow[] | null> {
  const period2 = Math.floor(Date.now() / 1000);
  const displayPeriod1 = period2 - Math.floor(DIVIDEND_LOOKBACK_YEARS * 365.25 * ONE_DAY_S);
  const pricesPeriod1 = displayPeriod1 - DIVIDEND_TTM_WINDOW_DAYS * ONE_DAY_S; // unchanged from pre-T1.1 behavior
  const eventsPeriod1 = displayPeriod1 - 2 * DIVIDEND_TTM_WINDOW_DAYS * ONE_DAY_S; // widened one more trailing year (T1.1)
  const displayPeriod1Iso = new Date(displayPeriod1 * 1000).toISOString().slice(0, 10);

  const events = await fetchDividendEvents(symbol, eventsPeriod1, period2);
  if (events === null) return null; // genuine fetch failure — distinct from "no dividends."
  if (events.length === 0) return []; // valid chart, zero dividend events — honest empty answer.

  // A close-price failure degrades every priceOnDate/annualisedYieldPct to
  // null; the ₹ bars and ttmDividendTotal(/PrevYear)/growthPct still render
  // on their own — dividends without price context is a normal, honest
  // partial state here.
  const closes = await fetchDailyCloses(symbol, pricesPeriod1, period2);

  /** Sum of `events` with `date` in `(windowStartIso, windowEndIso]` — the shared building block for both TTM windows below. */
  const sumInWindow = (windowStartIso: string, windowEndIso: string): number =>
    events.filter((x) => x.date > windowStartIso && x.date <= windowEndIso).reduce((sum, x) => sum + x.amount, 0);

  const isoNDaysBefore = (dateIso: string, days: number): string =>
    new Date(new Date(dateIso).getTime() - days * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

  const rows: DividendPayoutRow[] = [];
  for (const e of events) {
    if (e.date < displayPeriod1Iso) continue; // only within the display window — earlier events exist solely to feed TTM sums below.

    const windowStartIso = isoNDaysBefore(e.date, DIVIDEND_TTM_WINDOW_DAYS);
    const ttmDividendTotal = sumInWindow(windowStartIso, e.date);

    const prevWindowStartIso = isoNDaysBefore(e.date, 2 * DIVIDEND_TTM_WINDOW_DAYS);
    const ttmDividendTotalPrevYear = sumInWindow(prevWindowStartIso, windowStartIso);
    const growthPct = ttmDividendTotalPrevYear > 0 ? ((ttmDividendTotal - ttmDividendTotalPrevYear) / ttmDividendTotalPrevYear) * 100 : null;

    const priceOnDate = closes ? closeOnOrBefore(closes, e.date) : null;
    const annualisedYieldPct = priceOnDate != null && priceOnDate > 0 ? (ttmDividendTotal / priceOnDate) * 100 : null;

    rows.push({
      date: e.date,
      amount: e.amount,
      ttmDividendTotal,
      ttmDividendTotalPrevYear,
      growthPct,
      priceOnDate,
      annualisedYieldPct,
    });
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
 * `fetchFundamentalsTimeseries` batch call). At the UI layer
 * (`fundamentals-panel.tsx`'s `IncomeStatementSection`, Sprint 1 T1.2) these
 * two fields render on the §01 Revenue/Net-income/EBITDA chart, never the
 * §07 debt chart, despite the shared storage column.
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
 * currency-code-aware formatting follow-up (RESOLVED — Sprint 1, T1.1:
 * see `currencyCode` below and `formatCompactCurrency` in packages/utils).
 *
 * Fundamentals Panel v2 (Sprint 1, T1.1) — six more annual balance-sheet
 * keys join this SAME batch call (still zero extra HTTP requests): the
 * asset/equity/PP&E/receivables/current-assets/inventory series §04–§06 of
 * the founder-approved plan need. ALL SIX are annual-only, deliberately —
 * Yahoo's quarterly balance-sheet coverage for NSE names is bimodal
 * (semi-annual in practice, not truly quarterly) and would introduce a
 * basis mismatch against the quarterly income-statement series if mixed in;
 * documented here rather than silently omitted.
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
  /** Total assets, annual — feeds §05 Capital Structure and §06 Asset Base Composition (Sprint 2). */
  annualTotalAssets: FundamentalsPoint[] | null;
  /** Total stockholders' equity, annual — the denominator of §05's D/E line (Sprint 2). */
  annualStockholdersEquity: FundamentalsPoint[] | null;
  /** Net property/plant/equipment ("fixed assets"), annual — feeds §04's fixed-asset growth line and §06's stacked composition (Sprint 2). */
  annualNetPPE: FundamentalsPoint[] | null;
  /** Accounts receivable, annual (the reliable Yahoo key for NSE names — verified across the 6 iteration tickers). Absent for services businesses with no meaningful receivables line (e.g. INFY) — a genuine per-symbol gap, not a bug. Feeds §04 (Sprint 2). */
  annualAccountsReceivable: FundamentalsPoint[] | null;
  /** Total current assets, annual — feeds §06's stacked composition (Sprint 2). */
  annualCurrentAssets: FundamentalsPoint[] | null;
  /** Inventory, annual — absent for services businesses (e.g. INFY), a genuine per-symbol gap. Feeds §04 (Sprint 2). */
  annualInventory: FundamentalsPoint[] | null;
  /**
   * Currency code Yahoo reported these series in (e.g. "INR", "USD" — INFY
   * reports its ENTIRE fundamentals-timeseries feed in USD, not INR, unlike
   * every other NSE name checked). Computed by reducing the currencyCode
   * observed across every series IN THIS BATCH: all-agree -> that code;
   * disagree -> the first-listed series' code (see this function's own
   * inline comment for why "the first-listed series" rather than the plan's
   * literal "revenue's code" — revenue isn't part of this batch). Null only
   * when NO series in the batch returned any data at all. Persisted ONLY in
   * this blob (never duplicated onto `AnnualFundamentals`/
   * `QuarterlyFundamentals`) — consumers needing currency-aware formatting
   * for revenue/net income/EPS/dividends read it from here via
   * `debtCoverage?.currencyCode`, per the founder-approved plan's §5.
   */
  currencyCode: string | null;
}

export async function fetchDebtCoverage(symbol: string): Promise<DebtCoverage> {
  const { series, currencyCodes } = await fetchFundamentalsTimeseries(
    symbol,
    [
      "annualTotalDebt",
      "annualFreeCashFlow",
      "annualCashAndCashEquivalents",
      "quarterlyTotalDebt",
      "quarterlyCashAndCashEquivalents",
      "annualEBITDA",
      "quarterlyEBITDA",
      "annualTotalAssets",
      "annualStockholdersEquity",
      "annualNetPPE",
      "annualAccountsReceivable",
      "annualCurrentAssets",
      "annualInventory",
    ],
    ANNUAL_LOOKBACK_YEARS
  );

  const distinctCodes = new Set(currencyCodes.values());
  let currencyCode: string | null = null;
  if (distinctCodes.size === 1) {
    currencyCode = [...distinctCodes][0];
  } else if (distinctCodes.size > 1) {
    // Deviation from the plan's literal "mixed -> revenue's code" tie-break:
    // `annualTotalRevenue` isn't fetched in THIS batch (fetchAnnualFundamentals
    // fetches it separately) — re-requesting it here purely for a tie-break
    // would be a genuine extra network call, contradicting this function's
    // "zero extra requests" constraint. In-batch agreement is what this
    // blob's OWN fields actually need anyway, so on disagreement we fall
    // back to the first-listed key's code instead. Every symbol observed so
    // far (including INFY) reports ALL its series in one currency, so this
    // branch is defensive — not expected to fire in practice.
    currencyCode = currencyCodes.get("annualTotalDebt") ?? currencyCodes.values().next().value ?? null;
    console.warn(
      `[fundamentals] Mixed currencyCode across debtCoverage series for ${symbol}: ${[...distinctCodes].join(", ")} — using ${currencyCode}`
    );
  }

  return {
    annualDebt: series.get("annualTotalDebt") ?? null,
    annualFreeCashFlow: series.get("annualFreeCashFlow") ?? null,
    annualCash: series.get("annualCashAndCashEquivalents") ?? null,
    quarterlyDebt: series.get("quarterlyTotalDebt") ?? null,
    quarterlyCash: series.get("quarterlyCashAndCashEquivalents") ?? null,
    annualEbitda: series.get("annualEBITDA") ?? null,
    quarterlyEbitda: series.get("quarterlyEBITDA") ?? null,
    annualTotalAssets: series.get("annualTotalAssets") ?? null,
    annualStockholdersEquity: series.get("annualStockholdersEquity") ?? null,
    annualNetPPE: series.get("annualNetPPE") ?? null,
    annualAccountsReceivable: series.get("annualAccountsReceivable") ?? null,
    annualCurrentAssets: series.get("annualCurrentAssets") ?? null,
    annualInventory: series.get("annualInventory") ?? null,
    currencyCode,
  };
}
