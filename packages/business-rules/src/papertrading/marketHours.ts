/**
 * Paper Trading Phase 1 — NSE weekday market-hours gate for order placement.
 *
 * apps/web cannot import apps/api's server code, so this is a deliberate,
 * intentional DUPLICATE of the pure IST-clock logic in
 * apps/api/lib/marketMoves/marketHours.ts's isNseWeekdayMarketHours (same
 * IST_OFFSET_MS pattern, same 09:15-15:30 window) — lifted into this shared
 * package per the cross-app math placement rule (see
 * packages/business-rules/src/portfolios/shadow.ts's istCalendarDateOfInstant for
 * the identical precedent: duplicated rather than imported, to keep this package
 * free of any apps/api dependency). apps/api/lib/marketMoves/marketHours.ts itself
 * is left untouched — it still backs the Market Pulse movers cron.
 *
 * Same Phase 1 caveat as the original: no NSE holiday calendar. On an NSE trading
 * holiday that falls on a weekday, this returns true — acceptable for Phase 1,
 * flagged as a known gap.
 */

const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;

function getIstDayOfWeek(now: Date): number {
  return new Date(now.getTime() + IST_OFFSET_MS).getUTCDay();
}

function getIstMinutesSinceMidnight(now: Date): number {
  const ist = new Date(now.getTime() + IST_OFFSET_MS);
  return ist.getUTCHours() * 60 + ist.getUTCMinutes();
}

const NSE_OPEN_MINUTES = 9 * 60 + 15; // 09:15 IST
const NSE_CLOSE_MINUTES = 15 * 60 + 30; // 15:30 IST

/** True on a weekday (Mon-Fri IST) between 09:15 and 15:30 IST. Paper Trading orders are rejected outside this window — no fill can be priced against a closed market's delayed tick. */
export function isNseWeekdayMarketHours(now: Date = new Date()): boolean {
  const dayOfWeek = getIstDayOfWeek(now);
  if (dayOfWeek === 0 || dayOfWeek === 6) return false; // Sun / Sat

  const minutes = getIstMinutesSinceMidnight(now);
  return minutes >= NSE_OPEN_MINUTES && minutes <= NSE_CLOSE_MINUTES;
}
