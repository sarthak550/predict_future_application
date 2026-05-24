/**
 * NSE Trading Holidays 2026 (S35-T3)
 *
 * Hardcoded list of NSE market holiday dates for 2026 in IST.
 * Format: "YYYY-MM-DD" strings matching IST calendar dates.
 *
 * Source: NSE official holiday calendar 2026.
 * Update annually — the founder updates this file each December for the next year.
 */

export const NSE_HOLIDAYS_2026: readonly string[] = [
  "2026-01-26", // Republic Day
  "2026-02-19", // Chhatrapati Shivaji Maharaj Jayanti
  "2026-03-02", // Mahashivratri
  "2026-03-25", // Holi
  "2026-04-02", // Ram Navami
  "2026-04-03", // Good Friday
  "2026-04-14", // Dr. Ambedkar Jayanti
  "2026-04-27", // Mahavir Jayanti
  "2026-05-01", // Maharashtra Day
  "2026-06-17", // Eid Al Fitr (approx, subject to moon sighting)
  "2026-08-15", // Independence Day
  "2026-08-23", // Ganesh Chaturthi
  "2026-09-02", // Eid Al Adha (approx)
  "2026-10-02", // Gandhi Jayanti / Dussehra
  "2026-10-20", // Diwali Laxmi Pujan (Muhurat trading session — half day; listed as closed for normal trading)
  "2026-10-21", // Diwali Balipratipada
  "2026-11-05", // Guru Nanak Jayanti
  "2026-12-25", // Christmas
] as const;

/**
 * Returns true if the given IST date string (YYYY-MM-DD) is an NSE holiday.
 */
export function isNSEHoliday(istDateKey: string): boolean {
  return (NSE_HOLIDAYS_2026 as readonly string[]).includes(istDateKey);
}
