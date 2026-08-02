/**
 * Founder-feedback pass (2026-08-03) — "Indicators are not telling the
 * signals — we just get the indicator plots without any other information.
 * Look at TradingView and what they are doing with indicators and
 * strategies." PART A: per-instance signal chips in the active-indicator
 * strip (`indicator-active-strip.tsx`). This is a PURE module — no
 * klinecharts import, no DOM — computing directly over the SAME candle
 * array `chart-workbench.tsx` already holds in memory (the array the chart
 * itself plots), so a chip can never show a reading the chart itself
 * disagrees with.
 *
 * **The honesty law**: `computeIndicatorSignal` returns `state: null` for
 * every indicator without a well-established, citable reading convention
 * (AO, MTM, ROC, CMF, the whole OBV/volume family, DMA, TRIX, BIAS, PSY,
 * BRAR, CR, EMV, PIVOTS) — it NEVER invents a bullish/bearish/OB/OS read
 * for an oscillator that doesn't have one. Every one of those indicators
 * still gets a real, honestly-computed `valueText` (the brief's own "each
 * active instance shows its LATEST value(s)" applies to all of them) — only
 * the colored state CHIP is withheld.
 *
 * **Where the math comes from**: every indicator that has both (a) a chart
 * rendering elsewhere in this program AND (b) a state convention here calls
 * the EXACT SAME `lib/ta/math.ts` function that indicator's own chart
 * template (`custom-indicators/{pack-a,pack-b}.ts`) now calls, post the
 * founder-feedback promotion pass documented in `math.ts`'s own doc comment
 * — WYSIWYG between the plotted line and the read chip, not two
 * independently-maintained copies. `PIVOTS`/`CMF`/`BIAS`/`PSY`/`BRAR`/`CR`/
 * `VR`/`DMA`/`TRIX`/`VOL`/`OBV`/`PVT`/`AVP`/`EMV` have no state convention
 * to keep WYSIWYG-critical, so their value-only formulas are duplicated
 * locally below (verified against the SAME `klinecharts@10.0.1` source
 * lines their chart figures already match) rather than round-tripped
 * through a promotion — a minor, deliberate duplication in the same spirit
 * as `custom-indicators/pack-a.ts`'s own pre-existing local `istDateKey`.
 */
import {
  ema,
  sma,
  stdev,
  rsi,
  macd,
  wma,
  vwma,
  hma,
  wilderAtr,
  supertrend,
  rollingHigh,
  rollingLow,
  sessionVwap,
  parabolicSar,
  stochasticKdj,
  williamsR,
  cci,
  dmi,
  awesomeOscillator,
  momentum,
  moneyFlowIndex,
  stochRsi,
  ichimokuLines,
  aroon,
  type OhlcvLike
} from "./math";
import type { StrategyCandle } from "./strategies";

export type SignalState = "bullish" | "bearish" | "neutral" | "overbought" | "oversold" | "strong" | "weak" | null;

export interface IndicatorSignal {
  /** The indicator's latest value(s), formatted for the active-strip chip — e.g. `"65.2"`, `"K 82.3 · D 75.1"`, `"—"` if not enough bars are loaded yet. */
  valueText: string;
  state: SignalState;
  /** Plain-language reading, e.g. `"Overbought"`, `"Bullish cross"`, `null` when `state` is `null` (the honesty law — see module doc). */
  stateText: string | null;
}

const NO_SIGNAL: IndicatorSignal = { valueText: "—", state: null, stateText: null };

function fmt(v: number | undefined, digits = 2): string {
  return v === undefined || !Number.isFinite(v) ? "—" : v.toFixed(digits);
}
function pct(v: number | undefined, digits = 2): string {
  return v === undefined || !Number.isFinite(v) ? "—" : `${v.toFixed(digits)}%`;
}
function last<T>(arr: readonly T[]): T | undefined {
  return arr.length > 0 ? arr[arr.length - 1] : undefined;
}
function lastClose(candles: readonly OhlcvLike[]): number | undefined {
  return candles.length > 0 ? candles[candles.length - 1].close : undefined;
}

/** Price-vs-line convention shared by every MA-family/band-basis indicator (MA/EMA/SMA/WMA/VWMA/HMA/BBI, and the band-midpoint reads below). */
function priceVsLine(close: number | undefined, line: number | undefined, label: string): Pick<IndicatorSignal, "state" | "stateText"> {
  if (close === undefined || line === undefined) return { state: null, stateText: null };
  if (close > line) return { state: "bullish", stateText: `Price above ${label}` };
  if (close < line) return { state: "bearish", stateText: `Price below ${label}` };
  return { state: "neutral", stateText: `Price at ${label}` };
}

