/**
 * TA Suite Sprint S2, T1 — the indicator library's single source of truth:
 * metadata for all 27 klinecharts built-ins (verified by name AND default
 * `calcParams`/`figures` directly against `node_modules/klinecharts/dist/
 * index.esm.js`'s own indicator source, not assumed) plus the 14-indicator
 * custom pack (`custom-indicators/`), the multi-instance selection model,
 * and the `pf.workbench.indicators` v1→v2 localStorage migration.
 *
 * **Multi-instance product-gap fix (CEO brief's own addition to the S2
 * scope)**: the old `indicator-picker.tsx` kept selection as bare
 * `Set<string>`-shaped name arrays — impossible to represent "MA(9) AND
 * MA(21) simultaneously," a real, common TA pattern (and a direct
 * foreshadow of S3's `maCross`/`emaCross` strategies, which plot exactly
 * this pair). `IndicatorInstance` below is the fix: each add gets its own
 * `instanceId`, independent of `name` — the active-indicator strip renders
 * one row per INSTANCE, not per name.
 *
 * **Why `kline-chart.tsx`'s effect can operate on `id` alone, no `paneId`
 * bookkeeping needed** (a verified simplification vs. the brief's own
 * speculative "capture returned paneId in a Map ref" framing — confirmed by
 * reading `StoreImp.prototype.{addIndicator,removeIndicator,overrideIndicator,
 * getIndicatorsByFilter}` in `dist/index.esm.js:13998-14132` directly):
 * - `chart.createIndicator({..., id: instanceId}, isStack)` — verified
 *   against `ChartImp.prototype.createIndicator` (`dist/index.esm.js:15107`):
 *   `(_a = indicator.id) ?? (indicator.id = createId(...))` — an explicitly
 *   supplied `id` is used AS-IS, never overwritten. We generate our own
 *   `instanceId` up front and pass it through, so we always know exactly
 *   which indicator instance we're talking about without reading back a
 *   generated id (the function's return value is `indicator.id` anyway —
 *   confirmed at `dist/index.esm.js:15136` — never the paneId the brief
 *   speculated it might be).
 * - `getIndicatorsByFilter({id})` (`dist/index.esm.js:14024-14042`): when
 *   `id` is present the match function checks `indicator.id === id` ONLY —
 *   `paneId`, if also present in the filter, narrows the SEARCH SCOPE (which
 *   pane's indicator list to scan) but is never required for a positive
 *   match. Passing NO `paneId` makes it scan every pane's indicator list —
 *   correct and cheap at this program's indicator counts (≤ 4 sub-pane
 *   instances + a handful of main-pane ones).
 * - `chart.removeIndicator({id: instanceId})` and
 *   `chart.overrideIndicator({id: instanceId, name, calcParams})` therefore
 *   both resolve to the exact right instance, in whichever pane it actually
 *   lives, with zero paneId tracking on our side. Sub-pane instances are
 *   created with NO explicit `paneId` (`createIndicator({name, id}, false)`)
 *   — `ChartImp.prototype.createIndicator` auto-assigns a FRESH unique
 *   paneId whenever the caller doesn't supply one (`dist/index.esm.js:
 *   15115`), which is exactly D4's "one indicator instance per pane, no
 *   stacking" rule, for free, per instance, with no bookkeeping.
 */

// ── Categories & instance model ─────────────────────────────────────────

export type IndicatorCategory = "Trend" | "Bands" | "Momentum" | "Volatility" | "Volume" | "Custom";
export const INDICATOR_CATEGORIES: readonly IndicatorCategory[] = ["Trend", "Bands", "Momentum", "Volatility", "Volume", "Custom"];

export type IndicatorPaneKind = "main" | "sub";

export interface IndicatorParamSpec {
  label: string;
  min: number;
  max: number;
  step?: number;
}

export interface IndicatorMeta {
  /** The klinecharts-registered indicator name — passed verbatim to `createIndicator`/`registerIndicator`. */
  name: string;
  /** Display name when it differs from the klinecharts registry `name` — founder 2026-08-04: "SMA" collided (klinecharts' SMA is a SMOOTHED MA while the signals table's SMA(n) is the industry-standard SIMPLE MA). Display-only: `name` stays the registry/persistence key. */
  displayLabel?: string;
  category: IndicatorCategory;
  pane: IndicatorPaneKind;
  defaultParams: number[];
  /** One entry per `defaultParams` slot, same order — the settings popover's number-input labels + clamp bounds. */
  params: IndicatorParamSpec[];
  description: string;
  isCustom: boolean;
  /** T5 — disabled + stripped-on-restore when the chart is in option-premium (pseudo-candle, `volume=0`) mode. */
  premiumDisabled?: boolean;
  /** T5 — an independent, ADDITIONAL gate (both must hold for the indicator to be allowed) — currently only VWAP on `1d`. */
  intervalDisabled?: (interval: string) => boolean;
}

/**
 * Founder bug fix (2026-08-04, per-line style pass) — a single line's color/
 * width override. `undefined` fields mean "not overridden, use klinecharts'
 * own default for this line index" — see `buildIndicatorLineStyles` below
 * for how a sparse array of these gets turned into the DENSE array
 * `overrideIndicator({styles:{lines}})` actually requires.
 */
export interface LineStyleOverride {
  color?: string;
  size?: number;
}

