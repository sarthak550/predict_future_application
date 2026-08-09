/**
 * Shared helper for folding a real-time last-price tick into a DAILY
 * close-price sparkline series honestly — 2026-08-09 founder ask ("the
 * plots/charts we are showing... are not live or at least looks live") on
 * the homepage's Indian Economy tiles and Instrument Research cards.
 *
 * These sparklines (components/finance/instrument-sparkline.tsx) are a
 * SESSION-level series — one point per trading DAY's close — unlike the
 * intraday-bar folding `components/finance/homepage-live-chart.tsx` already
 * does for 5-minute candles. A closed session's close must never be
 * silently rewritten (same "never mutate a closed bar" law
 * `use-workbench-candles.ts`'s `foldQuoteIntoCandles` documents). What
 * matters here is whether the series' LAST point already represents
 * *today* (IST): if today's EOD/bhavcopy row has already posted, it's
 * correct to refine that point's close with the fresher live price; if the
 * last point is still yesterday's close (the common case while the market
 * is open and today's EOD hasn't posted yet), the honest move is to APPEND
 * a new provisional point for today rather than overwrite yesterday's real,
 * already-closed number.
 */

/** IST calendar-day key ("YYYY-MM-DD") for a Date — `en-CA` is the cheapest built-in locale that formats in ISO order. */
export function istDateKey(date: Date): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(date);
}

/**
 * Folds a live tick price into `points` (ascending by sessionDate, same
 * order every caller of this already uses). Returns a NEW array (never
 * mutates `points`) so React/consumers see the change. `points.length === 0`
 * is returned as-is — InstrumentSparkline already renders its own
 * "not enough sessions" state for that case.
 */
export function foldTickIntoSparkline<T extends { sessionDate: Date; close: number }>(
  points: T[],
  tickPrice: number,
  now: Date = new Date(),
): T[] {
  if (points.length === 0) return points;
  const last = points[points.length - 1];
  const todayKey = istDateKey(now);
  if (istDateKey(last.sessionDate) === todayKey) {
    // Today's row already exists — refine it, don't add a second point for
    // the same day.
    return [...points.slice(0, -1), { ...last, close: tickPrice }];
  }
  // Today's EOD hasn't posted yet — append a genuine new provisional point
  // rather than rewriting yesterday's already-closed number.
  return [...points, { ...last, sessionDate: now, close: tickPrice }];
}
