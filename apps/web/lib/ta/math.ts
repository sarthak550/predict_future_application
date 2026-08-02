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

// ─────────────────────────────────────────────────────────────────────────
// Founder-feedback pass (2026-08-03) — "indicators don't tell the signals"
// (TradingView-style per-indicator read + a Technicals Rating gauge).
// `lib/ta/indicator-signals.ts` (the active-strip signal chips) and
// `lib/ta/technicals.ts` (the rating gauge) BOTH need several oscillators
// this program never had a pure (non-klinecharts, non-registered-indicator)
// implementation of. Every function below is verified line-for-line against
// `node_modules/klinecharts/dist/index.esm.js`@10.0.1's own built-in
// extension (exact source lines cited per function) for the SAME reason
// every function above this point was: WYSIWYG between what a chart
// indicator plots and what a signal/rating computes over the identical
// candles. Three of these (`sessionVwap`, `ichimokuLines`, `aroon`,
// `moneyFlowIndex`, `stochRsi`) are PROMOTIONS of calculation bodies that
// used to live only inside `custom-indicators/{pack-a,pack-b}.ts` — those
// files are refactored in this same pass to call the promoted version
// (identical pattern to `supertrend()`'s S3 promotion above), so "what the
// chart draws" and "what the signal chip reads" are now provably the same
// function, not two independently-maintained copies.
// ─────────────────────────────────────────────────────────────────────────

/** Rolling window high over the trailing `period` bars (inclusive of the current bar) — `undefined` until the window fills. Shared by KDJ/WR/CCI/Stochastic's high-low range, ICHIMOKU's tenkan/kijun/senkou lines, and DONCHIAN's upper band. */
export function rollingHigh(candles: readonly Pick<OhlcvLike, "high">[], period: number): (number | undefined)[] {
  const out: (number | undefined)[] = new Array(candles.length);
  for (let i = 0; i < candles.length; i++) {
    if (i < period - 1) {
      out[i] = undefined;
      continue;
    }
    let hi = -Infinity;
    for (let k = i - period + 1; k <= i; k++) hi = Math.max(hi, candles[k].high);
    out[i] = hi;
  }
  return out;
}

/** Rolling window low, the `rollingHigh` mirror — see that function's own doc. */
export function rollingLow(candles: readonly Pick<OhlcvLike, "low">[], period: number): (number | undefined)[] {
  const out: (number | undefined)[] = new Array(candles.length);
  for (let i = 0; i < candles.length; i++) {
    if (i < period - 1) {
      out[i] = undefined;
      continue;
    }
    let lo = Infinity;
    for (let k = i - period + 1; k <= i; k++) lo = Math.min(lo, candles[k].low);
    out[i] = lo;
  }
  return out;
}

/**
 * Smooths a SPARSE series (one with a leading run of `undefined`s) over the
 * DEFINED-value run only, then maps the result back onto the original index
 * space. Promoted from `custom-indicators/pack-b.ts`'s originally-local
 * `compactSma` (S2) — feeding `sma()`'s rolling-sum window a raw `NaN`
 * placeholder for the undefined run would poison the running sum
 * PERMANENTLY (`NaN - x` is always `NaN`, it never "rolls out" of the
 * window the way a real numeric placeholder would); this avoids that by
 * construction. Used by `stochRsi` and `stochasticOscillator` below (both
 * smooth a series that only becomes defined partway through).
 */
export function compactSma(values: readonly (number | undefined)[], period: number, length: number): (number | undefined)[] {
  const compact: number[] = [];
  const compactIndexToOriginal: number[] = [];
  values.forEach((v, i) => {
    if (v !== undefined && Number.isFinite(v)) {
      compact.push(v);
      compactIndexToOriginal.push(i);
    }
  });
  const smoothed = sma(compact, period);
  const out: (number | undefined)[] = new Array(length).fill(undefined);
  smoothed.forEach((v, i) => {
    if (v !== undefined) out[compactIndexToOriginal[i]] = v;
  });
  return out;
}