/** One added indicator on the chart. `instanceId` is the identity used for every klinecharts call (`id` filter) AND every React key — `name` alone is deliberately NOT unique (two MA instances share a name, differ by `params`). `params` omitted = use `INDICATOR_REGISTRY[name].defaultParams`. */
export interface IndicatorInstance {
  instanceId: string;
  name: string;
  params?: number[];
  /**
   * Founder bug fix (2026-08-04) — per-LINE style overrides, index-aligned
   * to the instance's live `figures` filtered to `type === 'line'` (see
   * `IndicatorLineFigure.index` below — that's the same index space).
   * `lines[i]` is `null`/`undefined`/missing when line `i` has never been
   * customized. Replaces the old founder-feedback-pass STYLE section, which
   * (documented as a known scope gap at the time) applied ONE color/width to
   * EVERY line in the instance via `overrideIndicator`'s modulo-indexed
   * single-element-array trick — the exact bug this fixes ("choosing a
   * color makes all the lines the same colour").
   */
  styles?: { lines?: Array<LineStyleOverride | null> };
}

/**
 * Runtime-discovered metadata for one LINE-type figure of a live indicator
 * instance — sourced from `chart.getIndicators({id})[0].figures`, never a
 * hand-built catalogue (klinecharts' own `figures[].title` already carries
 * the correct per-indicator label — "MA1"/"UP"/"DIF"/"K", etc. — for every
 * built-in AND every custom indicator in this registry).
 */
export interface IndicatorLineFigure {
  key: string;
  /** `figure.title` trimmed of its trailing on-chart-legend `": "` suffix (falls back to `key` if a figure somehow has no title). */
  label: string;
  /**
   * Index within `figures[]` FILTERED to `type === 'line'`, in declaration
   * order — exactly the index klinecharts' own `eachFigures` (`dist/
   * index.esm.js:3066`) increments as `lineCount` to resolve
   * `styles.lines[lineCount % lineStyleCount]`. Writing a style override to
   * `styles.lines[index]` is therefore guaranteed to land on THIS figure and
   * no other, verified directly against that resolution loop (not assumed).
   */
  index: number;
}

/**
 * klinecharts@10.0.1's own default per-line style palette, verified
 * character-for-character against `node_modules/klinecharts/dist/
 * index.esm.js`'s `getDefaultIndicatorStyle()` (~line 11405):
 * `lines: ['#FF9600','#935EBD','#1677FF','#E11D74','#01C5C4'].map(color =>
 * ({style:'solid', smooth:false, size:1, dashedValue:[2,2], color}))`.
 * `#1677FF` is `Color.BLUE` in that same file (`~line 11215`), inlined here
 * since klinecharts exposes no runtime accessor for its own theme defaults.
 * Mirrored (not imported) so `buildIndicatorLineStyles` can submit a
 * COMPLETE `styles.lines[]` array on every override — required because
 * `overrideIndicator`'s style resolution is all-or-nothing per line index
 * (`formatValue(indicator.styles, 'lines', defaultStyles.lines)` returns
 * `indicator.styles.lines` in FULL the moment it's set at all, never
 * per-index-merged with klinecharts' own built-in default — verified via
 * the same `eachFigures`/`formatValue` read above). Never overridden by this
 * app's own `WORKBENCH_THEME` (`kline-chart.tsx` only sets
 * `indicator.tooltip.features` there), so this palette IS what every
 * never-customized line renders with today.
 */
export const DEFAULT_INDICATOR_LINE_COLORS = ["#FF9600", "#935EBD", "#1677FF", "#E11D74", "#01C5C4"] as const;

export interface ResolvedLineStyle {
  style: "solid";
  smooth: false;
  size: number;
  dashedValue: [number, number];
  color: string;
}

function defaultIndicatorLineStyle(index: number): ResolvedLineStyle {
  return {
    style: "solid",
    smooth: false,
    size: 1,
    dashedValue: [2, 2],
    color: DEFAULT_INDICATOR_LINE_COLORS[index % DEFAULT_INDICATOR_LINE_COLORS.length]
  };
}

/**
 * Builds the DENSE, `lineCount`-length `styles.lines[]` array a single
 * `overrideIndicator` call needs to change ONE line's color/width without
 * silently resetting every other line to klinecharts' own default (or, if a
 * PRIOR override call had already customized a different line, without
 * dropping that customization) — every index gets a real style object
 * (klinecharts' default for that index, patched by this instance's own
 * stored override if one exists for that index), never `null`/`undefined`,
 * since `formatValue`'s all-or-nothing resolution (see
 * `DEFAULT_INDICATOR_LINE_COLORS`'s own doc) means a sparse/partial array
 * would leave the UNSET trailing indices with no style object to modulo
 * back onto — a `lines.length < lineCount` array is fine (modulo wraps),
 * but a `lines.length` that's merely sparse (holes) is not, since JS array
 * holes stringify to `null` through klinecharts' own `clone()`.
 */
export function buildIndicatorLineStyles(overrides: Array<LineStyleOverride | null | undefined> | undefined, lineCount: number): ResolvedLineStyle[] {
  return Array.from({ length: lineCount }, (_, i) => {
    const base = defaultIndicatorLineStyle(i);
    const override = overrides?.[i];
    if (!override) return base;
    return {
      ...base,
      ...(override.color !== undefined ? { color: override.color } : {}),
      ...(override.size !== undefined ? { size: override.size } : {})
    };
  });
}

