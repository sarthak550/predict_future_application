/**
 * TA Suite Sprint S3, T1 — the seven strategy definitions (plan §4.1,
 * founder-locked, exact param defaults): `maCross[10,30]`, `emaCross[9,21]`,
 * `supertrendFlip[10,3]`, `rsiReversal[14,70,30]`, `macdCross[12,26,9]`,
 * `bollBreakout[20,2]`, `donchianBreakout[20]`. Every `compute()` below
 * consumes the SAME `lib/ta/math.ts` used by S2's chart indicators (see
 * that module's own doc comment on why — WYSIWYG between the chart's own
 * indicator lines and what a strategy signals against) and returns through
 * the ONE shared `finalizeSignals()` post-processor, so alternating-side
 * dedup and leading-SELL-drop are enforced identically for all seven, not
 * per-strategy.
 *
 * **The "per-bar side state, then collapse" pattern**: every `compute()`
 * below produces one RAW signal per bar where a simple binary condition
 * holds (`fast MA above slow MA` ⇒ `"BUY"` state, `close above the upper
 * Bollinger band` ⇒ `"BUY"` state, etc.) — NOT edge-triggered "did it just
 * cross" detection. `finalizeSignals()` then collapses each maximal run of
 * same-side raw signals down to its FIRST bar, which is exactly equivalent
 * to classic crossover/breakout edge-detection but expressed as one shared,
 * independently-verifiable post-processing step instead of seven separate
 * hand-rolled "was it different last bar" trackers that could each drift
 * from the alternating-dedup contract in a slightly different way.
 * `rsiReversal` is the one exception — a true threshold-CROSS (not a
 * persistent two-state machine, since RSI spends most of its time in the
 * 30-70 neutral zone where neither "reversal" state should hold) — it emits
 * edge-triggered signals directly, then still routes through
 * `finalizeSignals()` defensively (two oversold dips without an
 * intervening overbought cross would otherwise emit two consecutive BUYs).
 *
 * `supertrendFlip` calls `lib/ta/math.ts`'s `supertrend()` — the SAME
 * function `custom-indicators/pack-a.ts`'s `SUPERTREND` chart indicator was
 * refactored (S3) to call, so "what the SUPERTREND indicator plots" and
 * "what supertrendFlip signals on" are provably one algorithm, not two.
 */
import { ema, macd, rsi, sma, stdev, supertrend, type OhlcvLike } from "./math";

/** The minimal OHLCV+timestamp shape every strategy needs — structurally compatible with BOTH `use-workbench-candles.ts`'s `Candle` (the live chart feed) and klinecharts' own `KLineData` (so `PF_SIGNALS`'s `calc(dataList, ...)` can pass `dataList` straight through with no cast — see `custom-indicators/pf-signals.ts`). Deliberately NOT imported from either of those — `lib/ta/` stays free of any klinecharts/workbench import per the program's own "lib/ta modules imported only from workbench components" direction rule (this file only ever gets imported, never imports a UI/chart module itself). */
export interface StrategyCandle extends OhlcvLike {
  timestamp: number;
  open: number;
}

export type StrategySide = "BUY" | "SELL";

export interface StrategySignal {
  index: number;
  timestamp: number;
  side: StrategySide;
  /** The bar's close — every strategy enters/exits at the signal-bar close per the plan's backtest spec, so this IS the fill price `backtest.ts` uses. */
  price: number;
}

export interface StrategyParamSpec {
  key: string;
  label: string;
  default: number;
  min: number;
  max: number;
  step?: number;
}

export interface StrategyDef {
  id: string;
  label: string;
  params: StrategyParamSpec[];
  /** Pure — no I/O, no klinecharts import. `params` is keyed by each spec's `key` (see `resolveStrategyParams`), already clamped to `[min,max]`. */
  compute(candles: readonly StrategyCandle[], params: Record<string, number>): StrategySignal[];
}

// ── Shared post-processor ────────────────────────────────────────────────

/**
 * Enforces "alternating-side deduped" (plan §4.1's exact phrase) over a raw
 * signal list: sorts by bar index, drops any leading SELL(s) before the
 * first BUY (long-only — a leading SELL would otherwise read as a naked
 * short, which these strategies never take), then collapses each maximal
 * run of same-side signals to its first occurrence. The ONE function every
 * strategy's `compute()` routes its raw output through — see module doc.
 */
export function finalizeSignals(raw: readonly StrategySignal[]): StrategySignal[] {
  const sorted = [...raw].sort((a, b) => a.index - b.index);
  const out: StrategySignal[] = [];
  let lastSide: StrategySide | null = null;
  for (const s of sorted) {
    if (lastSide === null) {
      if (s.side === "SELL") continue; // leading SELL, before any BUY — dropped, not a naked short.
      out.push(s);
      lastSide = s.side;
    } else if (s.side !== lastSide) {
      out.push(s);
      lastSide = s.side;
    }
    // else: same side as the last KEPT signal — part of the same run, skipped.
  }
  return out;
}

