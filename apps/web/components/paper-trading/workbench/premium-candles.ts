/**
 * Charting Workbench (W3, T5) — pure client-side aggregation of
 * `OptionPremiumSnapshot` 5-minute points into 15/30-minute honest
 * pseudo-candles. No schema change, no new endpoint — this is the SAME
 * `premium-history` points array `terminal/premium-chart.tsx` already
 * fetches, bucketed differently for the workbench's candlestick view.
 *
 * Honesty rule (founder plan §2, non-negotiable): a bucket needs AT LEAST 3
 * snapshots to render at all. Fewer than 3 points in a 15/30-minute window
 * is too sparse to represent a real O/H/L/C range — rendering it anyway
 * would fabricate a flat `O=H=L=C` bar from what might be a single stale
 * tick. Such buckets are silently omitted, not rendered.
 *
 * Pure function, no I/O, no React — trivially unit-testable and exactly
 * mirrors `aggregatePremiumCandles(points, bucketMs)`'s signature from the
 * founder plan.
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
 * @param points Chronologically-ascending snapshot points (the
 *   `premium-history` endpoint's own contract — never re-sorted here, an
 *   out-of-order input would silently misplace O/C within a bucket).
 * @param bucketMs Bucket width in milliseconds — 15 or 30 minutes this
 *   sprint (`15 * 60_000` / `30 * 60_000`), enforced by the caller via
 *   `PREMIUM_INTERVALS`, not by this function.
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
    if (!snapshots || snapshots.length < 3) continue; // honesty rule — see module doc.
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