export interface IndicatorSelection {
  main: IndicatorInstance[];
  sub: IndicatorInstance[];
}

export const EMPTY_SELECTION: IndicatorSelection = { main: [], sub: [] };

/** D4 — sub-panes are capped at 4 concurrent INSTANCES total (not 4 per name) — screen space is the constraint, not indicator identity. */
export const MAX_SUB_PANE_INSTANCES = 4;

// ── Shared param-spec helpers ────────────────────────────────────────────

function periodParam(label = "Period", min = 1, max = 500): IndicatorParamSpec {
  return { label, min, max };
}
function ratioParam(label: string, min = 0.1, max = 10, step = 0.1): IndicatorParamSpec {
  return { label, min, max, step };
}

// ── 27 built-in indicators (verified against klinecharts@10.0.1's own
// `dist/index.esm.js` extension list — name, default `calcParams`, and
// figure count/keys all read directly from source, not assumed). ────────

const BUILTIN_REGISTRY: Record<string, IndicatorMeta> = {
  // Trend — main pane
  MA: {
    name: "MA",
    displayLabel: "MA (Simple)",
    category: "Trend",
    pane: "main",
    defaultParams: [5, 10, 30, 60],
    params: [periodParam("Period 1"), periodParam("Period 2"), periodParam("Period 3"), periodParam("Period 4")],
    description: "Simple moving average — the average close over the last N bars, smooths price to show trend direction.",
    isCustom: false
  },
  EMA: {
    name: "EMA",
    category: "Trend",
    pane: "main",
    defaultParams: [6, 12, 20],
    params: [periodParam("Period 1"), periodParam("Period 2"), periodParam("Period 3")],
    description: "Exponential moving average — like MA but weights recent bars more heavily, reacts faster to new price moves.",
    isCustom: false
  },
  SMA: {
    name: "SMA",
    displayLabel: "SMMA (Smoothed)",
    category: "Trend",
    pane: "main",
    defaultParams: [12, 2],
    params: [periodParam("Period"), periodParam("Weight", 1, 20)],
    description: "Smoothed moving average with adjustable weighting — a slower, more heavily-smoothed cousin of EMA.",
    isCustom: false
  },
  BBI: {
    name: "BBI",
    displayLabel: "Bull Bear Index (BBI)",
    category: "Trend",
    pane: "main",
    defaultParams: [3, 6, 12, 24],
    params: [periodParam("Period 1"), periodParam("Period 2"), periodParam("Period 3"), periodParam("Period 4")],
    description: "Bull and Bear Index — the average of four moving averages of different lengths, a single consensus trend line.",
    isCustom: false
  },
  SAR: {
    name: "SAR",
    displayLabel: "Parabolic SAR",
    category: "Trend",
    pane: "main",
    defaultParams: [2, 2, 20],
    params: [periodParam("Start %", 1, 100), periodParam("Step %", 1, 100), periodParam("Max %", 1, 100)],
    description: "Parabolic SAR — dots that flip above/below price at trend reversals, a classic trailing-stop trend indicator.",
    isCustom: false
  },
  DMA: {
    name: "DMA",
    displayLabel: "MA Difference (DMA)",
    category: "Trend",
    pane: "sub",
    defaultParams: [10, 50, 10],
    params: [periodParam("Fast MA"), periodParam("Slow MA"), periodParam("Signal")],
    description: "Difference of moving averages — the gap between a fast and slow MA, smoothed by a signal line; crossovers flag trend changes.",
    isCustom: false
  },
  DMI: {
    name: "DMI",
    /** Founder naming audit 2026-08-04: the Signals table's "ADX(14) [DMI]" rule row votes on this SAME indicator's ADX/+DI/-DI lines — this displayLabel is the family anchor a learner recognizes that row against. See `lib/ta/technicals.ts`'s `ADX_RULE` doc. */
    displayLabel: "DMI / ADX",
    category: "Trend",
    pane: "sub",
    defaultParams: [14, 6],
    params: [periodParam("Period"), periodParam("ADX Period")],
    description: "Directional Movement Index — PDI/MDI show up vs down trend strength, ADX shows overall trend strength regardless of direction.",
    isCustom: false
  },
  TRIX: {
    name: "TRIX",
    category: "Trend",
    pane: "sub",
    defaultParams: [12, 9],
    params: [periodParam("Period"), periodParam("Signal")],
    description: "Triple-smoothed EMA rate of change — filters out short-term noise to isolate the underlying trend.",
    isCustom: false
  },
  // Bands
  BOLL: {
    name: "BOLL",
    displayLabel: "Bollinger Bands",
    category: "Bands",
    pane: "main",
    defaultParams: [20, 2],
    params: [periodParam("Period"), ratioParam("Std Dev", 0.5, 5)],
    description: "Bollinger Bands — a moving average with bands at N standard deviations; price hugging a band signals a strong trend, a pinch signals low volatility.",
    isCustom: false
  },
  // Momentum
  MACD: {
    name: "MACD",
    category: "Momentum",
    pane: "sub",
    defaultParams: [12, 26, 9],
    params: [periodParam("Fast"), periodParam("Slow"), periodParam("Signal")],
    description: "Moving Average Convergence/Divergence — the gap between a fast and slow EMA, with a signal line; the classic trend + momentum combo indicator.",
    isCustom: false
  },
  RSI: {
    name: "RSI",
    category: "Momentum",
    pane: "sub",
    defaultParams: [6, 12, 24],
    params: [periodParam("Period 1"), periodParam("Period 2"), periodParam("Period 3")],
    description: "Relative Strength Index — measures the speed of recent gains vs losses on a 0-100 scale; above 70 = overbought, below 30 = oversold.",
    isCustom: false
  },
  KDJ: {
    name: "KDJ",
    /** Founder naming audit 2026-08-04: "Stochastic" collided across 3 places under different math — this is the
     * klinecharts-NATIVE Stochastic, computed via RSV + recursive weighted smoothing + a J line (`math.ts`'s
     * `stochasticKdj`, verified byte-for-byte against klinecharts' own `kdj.calc`). It is a DIFFERENT formula from
     * `lib/ta/technicals.ts`'s "Stochastic Osc %K(...) (Classic)" rating rule (SMA-smoothed %K/%D, no J line) and
     * from the custom-signal builder's matching entry — see that module's own doc for the full disambiguation. */
    displayLabel: "Stochastic (KDJ)",
    category: "Momentum",
    pane: "sub",
    defaultParams: [9, 3, 3],
    params: [periodParam("Period"), periodParam("K Smoothing", 1, 20), periodParam("D Smoothing", 1, 20)],
    description: "Stochastic oscillator (K/D/J) — compares the close to its recent high-low range; flags overbought/oversold turning points.",
    isCustom: false
  },
  WR: {
    name: "WR",
    displayLabel: "Williams %R (WR)",
    category: "Momentum",
    pane: "sub",
    defaultParams: [6, 10, 14],
    params: [periodParam("Period 1"), periodParam("Period 2"), periodParam("Period 3")],
    description: "Williams %R — an inverted stochastic oscillator on a 0 to -100 scale; below -80 = oversold, above -20 = overbought.",
    isCustom: false
  },
  ROC: {
    name: "ROC",
    category: "Momentum",
    pane: "sub",
    defaultParams: [12, 6],
    params: [periodParam("Period"), periodParam("Signal MA")],
    description: "Rate of Change — percentage price change over N bars; crossing zero flags momentum shifts.",
    isCustom: false
  },
  MTM: {
    name: "MTM",
    displayLabel: "Momentum (MTM)",
    category: "Momentum",
    pane: "sub",
    defaultParams: [12, 6],
    params: [periodParam("Period"), periodParam("Signal MA")],
    description: "Momentum — the raw price change over N bars, with a signal moving average.",
    isCustom: false
  },
  BIAS: {
    name: "BIAS",
    category: "Momentum",
    pane: "sub",
    defaultParams: [6, 12, 24],
    params: [periodParam("Period 1"), periodParam("Period 2"), periodParam("Period 3")],
    description: "Bias — how far (%) the close has strayed from its moving average; extremes often mean-revert.",
    isCustom: false
  },
  PSY: {
    name: "PSY",
    displayLabel: "Psychological Line",
    category: "Momentum",
    pane: "sub",
    defaultParams: [12, 6],
    params: [periodParam("Period"), periodParam("Signal MA")],
    description: "Psychological Line — the percentage of up-days over N bars; extremes suggest crowd over-optimism or over-pessimism.",
    isCustom: false
  },
  AO: {
    name: "AO",
    displayLabel: "Awesome Oscillator (AO)",
    category: "Momentum",
    pane: "sub",
    defaultParams: [5, 34],
    params: [periodParam("Fast"), periodParam("Slow")],
    description: "Awesome Oscillator — the gap between a fast and slow midpoint SMA; a zero-line momentum histogram.",
    isCustom: false
  },
  BRAR: {
    name: "BRAR",
    displayLabel: "BR/AR Sentiment",
    category: "Momentum",
    pane: "sub",
    defaultParams: [26],
    params: [periodParam("Period")],
    description: "BR/AR sentiment pair — AR compares open to high/low, BR compares yesterday's close to today's range; together gauge buying/selling pressure.",
    isCustom: false
  },
  CR: {
    name: "CR",
    displayLabel: "CR Energy",
    category: "Momentum",
    pane: "sub",
    defaultParams: [26, 10, 20, 40, 60],
    params: [periodParam("Period"), periodParam("MA1"), periodParam("MA2"), periodParam("MA3"), periodParam("MA4")],
    description: "Energy/CR indicator — a momentum oscillator centred on 100 with four smoothing lines, popular for spotting overbought/oversold energy.",
    isCustom: false
  },
  // Volatility
  CCI: {
    name: "CCI",
    displayLabel: "Commodity Channel (CCI)",
    category: "Volatility",
    pane: "sub",
    defaultParams: [20],
    params: [periodParam("Period")],
    description: "Commodity Channel Index — measures how far price has strayed from its statistical average; beyond ±100 flags a strong directional move.",
    isCustom: false
  },
  EMV: {
    name: "EMV",
    displayLabel: "Ease of Movement",
    category: "Volatility",
    pane: "sub",
    defaultParams: [14, 9],
    params: [periodParam("Sum Period"), periodParam("Signal MA")],
    description: "Ease of Movement — combines price change and volume to show how easily price is moving; large swings on light volume stand out.",
    isCustom: false,
    premiumDisabled: true
  },
  // Volume
  VOL: {
    name: "VOL",
    category: "Volume",
    pane: "sub",
    defaultParams: [5, 10, 20],
    params: [periodParam("MA1"), periodParam("MA2"), periodParam("MA3")],
    description: "Volume — traded volume per bar with up to three volume moving averages overlaid.",
    isCustom: false,
    premiumDisabled: true
  },
  OBV: {
    name: "OBV",
    displayLabel: "On-Balance Volume",
    category: "Volume",
    pane: "sub",
    defaultParams: [30],
    params: [periodParam("Signal MA")],
    description: "On-Balance Volume — a running total that adds volume on up-closes and subtracts on down-closes; divergence from price often precedes reversals.",
    isCustom: false,
    premiumDisabled: true
  },
  PVT: {
    name: "PVT",
    displayLabel: "Price-Volume Trend",
    category: "Volume",
    pane: "sub",
    defaultParams: [],
    params: [],
    description: "Price and Volume Trend — a running total of volume scaled by percentage price change; a volume-weighted momentum line.",
    isCustom: false,
    premiumDisabled: true
  },
  VR: {
    name: "VR",
    displayLabel: "Volume Ratio (VR)",
    category: "Volume",
    pane: "sub",
    defaultParams: [26, 6],
    params: [periodParam("Period"), periodParam("Signal MA")],
    description: "Volume Ratio — the ratio of up-day volume to down-day volume; extremes flag exhaustion.",
    isCustom: false,
    premiumDisabled: true
  },
  AVP: {
    name: "AVP",
    displayLabel: "Avg Price (AVP)",
    category: "Volume",
    pane: "main",
    defaultParams: [],
    params: [],
    description: "Average Price — cumulative turnover divided by cumulative volume, the running volume-weighted average price since the start of the loaded data.",
    isCustom: false,
    premiumDisabled: true
  }
};