/** IST calendar date key (`YYYY-MM-DD`) for session-boundary detection — same convention `custom-indicators/pack-a.ts` already used locally for VWAP/PIVOTS session grouping (`reference_nse_data_gotchas` memory's "IST-midnight session math"). */
function istDateKey(timestampMs: number): string {
  return new Date(timestampMs).toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
}

/**
 * Session-resetting Volume Weighted Average Price — cumulative
 * (typicalPrice × volume) ÷ cumulative volume since the start of the
 * CURRENT IST calendar day, resetting at every session boundary. Promoted
 * verbatim from `custom-indicators/pack-a.ts`'s originally-inlined
 * `vwap.calc` (that file's `VWAP` `IndicatorTemplate` now calls this
 * directly) so the `VWAP` signal chip's price-above/below read is
 * byte-identical to the line the chart actually draws.
 */
export function sessionVwap(candles: readonly (OhlcvLike & { timestamp: number })[]): (number | undefined)[] {
  const out: (number | undefined)[] = new Array(candles.length);
  let cumPv = 0;
  let cumVol = 0;
  let lastKey: string | null = null;
  for (let i = 0; i < candles.length; i++) {
    const c = candles[i];
    const key = istDateKey(c.timestamp);
    if (key !== lastKey) {
      cumPv = 0;
      cumVol = 0;
      lastKey = key;
    }
    const vol = c.volume ?? 0;
    const typicalPrice = (c.high + c.low + c.close) / 3;
    cumPv += typicalPrice * vol;
    cumVol += vol;
    out[i] = cumVol > 0 ? cumPv / cumVol : undefined;
  }
  return out;
}

/**
 * Parabolic SAR — trailing stop-and-reverse dots. Verified line-for-line
 * against `stopAndReverse.calc` (`dist/index.esm.js:4630-4685`), including
 * the exact (and slightly asymmetric — the uptrend-flip branch resets
 * `af` to `startAf`, the downtrend-flip branch resets it to `0`) reversal
 * behaviour of klinecharts' own built-in; kept byte-identical rather than
 * "fixed" so a chart's own `SAR` indicator and this signal read never
 * silently diverge. `startPct`/`stepPct`/`maxPct` are klinecharts'
 * `calcParams` convention (percent, e.g. `[2,2,20]`), divided by 100
 * internally exactly as the source does.
 */
export function parabolicSar(candles: readonly OhlcvLike[], startPct: number, stepPct: number, maxPct: number): number[] {
  const startAf = startPct / 100;
  const step = stepPct / 100;
  const maxAf = maxPct / 100;
  let af = startAf;
  let ep = -100;
  let isIncreasing = false;
  let sar = 0;
  const out: number[] = new Array(candles.length);
  for (let i = 0; i < candles.length; i++) {
    const preSar = sar;
    const high = candles[i].high;
    const low = candles[i].low;
    if (isIncreasing) {
      if (ep === -100 || ep < high) {
        ep = high;
        af = Math.min(af + step, maxAf);
      }
      sar = preSar + af * (ep - preSar);
      const lowMin = Math.min(candles[Math.max(1, i) - 1].low, low);
      if (sar > low) {
        sar = ep;
        af = startAf;
        ep = -100;
        isIncreasing = !isIncreasing;
      } else if (sar > lowMin) {
        sar = lowMin;
      }
    } else {
      if (ep === -100 || ep > low) {
        ep = low;
        af = Math.min(af + step, maxAf);
      }
      sar = preSar + af * (ep - preSar);
      const highMax = Math.max(candles[Math.max(1, i) - 1].high, high);
      if (sar < high) {
        sar = ep;
        af = 0;
        ep = -100;
        isIncreasing = !isIncreasing;
      } else if (sar < highMax) {
        sar = highMax;
      }
    }
    out[i] = sar;
  }
  return out;
}

export interface KdjPoint {
  k?: number;
  d?: number;
  j?: number;
}

