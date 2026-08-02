/**
 * TA Suite Sprint S2, T2 — shared pure technical-analysis math. Consumed by
 * `workbench/custom-indicators/{pack-a,pack-b}.ts` (S2) AND, per the S1/S2
 * plan's own hand-off note, by S3's `lib/ta/strategies.ts` — build it
 * correct and hand-verified HERE, don't let S3 discover a bug in shared
 * math after strategies already depend on it.
 *
 * Every function here deliberately mirrors klinecharts' OWN built-in
 * indicator algorithms byte-for-byte (verified by reading
 * `node_modules/klinecharts/dist/index.esm.js`'s `exponentialMovingAverage`/
 * `relativeStrengthIndex`/`movingAverageConvergenceDivergence` source
 * directly, not assumed from a textbook formula) for two reasons: (1) a
 * custom indicator that consumes `ema()`/`rsi()` internally (STOCHRSI's RSI
 * leg, KELTNER's EMA basis) should numerically agree with what a user would
 * see if they ALSO added the built-in EMA/RSI on the same chart for
 * comparison — divergent conventions (e.g. Wilder-vs-simple RSI seeding)
 * would look like a bug even though both are "valid" RSI definitions; (2)
 * S3's strategies compute signals from these same functions and must match
 * what S2's indicators already plot on the chart (plan's D8, "what you see
 * is what was tested").
 *
 * No klinecharts import here — this module is plain, standalone-testable
 * arithmetic over `number[]`/candle arrays, same posture as
 * `packages/business-rules`'s pure cost-engine functions.
 */

export interface OhlcvLike {
  high: number;
  low: number;
  close: number;
  open?: number;
  volume?: number;
}

/**
 * Simple moving average, trailing window of `period`. `undefined` for every
 * index before the window fills (index < period - 1) — the same
 * "no value yet" convention klinecharts' own built-ins use (a sparse array
 * a chart figure naturally skips over via its own `isNumber(value)` gate).
 */
export function sma(values: readonly number[], period: number): (number | undefined)[] {
  const out: (number | undefined)[] = new Array(values.length);
  let sum = 0;
  for (let i = 0; i < values.length; i++) {
    sum += values[i];
    if (i >= period) sum -= values[i - period];
    out[i] = i >= period - 1 ? sum / period : undefined;
  }
  return out;
}

/**
 * Exponential moving average — SMA-seeded (`EMA[period-1] = SMA(values[0..period-1])`),
 * then the standard recursion `EMA[i] = (2*value[i] + (period-1)*EMA[i-1]) / (period+1)`
 * for i > period-1. Verified identical to klinecharts' `exponentialMovingAverage.calc`
 * (`dist/index.esm.js:4021-4042`).
 */
export function ema(values: readonly number[], period: number): (number | undefined)[] {
  const out: (number | undefined)[] = new Array(values.length);
  let seedSum = 0;
  let prev: number | undefined;
  for (let i = 0; i < values.length; i++) {
    const v = values[i];
    seedSum += v;
    if (i >= period - 1) {
      const current = i > period - 1 && prev !== undefined ? (2 * v + (period - 1) * prev) / (period + 1) : seedSum / period;
      out[i] = current;
      prev = current;
    } else {
      out[i] = undefined;
    }
  }
  return out;
}

/**
 * Wilder's smoothed moving average — the RMA/"running moving average"
 * convention used by Wilder's own RSI/ATR/ADX family. Seed = simple average
 * of the first `period` values (index `period - 1`); thereafter
 * `RMA[i] = (RMA[i-1] * (period - 1) + value[i]) / period`. Distinct from
 * `ema()` above (different smoothing constant: alpha = 1/period, not
 * 2/(period+1)) — used by `wilderAtr()` and `rsi()` below, matching
 * klinecharts' own `relativeStrengthIndex.calc`'s gain/loss smoothing
 * exactly (`dist/index.esm.js:4483-4512`).
 */
function wilderSmooth(values: readonly number[], period: number): (number | undefined)[] {
  const out: (number | undefined)[] = new Array(values.length);
  let seedSum = 0;
  let prev: number | undefined;
  for (let i = 0; i < values.length; i++) {
    seedSum += values[i];
    if (i < period - 1) {
      out[i] = undefined;
      continue;
    }
    const current = prev === undefined ? seedSum / period : (prev * (period - 1) + values[i]) / period;
    out[i] = current;
    prev = current;
  }
  return out;
}