// ── 14 custom indicators (`custom-indicators/pack-a.ts` main-pane-heavy,
// `pack-b.ts` sub-pane) — all filed under a single "Custom" category tab
// per the plan's own dialog spec ("+ the 14 customs below in a Custom
// category").
//
// **S3 orchestrator correction**: WMA/VWMA/HMA were placed in the SUB pane
// by S2's brief (see `project_ta_suite_s2` memory's own "Deviations
// flagged" note — implemented literally per that sprint's explicit,
// twice-stated instruction even though these three are conventionally
// MAIN-pane price overlays everywhere else). S3's brief corrects this: they
// belong on the main pane like every other moving-average indicator here
// (MA/EMA/SMA/BBI/SUPERTREND/KELTNER/DONCHIAN all `pane: "main"`). Their
// klinecharts `IndicatorTemplate`s in `custom-indicators/pack-b.ts` are
// UNCHANGED (a bare price-line figure works identically in either pane —
// pane placement is entirely a `createIndicator({paneId})` concern on the
// caller side, see `kline-chart.tsx`'s `syncIndicatorInstances`), only the
// `pane` field below moves. `indicator-registry.ts`'s own
// `migrateStoredSelection()` reclassifies any OLD `pf.workbench.indicators`
// blob that still has these three filed under `sub` — moved to `main` on
// restore, never dropped (a stored instance surviving a pane reassignment
// is exactly what `reclassifyByPane()` below exists for). ───────────────