/**
 * KDJ — klinecharts' own stochastic-family oscillator (`K`/`D` Wilder-style
 * RECURSIVE smoothing of RSV, seeded 50, plus a `J = 3K - 2D` leg).
 * Verified against `stoch.calc` (`dist/index.esm.js:4585-4623`). Distinct
 * from `stochasticOscillator` below (TradingView's own SMA-smoothed
 * Stochastic %K/%D) — the two are genuinely different smoothing
 * conventions under similar names; kept as two separate functions rather
 * than one "close enough" implementation, named to avoid the ambiguity.
 */
export function stochasticKdj(candles: readonly OhlcvLike[], period: number, kSmoothing: number, dSmoothing: number): KdjPoint[] {
  const highs = rollingHigh(candles, period);
  const lows = rollingLow(candles, period);
  const out: KdjPoint[] = new Array(candles.length);
  let prevK: number | undefined;
  let prevD: number | undefined;
  for (let i = 0; i < candles.length; i++) {
    const hn = highs[i];
    const ln = lows[i];
    if (hn === undefined || ln === undefined) {
      out[i] = {};
      continue;
    }
    const hnSubLn = hn - ln;
    const rsv = ((candles[i].close - ln) / (hnSubLn === 0 ? 1 : hnSubLn)) * 100;
    const k = ((kSmoothing - 1) * (prevK ?? 50) + rsv) / kSmoothing;
    const d = ((dSmoothing - 1) * (prevD ?? 50) + k) / dSmoothing;
    const j = 3 * k - 2 * d;
    out[i] = { k, d, j };
    prevK = k;
    prevD = d;
  }
  return out;
}

export interface StochPoint {
  k?: number;
  d?: number;
}

/**
 * Stochastic Oscillator — the TradingView/classic convention: raw
 * `%K = 100 × (close - lowN) / (highN - lowN)` over a rolling `period`,
 * then `%K` and `%D` are each a plain `period`-bar SIMPLE moving average
 * (NOT klinecharts' KDJ recursive-smoothing convention above — a
 * deliberately separate function, see `stochasticKdj`'s own doc). This is
 * the standard formula behind TradingView's "Technical Rating" widget's own
 * Stochastic %K row (not derived from any klinecharts source, since
 * klinecharts has no built-in matching this exact convention).
 */
export function stochasticOscillator(candles: readonly OhlcvLike[], period: number, kSmooth: number, dSmooth: number): StochPoint[] {
  const highs = rollingHigh(candles, period);
  const lows = rollingLow(candles, period);
  const rawK: (number | undefined)[] = candles.map((c, i) => {
    const hn = highs[i];
    const ln = lows[i];
    if (hn === undefined || ln === undefined) return undefined;
    const range = hn - ln;
    return range === 0 ? 0 : ((c.close - ln) / range) * 100;
  });
  const kValues = compactSma(rawK, kSmooth, candles.length);
  const dValues = compactSma(kValues, dSmooth, candles.length);
  return candles.map((_, i) => ({ k: kValues[i], d: dValues[i] }));
}

/**
 * Williams %R for a SINGLE period — `100 × (close - highN) / (highN - lowN)`,
 * a 0..-100 scale. Verified against `williamsR.calc`
 * (`dist/index.esm.js:4975-4995`); the built-in plots up to 3 periods at
 * once (`calcParams: [6,10,14]`), this pure function takes one period at a
 * time (a signal read uses the FIRST configured period's line, same
 * "multi-line indicator → first param's line" convention this program uses
 * for MA/EMA/RSI).
 */
export function williamsR(candles: readonly OhlcvLike[], period: number): (number | undefined)[] {
  const highs = rollingHigh(candles, period);
  const lows = rollingLow(candles, period);
  return candles.map((c, i) => {
    const hn = highs[i];
    const ln = lows[i];
    if (hn === undefined || ln === undefined) return undefined;
    const range = hn - ln;
    return range === 0 ? 0 : ((c.close - hn) / range) * 100;
  });
}

