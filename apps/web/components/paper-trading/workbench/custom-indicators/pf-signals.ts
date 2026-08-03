/**
 * TA Suite Sprint S3, T2 — `PF_SIGNALS`: a registered klinecharts indicator
 * (plan D8) that paints strategy entry/exit markers on the MAIN pane.
 * `calc` recomputes signals from `calcParams: [strategyId, ...params]` via
 * `lib/ta/strategies.ts`'s `getStrategyDef`/`resolveStrategyParams` —
 * the EXACT SAME `compute()` `lib/ta/backtest.ts`'s `runBacktest()` consumes
 * (via `strategy-panel.tsx`, which calls both against the same signal
 * array), so what this indicator visually plots on the chart is provably
 * the same signal set the stats card's numbers were computed from, not a
 * second hand-synced implementation. Registered separately from
 * `custom-indicators/index.ts`'s `registerPackA`/`registerPackB` (S2) —
 * `PF_SIGNALS` is NOT a user-browsable entry in `indicator-registry.ts`'s
 * `INDICATOR_REGISTRY` (the indicator-dialog catalog); it's a single,
 * strategy-panel-managed instance, wired directly from `kline-chart.tsx`'s
 * own `signalsConfig` prop/effect.
 *
 * **Why the markers are non-interactive "for free"** (the T2 acceptance
 * criterion the brief calls out explicitly as a real, easy-to-hit
 * regression risk otherwise): this file paints EVERYTHING inside `draw()`
 * with raw `CanvasRenderingContext2D` calls, `figures: []` (empty — no
 * default figure-render fallback ever runs, `draw()` returns `true`/
 * `isCover`). Verified against `IndicatorView.prototype.drawImp`
 * (`dist/index.esm.js:7877-7911`, same source read S2's `project_ta_suite_s2`
 * memory already cites for indicator internals): an indicator's `draw()` is
 * called for its `ctx` side effect ONLY — its return value only decides
 * whether `figures[]` ALSO renders afterward, nothing about `draw()` (or
 * `figures[]`, for that matter) ever registers a click/drag hit-test target
 * anywhere in klinecharts core. Interactive hit-testing for THIS chart
 * lives entirely in two OTHER, disjoint code paths: `OverlayView`/
 * `_chartStore`'s overlay list (S1's drawing tools AND `order-line-
 * overlay.ts`'s draggable order lines, both `createOverlay`-based) and the
 * chart's own raw `click` DOM listener (`kline-chart.tsx`'s
 * `handleClick`, click-to-trade). An indicator's `draw()` painting pixels
 * on the SAME canvas as those two systems cannot intercept a click meant
 * for either — there is no shared event-dispatch path between them to
 * intercept THROUGH. This is a structural (not merely tested-and-observed)
 * guarantee, verified by reading the source rather than assumed.
 */
import type { IndicatorTemplate } from "klinecharts";
import { registerIndicator } from "klinecharts";

import { getStrategyDef, resolveStrategyParams, type StrategyCandle, type StrategySide, type StrategySignal } from "@/lib/ta/strategies";
import { SCRIPT_SENTINEL } from "@/lib/ta/user-scripts";

interface PfSignalPoint {
  side?: StrategySide;
  price?: number;
}

const MARKER_HALF_WIDTH = 5;
const MARKER_HEIGHT = 8;
const MARKER_GAP = 6;
const BUY_COLOR = "#10b981";
const SELL_COLOR = "#f43f5e";

/** The klinecharts-registered indicator name AND the fixed `createIndicator({id})` this sprint always uses — a single, strategy-panel-managed instance, never multi-instance like `indicator-registry.ts`'s `IndicatorInstance`s. Exported so `kline-chart.tsx`'s sync effect and `chart-workbench.tsx` never hand-type the string twice. */
export const PF_SIGNALS_NAME = "PF_SIGNALS";
export const PF_SIGNALS_INSTANCE_ID = "pf_signals_instance";

/**
 * User Strategy Scripting (SS1), D9 — the reserved `calcParams[0]` value
 * that routes `calc()` into the PRECOMPUTED branch instead of the template
 * (`STRATEGY_REGISTRY`) branch. `calcParams` is typed `(string |
 * number)[]` (see `IndicatorTemplate<PfSignalPoint, string | number,
 * unknown>` above) — a script's resolved `StrategySignal[]` can't ride
 * inside it directly, so instead `calcParams` carries this sentinel +
 * a `runToken` (a fresh opaque string per run), and the actual signals live
 * in the module-level store below, set via `setPrecomputedScriptSignals`
 * BEFORE the sentinel-keyed `calcParams` is ever applied to the chart.
 * Defined in `lib/ta/user-scripts.ts` (a pure module) and re-exported here
 * so `lib/ta/selfcheck.ts` can assert `SCRIPT_SENTINEL` is never a
 * `STRATEGY_REGISTRY` key without pulling `klinecharts` into a plain `tsx`
 * Node run — see that file's own doc comment on this constant.
 */
export { SCRIPT_SENTINEL };

/**
 * At most ONE entry — the most recent run's signals — never an
 * accumulating map. Repeated Run clicks (SS2's editor) must not leak
 * memory: each call to `setPrecomputedScriptSignals` REPLACES this store's
 * single entry outright.
 */
let precomputedScriptSignals: { runToken: string; signals: readonly StrategySignal[] } | null = null;