const CUSTOM_REGISTRY: Record<string, IndicatorMeta> = {
  ICHIMOKU: {
    name: "ICHIMOKU",
    displayLabel: "Ichimoku Cloud",
    category: "Custom",
    pane: "main",
    defaultParams: [9, 26, 52],
    params: [periodParam("Conversion (Tenkan)"), periodParam("Base (Kijun)"), periodParam("Leading Span B")],
    description: "Ichimoku Cloud — a multi-line trend system: conversion/base line cross for signals, a forward-shifted cloud shows support/resistance, cloud color shows trend bias.",
    isCustom: true
  },
  SUPERTREND: {
    name: "SUPERTREND",
    displayLabel: "SuperTrend",
    category: "Custom",
    pane: "main",
    defaultParams: [10, 3],
    params: [periodParam("ATR Period"), ratioParam("Multiplier", 0.5, 10)],
    description: "SuperTrend — an ATR-based trailing stop-and-reverse line; flips above/below price (and changes color) at trend reversals.",
    isCustom: true
  },
  VWAP: {
    name: "VWAP",
    displayLabel: "VWAP (Session)",
    category: "Custom",
    pane: "main",
    defaultParams: [],
    params: [],
    description: "Volume Weighted Average Price — the running average price weighted by volume since the start of the trading session; resets each session, a key intraday fair-value reference.",
    isCustom: true,
    premiumDisabled: true,
    intervalDisabled: (interval) => interval === "1d"
  },
  KELTNER: {
    name: "KELTNER",
    displayLabel: "Keltner Channels",
    category: "Custom",
    pane: "main",
    defaultParams: [20, 2],
    params: [periodParam("EMA Period"), ratioParam("ATR Multiplier", 0.5, 10)],
    description: "Keltner Channel — an EMA with bands at N × ATR; similar to Bollinger Bands but volatility-based on ATR instead of standard deviation.",
    isCustom: true
  },
  DONCHIAN: {
    name: "DONCHIAN",
    displayLabel: "Donchian Channels",
    category: "Custom",
    pane: "main",
    defaultParams: [20],
    params: [periodParam("Period")],
    description: "Donchian Channel — plots the highest high and lowest low over N bars; a breakout above/below the channel is a classic trend-following signal.",
    isCustom: true
  },
  PIVOTS: {
    name: "PIVOTS",
    displayLabel: "Pivot Points",
    category: "Custom",
    pane: "main",
    defaultParams: [],
    params: [],
    description: "Pivot Points — classic support/resistance levels from the prior session's high/low/close (weekly, on daily charts).",
    isCustom: true
  },
  ATRX: {
    name: "ATRX",
    displayLabel: "ATR",
    category: "Custom",
    pane: "sub",
    defaultParams: [14],
    params: [periodParam("Period")],
    description: "Average True Range — the average daily trading range (gap-adjusted); a pure volatility gauge, higher = choppier/wider bars.",
    isCustom: true
  },
  STOCHRSI: {
    name: "STOCHRSI",
    /** Founder naming audit 2026-08-04: part of the "Stochastic" family disambiguation — this is Stochastic
     * applied to RSI values instead of price, a third distinct member alongside "Stochastic (KDJ)" and the
     * Signals table's "Stochastic Osc %K(...) (Classic)" rule. See `KDJ`'s own displayLabel doc above. */
    displayLabel: "Stochastic RSI",
    category: "Custom",
    pane: "sub",
    defaultParams: [14, 14, 3, 3],
    params: [periodParam("RSI Period"), periodParam("Stoch Period"), periodParam("K Smoothing", 1, 20), periodParam("D Smoothing", 1, 20)],
    description: "Stochastic RSI — applies the stochastic formula to RSI instead of price; a faster, more sensitive overbought/oversold signal than plain RSI.",
    isCustom: true
  },
  WMA: {
    name: "WMA",
    displayLabel: "Weighted MA (WMA)",
    category: "Custom",
    pane: "main",
    defaultParams: [20],
    params: [periodParam("Period")],
    description: "Weighted Moving Average — like a simple moving average but weights recent bars more heavily than a plain SMA (though less aggressively than EMA).",
    isCustom: true
  },
  VWMA: {
    name: "VWMA",
    displayLabel: "Vol-Weighted MA (VWMA)",
    category: "Custom",
    pane: "main",
    defaultParams: [20],
    params: [periodParam("Period")],
    description: "Volume Weighted Moving Average — a moving average weighted by each bar's volume, so high-volume bars pull the average more than low-volume ones.",
    isCustom: true,
    premiumDisabled: true
  },
  HMA: {
    name: "HMA",
    displayLabel: "Hull MA (HMA)",
    category: "Custom",
    pane: "main",
    defaultParams: [9],
    params: [periodParam("Period")],
    description: "Hull Moving Average — a fast, low-lag moving average built from weighted averages; hugs price more closely than a plain MA of the same length.",
    isCustom: true
  },
  MFI: {
    name: "MFI",
    displayLabel: "Money Flow (MFI)",
    category: "Custom",
    pane: "sub",
    defaultParams: [14],
    params: [periodParam("Period")],
    description: "MFI — volume-weighted RSI, flags overbought/oversold with volume confirmation.",
    isCustom: true,
    premiumDisabled: true
  },
  CMF: {
    name: "CMF",
    displayLabel: "Chaikin Money Flow",
    category: "Custom",
    pane: "sub",
    defaultParams: [20],
    params: [periodParam("Period")],
    description: "Chaikin Money Flow — measures buying vs selling pressure using price location within each bar's range, weighted by volume.",
    isCustom: true,
    premiumDisabled: true
  },
  AROON: {
    name: "AROON",
    category: "Custom",
    pane: "sub",
    defaultParams: [25],
    params: [periodParam("Period")],
    description: "Aroon — measures how many bars since the most recent high/low over N bars; crossovers flag new trends emerging.",
    isCustom: true
  }
};

