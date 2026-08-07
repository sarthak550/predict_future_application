/**
 * Charting Workbench (W3, T5) — pure client-side aggregation of
 * `OptionPremiumSnapshot` points into honest pseudo-candles at any interval.
 * No new endpoint — this is the SAME `premium-history` points array
 * `terminal/premium-chart.tsx` already fetches, bucketed differently for the
 * workbench's candlestick view.
 *
 * **Interval-parity cadence project (2026-08-07)** — widened from a fixed
 * 15/30-minute-only bucket set (built around a flat 5-minute capture
 * cadence) to arbitrary `bucketMs`, now that `apps/api`'s premiumCapture.ts
 * captures index underlyings every 1 minute and stock underlyings every 5
 * minutes (see that file's own module doc for the full cadence split).
 *
 * Honesty rule (founder plan §2, non-negotiable — UNCHANGED for a real
 * aggregation): a bucket needs AT LEAST 3 snapshots to render AS AN
 * AGGREGATION. Fewer than 3 points in a window wider than the data's own
 * native capture cadence is too sparse to represent a real O/H/L/C range —
 * rendering it anyway would fabricate a flat `O=H=L=C` bar from what might
 * be a single stale tick.
 *
 * **NEW distinction (2026-08-07) — native-granularity buckets need only 1.**
 * `captureIntervalSec` (now carried on every point, read straight off each
 * row's own recorded truth — never inferred from the underlying's name
 * here) tells this function EXACTLY how finely a given point was actually
 * sampled. When a bucket's width is no wider than the FINEST
 * `captureIntervalSec` genuinely present among that bucket's own points, the
 * bucket isn't an aggregation at all — it's (at most) one native sample —
 * and a single point IS the true, honest tick for that bar (exactly how a
 * thinly-traded equity's real 1-minute candle can legitimately have
 * `O=H=L=C` from a single trade — not fabricated, just genuinely quiet).
 * Only a bucket WIDER than the finest native cadence present (a real
 * aggregation of multiple native samples) still needs the ≥3 floor. A point
 * with no `captureIntervalSec` (an older client, or a hand-built session
 * tick that omits it) is treated as the conservative legacy default (300s)
 * so it can never inflate a bucket's confidence past what's actually known.
 *
 * Pure function, no I/O, no React — trivially unit-testable.
 */

/** Legacy/unknown-cadence fallback — matches the schema column's own default (see OptionPremiumSnapshot's captureIntervalSec doc). Conservative: never lets an unmarked point masquerade as native-granularity. */
const DEFAULT_CAPTURE_INTERVAL_SEC = 300;

export interface PremiumSnapshotPoint {
  capturedAt: string;
  lastPrice: number;
  /** Seconds between real captures for THIS point's source track — see module doc. Optional so client-generated session ticks (finer than any server cadence, see use-workbench-candles.ts) and any older payload shape still type-check; both are treated as native-granularity by session ticks explicitly setting a small value, never by omission. */
  captureIntervalSec?: number;
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
    if (!snapshots) continue;

    const finestIntervalMs = Math.min(...snapshots.map((s) => (s.captureIntervalSec ?? DEFAULT_CAPTURE_INTERVAL_SEC) * 1000));
    const isNativeGranularity = bucketMs <= finestIntervalMs;
    const minSamples = isNativeGranularity ? 1 : 3; // see module doc's honesty rule.
    if (snapshots.length < minSamples) continue;

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
