/**
 * Instrument Page v2 — T3 acceptance script for computeReturnsStrip
 * (packages/business-rules/src/marketPulse/returns.ts). Pure function, zero
 * I/O, zero Prisma — mirrors apps/api/scripts/verify-papertrading-engine.ts's
 * "hand-calculated assertions against a pure function" pattern, kept in
 * apps/web/scripts (not apps/api) since this brief is web-only scope.
 *
 * Run: npx tsx scripts/verify-returns-strip.ts   (from apps/web)
 */

import { computeReturnsStrip, type ReturnsQuotePoint } from "@predict-future/business-rules/marketPulse/returns";

let passCount = 0;
let failCount = 0;

function assertClose(actual: number | null, expected: number | null, message: string, epsilon = 1e-6) {
  const ok =
    actual === null || expected === null ? actual === expected : Math.abs(actual - expected) < epsilon;
  if (ok) {
    passCount += 1;
    console.log(`  PASS: ${message} (${actual === null ? "null" : actual.toFixed(4)})`);
  } else {
    failCount += 1;
    console.error(`  FAIL: ${message} — expected ${expected}, got ${actual}`);
  }
}

function assertNull(actual: number | null, message: string) {
  assertClose(actual, null, message);
}

/** Builds an IST-midnight-as-UTC Date for a given calendar date, matching StockEodQuote.sessionDate's storage convention. */
function ist(year: number, month: number, day: number): Date {
  return new Date(Date.UTC(year, month - 1, day, 0, 0, 0) - 5.5 * 60 * 60 * 1000);
}

function q(year: number, month: number, day: number, close: number): ReturnsQuotePoint {
  return { sessionDate: ist(year, month, day), close };
}

// ---------------------------------------------------------------------------
// Case 1 — empty history: every field null.
// ---------------------------------------------------------------------------
console.log("Case 1: empty quotes array");
{
  const strip = computeReturnsStrip([], ist(2026, 7, 25));
  assertNull(strip.oneWeek, "1W null on empty history");
  assertNull(strip.oneMonth, "1M null on empty history");
  assertNull(strip.threeMonth, "3M null on empty history");
  assertNull(strip.sixMonth, "6M null on empty history");
  assertNull(strip.oneYear, "1Y null on empty history");
  assertNull(strip.fiscalYearToDate, "FYTD null on empty history");
}

// ---------------------------------------------------------------------------
// Case 2 — insufficient history: a "recent IPO" with only 10 days of data.
// 1W should resolve (7 days back is within range), everything longer must
// be an honest null, not a false 0%.
// ---------------------------------------------------------------------------
console.log("\nCase 2: recent-IPO-shaped short history (10 sessions)");
{
  const quotes: ReturnsQuotePoint[] = [];
  for (let i = 0; i < 10; i++) {
    quotes.push(q(2026, 7, 10 + i, 100 + i)); // 10 Jul..19 Jul, close 100..109
  }
  const strip = computeReturnsStrip(quotes, ist(2026, 7, 19));
  // current = 19 Jul close 109. Target for 1W = 19 Jul - 7d = 12 Jul -> close 102.
  assertClose(strip.oneWeek, ((109 - 102) / 102) * 100, "1W resolves within short history");
  assertNull(strip.oneMonth, "1M null — history doesn't reach back 30 days");
  assertNull(strip.threeMonth, "3M null — history doesn't reach back 91 days");
  assertNull(strip.sixMonth, "6M null — history doesn't reach back 182 days");
  assertNull(strip.oneYear, "1Y null — history doesn't reach back 365 days");
}

// ---------------------------------------------------------------------------
// Case 3 — flat/no-change series: every resolvable window is exactly 0%,
// not null (0% is a real, honest answer here — distinct from Case 2's null).
// ---------------------------------------------------------------------------
console.log("\nCase 3: flat series (400 daily sessions, constant close)");
{
  const quotes: ReturnsQuotePoint[] = [];
  const start = ist(2025, 1, 1);
  for (let i = 0; i < 400; i++) {
    quotes.push({ sessionDate: new Date(start.getTime() + i * 24 * 60 * 60 * 1000), close: 250 });
  }
  const asOf = quotes[quotes.length - 1]!.sessionDate;
  const strip = computeReturnsStrip(quotes, asOf);
  assertClose(strip.oneWeek, 0, "1W is 0% on a flat series");
  assertClose(strip.oneMonth, 0, "1M is 0% on a flat series");
  assertClose(strip.threeMonth, 0, "3M is 0% on a flat series");
  assertClose(strip.sixMonth, 0, "6M is 0% on a flat series");
  assertClose(strip.oneYear, 0, "1Y is 0% on a flat series");
}