export const INDICATOR_REGISTRY: Record<string, IndicatorMeta> = { ...BUILTIN_REGISTRY, ...CUSTOM_REGISTRY };

export const CUSTOM_INDICATOR_NAMES: readonly string[] = Object.keys(CUSTOM_REGISTRY);

/** T5 — the exact 10-name premium-disabled set the brief names verbatim: `VOL, OBV, PVT, EMV, VR, AVP, VWAP, VWMA, MFI, CMF`. Derived from the registry's own `premiumDisabled` flags rather than hardcoded twice, so the two can never drift apart. */
export const PREMIUM_DISABLED_NAMES: readonly string[] = Object.values(INDICATOR_REGISTRY)
  .filter((m) => m.premiumDisabled)
  .map((m) => m.name);

export function getIndicatorMeta(name: string): IndicatorMeta | undefined {
  return INDICATOR_REGISTRY[name];
}

/** Combined T5 gate: premium mode (any premium-disabled indicator) OR an indicator-specific interval gate (currently only VWAP on `1d`) — both independent, either one disallows. */
export function isIndicatorAllowed(name: string, opts: { mode: "spot" | "premium"; interval: string }): boolean {
  const meta = getIndicatorMeta(name);
  if (!meta) return false;
  if (opts.mode === "premium" && meta.premiumDisabled) return false;
  if (meta.intervalDisabled?.(opts.interval)) return false;
  return true;
}

