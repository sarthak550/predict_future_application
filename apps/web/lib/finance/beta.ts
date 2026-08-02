/**
 * Key Stats — self-computed Beta (founder ask 2026-08-02): replace the single
 * opaque Yahoo `beta` (quoteSummary's `summaryDetail.beta` — a 5Y-monthly
 * figure computed against an UNDISCLOSED benchmark for NSE names, per this
 * file's sibling `fetchKeyStats` doc comment) with two betas WE compute
 * ourselves against the same named benchmark (NIFTY 50, Yahoo ticker
 * "^NSEI") — one short-term, one long-term. Locked design:
 *
 *   Beta (1Y) = cov(stock daily returns, index daily returns)
 *               / var(index daily returns), trailing 1 year of ALIGNED
 *               daily closes.
 *   Beta (5Y) = same formula, trailing 5 years of ALIGNED MONTHLY returns
 *               (month-end closes derived from the daily series — the last
 *               daily close observed in each calendar month, not a
 *               fixed-day-of-month lookup).
 *
 * Rationale for computing both ourselves rather than mixing Yahoo's beta
 * (5Y monthly, benchmark undisclosed) with a self-computed 1Y: consistency
 * (both figures share one methodology and one named benchmark) and honesty
 * (a user comparing "Beta (1Y)" against "Beta (5Y)" on the same tile must be
 * comparing like with like, not two different benchmarks with different
 * disclosure).
 *
 * This module is PURE MATH — no I/O, no fetch, no Prisma — so it is
 * unit-testable in isolation (see apps/web/scripts/verify-beta.ts). The
 * fetch-and-cache orchestration (pulling 5y of daily closes for the stock
 * and for ^NSEI, with an in-module TTL cache for the shared index series)
 * lives in fundamentals.ts's `computeBetas`, alongside this file's sibling
 * price-series fetchers (`fetchDailyCloses`) — same module-boundary
 * convention as `growth.ts` (pure math) vs. `fundamentals.ts` (fetch+math)
 * elsewhere in this directory.
 */

/** One resolved trading-day (or month-end) close. Structurally identical to fundamentals.ts's internal `DailyClose` — kept as its own exported type here so this module has zero import dependency on fundamentals.ts. */
export type PricePoint = { date: string; close: number };

/** Minimum ALIGNED daily points required for a non-null Beta (1Y) — out of an expected ~252 trading days/year; ~180 tolerates a handful of feed gaps/holiday mismatches without going all the way to "insufficient." */
export const MIN_DAILY_POINTS_1Y = 180;
/** Minimum ALIGNED monthly points required for a non-null Beta (5Y) — out of an expected 60 over 5 years; ~36 (3 years) is the honest floor below which a "5-year" beta would materially misrepresent its own window. */
export const MIN_MONTHLY_POINTS_5Y = 36;

/**
 * Reduces an ascending, date-sorted daily series to one point per calendar
 * month — the LAST daily close observed in that month (a true month-end
 * close), not a close on a fixed day-of-month (which would silently be
 * wrong/absent around exchange holidays). Input order is trusted (as
 * `fetchDailyCloses` returns); a `Map` keyed by "YYYY-MM" naturally keeps
 * the last write per key when iterated in ascending order.
 */
export function toMonthEndCloses(daily: PricePoint[]): PricePoint[] {
  const byMonth = new Map<string, PricePoint>();
  for (const p of daily) {
    byMonth.set(p.date.slice(0, 7), p);
  }
  return [...byMonth.values()];
}

/**
 * Inner-joins two ascending series on exact date match (only dates present
 * in BOTH survive) — handles the stock and index feeds having slightly
 * different trading-holiday calendars or gaps without either series ever
 * needing to be forward/back-filled (which would fabricate a return).
 */
function alignByDate(a: PricePoint[], b: PricePoint[]): { a: PricePoint[]; b: PricePoint[] } {
  const bByDate = new Map(b.map((p) => [p.date, p.close]));
  const outA: PricePoint[] = [];
  const outB: PricePoint[] = [];
  for (const p of a) {
    const bClose = bByDate.get(p.date);
    if (bClose !== undefined) {
      outA.push(p);
      outB.push({ date: p.date, close: bClose });
    }
  }
  return { a: outA, b: outB };
}