// ---------------------------------------------------------------------------
// Case 4 — exact-boundary session dates: a quote sitting exactly on the
// target instant must be picked up (on-or-before is inclusive).
// ---------------------------------------------------------------------------
console.log("\nCase 4: exact-boundary session date (target date has a real quote)");
{
  // current = 25 Jul 2026. 1W target = 18 Jul 2026 exactly — a real session.
  const quotes: ReturnsQuotePoint[] = [
    q(2026, 7, 18, 200),
    q(2026, 7, 21, 210),
    q(2026, 7, 22, 215),
    q(2026, 7, 23, 205),
    q(2026, 7, 24, 220),
    q(2026, 7, 25, 230),
  ];
  const strip = computeReturnsStrip(quotes, ist(2026, 7, 25));
  assertClose(strip.oneWeek, ((230 - 200) / 200) * 100, "1W uses the exact-boundary session, not an adjacent one");
}

// ---------------------------------------------------------------------------
// Case 5 — a gap (missing session) near a boundary: the 1W target date falls
// on a weekend with no quote; the last trading day BEFORE it must be used.
// ---------------------------------------------------------------------------
console.log("\nCase 5: gap near the 1W boundary (target date is a weekend)");
{
  // current = Mon 27 Jul 2026. 1W target = Mon 20 Jul 2026 exactly (7 cal days back)
  // -> but suppose that session is missing (holiday); nearest trading day
  // before it is Fri 17 Jul.
  const quotes: ReturnsQuotePoint[] = [
    q(2026, 7, 16, 300), // Thu
    q(2026, 7, 17, 305), // Fri
    // 18/19 weekend, 20 Jul (Mon) missing — holiday gap
    q(2026, 7, 21, 310), // Tue
    q(2026, 7, 22, 312),
    q(2026, 7, 23, 315),
    q(2026, 7, 24, 318),
    q(2026, 7, 27, 320), // Mon (next week)
  ];
  const strip = computeReturnsStrip(quotes, ist(2026, 7, 27));
  // target = 27 Jul - 7d = 20 Jul (missing) -> falls back to 17 Jul close 305.
  assertClose(strip.oneWeek, ((320 - 305) / 305) * 100, "1W falls back to the last trading day before a holiday gap");
}

// ---------------------------------------------------------------------------
// Case 6 — FY-to-date: current date after 1 April (same FY as its own start)
// vs. before 1 April (still in the PRIOR fiscal year).
// ---------------------------------------------------------------------------
console.log("\nCase 6: fiscal-year-to-date boundary");
{
  const quotes: ReturnsQuotePoint[] = [
    q(2025, 3, 28, 90), // last trading day of FY2024-25 (before 1 Apr 2025)
    q(2025, 4, 1, 91), // first trading day of FY2025-26
    q(2025, 12, 15, 120),
    q(2026, 3, 31, 130), // last trading day of FY2025-26
    q(2026, 4, 1, 131), // first trading day of FY2026-27
    q(2026, 7, 20, 150),
  ];
  const afterAprilStrip = computeReturnsStrip(quotes, ist(2026, 7, 20));
  // current = 20 Jul 2026 -> FY2026-27 (started 1 Apr 2026) -> prior close = 31 Mar 2026 (130).
  assertClose(
    afterAprilStrip.fiscalYearToDate,
    ((150 - 130) / 130) * 100,
    "FYTD after 1 Apr uses the just-started fiscal year"
  );

  const beforeAprilStrip = computeReturnsStrip(quotes, ist(2025, 12, 15));
  // current = 15 Dec 2025 -> still FY2025-26 (started 1 Apr 2025) -> prior close = 28 Mar 2025 (90).
  assertClose(
    beforeAprilStrip.fiscalYearToDate,
    ((120 - 90) / 90) * 100,
    "FYTD before 1 Apr uses the still-open fiscal year, not the calendar year"
  );
}

// ---------------------------------------------------------------------------
// Case 7 — FY-to-date with no prior-FY close at all (IPO mid-FY): null, not 0%.
// ---------------------------------------------------------------------------
console.log("\nCase 7: FYTD with no prior fiscal year data (mid-FY IPO)");
{
  const quotes: ReturnsQuotePoint[] = [q(2026, 6, 1, 500), q(2026, 7, 20, 520)];
  const strip = computeReturnsStrip(quotes, ist(2026, 7, 20));
  assertNull(strip.fiscalYearToDate, "FYTD null — no quote exists before this fiscal year's 1 Apr start");
}

// ---------------------------------------------------------------------------
// Case 8 — asOf predates every quote on hand: every field null.
// ---------------------------------------------------------------------------
console.log("\nCase 8: asOf predates all available history");
{
  const quotes: ReturnsQuotePoint[] = [q(2026, 7, 20, 100), q(2026, 7, 21, 101)];
  const strip = computeReturnsStrip(quotes, ist(2020, 1, 1));
  assertNull(strip.oneWeek, "1W null when asOf predates all history");
  assertNull(strip.fiscalYearToDate, "FYTD null when asOf predates all history");
}

console.log(`\n${passCount} passed, ${failCount} failed`);
if (failCount > 0) {
  process.exitCode = 1;
}