/** Price-vs-band convention shared by BOLL/KELTNER/DONCHIAN. */
function priceVsBand(close: number | undefined, upper: number | undefined, lower: number | undefined): Pick<IndicatorSignal, "state" | "stateText"> {
  if (close === undefined || upper === undefined || lower === undefined) return { state: null, stateText: null };
  if (close >= upper) return { state: "bullish", stateText: "At/above upper band" };
  if (close <= lower) return { state: "bearish", stateText: "At/below lower band" };
  return { state: "neutral", stateText: "Inside the bands" };
}

/** OB/OS convention shared by RSI/STOCHRSI/KDJ/WR/MFI/CCI (each with its own threshold pair — see call sites). */
function obOsState(value: number | undefined, oversoldAt: number, overboughtAt: number, label: string): Pick<IndicatorSignal, "state" | "stateText"> {
  if (value === undefined) return { state: null, stateText: null };
  // WR's scale runs 0..-100 (overbought near 0, oversold near -100) — `oversoldAt < overboughtAt` holds for BOTH orientations
  // (RSI/STOCHRSI/KDJ/MFI/CCI: 30 < 70; WR: -80 < -20), so a single `<`/`>` pair works for every caller without a sign flag.
  if (value <= oversoldAt) return { state: "oversold", stateText: `Oversold (${label})` };
  if (value >= overboughtAt) return { state: "overbought", stateText: `Overbought (${label})` };
  return { state: "neutral", stateText: null };
}

// ── Local, value-only formulas (no state convention — see module doc for
// why these stay local instead of being promoted into `math.ts`). Every one
// verified against `klinecharts@10.0.1`'s `dist/index.esm.js` source, same
// discipline as every promoted function. ──────────────────────────────────

/** BIAS — `(close - MA(close,N)) / MA(close,N) × 100`. Verified against `bias.calc` (`dist/index.esm.js:3374-3406`). */
function biasSeries(closes: readonly number[], period: number): (number | undefined)[] {
  const ma = sma(closes, period);
  return closes.map((c, i) => (ma[i] !== undefined ? ((c - ma[i]!) / ma[i]!) * 100 : undefined));
}

/** PSY — percentage of up-closes over the trailing `period`, plus a `signalPeriod` SMA of PSY itself. Verified against `psychologicalLine.calc` (`dist/index.esm.js:4356-4381`). */
function psySeries(closes: readonly number[], period: number, signalPeriod: number): { psy?: number; maPsy?: number }[] {
  const upFlags = closes.map((c, i) => (i > 0 && c > closes[i - 1] ? 1 : 0));
  const psy = sma(upFlags, period).map((v) => (v !== undefined ? v * 100 : undefined));
  const maPsy = sma(psy.filter((v): v is number => v !== undefined), signalPeriod);
  // `maPsy` above is computed over the compacted defined-run then needs remapping — psy has a fixed-length leading undefined run (no NaN-poisoning risk, a plain slice suffices here unlike the sparse mid-series case `compactSma` guards against).
  const firstDefined = psy.findIndex((v) => v !== undefined);
  return closes.map((_, i) => {
    if (psy[i] === undefined) return {};
    const maIdx = firstDefined >= 0 ? i - firstDefined : -1;
    return { psy: psy[i], maPsy: maIdx >= 0 ? maPsy[maIdx] : undefined };
  });
}

/** BRAR — AR (open-to-high/low pressure) / BR (yesterday's-close-to-range pressure), both ×100. Verified against `brar.calc` (`dist/index.esm.js:3490-3538`). */
function brarSeries(candles: readonly StrategyCandle[], period: number): { ar?: number; br?: number }[] {
  let ho = 0, ol = 0, hcy = 0, cyl = 0;
  const out: { ar?: number; br?: number }[] = [];
  for (let i = 0; i < candles.length; i++) {
    const c = candles[i];
    const prevClose = candles[i - 1]?.close ?? c.close;
    ho += c.high - c.open;
    ol += c.open - c.low;
    hcy += c.high - prevClose;
    cyl += prevClose - c.low;
    if (i >= period - 1) {
      const ar = ol !== 0 ? (ho / ol) * 100 : 0;
      const br = cyl !== 0 ? (hcy / cyl) * 100 : 0;
      out.push({ ar, br });
      const ago = candles[i - (period - 1)];
      const agoPrevClose = candles[i - period]?.close ?? ago.close;
      hcy -= ago.high - agoPrevClose;
      cyl -= agoPrevClose - ago.low;
      ho -= ago.high - ago.open;
      ol -= ago.open - ago.low;
    } else {
      out.push({});
    }
  }
  return out;
}