/**
 * Commodity Channel Index — `(typicalPrice - MA(typicalPrice,N)) / (meanAbsDeviation × 0.015)`.
 * Verified against `commodityChannelIndex.calc` (`dist/index.esm.js:3605-3630`).
 */
export function cci(candles: readonly OhlcvLike[], period: number): (number | undefined)[] {
  const tp = candles.map((c) => (c.high + c.low + c.close) / 3);
  const out: (number | undefined)[] = new Array(candles.length);
  let tpSum = 0;
  for (let i = 0; i < candles.length; i++) {
    tpSum += tp[i];
    if (i >= period - 1) {
      const maTp = tpSum / period;
      let sum = 0;
      for (let k = i - period + 1; k <= i; k++) sum += Math.abs(tp[k] - maTp);
      const md = sum / period;
      out[i] = md !== 0 ? (tp[i] - maTp) / md / 0.015 : 0;
      tpSum -= tp[i - period + 1];
    } else {
      out[i] = undefined;
    }
  }
  return out;
}

export interface DmiPoint {
  pdi?: number;
  mdi?: number;
  adx?: number;
  adxr?: number;
}

/**
 * Directional Movement Index — Wilder-recursive-smoothed `+DI`/`-DI`
 * (`pdi`/`mdi`), `ADX` (Wilder-recursive-smoothed `DX = |mdi-pdi|/(mdi+pdi)×100`),
 * and `ADXR` (the 2-bar-average smoothing of ADX). Verified against
 * `directionalMovementIndex.calc` (`dist/index.esm.js:3845-3924`) —
 * including its exact seed-then-recurse cadence (`mtr`/`dmp`/`dmm` seed as
 * a plain sum at `i === period-1`, Wilder-recurse thereafter; `adx` seeds
 * as `dxSum/period` at `i === period*2-2`, Wilder-recurses thereafter).
 */
export function dmi(candles: readonly OhlcvLike[], period: number, adxPeriod: number): DmiPoint[] {
  const result: DmiPoint[] = [];
  let trSum = 0;
  let hSum = 0;
  let lSum = 0;
  let mtr = 0;
  let dmp = 0;
  let dmm = 0;
  let dxSum = 0;
  let adx = 0;
  for (let i = 0; i < candles.length; i++) {
    const c = candles[i];
    const point: DmiPoint = {};
    const prev = candles[i - 1] ?? c;
    const preClose = prev.close;
    const hl = c.high - c.low;
    const hcy = Math.abs(c.high - preClose);
    const lcy = Math.abs(preClose - c.low);
    const hhy = c.high - prev.high;
    const lyl = prev.low - c.low;
    const tr = Math.max(hl, hcy, lcy);
    const h = hhy > 0 && hhy > lyl ? hhy : 0;
    const l = lyl > 0 && lyl > hhy ? lyl : 0;
    trSum += tr;
    hSum += h;
    lSum += l;
    if (i >= period - 1) {
      if (i > period - 1) {
        mtr = mtr - mtr / period + tr;
        dmp = dmp - dmp / period + h;
        dmm = dmm - dmm / period + l;
      } else {
        mtr = trSum;
        dmp = hSum;
        dmm = lSum;
      }
      const pdi = mtr !== 0 ? (dmp * 100) / mtr : 0;
      const mdi = mtr !== 0 ? (dmm * 100) / mtr : 0;
      point.pdi = pdi;
      point.mdi = mdi;
      const dx = mdi + pdi !== 0 ? (Math.abs(mdi - pdi) / (mdi + pdi)) * 100 : 0;
      dxSum += dx;
      if (i >= period * 2 - 2) {
        adx = i > period * 2 - 2 ? (adx * (period - 1) + dx) / period : dxSum / period;
        point.adx = adx;
        if (i >= period * 2 + adxPeriod - 3) {
          point.adxr = ((result[i - (adxPeriod - 1)]?.adx ?? 0) + adx) / 2;
        }
      }
    }
    result.push(point);
  }
  return result;
}