// ── Instance id + param clamping ─────────────────────────────────────────

let instanceCounter = 0;
export function createInstanceId(name: string): string {
  instanceCounter += 1;
  const rand = typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID().slice(0, 8) : Math.random().toString(36).slice(2, 10);
  return `${name}__${rand}${instanceCounter}`;
}

/** Clamps each param to its registry-declared `[min, max]` — the settings popover's "out-of-range input clamps rather than crashing/no-oping" requirement. Extra/missing params (a corrupted or future-incompatible blob) are truncated/padded from `defaultParams`. */
export function clampParams(name: string, params: number[]): number[] {
  const meta = getIndicatorMeta(name);
  if (!meta) return params;
  return meta.params.map((spec, i) => {
    const raw = params[i];
    const value = Number.isFinite(raw) ? raw : meta.defaultParams[i];
    return Math.min(spec.max, Math.max(spec.min, value));
  });
}

export function resolveParams(instance: IndicatorInstance): number[] {
  const meta = getIndicatorMeta(instance.name);
  if (instance.params && instance.params.length > 0) return clampParams(instance.name, instance.params);
  return meta?.defaultParams ?? [];
}

/**
 * A short label for the active-indicator strip row, e.g. `MA (5,10,30)` or
 * `VWAP (Session)` for a param-less indicator.
 *
 * **Naming audit fix (2026-08-04)**: this used to interpolate the raw
 * registry `name` (`instance.name`) — e.g. `KDJ (9,3,3)` or `SMA (12,2)` —
 * even though every OTHER label in the workbench (the dialog row, the
 * settings-popover title, both `aria-label`s on this same strip row's own
 * gear/remove buttons) already went through `indicatorDisplayName()`. A
 * user would see the settings popover titled "Stochastic (KDJ) settings"
 * but the row it opened from still said bare "KDJ" — same bug class as the
 * SMA/SMMA collision `kline-chart.tsx`'s on-chart legend override already
 * fixed, just in a different component. Now routes through the same
 * `indicatorDisplayName()` every other surface uses, so the strip's
 * headline text can never drift from its own gear/remove `aria-label`s
 * again.
 */
export function formatInstanceLabel(instance: IndicatorInstance): string {
  const params = resolveParams(instance);
  const label = indicatorDisplayName(instance.name);
  return params.length > 0 ? `${label} (${params.join(",")})` : label;
}

// ── localStorage v1 → v2 migration ───────────────────────────────────────

export const INDICATOR_STORAGE_KEY = "pf.workbench.indicators";
const STORAGE_VERSION = 2;

interface StoredSelectionV2 {
  v: 2;
  main: Array<{ name: string; params?: number[]; styles?: { lines?: Array<LineStyleOverride | null> } }>;
  sub: Array<{ name: string; params?: number[]; styles?: { lines?: Array<LineStyleOverride | null> } }>;
}

/**
 * Founder bug fix (2026-08-04) — additive v2 field, not a new storage
 * version: an older `pf.workbench.indicators` blob written before this pass
 * simply lacks `styles` on every row, which `toInstances` below already
 * treats as "no overrides" (the same `undefined`-is-fine contract
 * `IndicatorInstance.styles` itself documents) — no version bump, no
 * separate migration branch needed. Defensive against a corrupted/
 * hand-edited blob: a non-array `lines`, or a non-object/malformed entry,
 * is dropped rather than trusted raw (same posture as `clampParams` for the
 * sibling `params` field).
 */
function sanitizeStoredLineStyles(raw: unknown): Array<LineStyleOverride | null> | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const lines = (raw as { lines?: unknown }).lines;
  if (!Array.isArray(lines)) return undefined;
  const sanitized: Array<LineStyleOverride | null> = lines.map((entry) => {
    if (!entry || typeof entry !== "object") return null;
    const e = entry as Record<string, unknown>;
    const override: LineStyleOverride = {};
    if (typeof e.color === "string") override.color = e.color;
    if (typeof e.size === "number" && Number.isFinite(e.size)) override.size = e.size;
    return override.color !== undefined || override.size !== undefined ? override : null;
  });
  return sanitized.some((e) => e !== null) ? sanitized : undefined;
}

function isV1Shape(v: unknown): v is { main: string[]; sub: string[] } {
  if (!v || typeof v !== "object") return false;
  const s = v as Record<string, unknown>;
  return Array.isArray(s.main) && s.main.every((n) => typeof n === "string") && Array.isArray(s.sub) && s.sub.every((n) => typeof n === "string");
}

/**
 * S3 orchestrator correction — reclassifies every instance in a freshly-read
 * selection by its CURRENT `INDICATOR_REGISTRY[name].pane` value, moving any
 * instance filed under the "wrong" list into the right one. This is what
 * makes the WMA/VWMA/HMA main-pane move safe for a pre-existing
 * `pf.workbench.indicators` blob written while they were still `pane:
 * "sub"`: those rows are stored under `sub` in `localStorage`, but the
 * moment this build reads them back they're moved to `main` — never
 * dropped, never left stranded under the wrong pane's array (which would
 * desync from `kline-chart.tsx`'s `syncIndicatorInstances({paneId:
 * MAIN_PANE_ID})` call for `mainIndicators`). Applied at the END of both
 * migration branches below (v1 and v2), so it's a single, name-agnostic
 * safety net that would also cover any FUTURE pane reassignment the same
 * way, not a one-off WMA/VWMA/HMA special case.
 */