/** CR — the core "energy" band line only (`0-and-(high-prevMid)-max ÷ 0-and-(prevMid-low)-max, ×100`). Verified against `currentRatio.calc` (`dist/index.esm.js:3665-3690`); the four forward-shifted MA1-4 companion lines are a DELIBERATE, flagged simplification — see final report. */
function crCoreLine(candles: readonly StrategyCandle[], period: number): (number | undefined)[] {
  return candles.map((c, i) => {
    const prev = candles[i - 1] ?? c;
    const prevMid = (prev.high + prev.close + prev.low + prev.open) / 4;
    const highSubPreMid = Math.max(0, c.high - prevMid);
    const preMidSubLow = Math.max(0, prevMid - c.low);
    if (i < period - 1) return undefined;
    return preMidSubLow !== 0 ? (highSubPreMid / preMidSubLow) * 100 : 0;
  });
}

/** VR — volume ratio of up-day/down-day/flat-day volume. Verified against `volumeRatio.calc` (`dist/index.esm.js:4895-4935`). */
function vrValue(candles: readonly StrategyCandle[], period: number): number | undefined {
  if (candles.length < period) return undefined;
  let uvs = 0, dvs = 0, pvs = 0;
  const start = candles.length - period;
  for (let i = start; i < candles.length; i++) {
    const c = candles[i];
    const prevClose = candles[i - 1]?.close ?? c.close;
    const vol = c.volume ?? 0;
    if (c.close > prevClose) uvs += vol;
    else if (c.close < prevClose) dvs += vol;
    else pvs += vol;
  }
  const halfPvs = pvs / 2;
  return dvs + halfPvs === 0 ? 0 : ((uvs + halfPvs) / (dvs + halfPvs)) * 100;
}

/** DMA — `MA(close,fast) - MA(close,slow)`, with a `signal`-period SMA of that gap. Verified against `differentOfMovingAverage.calc` (`dist/index.esm.js:3761-3789`). */
function dmaLast(closes: readonly number[], fast: number, slow: number, signal: number): { dma?: number; ama?: number } {
  const maFast = sma(closes, fast);
  const maSlow = sma(closes, slow);
  const maxPeriod = Math.max(fast, slow);
  const dif: (number | undefined)[] = closes.map((_, i) => (i >= maxPeriod - 1 && maFast[i] !== undefined && maSlow[i] !== undefined ? maFast[i]! - maSlow[i]! : undefined));
  const firstDefined = dif.findIndex((v) => v !== undefined);
  if (firstDefined < 0) return {};
  const compact = dif.slice(firstDefined).map((v) => v!);
  const ama = sma(compact, signal);
  return { dma: last(dif), ama: last(ama) };
}

/** TRIX — triple-EMA rate of change, ×100. Verified against `tripleExponentiallySmoothedAverage.calc` (`dist/index.esm.js:4740-4790`). */
function trixLast(closes: readonly number[], period: number, signal: number): { trix?: number; maTrix?: number } {
  // Three successive EMA passes (MTR = EMA(EMA(EMA(close,N),N),N)) — each pass's OWN leading `undefined` run is
  // compacted away before feeding the next pass, since `ema()` only accepts a dense array; the remaining values
  // stay in original bar order (a fixed head truncation, no internal gaps), so adjacent-entry pct-change below
  // still reads as adjacent-BAR pct-change.
  const ema1 = ema(closes, period);
  const ema1Defined = ema1.filter((v): v is number => v !== undefined);
  const ema2Series = ema(ema1Defined, period);
  const ema2Defined = ema2Series.filter((v): v is number => v !== undefined);
  const trSeries = ema(ema2Defined, period);
  const trixValues: (number | undefined)[] = trSeries.map((v, i) => (v !== undefined && i > 0 && trSeries[i - 1] !== undefined && trSeries[i - 1] !== 0 ? ((v - trSeries[i - 1]!) / trSeries[i - 1]!) * 100 : undefined));
  const trixDefined = trixValues.filter((v): v is number => v !== undefined);
  const maTrix = sma(trixDefined, signal);
  return { trix: last(trixValues), maTrix: last(maTrix) };
}