/**
 * Simple returns for two ALREADY-ALIGNED (same length, same dates at each
 * index) close series, computed jointly so a defensive skip (a
 * non-positive close, never observed in practice for an equity/index close
 * but guarded for correctness) can never desynchronize the two return
 * arrays — the two outputs are always the same length, index-for-index
 * comparable.
 */
function jointSimpleReturns(a: PricePoint[], b: PricePoint[]): { returnsA: number[]; returnsB: number[] } {
  const returnsA: number[] = [];
  const returnsB: number[] = [];
  for (let i = 1; i < a.length; i++) {
    const prevA = a[i - 1].close;
    const prevB = b[i - 1].close;
    if (prevA > 0 && prevB > 0) {
      returnsA.push(a[i].close / prevA - 1);
      returnsB.push(b[i].close / prevB - 1);
    }
  }
  return { returnsA, returnsB };
}

function mean(xs: number[]): number {
  return xs.reduce((sum, x) => sum + x, 0) / xs.length;
}

/** Population covariance — the divide-by-n cancels against variance's own divide-by-n in the beta ratio below, so population vs. sample convention makes no difference to the result. */
function covariance(x: number[], y: number[]): number {
  const meanX = mean(x);
  const meanY = mean(y);
  let sum = 0;
  for (let i = 0; i < x.length; i++) sum += (x[i] - meanX) * (y[i] - meanY);
  return sum / x.length;
}

function variance(x: number[]): number {
  return covariance(x, x);
}

/**
 * computeBeta — the shared statistical core for both Beta (1Y) and
 * Beta (5Y). Both `stockCloses` and `indexCloses` must be ascending,
 * date-sorted daily closes (as `fetchDailyCloses` returns); this function
 * does NOT trim by date range — callers are responsible for passing in
 * exactly the window they want (see `computeBetas` in fundamentals.ts,
 * which slices a shared 5y fetch down to the trailing 1y for the daily
 * mode and passes the full 5y through for the monthly mode).
 *
 * mode "daily": aligns the two series by exact date, computes simple daily
 * returns, and returns cov(stockReturns, indexReturns) / var(indexReturns).
 * Null when fewer than `MIN_DAILY_POINTS_1Y` aligned return points exist.
 *
 * mode "monthly": first reduces BOTH series to one close per calendar
 * month (`toMonthEndCloses`), then applies the identical
 * align -> returns -> cov/var pipeline to the monthly series. Null when
 * fewer than `MIN_MONTHLY_POINTS_5Y` aligned monthly return points exist.
 *
 * Returns null (never a fabricated number) whenever there's insufficient
 * aligned history for the requested mode, OR the index's return variance is
 * exactly 0 (a constant/flat index series over the window — the ratio is
 * mathematically undefined, not just numerically unstable).
 */
export function computeBeta(stockCloses: PricePoint[], indexCloses: PricePoint[], opts: { mode: "daily" | "monthly" }): number | null {
  const stockSeries = opts.mode === "monthly" ? toMonthEndCloses(stockCloses) : stockCloses;
  const indexSeries = opts.mode === "monthly" ? toMonthEndCloses(indexCloses) : indexCloses;

  const { a: stockAligned, b: indexAligned } = alignByDate(stockSeries, indexSeries);
  const { returnsA: stockReturns, returnsB: indexReturns } = jointSimpleReturns(stockAligned, indexAligned);

  const minPoints = opts.mode === "monthly" ? MIN_MONTHLY_POINTS_5Y : MIN_DAILY_POINTS_1Y;
  if (stockReturns.length < minPoints) return null;

  const indexVar = variance(indexReturns);
  if (indexVar === 0) return null;

  const beta = covariance(stockReturns, indexReturns) / indexVar;
  return Number.isFinite(beta) ? beta : null;
}
