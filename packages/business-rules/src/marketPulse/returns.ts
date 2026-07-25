/**
 * Instrument Page v2 (Decision 2) — performance strip over EOD closes
 * already in hand. Pure — no I/O, no Prisma import — so it runs identically
 * wherever a caller has already fetched a symbol's `StockEodQuote` history
 * (today: apps/web's `fetchInstrumentDetail`, which pulls 260 sessions for
 * the interactive chart; that same in-memory array is reused here with zero
 * extra DB query and zero extra network call).
 *
 * Every window is honest-null on insufficient history (e.g. a recent IPO
 * has no 1Y number) rather than a misleading 0% — a missing series must
 * never be confused with "no change".
 */

/** Minimal structural shape any EOD-quote-like row must satisfy. */
export type ReturnsQuotePoint = {
  sessionDate: Date;
  close: number;
};

export type ReturnsStrip = {
  oneWeek: number | null;
  oneMonth: number | null;
  threeMonth: number | null;
  sixMonth: number | null;
  oneYear: number | null;
  /** Since 1 April IST of the current-or-most-recently-completed Indian fiscal year. */
  fiscalYearToDate: number | null;
};

const ONE_DAY_MS = 24 * 60 * 60 * 1000;

/** Calendar-day lookback windows. Approximations (30/91/182/365), same convention as every other "1M/3M/6M/1Y" chip in finance UIs — not exact month/quarter arithmetic. */
const WINDOW_DAYS = {
  oneWeek: 7,
  oneMonth: 30,
  threeMonth: 91,
  sixMonth: 182,
  oneYear: 365,
} as const;

/**
 * Extracts an IST calendar-date's {year, month} (1-indexed month) from any
 * Date instant, timezone-safe regardless of server locale — matches the
 * Asia/Kolkata pinning convention used by formatIstSessionDate in
 * packages/utils (a UTC server must never let a session/asOf instant shift
 * back a calendar day).
 */
function istYearMonth(date: Date): { year: number; month: number } {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "numeric",
  }).formatToParts(date);
  const year = Number(parts.find((p) => p.type === "year")?.value);
  const month = Number(parts.find((p) => p.type === "month")?.value);
  return { year, month };
}

/**
 * Builds the Date instant for 1 April 00:00 IST of `year`, expressed the
 * same way this codebase stores session dates — "IST midnight" represented
 * as the equivalent UTC instant (UTC-5:30) — so it compares directly against
 * `StockEodQuote.sessionDate` values with plain `.getTime()` arithmetic.
 */
function istAprilFirstAsUtc(year: number): Date {
  return new Date(Date.UTC(year, 3, 1, 0, 0, 0) - 5.5 * 60 * 60 * 1000);
}

/**
 * Returns the most recent quote whose sessionDate is on-or-before `atOrBefore`,
 * from a list pre-sorted ascending by sessionDate. Null if none qualifies
 * (every quote is strictly after the target instant, or the list is empty)
 * — this is exactly the "insufficient history" signal callers must render
 * as "—", never as a false 0%.
 */
function latestOnOrBefore(sorted: ReturnsQuotePoint[], atOrBefore: number): ReturnsQuotePoint | null {
  let result: ReturnsQuotePoint | null = null;
  for (const q of sorted) {
    if (q.sessionDate.getTime() > atOrBefore) break;
    result = q;
  }
  return result;
}

function pctChange(from: number, to: number): number | null {
  if (from === 0 || !Number.isFinite(from) || !Number.isFinite(to)) return null;
  return ((to - from) / from) * 100;
}

/**
 * Computes the 1W/1M/3M/6M/1Y/FY-to-date % change of `close` over `quotes`.
 *
 * `asOf` defaults to now. The "current" price is the latest quote on-or-
 * before `asOf` (EOD data always lags real time by definition), and each
 * window compares that current price against the latest quote on-or-before
 * (currentDate - N calendar days) — naturally absorbing weekend/holiday
 * gaps near a boundary without special-casing them, since "on or before"
 * always resolves to the last real trading day at or ahead of the target.
 *
 * Returns every field `null` if `quotes` is empty or `asOf` predates every
 * quote on hand.
 */
export function computeReturnsStrip(quotes: ReturnsQuotePoint[], asOf: Date = new Date()): ReturnsStrip {
  const allNull: ReturnsStrip = {
    oneWeek: null,
    oneMonth: null,
    threeMonth: null,
    sixMonth: null,
    oneYear: null,
    fiscalYearToDate: null,
  };
  if (quotes.length === 0) return allNull;

  const sorted = quotes.slice().sort((a, b) => a.sessionDate.getTime() - b.sessionDate.getTime());
  const current = latestOnOrBefore(sorted, asOf.getTime());
  if (!current) return allNull;

  const strip: ReturnsStrip = { ...allNull };
  for (const key of Object.keys(WINDOW_DAYS) as (keyof typeof WINDOW_DAYS)[]) {
    const targetTime = current.sessionDate.getTime() - WINDOW_DAYS[key] * ONE_DAY_MS;
    const past = latestOnOrBefore(sorted, targetTime);
    // Guard against reusing the SAME session as both "current" and "past" on
    // a too-short history (e.g. a single-quote array) — that would silently
    // report a false 0% instead of an honest null.
    strip[key] = past && past.sessionDate.getTime() < current.sessionDate.getTime() ? pctChange(past.close, current.close) : null;
  }

  const { year, month } = istYearMonth(current.sessionDate);
  const fyStartYear = month >= 4 ? year : year - 1;
  const fyStart = istAprilFirstAsUtc(fyStartYear);
  // "To-date" from the FY start means vs. the last close of the PRIOR
  // fiscal year (one instant before fyStart) — same convention as a
  // calendar-YTD return being measured against the prior 31 Dec close.
  const priorFyClose = latestOnOrBefore(sorted, fyStart.getTime() - 1);
  strip.fiscalYearToDate =
    priorFyClose && priorFyClose.sessionDate.getTime() < current.sessionDate.getTime()
      ? pctChange(priorFyClose.close, current.close)
      : null;

  return strip;
}