/** BBI — the average of four simple MAs of different lengths. Verified against `bullAndBearIndex.calc` (`dist/index.esm.js:3548-3579`). */
function bbiLast(closes: readonly number[], periods: readonly number[]): number | undefined {
  const mas = periods.map((p) => last(sma(closes, p))).filter((v): v is number => v !== undefined);
  if (mas.length !== periods.length) return undefined;
  return mas.reduce((s, v) => s + v, 0) / mas.length;
}

/** klinecharts' own `SMA` indicator (confusingly NOT a simple moving average — a `[period, weight]`-weighted recursive smoothing). Verified against `simpleMovingAverage.calc` (`dist/index.esm.js:4534-4557`). Named distinctly from `math.ts`'s own `sma()` (true simple moving average) to avoid exactly this confusion. */
function klineWeightedSma(closes: readonly number[], period: number, weight: number): (number | undefined)[] {
  const out: (number | undefined)[] = new Array(closes.length);
  let closeSum = 0;
  let smaValue = 0;
  for (let i = 0; i < closes.length; i++) {
    closeSum += closes[i];
    if (i >= period - 1) {
      smaValue = i > period - 1 ? (closes[i] * weight + smaValue * (period - weight + 1)) / (period + 1) : closeSum / period;
      out[i] = smaValue;
    } else {
      out[i] = undefined;
    }
  }
  return out;
}

/** EMV — ease of movement (price-range-adjusted distance moved per unit volume), plus its own signal MA. Verified against `easeOfMovementValue.calc` (`dist/index.esm.js:3952-3990`) — including a genuine klinecharts quirk: `calcParams[1]` ("Signal MA" in `indicator-registry.ts`'s own param spec) is declared but NEVER read by the real `calc` body, which uses `params[0]` for BOTH the raw-EMV threshold AND the signal-MA window. Reproduced faithfully here (`period` alone, `signal` implicitly ignored) rather than "fixed" — WYSIWYG with the built-in's actual behavior. */
function emvLast(candles: readonly StrategyCandle[], period: number): { emv?: number; maEmv?: number } {
  const emv: (number | undefined)[] = new Array(candles.length);
  for (let i = 0; i < candles.length; i++) {
    if (i === 0) {
      emv[i] = undefined;
      continue;
    }
    const c = candles[i];
    const prev = candles[i - 1];
    const vol = c.volume ?? 0;
    const distanceMoved = (c.high + c.low) / 2 - (prev.high + prev.low) / 2;
    if (vol === 0 || c.high - c.low === 0) emv[i] = 0;
    else emv[i] = distanceMoved / (vol / 100000000 / (c.high - c.low));
  }
  const defined = emv.filter((v): v is number => v !== undefined);
  const maEmv = sma(defined, period);
  return { emv: last(emv), maEmv: last(maEmv) };
}

/** OBV — running total adding volume on up-closes, subtracting on down-closes, plus a `signal`-period SMA. */
function obvLast(candles: readonly StrategyCandle[], signal: number): { obv?: number; maObv?: number } {
  const obv: number[] = new Array(candles.length);
  let running = 0;
  for (let i = 0; i < candles.length; i++) {
    if (i > 0) {
      const c = candles[i];
      const prev = candles[i - 1];
      if (c.close > prev.close) running += c.volume ?? 0;
      else if (c.close < prev.close) running -= c.volume ?? 0;
    }
    obv[i] = running;
  }
  const maObv = sma(obv, signal);
  return { obv: last(obv), maObv: last(maObv) };
}

/** PVT — running total of volume scaled by percentage price change. */
function pvtLast(candles: readonly StrategyCandle[]): number | undefined {
  if (candles.length === 0) return undefined;
  let running = 0;
  for (let i = 1; i < candles.length; i++) {
    const c = candles[i];
    const prev = candles[i - 1];
    if (prev.close !== 0) running += ((c.close - prev.close) / prev.close) * (c.volume ?? 0);
  }
  return running;
}

/** AVP — Average Price. klinecharts' own built-in divides cumulative turnover by cumulative volume; this workbench's candles carry no `turnover` field, so this is a documented, honest approximation — cumulative (typical price × volume) ÷ cumulative volume since the start of the LOADED window (never resets, unlike `VWAP`'s per-session reset above). */
function avpLast(candles: readonly StrategyCandle[]): number | undefined {
  let cumPv = 0;
  let cumVol = 0;
  for (const c of candles) {
    const vol = c.volume ?? 0;
    cumPv += ((c.high + c.low + c.close) / 3) * vol;
    cumVol += vol;
  }
  return cumVol > 0 ? cumPv / cumVol : undefined;
}