/** Per-bar binary state (`"BUY"` while `a > b`, `"SELL"` while `a < b`, `undefined` on a tie or before both are defined) — the shared building block for every "cross" strategy (maCross, emaCross, macdCross use two lines; bollBreakout/donchianBreakout use one line vs a threshold, see their own callers below). */
function stateFromComparison(a: number | undefined, b: number | undefined): StrategySide | undefined {
  if (a === undefined || b === undefined) return undefined;
  if (a > b) return "BUY";
  if (a < b) return "SELL";
  return undefined;
}

function rawFromState(candles: readonly StrategyCandle[], stateAt: (i: number) => StrategySide | undefined): StrategySignal[] {
  const out: StrategySignal[] = [];
  for (let i = 0; i < candles.length; i++) {
    const side = stateAt(i);
    if (side) out.push({ index: i, timestamp: candles[i].timestamp, side, price: candles[i].close });
  }
  return out;
}

// ── 1. maCross[10,30] ────────────────────────────────────────────────────

export const maCross: StrategyDef = {
  id: "maCross",
  label: "MA Cross",
  params: [
    { key: "fast", label: "Fast period", default: 10, min: 2, max: 200 },
    { key: "slow", label: "Slow period", default: 30, min: 3, max: 400 }
  ],
  compute(candles, params) {
    const closes = candles.map((c) => c.close);
    const fastMa = sma(closes, params.fast);
    const slowMa = sma(closes, params.slow);
    const raw = rawFromState(candles, (i) => stateFromComparison(fastMa[i], slowMa[i]));
    return finalizeSignals(raw);
  }
};

// ── 2. emaCross[9,21] ────────────────────────────────────────────────────

export const emaCross: StrategyDef = {
  id: "emaCross",
  label: "EMA Cross",
  params: [
    { key: "fast", label: "Fast period", default: 9, min: 2, max: 200 },
    { key: "slow", label: "Slow period", default: 21, min: 3, max: 400 }
  ],
  compute(candles, params) {
    const closes = candles.map((c) => c.close);
    const fastEma = ema(closes, params.fast);
    const slowEma = ema(closes, params.slow);
    const raw = rawFromState(candles, (i) => stateFromComparison(fastEma[i], slowEma[i]));
    return finalizeSignals(raw);
  }
};

// ── 3. supertrendFlip[10,3] ──────────────────────────────────────────────

export const supertrendFlip: StrategyDef = {
  id: "supertrendFlip",
  label: "SuperTrend Flip",
  params: [
    { key: "period", label: "ATR period", default: 10, min: 2, max: 100 },
    { key: "multiplier", label: "ATR multiplier", default: 3, min: 0.5, max: 10, step: 0.1 }
  ],
  compute(candles, params) {
    const points = supertrend(candles, params.period, params.multiplier);
    const raw = rawFromState(candles, (i) => (points[i]?.trend === 1 ? "BUY" : points[i]?.trend === -1 ? "SELL" : undefined));
    return finalizeSignals(raw);
  }
};

// ── 4. rsiReversal[14,70,30] ─────────────────────────────────────────────

export const rsiReversal: StrategyDef = {
  id: "rsiReversal",
  label: "RSI Reversal",
  params: [
    { key: "period", label: "RSI period", default: 14, min: 2, max: 100 },
    { key: "overbought", label: "Overbought", default: 70, min: 50, max: 95 },
    { key: "oversold", label: "Oversold", default: 30, min: 5, max: 50 }
  ],
  compute(candles, params) {
    const closes = candles.map((c) => c.close);
    const rsiValues = rsi(closes, params.period);
    const raw: StrategySignal[] = [];
    let prev: number | undefined;
    for (let i = 0; i < candles.length; i++) {
      const r = rsiValues[i];
      if (r === undefined) {
        prev = undefined;
        continue;
      }
      if (prev !== undefined) {
        // Reversal UP: RSI was AT or BELOW oversold, just rose above it.
        if (prev <= params.oversold && r > params.oversold) {
          raw.push({ index: i, timestamp: candles[i].timestamp, side: "BUY", price: candles[i].close });
        }
        // Reversal DOWN: RSI was AT or ABOVE overbought, just fell below it.
        else if (prev >= params.overbought && r < params.overbought) {
          raw.push({ index: i, timestamp: candles[i].timestamp, side: "SELL", price: candles[i].close });
        }
      }
      prev = r;
    }
    return finalizeSignals(raw);
  }
};

// ── 5. macdCross[12,26,9] ────────────────────────────────────────────────

export const macdCross: StrategyDef = {
  id: "macdCross",
  label: "MACD Cross",
  params: [
    { key: "fast", label: "Fast EMA", default: 12, min: 2, max: 100 },
    { key: "slow", label: "Slow EMA", default: 26, min: 3, max: 200 },
    { key: "signal", label: "Signal EMA", default: 9, min: 2, max: 100 }
  ],
  compute(candles, params) {
    const closes = candles.map((c) => c.close);
    const points = macd(closes, params.fast, params.slow, params.signal);
    const raw = rawFromState(candles, (i) => stateFromComparison(points[i]?.dif, points[i]?.dea));
    return finalizeSignals(raw);
  }
};

