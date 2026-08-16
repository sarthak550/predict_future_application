/**
 * Intraday Chart Ranges (2026-08-16) — IST trading-session bucketing for a
 * raw Yahoo-candle OHLCV array (epoch-millis timestamps), so a client-side
 * chart can slice "the last N trading sessions" out of a 1mo/3mo intraday
 * series the same honest way `computeReturnsStrip` already treats a daily
 * EOD array's session boundaries (see ./returns.ts) — reused here rather
 * than re-invented, via `istCalendarDateOfInstant` (portfolios/shadow.ts,
 * already the package's one IST-calendar-date primitive; NOT re-duplicated
 * as a third IST_OFFSET_MS copy).
 *
 * Pure — no I/O — so this runs identically server- or client-side. Written
 * for `price-chart.tsx`'s 1W (15m bars) / 1M (60m bars) lazy fetch: the
 * candles endpoint's `range` window (1mo / 3mo) is intentionally wider than
 * the 5/22 sessions the chart actually wants (see
 * apps/api/lib/marketMoves/candles.ts's INTERVAL_RANGE doc), so this is the
 * client-side slice step Decision 2 of the CTO brief calls for.
 */

import { istCalendarDateOfInstant } from "../portfolios/shadow";

/** The minimal shape this module needs from a candle bar — an epoch-millis timestamp, same units `fetchYahooCandles` returns (`Candle.timestamp`). */
export interface IstTimestampedBar {
  timestamp: number;
}

/** `${year}-${month}-${day}` IST calendar-day key — collision-free across years (unlike a bare "MM-DD"). */
function istSessionKey(timestampMs: number): string {
  const { year, month, day } = istCalendarDateOfInstant(new Date(timestampMs));
  return `${year}-${month}-${day}`;
}

/**
 * Returns only the bars belonging to the last `sessionCount` distinct IST
 * trading sessions present in `bars` — the intraday-series equivalent of
 * `series.slice(-sessions)` on a one-row-per-session daily array. Sessions
 * are derived from the bars' OWN timestamps (never a holiday calendar or an
 * assumed session length), so this is correct regardless of how many bars a
 * given session actually contains (a half day, a thin/illiquid session,
 * etc) and naturally spans weekends with zero gap-detection code — the
 * output simply has no bar for a day nothing was returned for.
 *
 * Assumes `bars` arrives sorted ascending by timestamp (guaranteed by
 * `fetchYahooCandles`'s own zip step) — this function does not re-sort, only
 * groups and filters, so a caller violating that ordering gets an
 * undefined-order (but still correctly-FILTERED) result rather than a thrown
 * error.
 *
 * `sessionCount <= 0` or an empty `bars` array returns `[]`. When `bars`
 * already spans `sessionCount` sessions or fewer, every bar is returned
 * unchanged (nothing to trim).
 */
export function sliceToLastIstSessions<T extends IstTimestampedBar>(bars: T[], sessionCount: number): T[] {
  if (bars.length === 0 || sessionCount <= 0) return [];

  const orderedSessionKeys: string[] = [];
  const seen = new Set<string>();
  for (const bar of bars) {
    const key = istSessionKey(bar.timestamp);
    if (!seen.has(key)) {
      seen.add(key);
      orderedSessionKeys.push(key);
    }
  }
  if (orderedSessionKeys.length <= sessionCount) return bars;

  const keepSessions = new Set(orderedSessionKeys.slice(-sessionCount));
  return bars.filter((bar) => keepSessions.has(istSessionKey(bar.timestamp)));
}