/** CMF — Chaikin Money Flow. Verified against `pack-b.ts`'s own `cmf.calc` (S2), itself a standard, well-known formula. */
function cmfLast(candles: readonly StrategyCandle[], period: number): number | undefined {
  if (candles.length < period) return undefined;
  let mfvSum = 0;
  let volSum = 0;
  const start = candles.length - period;
  for (let i = start; i < candles.length; i++) {
    const c = candles[i];
    const range = c.high - c.low;
    const multiplier = range === 0 ? 0 : (c.close - c.low - (c.high - c.close)) / range;
    mfvSum += multiplier * (c.volume ?? 0);
    volSum += c.volume ?? 0;
  }
  return volSum === 0 ? 0 : mfvSum / volSum;
}

/** ROC — `(close - close[N ago]) / close[N ago] × 100`, plus a `signal`-period SMA. Verified against `rateOfChange.calc` (`dist/index.esm.js:4409-4433`). */
function rocLast(closes: readonly number[], period: number, signal: number): { roc?: number; maRoc?: number } {
  const roc: (number | undefined)[] = closes.map((c, i) => {
    if (i < period - 1) return undefined;
    const ago = closes[i - period] ?? closes[i - (period - 1)];
    return ago !== 0 ? ((c - ago) / ago) * 100 : 0;
  });
  const defined = roc.filter((v): v is number => v !== undefined);
  const maRoc = sma(defined, signal);
  return { roc: last(roc), maRoc: last(maRoc) };
}

/** Classic prior-session pivot points, session-adaptive (weekly on daily bars, prior-day intraday) — duplicated verbatim from `custom-indicators/pack-a.ts`'s own `pivots.calc` (S2). Not imported from that file directly: importing it would trigger its module-scope `registerIndicator()` side effects merely to reach a private helper, which this pure module must never do. */
function istDateKey(timestampMs: number): string {
  return new Date(timestampMs).toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
}
function istWeekKey(timestampMs: number): string {
  const istString = new Date(timestampMs).toLocaleString("en-US", { timeZone: "Asia/Kolkata" });
  const d = new Date(istString);
  const day = (d.getDay() + 6) % 7;
  d.setDate(d.getDate() - day);
  return d.toISOString().slice(0, 10);
}
function inferIsDailyBars(candles: readonly StrategyCandle[]): boolean {
  if (candles.length < 3) return false;
  const gaps: number[] = [];
  for (let i = 1; i < candles.length; i++) gaps.push(candles[i].timestamp - candles[i - 1].timestamp);
  gaps.sort((a, b) => a - b);
  return gaps[Math.floor(gaps.length / 2)] >= 20 * 60 * 60 * 1000;
}
function classicPivotPp(high: number, low: number, close: number): number {
  return (high + low + close) / 3;
}
function pivotsLast(candles: readonly StrategyCandle[]): { pp?: number } {
  if (candles.length === 0) return {};
  const isDaily = inferIsDailyBars(candles);
  const keyFn = isDaily ? istWeekKey : istDateKey;
  const periodKeys: string[] = [];
  const periodAgg = new Map<string, { high: number; low: number; close: number }>();
  for (const c of candles) {
    const key = keyFn(c.timestamp);
    const existing = periodAgg.get(key);
    if (!existing) {
      periodKeys.push(key);
      periodAgg.set(key, { high: c.high, low: c.low, close: c.close });
    } else {
      existing.high = Math.max(existing.high, c.high);
      existing.low = Math.min(existing.low, c.low);
      existing.close = c.close;
    }
  }
  if (periodKeys.length < 2) return {};
  const prior = periodAgg.get(periodKeys[periodKeys.length - 2])!;
  return { pp: classicPivotPp(prior.high, prior.low, prior.close) };
}

// ── The dispatcher ────────────────────────────────────────────────────────

/**
 * `params` must already be RESOLVED (`indicator-registry.ts`'s
 * `resolveParams(instance)` — defaults applied, clamped), same convention
 * `IndicatorActiveStrip`'s own `formatInstanceLabel` already uses.
 */