/**
 * Wilder's Average True Range. True Range at i=0 is `high[0] - low[0]`
 * (no prior close to compare against); thereafter the standard
 * `max(high-low, |high-prevClose|, |prevClose-low|)`. Smoothed via
 * `wilderSmooth` (seed = simple average of the first `period` TRs, then
 * Wilder recursion) — the textbook ATR definition, and the convention every
 * other Wilder-family built-in (klinecharts' own DMI) uses for its own
 * internal `MTR` smoothing (`dist/index.esm.js:3884-3894`, same
 * seed-then-recurse shape confirmed by reading that indicator's source).
 */
export function wilderAtr(candles: readonly OhlcvLike[], period: number): (number | undefined)[] {
  const tr: number[] = new Array(candles.length);
  for (let i = 0; i < candles.length; i++) {
    const c = candles[i];
    if (i === 0) {
      tr[i] = c.high - c.low;
    } else {
      const prevClose = candles[i - 1].close;
      tr[i] = Math.max(c.high - c.low, Math.abs(c.high - prevClose), Math.abs(prevClose - c.low));
    }
  }
  return wilderSmooth(tr, period);
}

/**
 * Rolling population standard deviation over a trailing window of `period`
 * (divisor = `period`, NOT `period - 1`) — matches klinecharts' own BOLL
 * standard-deviation helper `getBollMd` (`dist/index.esm.js:3423-3432`,
 * `Math.sqrt(sum / dataSize)` with `dataSize` = the window length), so a
 * custom indicator built on `stdev()` agrees with the built-in BOLL's own
 * band width for the same window.
 */
export function stdev(values: readonly number[], period: number): (number | undefined)[] {
  const out: (number | undefined)[] = new Array(values.length);
  for (let i = 0; i < values.length; i++) {
    if (i < period - 1) {
      out[i] = undefined;
      continue;
    }
    const window = values.slice(i - period + 1, i + 1);
    const mean = window.reduce((s, v) => s + v, 0) / period;
    const variance = window.reduce((s, v) => s + (v - mean) * (v - mean), 0) / period;
    out[i] = Math.sqrt(Math.abs(variance));
  }
  return out;
}

/**
 * Wilder RSI — gain/loss Wilder-smoothed averages, seeded on the first
 * `period` price changes. Verified identical to klinecharts' own
 * `relativeStrengthIndex.calc` (`dist/index.esm.js:4477-4515`):
 * `change[0]` is defined as 0 (no prior close), so seeding on
 * `sum(gain[0..period]) / period` (klinecharts skips while `i < period`,
 * seeds when `i === period`) is equivalent to averaging the `period` REAL
 * changes at indices `1..period` — deliberately NOT built on the generic
 * `wilderSmooth()` helper above, which seeds one index earlier at
 * `period - 1` using `period` raw array slots; that's correct for
 * `wilderAtr()` (every TR value, including index 0, is real data) but would
 * silently absorb RSI's fake `change[0] = 0` into the seed average as if it
 * were a real change, seeding one bar too early on `period - 1` real
 * changes instead of `period` — caught by this module's own hand-computed
 * fixture (`/tmp/verify-math.ts` during S2 development: expected RSI(4) on
 * closes `[10,11,12,13,14,12,10]` to seed at index 4 = 100, then 60, then
 * 39.130435 at indices 5/6 — the generic-helper version produced 100,
 * 54.93, 34.31 instead, off by one bar of smoothing).
 * `rsi = avgLoss === 0 ? 100 : avgGain === 0 ? 0 : 100 - 100/(1 + avgGain/avgLoss)`.
 */
