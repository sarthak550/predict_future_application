/**
 * Charting Workbench (W3, T5) — pure client-side aggregation of
 * `OptionPremiumSnapshot` points into candles at any interval. No new
 * endpoint — this is the SAME `premium-history` points array
 * `terminal/premium-chart.tsx` already fetches, bucketed differently for the
 * workbench's candlestick view.
 *
 * **Architecture-simplification pass (2026-08-11), founder-directed.**
 * Three prior rounds of patches (interval-parity cadence, always-on index
 * capture + sparse-render fix, a same-day "1m candles missing" follow-up)
 * built this up into a bespoke pipeline: a "≥3-samples-per-bucket honesty
 * floor," a `captureIntervalSec`-driven per-bucket native-granularity check
 * to decide when that floor didn't apply, and (in `kline-chart.tsx`) a
 * bar-width-widening visual patch for the sparse result. Founder, verbatim,
 * after the THIRD round still shipped broken (1m showing no candles live,
 * 5m intermittently blank): "I want you to not fix it like it's broken but
 * use what we do in stocks/futures for this as well." Stocks/futures
 * (`fetchYahooCandles` -> `use-workbench-candles.ts` -> `kline-chart.tsx`)
 * have NONE of this machinery — a bucket's OHLC is just first/max/min/last
 * of whatever real samples landed in it, full stop.
 *
 * `aggregatePremiumCandles` below now does exactly that and nothing else.
 * The old honesty floor is gone — it was solving a problem that no longer
 * exists: OptionPremiumSnapshot capture is now dense (always-on, 1-minute
 * cadence for every index underlying — see `apps/api`'s premiumCapture.ts),
 * so a real bucket almost always has a real sample, and a bucket with
 * exactly one sample renders as an honest `O=H=L=C` bar — precisely how a
 * thinly-traded stock's real 1-minute candle can legitimately look from a
 * single trade. No fabrication either way; the floor was never protecting
 * against dishonesty, only hiding real (if visually thin) data.
 *
 * **A real, load-bearing finding from reproducing the founder's bug
 * live**, worth recording here since it explains why the OLD machinery
 * couldn't have fixed this even if it were bug-free: a single official
 * capture is a POINT-IN-TIME PRICE READ, not a trade tape. A 1-minute
 * bucket built from exactly one snapshot has no real intra-minute
 * high/low — it is HONESTLY a flat dash (open=high=low=close), same as it
 * was before this pass, same as it will be after. That's not a bug to
 * paper over; it's what plain, honest bucketing of snapshot data looks
 * like. What actually gives the chart real-looking bodies is the
 * CURRENTLY-FORMING bar picking up intra-bucket movement from the live
 * ~15s chain-tick — see `use-workbench-candles.ts`'s `foldQuoteIntoCandles`/
 * `extendProvisionalBar`, now shared with the equity/index branch instead
 * of a parallel "session tick" fold. Closed historical bars stay honest
 * single-print dashes when that's genuinely all that was captured — never
 * interpolated or widened to look richer than the data actually is.
 *
 * `captureIntervalSec` is still recorded per snapshot and still read
 * (by `use-workbench-candles.ts`, for its `premiumMeta.earliestFineGrainedCapturedAt`
 * disclosure label only) — but this module no longer branches aggregation
 * on it. A bucket's sample count no longer changes whether it renders.
 *
 * Pure function, no I/O, no React — trivially unit-testable.
 */

export interface PremiumSnapshotPoint {
  capturedAt: string;
  lastPrice: number;
}

export interface PremiumCandle {
  timestamp: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

/**
 * Terminal widget's sparse-history disclosure threshold lives in
 * `terminal/premium-chart.tsx` (`SPARSE_HISTORY_POINT_THRESHOLD`,
 * independent — a compact widget where a handful of points is normal).
 * This one is the WORKBENCH candlestick view's threshold, for its own
 * disclosure banner in `chart-workbench.tsx` — moved here (2026-08-11) from
 * `kline-chart.tsx`, which no longer has any premium-specific or
 * sparse-specific logic at all now that the bar-widening visual patch is
 * retired. Purely a copy threshold now, not a rendering one: below this
 * many real bars, `chart-workbench.tsx` shows "sparse history" disclosure
 * text rather than letting a thin chart speak for itself.
 */
export const SPARSE_BAR_COUNT_THRESHOLD = 40;

/**
 * @param points Chronologically-ascending snapshot points (the
 *   `premium-history` endpoint's own contract — never re-sorted here, an
 *   out-of-order input would silently misplace O/C within a bucket).
 * @param bucketMs Bucket width in milliseconds — any of the 6 workbench
 *   intervals (`1m` through `1d`), resolved by the caller.
 */
export function aggregatePremiumCandles(points: PremiumSnapshotPoint[], bucketMs: number): PremiumCandle[] {
  if (points.length === 0 || bucketMs <= 0) return [];

  const buckets = new Map<number, PremiumSnapshotPoint[]>();
  for (const point of points) {
    if (!Number.isFinite(point.lastPrice) || point.lastPrice <= 0) continue;
    const capturedAtMs = new Date(point.capturedAt).getTime();
    if (!Number.isFinite(capturedAtMs)) continue;
    const bucketStart = Math.floor(capturedAtMs / bucketMs) * bucketMs;
    const bucket = buckets.get(bucketStart);
    if (bucket) {
      bucket.push(point);
    } else {
      buckets.set(bucketStart, [point]);
    }
  }

  const candles: PremiumCandle[] = [];
  for (const bucketStart of Array.from(buckets.keys()).sort((a, b) => a - b)) {
    const snapshots = buckets.get(bucketStart);
    if (!snapshots || snapshots.length === 0) continue;

    let high = -Infinity;
    let low = Infinity;
    for (const s of snapshots) {
      if (s.lastPrice > high) high = s.lastPrice;
      if (s.lastPrice < low) low = s.lastPrice;
    }
    candles.push({
      timestamp: bucketStart,
      open: snapshots[0].lastPrice,
      high,
      low,
      close: snapshots[snapshots.length - 1].lastPrice,
      volume: 0 // option premium snapshots carry no real traded-volume figure — never fabricated.
    });
  }
  return candles;
}