export function computeIndicatorSignal(name: string, params: readonly number[], candles: readonly StrategyCandle[]): IndicatorSignal {
  if (candles.length === 0) return NO_SIGNAL;
  const closes = candles.map((c) => c.close);
  const close = lastClose(candles);

  switch (name) {
    // ── Trend (main) ──
    case "MA": {
      const lines = params.map((p) => last(sma(closes, p)));
      const valueText = params.map((p, i) => `MA(${p}) ${fmt(lines[i])}`).join(" · ");
      return { valueText, ...priceVsLine(close, lines[0], `MA(${params[0]})`) };
    }
    case "EMA": {
      const lines = params.map((p) => last(ema(closes, p)));
      const valueText = params.map((p, i) => `EMA(${p}) ${fmt(lines[i])}`).join(" · ");
      return { valueText, ...priceVsLine(close, lines[0], `EMA(${params[0]})`) };
    }
    case "SMA": {
      const [period, weight] = params;
      const line = last(klineWeightedSma(closes, period, weight));
      return { valueText: fmt(line), ...priceVsLine(close, line, "SMA") };
    }
    case "BBI": {
      const value = bbiLast(closes, params);
      return { valueText: fmt(value), ...priceVsLine(close, value, "BBI") };
    }
    case "SAR": {
      const [startPct, stepPct, maxPct] = params;
      const value = last(parabolicSar(candles, startPct, stepPct, maxPct));
      if (close === undefined || value === undefined) return NO_SIGNAL;
      return close > value
        ? { valueText: fmt(value), state: "bullish", stateText: "Price above SAR (uptrend)" }
        : { valueText: fmt(value), state: "bearish", stateText: "Price below SAR (downtrend)" };
    }
    case "DMA": {
      const [fast, slow, signal] = params;
      const { dma, ama } = dmaLast(closes, fast, slow, signal);
      return { valueText: `DMA ${fmt(dma)} · AMA ${fmt(ama)}`, state: null, stateText: null };
    }
    case "DMI": {
      const [period, adxPeriod] = params;
      const point = last(dmi(candles, period, adxPeriod));
      if (!point || point.adx === undefined) return NO_SIGNAL;
      const strength: SignalState = point.adx >= 25 ? "strong" : "weak";
      const direction = (point.pdi ?? 0) > (point.mdi ?? 0) ? "+DI leading" : (point.mdi ?? 0) > (point.pdi ?? 0) ? "-DI leading" : "flat";
      return {
        valueText: `ADX ${pct(point.adx)} · +DI ${pct(point.pdi)} · -DI ${pct(point.mdi)}`,
        state: strength,
        stateText: `${strength === "strong" ? "Strong" : "Weak"} trend · ${direction}`
      };
    }
    case "TRIX": {
      const [period, signal] = params;
      const { trix, maTrix } = trixLast(closes, period, signal);
      return { valueText: `TRIX ${pct(trix)} · Signal ${pct(maTrix)}`, state: null, stateText: null };
    }

    // ── Bands ──
    case "BOLL": {
      const [period, mult] = params;
      const mid = last(sma(closes, period));
      const sd = last(stdev(closes, period));
      const upper = mid !== undefined && sd !== undefined ? mid + mult * sd : undefined;
      const lower = mid !== undefined && sd !== undefined ? mid - mult * sd : undefined;
      return { valueText: `Mid ${fmt(mid)} · Upper ${fmt(upper)} · Lower ${fmt(lower)}`, ...priceVsBand(close, upper, lower) };
    }

    // ── Momentum ──
    case "MACD": {
      const [fast, slow, signal] = params;
      const point = last(macd(closes, fast, slow, signal));
      if (!point || point.dif === undefined || point.dea === undefined) return NO_SIGNAL;
      const bullish = point.dif > point.dea;
      return {
        valueText: `DIF ${fmt(point.dif)} · DEA ${fmt(point.dea)} · Hist ${fmt(point.macd)}`,
        state: bullish ? "bullish" : "bearish",
        stateText: bullish ? "Bullish cross (DIF above DEA)" : "Bearish cross (DIF below DEA)"
      };
    }
    case "RSI": {
      const lines = params.map((p) => last(rsi(closes, p)));
      const valueText = params.map((p, i) => `RSI(${p}) ${pct(lines[i])}`).join(" · ");
      return { valueText, ...obOsState(lines[0], 30, 70, `RSI(${params[0]}) ${pct(lines[0])}`) };
    }
    case "KDJ": {
      const [period, kSmooth, dSmooth] = params;
      const point = last(stochasticKdj(candles, period, kSmooth, dSmooth));
      const k = point?.k;
      const valueText = `K ${pct(k)} · D ${pct(point?.d)} · J ${pct(point?.j)}`;
      // The brief's own convention list ellipsis omits KDJ's exact threshold pair — 80/20 on the K line, the
      // same convention this program also applies to STOCHRSI/MFI (a standard, widely-used KDJ reading).
      return { valueText, ...obOsState(k, 20, 80, `K ${pct(k)}`) };
    }
    case "WR": {
      const lines = params.map((p) => last(williamsR(candles, p)));
      const valueText = params.map((p, i) => `WR${p} ${pct(lines[i])}`).join(" · ");
      return { valueText, ...obOsState(lines[0], -80, -20, `WR ${pct(lines[0])}`) };
    }
    case "ROC": {
      const [period, signal] = params;
      const { roc, maRoc } = rocLast(closes, period, signal);
      return { valueText: `ROC ${pct(roc)} · Signal ${pct(maRoc)}`, state: null, stateText: null };
    }
    case "MTM": {
      const [period, signal] = params;
      const point = last(momentum(closes, period, signal));
      return { valueText: `MTM ${fmt(point?.mtm)} · Signal ${fmt(point?.maMtm)}`, state: null, stateText: null };
    }
    case "BIAS": {
      const lines = params.map((p) => last(biasSeries(closes, p)));
      const valueText = params.map((p, i) => `BIAS(${p}) ${pct(lines[i])}`).join(" · ");
      return { valueText, state: null, stateText: null };
    }
    case "PSY": {
      const [period, signal] = params;
      const point = last(psySeries(closes, period, signal));
      return { valueText: `PSY ${pct(point?.psy)} · Signal ${pct(point?.maPsy)}`, state: null, stateText: null };
    }
    case "AO": {
      const [fast, slow] = params;
      const value = last(awesomeOscillator(candles, fast, slow));
      return { valueText: fmt(value), state: null, stateText: null };
    }
    case "BRAR": {
      const [period] = params;
      const point = last(brarSeries(candles, period));
      return { valueText: `AR ${pct(point?.ar)} · BR ${pct(point?.br)}`, state: null, stateText: null };
    }
    case "CR": {
      const [period] = params;
      const value = last(crCoreLine(candles, period));
      return { valueText: `CR ${pct(value)}`, state: null, stateText: null };
    }

    // ── Volatility ──
    case "CCI": {
      const [period] = params;
      const value = last(cci(candles, period));
      // Brief's own "simplify honestly" instruction: TradingView's real CCI rating rule also checks the value is
      // RISING/FALLING through the threshold, not just past it — deliberately simplified here to a bare
      // threshold cross (documented, not silently narrowed).
      return { valueText: fmt(value), ...obOsState(value, -100, 100, `CCI ${fmt(value)}`) };
    }
    case "EMV": {
      const [period] = params;
      const { emv, maEmv } = emvLast(candles, period);
      return { valueText: `EMV ${fmt(emv)} · Signal ${fmt(maEmv)}`, state: null, stateText: null };
    }

    // ── Volume ──
    case "VOL": {
      const volumes = candles.map((c) => c.volume ?? 0);
      const mas = params.map((p) => last(sma(volumes, p)));
      const lastVol = last(volumes);
      const valueText = `Vol ${fmt(lastVol, 0)}` + params.map((p, i) => ` · MA${i + 1} ${fmt(mas[i], 0)}`).join("");
      return { valueText, state: null, stateText: null };
    }
    case "OBV": {
      const [signal] = params;
      const { obv, maObv } = obvLast(candles, signal);
      return { valueText: `OBV ${fmt(obv, 0)} · Signal ${fmt(maObv, 0)}`, state: null, stateText: null };
    }
    case "PVT": {
      const value = pvtLast(candles);
      return { valueText: fmt(value, 0), state: null, stateText: null };
    }
    case "VR": {
      const [period] = params;
      const value = vrValue(candles, period);
      return { valueText: pct(value), state: null, stateText: null };
    }
    case "AVP": {
      const value = avpLast(candles);
      return { valueText: fmt(value), state: null, stateText: null };
    }

    // ── Custom ──
    case "ICHIMOKU": {
      const [tenkanPeriod, kijunPeriod, senkouBPeriod] = params;
      const lines = ichimokuLines(candles, tenkanPeriod, kijunPeriod, senkouBPeriod);
      const lastIndex = candles.length - 1;
      const cloudSourceIndex = lastIndex - kijunPeriod; // the bar whose senkouA/B the chart currently displaces FORWARD to sit at lastIndex — see math.ts's own `ichimokuLines` doc.
      const cloudPoint = cloudSourceIndex >= 0 ? lines[cloudSourceIndex] : undefined;
      const tenkan = last(lines)?.tenkan;
      const kijun = last(lines)?.kijun;
      const valueText = `Conv ${fmt(tenkan)} · Base ${fmt(kijun)}`;
      const senkouA = cloudPoint?.senkouA;
      const senkouB = cloudPoint?.senkouB;
      if (close === undefined || senkouA === undefined || senkouB === undefined) {
        return { valueText, state: null, stateText: null };
      }
      const cloudTop = Math.max(senkouA, senkouB);
      const cloudBottom = Math.min(senkouA, senkouB);
      if (close > cloudTop) return { valueText, state: "bullish", stateText: "Price above the cloud" };
      if (close < cloudBottom) return { valueText, state: "bearish", stateText: "Price below the cloud" };
      return { valueText, state: "neutral", stateText: "Price inside the cloud" };
    }
    case "SUPERTREND": {
      const [period, mult] = params;
      const point = last(supertrend(candles, period, mult));
      if (!point || point.trend === undefined || point.value === undefined) return NO_SIGNAL;
      const up = point.trend === 1;
      return { valueText: fmt(point.value), state: up ? "bullish" : "bearish", stateText: up ? "Uptrend" : "Downtrend" };
    }
    case "VWAP": {
      const value = last(sessionVwap(candles));
      return { valueText: fmt(value), ...priceVsLine(close, value, "VWAP") };
    }
    case "KELTNER": {
      const [period, mult] = params;
      const middle = last(ema(closes, period));
      const atr = last(wilderAtr(candles, period));
      const upper = middle !== undefined && atr !== undefined ? middle + mult * atr : undefined;
      const lower = middle !== undefined && atr !== undefined ? middle - mult * atr : undefined;
      return { valueText: `Mid ${fmt(middle)} · Upper ${fmt(upper)} · Lower ${fmt(lower)}`, ...priceVsBand(close, upper, lower) };
    }
    case "DONCHIAN": {
      const [period] = params;
      const upper = last(rollingHigh(candles, period));
      const lower = last(rollingLow(candles, period));
      const middle = upper !== undefined && lower !== undefined ? (upper + lower) / 2 : undefined;
      return { valueText: `Mid ${fmt(middle)} · Upper ${fmt(upper)} · Lower ${fmt(lower)}`, ...priceVsBand(close, upper, lower) };
    }
    case "PIVOTS": {
      const { pp } = pivotsLast(candles);
      return { valueText: `PP ${fmt(pp)}`, state: null, stateText: null };
    }
    case "ATRX": {
      const [period] = params;
      const value = last(wilderAtr(candles, period));
      return { valueText: fmt(value), state: null, stateText: null };
    }
    case "STOCHRSI": {
      const [rsiPeriod, stochPeriod, kSmooth, dSmooth] = params;
      const point = last(stochRsi(closes, rsiPeriod, stochPeriod, kSmooth, dSmooth));
      const k = point?.k;
      return { valueText: `K ${pct(k)} · D ${pct(point?.d)}`, ...obOsState(k, 20, 80, `K ${pct(k)}`) };
    }
    case "WMA": {
      const [period] = params;
      const value = last(wma(closes, period));
      return { valueText: fmt(value), ...priceVsLine(close, value, "WMA") };
    }
    case "VWMA": {
      const [period] = params;
      const value = last(vwma(closes, candles.map((c) => c.volume ?? 0), period));
      return { valueText: fmt(value), ...priceVsLine(close, value, "VWMA") };
    }
    case "HMA": {
      const [period] = params;
      const value = last(hma(closes, period));
      return { valueText: fmt(value), ...priceVsLine(close, value, "HMA") };
    }
    case "MFI": {
      const [period] = params;
      const value = last(moneyFlowIndex(candles, period));
      return { valueText: pct(value), ...obOsState(value, 20, 80, `MFI ${pct(value)}`) };
    }
    case "CMF": {
      const [period] = params;
      const value = cmfLast(candles, period);
      return { valueText: fmt(value, 4), state: null, stateText: null };
    }
    case "AROON": {
      const [period] = params;
      const point = last(aroon(candles, period));
      const up = point?.up;
      const down = point?.down;
      const valueText = `Up ${pct(up, 0)} · Down ${pct(down, 0)}`;
      if (up === undefined || down === undefined) return { valueText, state: null, stateText: null };
      if (up > down) return { valueText, state: "bullish", stateText: `Up dominant (${pct(up, 0)} vs ${pct(down, 0)})` };
      if (down > up) return { valueText, state: "bearish", stateText: `Down dominant (${pct(down, 0)} vs ${pct(up, 0)})` };
      return { valueText, state: "neutral", stateText: "Up/Down even" };
    }

    default:
      return NO_SIGNAL;
  }
}
