/**
 * Key Stats — Beta (1Y)/(5Y) acceptance script for `computeBeta`
 * (lib/finance/beta.ts). Pure function, zero I/O — same "hand-calculated
 * assertions against a pure function" pattern as
 * apps/web/scripts/verify-returns-strip.ts.
 *
 * Run: npx tsx scripts/verify-beta.ts   (from apps/web)
 */

import { computeBeta, toMonthEndCloses, MIN_DAILY_POINTS_1Y, MIN_MONTHLY_POINTS_5Y, type PricePoint } from "@/lib/finance/beta";

let passCount = 0;
let failCount = 0;

function assertClose(actual: number | null, expected: number | null, message: string, epsilon = 1e-6) {
  const ok = actual === null || expected === null ? actual === expected : Math.abs(actual - expected) < epsilon;
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

function assertEqual<T>(actual: T, expected: T, message: string) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (ok) {
    passCount += 1;
    console.log(`  PASS: ${message}`);
  } else {
    failCount += 1;
    console.error(`  FAIL: ${message} — expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

function isoDate(daysFromEpochStart: number): string {
  // 2020-01-01 + N calendar days, deterministic, weekends included (this is
  // synthetic data — computeBeta doesn't care about real trading calendars,
  // only about date-string alignment between the two series).
  const d = new Date(Date.UTC(2020, 0, 1) + daysFromEpochStart * 24 * 60 * 60 * 1000);
  return d.toISOString().slice(0, 10);
}

/**
 * Builds a synthetic ascending daily-close series of `n` points where each
 * day's simple return is exactly `dailyReturn` (constant, non-zero, so the
 * index has real non-zero variance) starting from `startClose`.
 */
function buildConstantReturnSeries(n: number, startClose: number, dailyReturn: number): PricePoint[] {
  const points: PricePoint[] = [];
  let close = startClose;
  for (let i = 0; i < n; i++) {
    points.push({ date: isoDate(i), close });
    close = close * (1 + dailyReturn);
  }
  return points;
}

/**
 * Builds a synthetic ascending daily-close series where the day-to-day
 * simple returns cycle through `returnPattern` (repeating) — used to give
 * the index REAL variance (a constant-return series has cov proportional
 * to var trivially in a degenerate way that could mask an alignment bug;
 * a varying pattern is a stronger check).
 */
function buildPatternedSeries(n: number, startClose: number, returnPattern: number[]): PricePoint[] {
  const points: PricePoint[] = [];
  let close = startClose;
  for (let i = 0; i < n; i++) {
    points.push({ date: isoDate(i), close });
    close = close * (1 + returnPattern[i % returnPattern.length]);
  }
  return points;
}

/** Derives a stock series whose return on every day is exactly `beta * index's own return that day` — analytically, cov(stock,index)/var(index) must equal `beta` exactly. */
function scaledSeries(indexSeries: PricePoint[], beta: number, startClose: number): PricePoint[] {
  const points: PricePoint[] = [{ date: indexSeries[0].date, close: startClose }];
  let close = startClose;
  for (let i = 1; i < indexSeries.length; i++) {
    const indexReturn = indexSeries[i].close / indexSeries[i - 1].close - 1;
    close = close * (1 + beta * indexReturn);
    points.push({ date: indexSeries[i].date, close });
  }
  return points;
}

// ---------------------------------------------------------------------------
// Case 1 — analytically known beta: stock returns = exactly 1.5x index
// returns, varying (non-constant) daily pattern, 300 daily points (> the
// 180-point 1Y floor). Beta must resolve to exactly 1.5.
// ---------------------------------------------------------------------------
console.log("Case 1: daily mode, stock = 1.5x index (varying pattern), analytically beta = 1.5");
{
  const pattern = [0.01, -0.005, 0.002, 0.008, -0.012, 0.003, -0.001, 0.006];
  const index = buildPatternedSeries(300, 20000, pattern);
  const stock = scaledSeries(index, 1.5, 2500);
  const beta = computeBeta(stock, index, { mode: "daily" });
  assertClose(beta, 1.5, "daily beta resolves to exactly 1.5 for a 1.5x-scaled synthetic stock");
}

// ---------------------------------------------------------------------------
// Case 2 — noise-free shifted case: index shifted/offset by a constant
// multiplier still yields the same beta (sanity: beta is scale-invariant to
// the index's OWN level, only its RETURNS matter).
// ---------------------------------------------------------------------------
console.log("\nCase 2: daily mode, index rebased to a different starting level, beta unchanged");
{
  const pattern = [0.004, -0.002, 0.009, -0.006, 0.001, 0.003, -0.008, 0.005];
  const indexLow = buildPatternedSeries(250, 1000, pattern);
  const indexHigh = buildPatternedSeries(250, 5_000_000, pattern); // same returns, wildly different level
  const stockLow = scaledSeries(indexLow, 0.8, 300);
  const stockHigh = scaledSeries(indexHigh, 0.8, 300);
  const betaLow = computeBeta(stockLow, indexLow, { mode: "daily" });
  const betaHigh = computeBeta(stockHigh, indexHigh, { mode: "daily" });
  assertClose(betaLow, 0.8, "beta = 0.8 at the original index level");
  assertClose(betaHigh, 0.8, "beta = 0.8 unchanged after rebasing the index's starting level");
}

/** "2020-01" + N months, day fixed at the 15th — deliberately ONE point per calendar month, so `toMonthEndCloses` (which keeps the last point seen per YYYY-MM) returns these points completely unchanged. This isolates the monthly-mode test from the daily-compounding-vs-linear-scaling distinction Case 1/7 rely on: the beta relationship (`stockReturn = beta * indexReturn`) is only exact between two CONSECUTIVE points in the series actually fed to computeBeta — for monthly mode those consecutive points must themselves already be monthly, not daily points later reduced, which is why this builds directly at monthly granularity. */
function monthlyIsoDate(monthsFromStart: number): string {
  const d = new Date(Date.UTC(2020, monthsFromStart, 15));
  return d.toISOString().slice(0, 10);
}

function buildPatternedMonthlySeries(nMonths: number, startClose: number, returnPattern: number[]): PricePoint[] {
  const points: PricePoint[] = [];
  let close = startClose;
  for (let i = 0; i < nMonths; i++) {
    points.push({ date: monthlyIsoDate(i), close });
    close = close * (1 + returnPattern[i % returnPattern.length]);
  }
  return points;
}

// ---------------------------------------------------------------------------
// Case 3 — monthly mode with an analytically known beta: built directly at
// monthly granularity (one point per calendar month — see
// buildPatternedMonthlySeries's doc comment for why) over 5 years (60
// months, comfortably above the 36-point floor).
// ---------------------------------------------------------------------------
console.log("\nCase 3: monthly mode, stock = 0.6x index over 5y of monthly data, analytically beta = 0.6");
{
  const pattern = [0.015, -0.008, 0.022, -0.011, 0.006, -0.019, 0.013, 0.004, -0.006, 0.009];
  const index = buildPatternedMonthlySeries(60, 22000, pattern);
  const stock = scaledSeries(index, 0.6, 3200);
  const beta = computeBeta(stock, index, { mode: "monthly" });
  assertClose(beta, 0.6, "monthly beta resolves to exactly 0.6 for a 0.6x-scaled synthetic stock");
}

// ---------------------------------------------------------------------------
// Case 4 — insufficient daily history: fewer than MIN_DAILY_POINTS_1Y
// aligned points must yield an honest null, never a fabricated number off a
// too-short window.
// ---------------------------------------------------------------------------
console.log("\nCase 4: daily mode, too few aligned points (recent-IPO-shaped short history)");
{
  const pattern = [0.01, -0.005, 0.002];
  const index = buildPatternedSeries(90, 20000, pattern); // well under the 180-point floor
  const stock = scaledSeries(index, 1.2, 500);
  const beta = computeBeta(stock, index, { mode: "daily" });
  assertNull(beta, `daily beta null with only 89 return points (< ${MIN_DAILY_POINTS_1Y} floor)`);
}

// ---------------------------------------------------------------------------
// Case 5 — insufficient monthly history: under 36 monthly points.
// ---------------------------------------------------------------------------
console.log("\nCase 5: monthly mode, too few aligned monthly points (2 years of daily data -> ~24 months)");
{
  const pattern = [0.001, -0.002, 0.0015];
  const index = buildPatternedSeries(2 * 365, 20000, pattern);
  const stock = scaledSeries(index, 1.1, 500);
  const beta = computeBeta(stock, index, { mode: "monthly" });
  assertNull(beta, `monthly beta null with ~24 monthly points (< ${MIN_MONTHLY_POINTS_5Y} floor)`);
}

// ---------------------------------------------------------------------------
// Case 6 — zero index variance: a perfectly flat index must yield null, not
// a divide-by-zero artifact (Infinity/NaN).
// ---------------------------------------------------------------------------
console.log("\nCase 6: daily mode, flat (zero-variance) index");
{
  const flatIndex: PricePoint[] = Array.from({ length: 250 }, (_, i) => ({ date: isoDate(i), close: 20000 }));
  const stock = buildConstantReturnSeries(250, 500, 0.001);
  const beta = computeBeta(stock, flatIndex, { mode: "daily" });
  assertNull(beta, "beta null (not Infinity/NaN) when index variance is exactly 0");
}

// ---------------------------------------------------------------------------
// Case 7 — misaligned dates: the index has gaps (simulating a different
// holiday calendar / missing sessions) that the stock doesn't. Only dates
// present in BOTH must be used — verified by checking the result still
// matches the analytically expected beta despite the gaps.
// ---------------------------------------------------------------------------
console.log("\nCase 7: daily mode, index has date gaps the stock doesn't (inner-join alignment)");
{
  const pattern = [0.006, -0.003, 0.012, -0.007, 0.002, 0.009, -0.004];
  const fullIndex = buildPatternedSeries(300, 20000, pattern);
  const stock = scaledSeries(fullIndex, 1.3, 400);
  // Drop every 5th index point (simulating exchange-specific holidays) —
  // the corresponding stock points remain, so alignment must inner-join
  // down to the surviving dates only.
  const gappyIndex = fullIndex.filter((_, i) => i % 5 !== 0);
  const beta = computeBeta(stock, gappyIndex, { mode: "daily" });
  // Wider epsilon here (not 1e-6): whenever alignment collapses a dropped
  // day into one multi-day return, `stock's per-DAY beta*return recursion`
  // vs. `index's own multi-day compounded return` are only linearly (not
  // exactly) related — a genuine second-order artifact of this test's
  // construction around gaps, not a computeBeta bug. 1e-3 comfortably
  // clears the observed ~8e-5 deviation while still catching a real
  // misalignment bug, which would be off by orders of magnitude more.
  assertClose(beta, 1.3, "daily beta still resolves correctly when the index has gaps the stock doesn't (still >180 aligned points)", 1e-3);
}

// ---------------------------------------------------------------------------
// Case 8 — toMonthEndCloses: verifies the reduction picks the LAST daily
// close in each calendar month, not a fixed-day-of-month lookup.
// ---------------------------------------------------------------------------
console.log("\nCase 8: toMonthEndCloses picks the last close per calendar month");
{
  const daily: PricePoint[] = [
    { date: "2026-01-05", close: 100 },
    { date: "2026-01-20", close: 105 },
    { date: "2026-01-30", close: 110 }, // last Jan point
    { date: "2026-02-02", close: 111 },
    { date: "2026-02-27", close: 120 }, // last Feb point
    { date: "2026-03-15", close: 130 }, // last (only) Mar point
  ];
  const monthEnds = toMonthEndCloses(daily);
  assertEqual(
    monthEnds.map((p) => `${p.date}:${p.close}`),
    ["2026-01-30:110", "2026-02-27:120", "2026-03-15:130"],
    "month-end reduction keeps the last observed close per YYYY-MM bucket"
  );
}

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------
console.log(`\n${passCount} passed, ${failCount} failed`);
if (failCount > 0) process.exit(1);