function reclassifyByPane(selection: IndicatorSelection): IndicatorSelection {
  const main: IndicatorInstance[] = [];
  const sub: IndicatorInstance[] = [];
  for (const instance of [...selection.main, ...selection.sub]) {
    const meta = getIndicatorMeta(instance.name);
    if (meta?.pane === "sub") sub.push(instance);
    else main.push(instance); // unknown name (already filtered out by the caller) or `pane: "main"`.
  }
  return { main, sub: sub.slice(0, MAX_SUB_PANE_INSTANCES) };
}

function isV2Shape(v: unknown): v is StoredSelectionV2 {
  if (!v || typeof v !== "object") return false;
  const s = v as Record<string, unknown>;
  return s.v === 2 && Array.isArray(s.main) && Array.isArray(s.sub);
}

/**
 * Reads a raw `localStorage` value in EITHER the v1 shape
 * (`{main: string[], sub: string[]}`, `indicator-picker.tsx`'s original
 * format) or the v2 shape (`{v:2, main: [{name, params?}], sub: [...]}`),
 * always returning a fresh `IndicatorSelection` with brand-new
 * `instanceId`s (an id is a runtime/session concept, never persisted —
 * persisting it would be pointless since a reload always re-mounts fresh
 * klinecharts indicator instances anyway). Unknown indicator names (a
 * future build removing/renaming one) are DROPPED, not rendered broken.
 * `sub` is clamped to `MAX_SUB_PANE_INSTANCES` even on a v2 blob, in case a
 * stale/corrupted blob somehow exceeds it (defensive — the live UI itself
 * never lets this happen going forward).
 */
export function migrateStoredSelection(raw: unknown): IndicatorSelection | null {
  if (isV2Shape(raw)) {
    const toInstances = (rows: StoredSelectionV2["main"]): IndicatorInstance[] =>
      rows
        .filter((r) => typeof r?.name === "string" && r.name in INDICATOR_REGISTRY)
        .map((r) => {
          const lines = sanitizeStoredLineStyles(r.styles);
          return {
            instanceId: createInstanceId(r.name),
            name: r.name,
            params: Array.isArray(r.params) && r.params.every((p) => typeof p === "number") ? clampParams(r.name, r.params) : undefined,
            ...(lines ? { styles: { lines } } : {})
          };
        });
    return reclassifyByPane({ main: toInstances(raw.main), sub: toInstances(raw.sub) });
  }
  if (isV1Shape(raw)) {
    const toInstances = (names: string[]): IndicatorInstance[] =>
      names.filter((n) => n in INDICATOR_REGISTRY).map((n) => ({ instanceId: createInstanceId(n), name: n }));
    return reclassifyByPane({ main: toInstances(raw.main), sub: toInstances(raw.sub) });
  }
  return null;
}

function serializeInstance(i: IndicatorInstance): StoredSelectionV2["main"][number] {
  const lines = i.styles?.lines;
  const hasOverride = Array.isArray(lines) && lines.some((e) => e !== null && e !== undefined);
  return {
    name: i.name,
    ...(i.params ? { params: i.params } : {}),
    ...(hasOverride ? { styles: { lines } } : {})
  };
}

/** Always writes v2 going forward — v1 is read-only-compatible, never re-written. */
export function serializeSelection(selection: IndicatorSelection): string {
  const stored: StoredSelectionV2 = {
    v: STORAGE_VERSION,
    main: selection.main.map(serializeInstance),
    sub: selection.sub.map(serializeInstance)
  };
  return JSON.stringify(stored);
}

export function loadStoredSelection(): IndicatorSelection | null {
  try {
    const raw = window.localStorage.getItem(INDICATOR_STORAGE_KEY);
    if (!raw) return null;
    return migrateStoredSelection(JSON.parse(raw) as unknown);
  } catch {
    return null; // private mode / storage disabled / corrupt value.
  }
}

export function saveStoredSelection(selection: IndicatorSelection): void {
  try {
    window.localStorage.setItem(INDICATOR_STORAGE_KEY, serializeSelection(selection));
  } catch {
    // Preference just won't survive the refresh.
  }
}

/** T5 — strips any instance the current `mode`/`interval` disallows (dual VWAP gate, premium volume-set) and reclamps the sub cap. Applied on restore AND whenever `mode`/`interval` changes underneath an already-open workbench. */
export function sanitizeSelectionForMode(selection: IndicatorSelection, opts: { mode: "spot" | "premium"; interval: string }): IndicatorSelection {
  const filterFn = (i: IndicatorInstance) => isIndicatorAllowed(i.name, opts);
  return { main: selection.main.filter(filterFn), sub: selection.sub.filter(filterFn).slice(0, MAX_SUB_PANE_INSTANCES) };
}

/** Display name for an indicator registry key — `displayLabel` when set (the SMA/SMMA disambiguation), else the key itself. */
export function indicatorDisplayName(name: string): string {
  const meta = (INDICATOR_REGISTRY as Record<string, IndicatorMeta | undefined>)[name];
  return meta?.displayLabel ?? name;
}
