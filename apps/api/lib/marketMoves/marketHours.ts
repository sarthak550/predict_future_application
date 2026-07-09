/**
 * Market Pulse — NSE market-hours + weekday gate for the movers cron.
 *
 * Phase 1 deliberately does NOT implement a full NSE holiday calendar (see
 * apps/mobile/src/constants/nse-holidays-2026.ts for the mobile-side holiday
 * list used elsewhere in the app — reusing it here would require duplicating
 * or importing across the app/mobile boundary, and the CEO brief explicitly
 * scoped Phase 1 to a simple weekday check). On an NSE trading holiday that
 * falls on a weekday, this returns true and the cron will simply upsert
 * whatever (likely empty/stale) data the mover endpoint returns that day —
 * acceptable for Phase 1; flagged as a known gap, not silently worked around.
 *
 * IST = UTC+5:30. Mirrors the offset-math pattern used in
 * apps/api/lib/quests/engine.ts's getIstDateString/getIstDayBoundsUtc.
 */

const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;

/** 0 = Sunday … 6 = Saturday, computed in IST regardless of server TZ. */
function getIstDayOfWeek(now: Date): number {
  return new Date(now.getTime() + IST_OFFSET_MS).getUTCDay();
}

/** Minutes since IST midnight (0–1439), computed in IST regardless of server TZ. */
function getIstMinutesSinceMidnight(now: Date): number {
  const ist = new Date(now.getTime() + IST_OFFSET_MS);
  return ist.getUTCHours() * 60 + ist.getUTCMinutes();
}

const NSE_OPEN_MINUTES = 9 * 60 + 15; // 09:15 IST
const NSE_CLOSE_MINUTES = 15 * 60 + 30; // 15:30 IST

/**
 * True on a weekday (Mon–Fri IST) between 09:15 and 15:30 IST. Used to gate
 * the movers cron so it silently no-ops outside trading hours rather than
 * upserting stale/closed-market snapshots.
 */
export function isNseWeekdayMarketHours(now: Date = new Date()): boolean {
  const dayOfWeek = getIstDayOfWeek(now);
  if (dayOfWeek === 0 || dayOfWeek === 6) return false; // Sun / Sat

  const minutes = getIstMinutesSinceMidnight(now);
  return minutes >= NSE_OPEN_MINUTES && minutes <= NSE_CLOSE_MINUTES;
}

/** Returns the current IST calendar day at IST midnight, expressed as a UTC Date instant. */
export function getIstSessionDate(now: Date = new Date()): Date {
  const ist = new Date(now.getTime() + IST_OFFSET_MS);
  const yyyy = ist.getUTCFullYear();
  const mm = ist.getUTCMonth();
  const dd = ist.getUTCDate();
  return new Date(Date.UTC(yyyy, mm, dd) - IST_OFFSET_MS);
}