/**
 * Awesome Oscillator — `SMA((high+low)/2, fastPeriod) - SMA((high+low)/2, slowPeriod)`,
 * a zero-line momentum histogram. Verified against `awesomeOscillator.calc`
 * (`dist/index.esm.js:3299-3352`).
 */
export function awesomeOscillator(candles: readonly OhlcvLike[], fastPeriod: number, slowPeriod: number): (number | undefined)[] {
  const maxPeriod = Math.max(fastPeriod, slowPeriod);
  const mids = candles.map((c) => (c.high + c.low) / 2);
  const shortMa = sma(mids, fastPeriod);
  const longMa = sma(mids, slowPeriod);
  return candles.map((_, i) => {
    if (i < maxPeriod - 1) return undefined;
    const short = shortMa[i];
    const long = longMa[i];
    return short !== undefined && long !== undefined ? short - long : undefined;
  });
}

export interface MtmPoint {
  mtm?: number;
  maMtm?: number;
}

/**
 * Momentum — `MTM = close[i] - close[i - period]`, with a `signalPeriod`
 * simple moving average of `MTM` itself. Verified against `momentum.calc`
 * (`dist/index.esm.js:4062-4082`).
 */
export function momentum(closes: readonly number[], period: number, signalPeriod: number): MtmPoint[] {
  const result: MtmPoint[] = [];
  let mtmSum = 0;
  for (let i = 0; i < closes.length; i++) {
    const point: MtmPoint = {};
    if (i >= period) {
      point.mtm = closes[i] - closes[i - period];
      mtmSum += point.mtm;
      if (i >= period + signalPeriod - 1) {
        point.maMtm = mtmSum / signalPeriod;
        mtmSum -= result[i - (signalPeriod - 1)]?.mtm ?? 0;
      }
    }
    result.push(point);
  }
  return result;
}

/**
 * Money Flow Index — volume-weighted RSI (raw money flow = typical price ×
 * volume, split into positive/negative flow by typical-price direction).
 * Promoted verbatim from `custom-indicators/pack-b.ts`'s originally-inlined
 * `mfi.calc` (S2) — that file's `MFI` `IndicatorTemplate` now calls this
 * directly.
 */
export function moneyFlowIndex(candles: readonly OhlcvLike[], period: number): (number | undefined)[] {
  const typicalPrices = candles.map((c) => (c.high + c.low + c.close) / 3);
  const rawFlow = candles.map((c, i) => typicalPrices[i] * (c.volume ?? 0));
  return candles.map((_, i) => {
    if (i < period) return undefined;
    let posSum = 0;
    let negSum = 0;
    for (let k = i - period + 1; k <= i; k++) {
      if (k === 0) continue;
      if (typicalPrices[k] > typicalPrices[k - 1]) posSum += rawFlow[k];
      else if (typicalPrices[k] < typicalPrices[k - 1]) negSum += rawFlow[k];
    }
    if (negSum === 0) return 100;
    const moneyRatio = posSum / negSum;
    return 100 - 100 / (1 + moneyRatio);
  });
}

export interface StochRsiPoint {
  k?: number;
  d?: number;
}

/**
 * Stochastic RSI — the stochastic formula applied to `rsi()` instead of
 * price. Promoted from `custom-indicators/pack-b.ts`'s originally-inlined
 * `stochrsi.calc` (S2, including that file's own `compactSma`-poisoning
 * fix, now generalized as this module's own exported `compactSma`) — that
 * file's `STOCHRSI` `IndicatorTemplate` now calls this directly.
 */