export function rsi(closes: readonly number[], period: number): (number | undefined)[] {
  const gains: number[] = new Array(closes.length);
  const losses: number[] = new Array(closes.length);
  for (let i = 0; i < closes.length; i++) {
    const change = i === 0 ? 0 : closes[i] - closes[i - 1];
    gains[i] = Math.max(change, 0);
    losses[i] = Math.max(-change, 0);
  }
  const out: (number | undefined)[] = new Array(closes.length);
  let gainSeedSum = 0;
  let lossSeedSum = 0;
  let avgGain: number | undefined;
  let avgLoss: number | undefined;
  for (let i = 0; i < closes.length; i++) {
    gainSeedSum += gains[i];
    lossSeedSum += losses[i];
    if (i < period) {
      out[i] = undefined;
      continue;
    }
    if (avgGain === undefined || avgLoss === undefined) {
      avgGain = gainSeedSum / period;
      avgLoss = lossSeedSum / period;
    } else {
      avgGain = (avgGain * (period - 1) + gains[i]) / period;
      avgLoss = (avgLoss * (period - 1) + losses[i]) / period;
    }
    out[i] = avgLoss === 0 ? 100 : avgGain === 0 ? 0 : 100 - 100 / (1 + avgGain / avgLoss);
  }
  return out;
}

export interface MacdPoint {
  dif: number | undefined;
  dea: number | undefined;
  macd: number | undefined;
}

/**
 * MACD — `dif = EMA(fast) - EMA(slow)`, `dea = EMA(dif, signal)`,
 * `macd = (dif - dea) * 2` (the `*2` convention klinecharts' own MACD uses
 * for its histogram, `dist/index.esm.js:4236` — kept here for the same
 * WYSIWYG reason as the rest of this module).
 */
export function macd(closes: readonly number[], fastPeriod = 12, slowPeriod = 26, signalPeriod = 9): MacdPoint[] {
  const emaFast = ema(closes, fastPeriod);
  const emaSlow = ema(closes, slowPeriod);
  const dif: (number | undefined)[] = closes.map((_, i) => {
    const f = emaFast[i];
    const s = emaSlow[i];
    return f !== undefined && s !== undefined ? f - s : undefined;
  });

  // EMA of `dif`, but `dif` itself has a leading run of `undefined`s (until
  // both legs are seeded) — seed the signal EMA on the first `signalPeriod`
  // DEFINED dif values, not on array position, mirroring klinecharts' own
  // `maxPeriod`-offset seeding (`dist/index.esm.js:4204-4238`).
  const out: MacdPoint[] = closes.map(() => ({ dif: undefined, dea: undefined, macd: undefined }));
  let seedSum = 0;
  let seedCount = 0;
  let prevDea: number | undefined;
  for (let i = 0; i < closes.length; i++) {
    const d = dif[i];
    out[i].dif = d;
    if (d === undefined) continue;
    if (prevDea === undefined) {
      seedSum += d;
      seedCount += 1;
      if (seedCount === signalPeriod) {
        prevDea = seedSum / signalPeriod;
        out[i].dea = prevDea;
        out[i].macd = (d - prevDea) * 2;
      }
    } else {
      prevDea = (d * 2 + prevDea * (signalPeriod - 1)) / (signalPeriod + 1);
      out[i].dea = prevDea;
      out[i].macd = (d - prevDea) * 2;
    }
  }
  return out;
}

/** Weighted moving average — linearly weighted trailing window (weight `period` on the most recent value down to weight 1 on the oldest), used by `WMA`/`HMA`. */
export function wma(values: readonly number[], period: number): (number | undefined)[] {
  const denom = (period * (period + 1)) / 2;
  const out: (number | undefined)[] = new Array(values.length);
  for (let i = 0; i < values.length; i++) {
    if (i < period - 1) {
      out[i] = undefined;
      continue;
    }
    let sum = 0;
    for (let w = 0; w < period; w++) {
      // most recent value (offset 0) gets weight `period`, oldest gets weight 1.
      sum += values[i - w] * (period - w);
    }
    out[i] = sum / denom;
  }
  return out;
}

/** Hull moving average — `WMA(2*WMA(n/2) - WMA(n), round(sqrt(n)))`, the standard HMA formula (reduces lag vs a plain WMA/EMA). */
export function hma(values: readonly number[], period: number): (number | undefined)[] {
  const halfPeriod = Math.max(1, Math.round(period / 2));
  const sqrtPeriod = Math.max(1, Math.round(Math.sqrt(period)));
  const wmaHalf = wma(values, halfPeriod);
  const wmaFull = wma(values, period);
  const diff: number[] = values.map((_, i) => {
    const h = wmaHalf[i];
    const f = wmaFull[i];
    return h !== undefined && f !== undefined ? 2 * h - f : NaN;
  });
  const hullRaw = wma(diff, sqrtPeriod);
  return hullRaw.map((v) => (v !== undefined && Number.isFinite(v) ? v : undefined));
}