// ── 6. bollBreakout[20,2] ────────────────────────────────────────────────

export const bollBreakout: StrategyDef = {
  id: "bollBreakout",
  label: "Bollinger Breakout",
  params: [
    { key: "period", label: "Period", default: 20, min: 2, max: 200 },
    { key: "stdDevMultiplier", label: "Std dev", default: 2, min: 0.5, max: 5, step: 0.1 }
  ],
  compute(candles, params) {
    const closes = candles.map((c) => c.close);
    const middle = sma(closes, params.period);
    const dev = stdev(closes, params.period);
    const raw = rawFromState(candles, (i) => {
      const m = middle[i];
      const d = dev[i];
      if (m === undefined || d === undefined) return undefined;
      const upper = m + params.stdDevMultiplier * d;
      const lower = m - params.stdDevMultiplier * d;
      const close = closes[i];
      if (close > upper) return "BUY"; // breakout above the upper band.
      if (close < lower) return "SELL"; // breakdown below the lower band.
      return undefined; // inside the bands — neither state, doesn't break an in-progress run.
    });
    return finalizeSignals(raw);
  }
};

// ── 7. donchianBreakout[20] ──────────────────────────────────────────────

/** Highest high / lowest low over the PRIOR `period` bars (window `[i-period, i-1]`, current bar excluded) — a channel computed over the current bar's own high/low would make a same-bar breakout impossible by construction (`close` can never exceed its own bar's `high`). */
function priorRollingExtreme(values: readonly number[], period: number, mode: "max" | "min"): (number | undefined)[] {
  const out: (number | undefined)[] = new Array(values.length);
  for (let i = 0; i < values.length; i++) {
    if (i < period) {
      out[i] = undefined;
      continue;
    }
    let ext = mode === "max" ? -Infinity : Infinity;
    for (let k = i - period; k < i; k++) ext = mode === "max" ? Math.max(ext, values[k]) : Math.min(ext, values[k]);
    out[i] = ext;
  }
  return out;
}

export const donchianBreakout: StrategyDef = {
  id: "donchianBreakout",
  label: "Donchian Breakout",
  params: [{ key: "period", label: "Period", default: 20, min: 2, max: 200 }],
  compute(candles, params) {
    const highs = candles.map((c) => c.high);
    const lows = candles.map((c) => c.low);
    const closes = candles.map((c) => c.close);
    const priorHigh = priorRollingExtreme(highs, params.period, "max");
    const priorLow = priorRollingExtreme(lows, params.period, "min");
    const raw = rawFromState(candles, (i) => {
      const hi = priorHigh[i];
      const lo = priorLow[i];
      if (hi === undefined || lo === undefined) return undefined;
      if (closes[i] > hi) return "BUY";
      if (closes[i] < lo) return "SELL";
      return undefined;
    });
    return finalizeSignals(raw);
  }
};

// ── Registry + param helpers (mirrors `indicator-registry.ts`'s own
// clamp/resolve pattern for UI consistency between the indicator settings
// popover and `strategy-panel.tsx`'s param inputs). ─────────────────────

export const STRATEGY_REGISTRY: Record<string, StrategyDef> = {
  maCross,
  emaCross,
  supertrendFlip,
  rsiReversal,
  macdCross,
  bollBreakout,
  donchianBreakout
};

export const STRATEGY_LIST: readonly StrategyDef[] = Object.values(STRATEGY_REGISTRY);

export function getStrategyDef(id: string): StrategyDef | undefined {
  return STRATEGY_REGISTRY[id];
}

export function defaultParamValues(def: StrategyDef): number[] {
  return def.params.map((p) => p.default);
}

/** Clamps a positional `number[]` (the `calcParams`/localStorage-on-disk shape) to each spec's `[min,max]`, padding/truncating from defaults on a malformed/short array — same defensive posture as `indicator-registry.ts`'s `clampParams`. */
export function clampStrategyParams(def: StrategyDef, values: readonly number[]): number[] {
  return def.params.map((spec, i) => {
    const raw = values[i];
    const value = Number.isFinite(raw) ? raw : spec.default;
    return Math.min(spec.max, Math.max(spec.min, value));
  });
}

/** Resolves a positional `number[]` (as carried on `PF_SIGNALS`' `calcParams` and in `pf.workbench.strategy` localStorage) into the KEYED `Record<string, number>` shape every `compute()` above expects — clamped, with missing values falling back to `spec.default`. */
export function resolveStrategyParams(def: StrategyDef, values: readonly number[] | undefined): Record<string, number> {
  const clamped = clampStrategyParams(def, values ?? defaultParamValues(def));
  const out: Record<string, number> = {};
  def.params.forEach((spec, i) => {
    out[spec.key] = clamped[i];
  });
  return out;
}