export function stochRsi(closes: readonly number[], rsiPeriod: number, stochPeriod: number, kSmooth: number, dSmooth: number): StochRsiPoint[] {
  const rsiValues = rsi(closes, rsiPeriod);
  const stochRsiRaw: (number | undefined)[] = new Array(closes.length);
  for (let i = 0; i < closes.length; i++) {
    if (i < rsiPeriod + stochPeriod - 1) {
      stochRsiRaw[i] = undefined;
      continue;
    }
    const window = rsiValues.slice(i - stochPeriod + 1, i + 1) as number[];
    if (window.some((v) => v === undefined)) {
      stochRsiRaw[i] = undefined;
      continue;
    }
    const hi = Math.max(...window);
    const lo = Math.min(...window);
    const current = rsiValues[i]!;
    stochRsiRaw[i] = hi === lo ? 0 : ((current - lo) / (hi - lo)) * 100;
  }
  const kValues = compactSma(stochRsiRaw, kSmooth, closes.length);
  const dValues = compactSma(kValues, dSmooth, closes.length);
  return closes.map((_, i) => ({ k: kValues[i], d: dValues[i] }));
}

export interface IchimokuLinesPoint {
  tenkan?: number;
  kijun?: number;
  senkouA?: number;
  senkouB?: number;
}

/**
 * Ichimoku's four non-displaced lines (conversion/base/leading span A/B —
 * the raw values BEFORE the chart's own forward `kijunPeriod`-bar
 * displacement of the cloud). Promoted from `custom-indicators/pack-a.ts`'s
 * originally-inlined `ichimoku.calc` (S2) — that file's `ICHIMOKU`
 * `IndicatorTemplate` now calls this directly; its own `draw()` (the
 * forward-shifted cloud rendering) is unchanged, only the line values moved
 * here. A signal read comparing price to "the cloud" must look up
 * `senkouA`/`senkouB` at `lastIndex - kijunPeriod` (the pair that the chart
 * currently displaces FORWARD to sit at `lastIndex`) — see
 * `indicator-signals.ts`'s own ICHIMOKU case for that lookup.
 */
export function ichimokuLines(candles: readonly OhlcvLike[], tenkanPeriod: number, kijunPeriod: number, senkouBPeriod: number): IchimokuLinesPoint[] {
  const tenkanHigh = rollingHigh(candles, tenkanPeriod);
  const tenkanLow = rollingLow(candles, tenkanPeriod);
  const kijunHigh = rollingHigh(candles, kijunPeriod);
  const kijunLow = rollingLow(candles, kijunPeriod);
  const senkouBHigh = rollingHigh(candles, senkouBPeriod);
  const senkouBLow = rollingLow(candles, senkouBPeriod);
  return candles.map((_, i) => {
    const point: IchimokuLinesPoint = {};
    if (tenkanHigh[i] !== undefined) point.tenkan = (tenkanHigh[i]! + tenkanLow[i]!) / 2;
    if (kijunHigh[i] !== undefined) point.kijun = (kijunHigh[i]! + kijunLow[i]!) / 2;
    if (point.tenkan !== undefined && point.kijun !== undefined) point.senkouA = (point.tenkan + point.kijun) / 2;
    if (senkouBHigh[i] !== undefined) point.senkouB = (senkouBHigh[i]! + senkouBLow[i]!) / 2;
    return point;
  });
}

export interface AroonPoint {
  up?: number;
  down?: number;
}

/**
 * Aroon — how many bars (as a percentage of `period`) since the most
 * recent high/low. Promoted from `custom-indicators/pack-b.ts`'s
 * originally-inlined `aroon.calc` (S2) — that file's `AROON`
 * `IndicatorTemplate` now calls this directly.
 */
export function aroon(candles: readonly OhlcvLike[], period: number): AroonPoint[] {
  return candles.map((_, i) => {
    if (i < period) return {};
    let highIdx = i - period;
    let lowIdx = i - period;
    for (let k = i - period; k <= i; k++) {
      if (candles[k].high >= candles[highIdx].high) highIdx = k;
      if (candles[k].low <= candles[lowIdx].low) lowIdx = k;
    }
    const barsSinceHigh = i - highIdx;
    const barsSinceLow = i - lowIdx;
    return {
      up: ((period - barsSinceHigh) / period) * 100,
      down: ((period - barsSinceLow) / period) * 100
    };
  });
}