/** Volume-weighted moving average — trailing window of `sum(close*volume)/sum(volume)`. */
export function vwma(closes: readonly number[], volumes: readonly number[], period: number): (number | undefined)[] {
  const out: (number | undefined)[] = new Array(closes.length);
  let pvSum = 0;
  let vSum = 0;
  for (let i = 0; i < closes.length; i++) {
    pvSum += closes[i] * volumes[i];
    vSum += volumes[i];
    if (i >= period) {
      pvSum -= closes[i - period] * volumes[i - period];
      vSum -= volumes[i - period];
    }
    out[i] = i >= period - 1 && vSum !== 0 ? pvSum / vSum : undefined;
  }
  return out;
}

export interface SupertrendPoint {
  value?: number;
  trend?: 1 | -1;
  /** Defined (equal to `value`) only on the bar where `trend` just flipped — the sparse-key convention `custom-indicators/pack-a.ts`'s own `flip` figure relies on (a `circle` figure whose `key` is only defined on flip bars renders nothing on every other bar, per klinecharts' default figure-render `isValid` gate — see `project_ta_suite_s2` memory's verified internal #7). */
  flip?: number;
}

/**
 * SuperTrend — an ATR-band trailing stop-and-reverse line. Promoted here
 * (S3, T1) from `custom-indicators/pack-a.ts`'s originally-inlined `calc`
 * body so BOTH the `SUPERTREND` chart indicator (S2) and the
 * `supertrendFlip` strategy (S3's `lib/ta/strategies.ts`) call this ONE
 * function — the plan's D8 "what you see is what was tested" guarantee
 * would be unverifiable if the strategy re-derived the same algorithm from
 * a textbook formula independently instead of sharing the exact
 * implementation. `pack-a.ts`'s `SUPERTREND` `IndicatorTemplate.calc` now
 * calls this directly; its own `figures[]` styling (flip-colored line +
 * flip-circle markers) is unchanged, only the calculation body moved.
 *
 * Algorithm: basic bands = `midpoint ± multiplier * ATR(period)`; final
 * bands only ever tighten toward price (never widen back out) via the
 * standard SuperTrend carry-forward rule; `trend` flips to +1 (uptrend)
 * once close crosses above the final upper band, to -1 (downtrend) once
 * close crosses below the final lower band. `value` is the final lower
 * band while uptrend, the final upper band while downtrend (the line a
 * chart actually plots).
 */
export function supertrend(candles: readonly OhlcvLike[], period: number, multiplier: number): SupertrendPoint[] {
  const atr = wilderAtr(candles, period);
  let finalUpper: number | undefined;
  let finalLower: number | undefined;
  let trend: 1 | -1 | undefined;

  return candles.map((c, i) => {
    const a = atr[i];
    if (a === undefined) return {};
    const mid = (c.high + c.low) / 2;
    const basicUpper = mid + multiplier * a;
    const basicLower = mid - multiplier * a;

    if (finalUpper === undefined || finalLower === undefined) {
      finalUpper = basicUpper;
      finalLower = basicLower;
    } else {
      const prevClose = candles[i - 1]?.close ?? c.close;
      finalUpper = basicUpper < finalUpper || prevClose > finalUpper ? basicUpper : finalUpper;
      finalLower = basicLower > finalLower || prevClose < finalLower ? basicLower : finalLower;
    }

    let flipped = false;
    if (trend === undefined) {
      trend = c.close <= finalUpper ? -1 : 1;
    } else if (trend === -1 && c.close > finalUpper) {
      trend = 1;
      flipped = true;
    } else if (trend === 1 && c.close < finalLower) {
      trend = -1;
      flipped = true;
    }
    const value = trend === 1 ? finalLower : finalUpper;
    return { value, trend, flip: flipped ? value : undefined };
  });
}