/** Sets the single precomputed-signals entry for `PF_SIGNALS`'s script branch. Called by the (SS2) editor's Run flow BEFORE `kline-chart.tsx`'s sync effect applies `calcParams: [SCRIPT_SENTINEL, runToken]` — see this file's module doc and `kline-chart.tsx`'s own `PfSignalsConfig` doc for the full ordering contract. */
export function setPrecomputedScriptSignals(runToken: string, signals: readonly StrategySignal[]): void {
  precomputedScriptSignals = { runToken, signals };
}

function getPrecomputedScriptSignals(runToken: string): readonly StrategySignal[] | undefined {
  return precomputedScriptSignals?.runToken === runToken ? precomputedScriptSignals.signals : undefined;
}

export const pfSignals: IndicatorTemplate<PfSignalPoint, string | number, unknown> = {
  name: PF_SIGNALS_NAME,
  shortName: "Strategy Signals",
  series: "price",
  precision: 2,
  shouldOhlc: true,
  // Painted after every other main-pane indicator (MA/EMA/SUPERTREND/etc. all default zLevel 0) and after
  // candles themselves — "zLevel above candles" per the brief, so a marker is never hidden underneath a
  // moving-average line or a candle wick sharing the same pixel.
  zLevel: 10,
  calcParams: [],
  figures: [], // fully custom-painted in draw() below — see module doc for why this is what makes markers non-interactive.
  calc: (dataList, indicator) => {
    // User Strategy Scripting (SS1), D9 — precomputed-script branch, checked
    // FIRST. Everything from `const [strategyId, ...rawParams]` below this
    // block is the pre-SS1 template branch, untouched (byte-identical,
    // verified by diff).
    if (indicator.calcParams[0] === SCRIPT_SENTINEL) {
      const runToken = indicator.calcParams[1] !== undefined ? String(indicator.calcParams[1]) : undefined;
      const scriptSignals = runToken !== undefined ? getPrecomputedScriptSignals(runToken) : undefined;
      const byScriptSignalIndex = new Map((scriptSignals ?? []).map((s) => [s.index, s]));
      return dataList.map((_, i) => {
        const s = byScriptSignalIndex.get(i);
        return s ? { side: s.side, price: s.price } : {};
      });
    }
    const [strategyId, ...rawParams] = indicator.calcParams;
    const def = strategyId !== undefined ? getStrategyDef(String(strategyId)) : undefined;
    if (!def) return dataList.map(() => ({}));
    const params = resolveStrategyParams(def, (rawParams as number[]) ?? []);
    // `dataList` (klinecharts KLineData[]) is structurally compatible with StrategyCandle[] — see
    // pf-signals.ts's own StrategyCandle import doc and strategies.ts's module comment on why lib/ta/ stays
    // klinecharts-import-free while still accepting this shape directly, no cast needed.
    const signals = def.compute(dataList as unknown as StrategyCandle[], params);
    const bySignalIndex = new Map(signals.map((s) => [s.index, s]));
    return dataList.map((_, i) => {
      const s = bySignalIndex.get(i);
      return s ? { side: s.side, price: s.price } : {};
    });
  },
  createTooltipDataSource: ({ indicator, crosshair }) => {
    const dataIndex = crosshair.dataIndex ?? 0;
    const p = (indicator.result[dataIndex] ?? {}) as PfSignalPoint;
    if (!p.side) return { name: "Strategy Signals", calcParamsText: "", features: [], legends: [] };
    return {
      name: "Strategy Signals",
      calcParamsText: "",
      features: [],
      legends: [{ title: `${p.side}: `, value: p.price !== undefined ? p.price.toFixed(indicator.precision) : "-" }]
    };
  },
  draw: ({ ctx, chart, indicator, bounding, xAxis, yAxis }) => {
    const dataList = chart.getDataList() as StrategyCandle[];
    const result = indicator.result as PfSignalPoint[];
    ctx.save();
    ctx.textAlign = "center";
    ctx.font = "10px sans-serif";
    for (let i = 0; i < result.length; i++) {
      const point = result[i];
      const bar = dataList[i];
      if (!point?.side || !bar) continue;
      const x = xAxis.convertToPixel(i);
      if (x < -20 || x > bounding.width + 20) continue; // cheap perf cull, matches the ICHIMOKU draw()'s own bounds guard.
      const isBuy = point.side === "BUY";
      const color = isBuy ? BUY_COLOR : SELL_COLOR;
      const anchorY = yAxis.convertToPixel(isBuy ? bar.low : bar.high);
      const y = isBuy ? anchorY + MARKER_GAP : anchorY - MARKER_GAP;

      ctx.beginPath();
      if (isBuy) {
        // Upward-pointing triangle BELOW the bar's low.
        ctx.moveTo(x, y - MARKER_HEIGHT);
        ctx.lineTo(x - MARKER_HALF_WIDTH, y);
        ctx.lineTo(x + MARKER_HALF_WIDTH, y);
      } else {
        // Downward-pointing triangle ABOVE the bar's high.
        ctx.moveTo(x, y + MARKER_HEIGHT);
        ctx.lineTo(x - MARKER_HALF_WIDTH, y);
        ctx.lineTo(x + MARKER_HALF_WIDTH, y);
      }
      ctx.closePath();
      ctx.fillStyle = color;
      ctx.fill();
      ctx.fillText(isBuy ? "BUY" : "SELL", x, isBuy ? y + 12 : y - 12);
    }
    ctx.restore();
    return true; // isCover — skip the default figures[] render (figures[] is empty anyway, belt-and-suspenders).
  }
};

let registered = false;
export function registerPfSignals(): void {
  if (registered) return;
  registered = true;
  registerIndicator(pfSignals);
}
