"use client";

/**
 * Charting Workbench (W2, T1; TA Suite Sprint S1 widens the drawings/
 * styles surface — T5/T7) — the imperative KLineCharts wrapper.
 *
 * House render-loop law (see [[project_chart_trading_sl_tp_program]]'s
 * documented incident: an object-identity-keyed effect in price-chart.tsx
 * once froze a tab): `init()` runs exactly ONCE in a mount effect, the chart
 * instance lives in a ref, EVERY callback prop is read through a ref inside
 * KLineCharts' own event handlers, and no effect here is keyed on an object
 * identity that a parent recreates every render (`candles`, `orderLines`,
 * `mainIndicators`/`subIndicators` arrays) — each data-bearing effect below
 * is keyed on primitive values derived FROM those objects instead.
 *
 * Real klinecharts v10.0.1 API note (verified against the installed
 * package's own `dist/index.d.ts`, NOT assumed from the founder plan's
 * prose): v10 removed the `applyNewData`/`updateData` methods the plan
 * describes by name — v9's imperative push API doesn't exist in the
 * released v10. Data now flows through `chart.setDataLoader({getBars,
 * subscribeBar, unsubscribeBar})`, a pull/push model: the chart calls
 * `getBars` itself (on init, and whenever `setSymbol`/`setPeriod` change)
 * to request a full dataset, and a DataLoader can separately push single
 * live bars through `subscribeBar`'s callback. This file's PUBLIC prop API
 * still matches the plan's literal intent exactly — a plain `candles: Candle[]`
 * array prop, standalone-testable — the DataLoader is purely an internal
 * bridge: `getBars` always answers from `candlesRef.current` (kept fresh by
 * the data-change effect below), and the "full reload vs tail-advance"
 * distinction the plan calls `applyNewData` vs `updateData` is reproduced as
 * "call `setPeriod` again to force a fresh `getBars` pull" vs "push just the
 * last bar through the `subscribeBar` channel."
 *
 * **TA Suite Sprint S1 — the persistedId side-channel + simpleAnnotation
 * fix (T5).** Every drawing overlay used to carry `extendData:
 * {persistedId}` as an OBJECT, uniformly. That's harmless for every overlay
 * EXCEPT the built-in `simpleAnnotation`, whose own `createPointFigures`
 * (baked into klinecharts core, `dist/index.esm.js:12309-12326`) reads
 * `overlay.extendData` DIRECTLY as display text — an object gets
 * coerced to `"[object Object]"` by the canvas text draw. klinecharts
 * ALSO supports `extendData` as a FUNCTION, `(overlay) => text` — that's
 * the mechanism used below, but ONLY for `simpleAnnotation` (the one
 * built-in that actually reads it): its `extendData` is a closure that
 * renders `resolvePfContent(overlay.styles).text`, real content the D1
 * `styles.pfContent` channel already carries for every other annotation
 * tool. To make `getPersistedId()` keep working UNIFORMLY across every
 * overlay type (including `simpleAnnotation`, which no longer carries an
 * object `extendData` at all) rather than special-casing the read path,
 * persistedId now lives in `overlayIdToPersistedIdRef` — an id-KEYED
 * side-map maintained alongside `drawingOverlayIdsRef`/`hydratedRowIdsRef`
 * — instead of being read off `extendData`. Every other overlay type
 * simply doesn't set `extendData` at all any more (it was only ever used
 * for this one purpose).
 *
 * **Founder feedback (2026-08-04) — Part 1, the on-chart indicator legend +
 * crosshair-follow.** Two separate, independently-verified mechanisms (both
 * against `dist/index.d.ts`/`dist/index.esm.js`, see `custom-indicators/
 * tooltip-features.ts`'s own doc for the feature-click path):
 *   1. klinecharts' OWN per-pane top-left indicator tooltip (name(params) +
 *      one colored legend row per `figures[]` entry that has a `title`,
 *      reading `result[crosshair.dataIndex]`) is a DEFAULT, already-working
 *      mechanism -- `styles.indicator.tooltip.showRule` defaults to
 *      `"always"` and an unset crosshair resolves to the LAST bar
 *      (`StoreImp.prototype.setCrosshair`'s own `{}` branch), so every
 *      custom indicator whose figures already declare `title` (all of them
 *      except `PF_SIGNALS`, which is deliberately non-interactive/legend-
 *      less -- see that file) gets TradingView's on-chart legend for FREE,
 *      with zero extra code. This file's only additions are the
 *      interactive eye/gear/remove ICONS (`WORKBENCH_THEME`'s new
 *      `indicator.tooltip.features` below -- `TooltipFeatureStyle[]` is a
 *      REAL click path, not render-only, confirmed by reading
 *      `IndicatorTooltipView.prototype.drawStandardTooltipFeatures`'s own
 *      `_featureClickEvent` -> `executeAction('onIndicatorTooltipFeatureClick',
 *      ...)` call) and the click handler that answers them, below.
 *   2. The DETACHED strip (`indicator-active-strip.tsx`, rendered by
 *      `chart-workbench.tsx`) has no such native mechanism -- it's a plain
 *      DOM row outside the canvas -- so THIS file subscribes to
 *      `chart.subscribeAction('onCrosshairChange', ...)` itself and lifts
 *      the hovered `dataIndex` out via the new `onCrosshairDataIndexChange`
 *      prop, rAF-throttled. A verified, load-bearing gotcha: the payload
 *      that action callback receives is NOT the fully-resolved crosshair --
 *      `StoreImp.prototype.setCrosshair` calls `this.executeAction
 *      ('onCrosshairChange', crosshair)` using its OWN raw input parameter
 *      (`{x, y, paneId}`, exactly what `Event.prototype.mouseMoveEvent`
 *      passes in for the main pane), never the internally-resolved
 *      `this._crosshair` (which DOES carry `dataIndex`/`kLineData` but is
 *      not reachable from the public `Chart`/`Store` API at all -- no
 *      `getCrosshair` method exists on either public interface). This file
 *      re-derives `dataIndex` itself via `chart.convertFromPixel([{x}],
 *      {paneId})` (verified: `ChartImp.prototype.convertFromPixel` DOES
 *      populate `point.dataIndex` via `xAxis.convertFromPixel` = the same
 *      `coordinateToDataIndex` the internal resolution path uses -- an
 *      exact, public-API equivalent). A SEPARATE, real gotcha: klinecharts'
 *      own `mouseleave` clear (`setCrosshair()` with no args) does NOT fire
 *      the action at all (`isString(this._crosshair.paneId)` gate fails on
 *      the cleared `{}` crosshair) -- so this file adds its OWN `mouseleave`
 *      listener on the container to null out the hover state, independent
 *      of klinecharts' internal action system.
 */
import { useCallback, useEffect, useRef, type MutableRefObject } from "react";
import {
  init,
  dispose,
  type Chart,
  type KLineData,
  type Period,
  type Styles,
  type DeepPartial,
  type NeighborData,
  type OverlayEventCallback,
  type OverlayStyle,
  type IndicatorStyle
} from "klinecharts";

import { snapToTick, type ChartOrderLine } from "@/components/finance/chart-order-lines";
import { registerWorkbenchOrderLineOverlay, type PfOrderLineExtendData } from "./order-line-overlay";
import { registerTaOverlays, ALL_DRAWING_OVERLAYS } from "./overlays";
import { resolvePfContent } from "./overlays/figure-kit";
import { registerCustomIndicators } from "./custom-indicators";
import { registerPfSignals, PF_SIGNALS_NAME, PF_SIGNALS_INSTANCE_ID } from "./custom-indicators/pf-signals";
import {
  INDICATOR_TOOLTIP_FEATURES,
  INDICATOR_FEATURE_EYE_ID,
  INDICATOR_FEATURE_GEAR_ID,
  INDICATOR_FEATURE_REMOVE_ID
} from "./custom-indicators/tooltip-features";
import { resolveParams, type IndicatorInstance } from "./indicator-registry";
import type { ChartDrawingPoint, ChartDrawingRow } from "./use-chart-drawings";
import type { Candle } from "./use-workbench-candles";

registerWorkbenchOrderLineOverlay();
registerTaOverlays();
registerCustomIndicators();
registerPfSignals();

/** Cast helper for the passthrough-JSON `styles` blob (`ChartDrawingRow.styles` / the S1 style-editor's patches) into klinecharts' own `DeepPartial<OverlayStyle>` shape — both sides are intentionally opaque `Record<string, unknown>` at the API boundary (server never validates the SHAPE of `styles`, only that it's a JSON object, per `packages/validation/src/chartDrawings.ts`'s `chartDrawingStylesSchema`), so a structural cast here is correct, not a type-safety hole. */
function asOverlayStyles(styles: Record<string, unknown> | null | undefined): DeepPartial<OverlayStyle> | undefined {
  return (styles ?? undefined) as DeepPartial<OverlayStyle> | undefined;
}

/**
 * W3, T7 polish — dark-mode token mapping for the workbench's hardcoded
 * light-mode colors (`WORKBENCH_THEME` below, `overlays/figure-kit.ts`'s
 * ink/signal constants, `order-line-overlay.ts`'s line colors). Documented
 * as a CONSTANT only, per the W3 brief's explicit descope: this codebase has
 * no dark-mode toggle/infrastructure anywhere yet (see
 * project_design_direction_indigo_futures memory — "dark mode as Phase-2
 * option", not yet built app-wide). Wiring this in would mean inventing a
 * theme-detection mechanism nothing else in the app has, for a workbench
 * that would then be the ONLY dark-mode-aware surface in the product — a
 * regression risk with no matching capability elsewhere. Kept here, unused,
 * so Phase-2 dark mode has a ready-made lookup table instead of a fresh
 * audit of this whole sprint's color literals.
 */
const WORKBENCH_DARK_TOKENS = {
  grid: "#292929",
  axisLine: "#3a3a3a",
  axisText: "#8a8a8a",
  crosshair: "#5a5a5a",
  candleUp: "#10b981",
  candleDown: "#f43f5e",
  inkBorder: "#475569",
  inkSolid: "#cbd5e1"
} as const;
void WORKBENCH_DARK_TOKENS; // referenced only by the doc comment above until Phase-2 dark mode lands.

function formatRupees(v: number): string {
  return `₹${v.toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;
}

/** Indigo-Futures palette tokens (see project_design_direction_indigo_futures memory / apps/web tailwind.config.ts's `ink` scale) — grid/axis/crosshair pulled straight from `ink-100`/`ink-400`/`ink-300`, candle up/down matching the SVG chart's own tone convention (price-chart.tsx's `#059669`/`#e11d48`) widened to the brief's explicit `#10b981`/`#f43f5e`. */
const WORKBENCH_THEME: DeepPartial<Styles> = {
  grid: {
    horizontal: { color: "#e2e8f0", size: 1, style: "dashed", dashedValue: [2, 2] },
    vertical: { color: "#e2e8f0", size: 1, style: "dashed", dashedValue: [2, 2] }
  },
  candle: {
    bar: {
      upColor: "#10b981",
      downColor: "#f43f5e",
      noChangeColor: "#94a3b8",
      upBorderColor: "#10b981",
      downBorderColor: "#f43f5e",
      noChangeBorderColor: "#94a3b8",
      upWickColor: "#10b981",
      downWickColor: "#f43f5e",
      noChangeWickColor: "#94a3b8"
    },
    priceMark: {
      last: { upColor: "#10b981", downColor: "#f43f5e", noChangeColor: "#94a3b8" }
    },
    tooltip: {
      legend: {
        template: (data: NeighborData<KLineData | null>) => {
          const c = data.current;
          if (!c) return [];
          return [
            { title: "O", value: formatRupees(Number(c.open)) },
            { title: "H", value: formatRupees(Number(c.high)) },
            { title: "L", value: formatRupees(Number(c.low)) },
            { title: "C", value: formatRupees(Number(c.close)) },
            { title: "Vol", value: Number(c.volume ?? 0).toLocaleString("en-IN") }
          ];
        }
      }
    }
  },
  xAxis: { axisLine: { color: "#e2e8f0" }, tickLine: { color: "#e2e8f0" }, tickText: { color: "#64748b" } },
  yAxis: { axisLine: { color: "#e2e8f0" }, tickLine: { color: "#e2e8f0" }, tickText: { color: "#64748b" } },
  crosshair: {
    horizontal: { line: { color: "#94a3b8" }, text: { backgroundColor: "#94a3b8" } },
    vertical: { line: { color: "#94a3b8" }, text: { backgroundColor: "#94a3b8" } }
  },
  // Founder feedback (2026-08-04) — the GLOBAL default `tooltipData.features`
  // for every indicator tooltip that doesn't supply its own (see module doc
  // + `custom-indicators/tooltip-features.ts`'s own doc for the full
  // verification) — covers all 27 built-ins + 13 of 14 customs uniformly.
  // `ICHIMOKU` (the one custom with its own `createTooltipDataSource`)
  // re-exports the same array explicitly (`custom-indicators/pack-a.ts`).
  indicator: {
    tooltip: { features: INDICATOR_TOOLTIP_FEATURES }
  }
};

function intervalToPeriod(interval: string): Period {
  switch (interval) {
    case "1m":
      return { type: "minute", span: 1 };
    case "5m":
      return { type: "minute", span: 5 };
    case "15m":
      return { type: "minute", span: 15 };
    case "30m":
      return { type: "minute", span: 30 };
    case "60m":
      return { type: "hour", span: 1 };
    case "1d":
      return { type: "day", span: 1 };
    default:
      return { type: "minute", span: 1 };
  }
}

const MAIN_PANE_ID = "candle_pane";

/**
 * TA Suite Sprint S2, T4 — the multi-instance indicator diff/sync. Keyed on
 * `instanceId` (never bare `name` — see `indicator-registry.ts`'s own doc
 * for the full verification of why `id`-filtered `removeIndicator`/
 * `overrideIndicator` need NO paneId bookkeeping, a deliberate
 * simplification of the brief's own "capture returned paneId in a Map ref"
 * framing). `activeRef` holds this pane's previously-synced
 * `instanceId → {name, paramsKey}` map; a changed `paramsKey` (params-only
 * edit via the T4 settings popover) triggers `overrideIndicator` instead of
 * a remove+recreate — the actual klinecharts instance object is reused,
 * matching what `overrideIndicator`'s own `shouldUpdate` recalculation path
 * is FOR (verified against `dist/index.esm.js`'s `IndicatorImp.prototype
 * .shouldUpdate`'s default `JSON.stringify(prev.calcParams) !==
 * JSON.stringify(current.calcParams)` check — a `calcParams` change alone
 * is exactly what that path recalculates on).
 */
function syncIndicatorInstances(
  chart: Chart,
  instances: IndicatorInstance[],
  activeRef: MutableRefObject<Map<string, { name: string; paramsKey: string }>>,
  opts: { paneId?: string; isStack: boolean }
): void {
  const active = activeRef.current;
  const nextIds = new Set(instances.map((i) => i.instanceId));

  for (const instanceId of active.keys()) {
    if (!nextIds.has(instanceId)) {
      chart.removeIndicator({ id: instanceId });
      active.delete(instanceId);
    }
  }

  for (const instance of instances) {
    const params = resolveParams(instance);
    const paramsKey = JSON.stringify(params);
    const existing = active.get(instance.instanceId);
    if (!existing) {
      chart.createIndicator(
        {
          id: instance.instanceId,
          name: instance.name,
          calcParams: params,
          // Founder 2026-08-04 lingo fix: klinecharts' "SMA" is a SMOOTHED MA
          // (the industry's SMMA), while "SMA" everywhere else in this app is
          // the SIMPLE MA — relabel the on-chart pane legend so both never
          // wear the same acronym. Display-only; registry name unchanged.
          ...(instance.name === "SMA" ? { shortName: "SMMA" } : {}),
          ...(opts.paneId ? { paneId: opts.paneId } : {})
        },
        opts.isStack
      );
      active.set(instance.instanceId, { name: instance.name, paramsKey });
    } else if (existing.paramsKey !== paramsKey) {
      chart.overrideIndicator({ id: instance.instanceId, name: instance.name, calcParams: params });
      active.set(instance.instanceId, { name: instance.name, paramsKey });
    }
  }
}

/** Tool names whose `extendData` must render `styles.pfContent` (the ONE built-in that reads `extendData` as display text — see module doc's simpleAnnotation fix). */
const EXTEND_DATA_TEXT_OVERLAYS = new Set(["simpleAnnotation"]);
/** Tool names that open the D10 text popover once their create-POST resolves. Founder-feedback pass (2026-08-03) widens this with the 4 new text-content annotation tools (`textLabel`/`priceNote`/`commentBubble`/`signpost`) — `pin` is deliberately NOT here, it's a glyph-only marker like `flagMark`/`arrowMark*`. */
const TEXT_INPUT_OVERLAYS = new Set(["calloutText", "noteAnchored", "textLabel", "priceNote", "commentBubble", "signpost"]);

function buildExtendDataForOverlay(overlayName: string): unknown {
  if (!EXTEND_DATA_TEXT_OVERLAYS.has(overlayName)) return undefined;
  // A closure, per klinecharts' own supported `extendData` shapes
  // (`isFunction(overlay.extendData) ? overlay.extendData(overlay) : ...`)
  // — reads the SAME `styles.pfContent` channel every other annotation tool
  // uses, so simpleAnnotation rows created via the OLD "Note" button (before
  // this sprint, via a plain string-coerced object) and any FUTURE
  // simpleAnnotation row alike render real text instead of "[object
  // Object]". Never reads persistedId — that's `overlayIdToPersistedIdRef`'s
  // job now, uniformly for every overlay type.
  return (overlay: { styles?: unknown }) => resolvePfContent(overlay.styles as Record<string, unknown> | null | undefined).text ?? "";
}

export function KlineChart({
  candles,
  interval,
  precision = 2,
  mainIndicators,
  subIndicators,
  signalsConfig,
  orderLines,
  onSurfaceClick,
  onOrderLineDrag,
  onOrderLineCancel,
  suspendClick,
  drawings,
  activeTool,
  pendingToolStyles,
  magnetMode,
  onToolDrawEnd,
  onDrawingCreate,
  onDrawingMoveEnd,
  onDrawingRemoved,
  onDrawingSelected,
  onDrawingDeselected,
  onDrawingNeedsText,
  cancelDrawingNonce,
  clearAllDrawingsNonce,
  onAllDrawingsCleared,
  drawingStyleCommand,
  removeDrawingCommand,
  onCrosshairDataIndexChange,
  onIndicatorOpenSettings,
  onIndicatorRemove,
  indicatorStyleCommand
}: {
  candles: Candle[];
  interval: string;
  /** Decimal places for price display/tooltip — the plan's fixed "precision 2" for every instrument this sprint charts. */
  precision?: number;
  /** TA Suite S2 — indicator INSTANCES (not bare names, see `indicator-registry.ts`) stacked in the main candle pane. */
  mainIndicators: IndicatorInstance[];
  /** TA Suite S2 — indicator instances, each rendered in its own sub-pane; the caller (`indicator-dialog.tsx` via `chart-workbench.tsx`) enforces the `MAX_SUB_PANE_INSTANCES` cap, this wrapper just reflects whatever it's given. */
  subIndicators: IndicatorInstance[];
  /** TA Suite S3, T2 — the active strategy's `PF_SIGNALS` config (`{id, params}`), or `null`/`undefined` to remove it. A SINGLE instance (`PF_SIGNALS_INSTANCE_ID`), unlike `mainIndicators`/`subIndicators`' multi-instance model — only one strategy's signals are ever shown at once. */
  signalsConfig?: { id: string; params: number[] } | null;
  orderLines: ChartOrderLine[];
  /** `left`/`top` are CSS pixels relative to THIS component's own root element, which fills its `position: relative` parent (chart-workbench.tsx's center pane) with no offset — so they double as coordinates relative to that wrapper too, satisfying ChartOrderIntentPopover's anchor contract. */
  onSurfaceClick?: (info: { price: number; left: number; top: number }) => void;
  onOrderLineDrag?: (id: string, newPrice: number) => void;
  onOrderLineCancel?: (id: string) => void;
  /** True while a drawing tool is active (W3) or a drag just ended — suppresses click-to-trade so a draw-mode click or a drag's trailing click never also opens the order-intent popover. */
  suspendClick?: boolean;
  /** W3, T4 — server-loaded rows to hydrate as overlays on open. Populated once by `use-chart-drawings.ts`'s `load()`; identity-keyed prop-sync effect below (safe per this file's own "one-way sync can't cycle" reasoning — see module doc). */
  drawings?: ChartDrawingRow[];
  /** W3, T3 — the currently-selected toolbar tool name (one of `ALL_DRAWING_OVERLAYS`), or `null`. Setting this to a NEW non-null value starts a fresh KLineCharts native step-drawing session for that overlay name. */
  activeTool?: string | null;
  /** S1, T5/T6 — style preset applied at the MOMENT a new drawing is created (e.g. the emoji flyout's chosen `pfContent.emoji`, or `highlighter`'s translucent-wide brush preset). Read once per draw-start via a ref, never round-tripped back out. */
  pendingToolStyles?: Record<string, unknown> | null;
  /** S1, T6 — the toolbar's magnet toggle, wired straight to `createOverlay`'s own `mode` field (`"normal"` default vs `"weak_magnet"`). */
  magnetMode?: "normal" | "weak_magnet";
  /** Fires once a draw session ends — completed OR cancelled — so the parent can clear `activeTool` (and un-suspend click-to-trade). */
  onToolDrawEnd?: () => void;
  /** W3, T4 step 3; S1, T5 widens with an optional initial `styles` (pendingToolStyles) — called with the finished drawing's overlay name + anchor points once `onDrawEnd` fires; the returned row (or `null` on failure) is used to patch the persistedId side-channel onto the already-on-canvas overlay directly in this file — never round-tripped back out through a prop. */
  onDrawingCreate?: (overlayName: string, points: ChartDrawingPoint[], styles?: Record<string, unknown>) => Promise<ChartDrawingRow | null>;
  /** W3, T4 step 4; S1, T7 widens the patch to optionally carry `styles` too (the hook's `update()` merges points/styles patches per id behind ONE debounce timer) — fired on `onPressedMoveEnd` for an already-persisted drawing. */
  onDrawingMoveEnd?: (persistedId: string, patch: { points?: ChartDrawingPoint[]; styles?: Record<string, unknown> }) => void;
  /** W3, T4 step 5 — fired on `onRemoved` for an already-persisted drawing, ONLY when not suspended (see `suspendDrawingSyncRef` below — the sprint's top-named correctness risk). */
  onDrawingRemoved?: (persistedId: string) => void;
  /** S1, T7 — fired on `onSelected` for ANY drawing (persisted or not) so `chart-workbench.tsx` can position the floating style editor. `persistedId` is `null` for a drawing whose create-POST hasn't resolved yet (style edits on it are a no-op until it has). */
  onDrawingSelected?: (info: { overlayId: string; persistedId: string | null; overlayName: string; left: number; top: number }) => void;
  onDrawingDeselected?: () => void;
  /** S1, T5 — fired once a text-family tool's (`calloutText`/`noteAnchored`) create-POST resolves, so the parent can open the D10 popover anchored at the drawing's own position. */
  onDrawingNeedsText?: (info: { overlayId: string; persistedId: string; overlayName: string; left: number; top: number }) => void;
  /** W3, T3 — bump to cancel the in-progress draw (Escape, chart-workbench.tsx's priority chain). Nonce idiom, matching this codebase's existing `selectionNonce`/`presetNonce` convention rather than a `forwardRef` imperative handle. */
  cancelDrawingNonce?: number;
  /** W3, T3 — bump to remove every drawing overlay from the canvas (toolbar's "Clear all", already confirmed by the caller) and fire `onAllDrawingsCleared`. */
  clearAllDrawingsNonce?: number;
  /** Fires once clear-all has finished removing overlays from the canvas — the parent calls `use-chart-drawings.ts`'s `clearAll()` (the ONE batched `DELETE ?chartKey=`) from here. */
  onAllDrawingsCleared?: () => void;
  /** S1, T7 — style editor swatch/width clicks: bump `nonce` with a NEW `{id, styles}` to apply an instant `overrideOverlay` (visual feedback with zero round-trip latency). The debounced PATCH itself is fired by the caller directly against `use-chart-drawings.ts`'s `update()` (it already has `persistedId` from `onDrawingSelected`) — this prop only drives the on-canvas visual. */
  drawingStyleCommand?: { id: string; styles: Record<string, unknown>; nonce: number } | null;
  /** S1, T5/T7 — bump `nonce` with a NEW `{id}` to remove a specific overlay by id (the D10 empty-text-popover-dismissal delete, and the style editor's own Delete button) — reuses the exact same NOT-suspended `removeOverlay` path as the Backspace hotkey, so it reaches `onDrawingRemoved` → the server DELETE identically. */
  removeDrawingCommand?: { id: string; nonce: number } | null;
  /** Founder feedback (2026-08-04), Part 1 — fires with the crosshair-hovered bar's `dataIndex` (rAF-throttled), or `null` when the crosshair isn't over the chart (mouse left the container) — the detached `indicator-active-strip.tsx`'s own crosshair-follow signal, since it has no native equivalent to the on-chart tooltip's built-in one (see module doc). `null` means "use the latest bar," matching klinecharts' own default. */
  onCrosshairDataIndexChange?: (dataIndex: number | null) => void;
  /** Founder feedback (2026-08-04), Part 1 — fired by the on-chart legend's gear icon (native `onIndicatorTooltipFeatureClick`, see module doc). Same `(instance, anchor)` shape `indicator-active-strip.tsx`'s own gear button already calls — `chart-workbench.tsx` wires both to the identical handler. `instance` is looked up from `mainIndicators`/`subIndicators` by the clicked feature's `indicator.id`; `anchor` is the clicked pane's own top-left (`chart.getSize(paneId)`) plus a small fixed offset — the native click payload carries no pixel coordinate (verified: `featureInfo = {paneId, feature, indicator}` only), so this is a documented, honest approximation of "near where you clicked," not pixel-exact. */
  onIndicatorOpenSettings?: (instance: IndicatorInstance, anchor: { left: number; top: number }) => void;
  /** Founder feedback (2026-08-04), Part 1 — fired by the on-chart legend's × icon; same `instanceId` shape `indicator-active-strip.tsx`'s own remove button already calls — MUST go through `chart-workbench.tsx`'s React state (never a raw `chart.removeIndicator` call from in here), or the next indicator-sync effect pass would just recreate what this just removed. */
  onIndicatorRemove?: (instanceId: string) => void;
  /** Founder feedback (2026-08-04), Part 1 — the settings popover's new STYLE section: bump `nonce` with a NEW `{id, styles}` to `overrideIndicator({id, styles})`. Deliberately UNIFORM across every line-type figure of that instance (a single-element `styles.lines` array — verified against `eachFigures`'s `lineStyles[lineCount % lineStyleCount]` modulo resolution: submitting exactly one style object recolors/resizes EVERY line figure of the instance, not just the first — see `indicator-settings-popover.tsx`'s own doc for why independent per-sub-line control was scoped out this pass). */
  indicatorStyleCommand?: { id: string; styles: Record<string, unknown>; nonce: number } | null;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<Chart | null>(null);
  const initCountRef = useRef(0);

  // ── Callback refs (render-loop law: every prop read by a KLineCharts-
  // internal handler goes through one of these, never a closure over the
  // prop itself). ─────────────────────────────────────────────────────────
  const onSurfaceClickRef = useRef(onSurfaceClick);
  onSurfaceClickRef.current = onSurfaceClick;
  const onOrderLineDragRef = useRef(onOrderLineDrag);
  onOrderLineDragRef.current = onOrderLineDrag;
  const onOrderLineCancelRef = useRef(onOrderLineCancel);
  onOrderLineCancelRef.current = onOrderLineCancel;
  const suspendClickRef = useRef(suspendClick);
  suspendClickRef.current = suspendClick;

  // W3, T3/T4 — drawings callback refs (same ref-mirror pattern as above).
  const onToolDrawEndRef = useRef(onToolDrawEnd);
  onToolDrawEndRef.current = onToolDrawEnd;
  const onDrawingCreateRef = useRef(onDrawingCreate);
  onDrawingCreateRef.current = onDrawingCreate;
  const onDrawingMoveEndRef = useRef(onDrawingMoveEnd);
  onDrawingMoveEndRef.current = onDrawingMoveEnd;
  const onDrawingRemovedRef = useRef(onDrawingRemoved);
  onDrawingRemovedRef.current = onDrawingRemoved;
  const onAllDrawingsClearedRef = useRef(onAllDrawingsCleared);
  onAllDrawingsClearedRef.current = onAllDrawingsCleared;
  const onDrawingSelectedRef = useRef(onDrawingSelected);
  onDrawingSelectedRef.current = onDrawingSelected;
  const onDrawingDeselectedRef = useRef(onDrawingDeselected);
  onDrawingDeselectedRef.current = onDrawingDeselected;
  const onDrawingNeedsTextRef = useRef(onDrawingNeedsText);
  onDrawingNeedsTextRef.current = onDrawingNeedsText;
  const pendingToolStylesRef = useRef(pendingToolStyles);
  pendingToolStylesRef.current = pendingToolStyles;
  const magnetModeRef = useRef(magnetMode);
  magnetModeRef.current = magnetMode;

  // Founder feedback (2026-08-04), Part 1 — callback refs for the new
  // crosshair-follow/on-chart-legend-feature-click props, same mirror
  // pattern as every ref above.
  const onCrosshairDataIndexChangeRef = useRef(onCrosshairDataIndexChange);
  onCrosshairDataIndexChangeRef.current = onCrosshairDataIndexChange;
  const onIndicatorOpenSettingsRef = useRef(onIndicatorOpenSettings);
  onIndicatorOpenSettingsRef.current = onIndicatorOpenSettings;
  const onIndicatorRemoveRef = useRef(onIndicatorRemove);
  onIndicatorRemoveRef.current = onIndicatorRemove;
  /** Every current instance, both panes combined — kept fresh every render (a plain assignment, not an effect: it's only ever read from inside an event handler closure, never used as a dependency) so the `onIndicatorTooltipFeatureClick` handler can resolve a clicked `indicator.id` back to the full `IndicatorInstance` object `onIndicatorOpenSettings` expects, without needing its own stale-closure guard. */
  const allIndicatorInstancesRef = useRef<IndicatorInstance[]>([]);
  allIndicatorInstancesRef.current = [...mainIndicators, ...subIndicators];

  // W3, T4 — drawing overlay bookkeeping, all separate from `overlaySnapshotRef`
  // (order lines) below: DISJOINT id namespaces (`dw_*` for hydrated/
  // persisted rows, `draw_pending_*` for a not-yet-persisted fresh drawing)
  // so a drawing can never be mistaken for an order line or vice versa.
  //   - `drawingOverlayIdsRef` — every drawing overlay id currently on the
  //     canvas (persisted or not), scoped by "Clear all".
  //   - `hydratedRowIdsRef` — server row ids already represented on-canvas,
  //     so the hydration-diff effect never double-creates a row whose
  //     overlay already exists (either from a prior hydration pass, or from
  //     a just-finished fresh draw that hasn't round-tripped back through
  //     the `drawings` prop yet).
  //   - `overlayIdToPersistedIdRef` (S1) — the persistedId side-channel; see
  //     module doc's simpleAnnotation fix for why this replaced reading
  //     `extendData.persistedId` directly.
  //   - `suspendDrawingSyncRef` — true only for the DURATION of a
  //     programmatic `removeOverlay` call this component itself makes
  //     (hydration cleanup of a stale row, clear-all) — false at every other
  //     moment, including the delete-hotkey path below and the S1
  //     `removeDrawingCommand` path, so a real user delete still reaches
  //     `use-chart-drawings.ts`'s `remove()` → DELETE. THE guard the brief
  //     names as this sprint's top correctness risk: without it, loading a
  //     user's saved drawings (createOverlay in a loop, each of which can
  //     trigger a KLineCharts-internal cleanup of a REPLACED same-id
  //     overlay) could fire `onRemoved` and immediately re-delete what was
  //     just loaded.
  //   - `pendingDrawOverlayIdRef` — the overlay id of an in-progress
  //     (not-yet-`totalStep`-complete) draw, so Escape can cancel exactly
  //     that one (confirmed against the installed package's own
  //     `getOverlaysByFilter`: an in-progress overlay IS matched by id, so
  //     `removeOverlay({id})` correctly aborts a mid-draw shape too).
  //   - `selectedDrawingOverlayIdRef` — tracks the currently-selected
  //     drawing (via each instance's own `onSelected`/`onDeselected`) for
  //     the Backspace/Delete-to-remove hotkey AND (S1) the style editor.
  const drawingOverlayIdsRef = useRef<Set<string>>(new Set());
  const hydratedRowIdsRef = useRef<Set<string>>(new Set());
  const overlayIdToPersistedIdRef = useRef<Map<string, string>>(new Map());
  const suspendDrawingSyncRef = useRef(false);
  const pendingDrawOverlayIdRef = useRef<string | null>(null);
  const selectedDrawingOverlayIdRef = useRef<string | null>(null);
  const activeToolRef = useRef<string | null>(null);

  function toDrawingPoints(points: Array<{ dataIndex?: number; timestamp?: number; value?: number }> | undefined): ChartDrawingPoint[] {
    if (!points) return [];
    return points
      .filter((p): p is { dataIndex?: number; timestamp: number; value: number } => typeof p.timestamp === "number" && typeof p.value === "number")
      .map((p) => ({ timestamp: p.timestamp, value: p.value }));
  }

  /** S1 — pixel anchor of an overlay's first point, relative to this component's own root (same contract `onSurfaceClick`'s `left`/`top` already use) — feeds `onDrawingSelected`/`onDrawingNeedsText`'s popover positioning. */
  function firstPointPixelAnchor(overlayPoints: Array<{ dataIndex?: number; timestamp?: number; value?: number }>): { left: number; top: number } | null {
    const chart = chartRef.current;
    const first = overlayPoints[0];
    if (!chart || !first || typeof first.value !== "number") return null;
    const converted = chart.convertToPixel(
      { dataIndex: first.dataIndex, timestamp: first.timestamp, value: first.value },
      { paneId: MAIN_PANE_ID }
    );
    const point = Array.isArray(converted) ? converted[0] : converted;
    if (!point || typeof point.x !== "number" || typeof point.y !== "number") return null;
    return { left: point.x, top: point.y };
  }

  // Chart Trading + SL/TP parity (Sprint C, C1) — the SAME anti-snap-back /
  // click-suppression pair price-chart.tsx uses, reimplemented here since
  // KLineCharts renders everything on one canvas (no separate DOM element
  // per line to `stopPropagation` on — see order-line-overlay.ts's own doc).
  const draggingIdRef = useRef<string | null>(null);
  const dragJustEndedRef = useRef(false);
  const dragStartPriceRef = useRef<Record<string, number>>({});

  // Founder feedback (2026-08-04), Part 1 — set synchronously (never through
  // React state/an effect) the moment an on-chart legend feature (eye/gear/
  // remove) fires, so `handleClick` below can bail out for the SAME physical
  // click and never also open the order-intent popover underneath. Safe
  // specifically because klinecharts wires tooltip features to
  // `mouseDownEvent` (verified — `custom-indicators/tooltip-features.ts`'s
  // own doc), which always fires strictly BEFORE the browser's own
  // synthesized `click` event on the same element — the same "set a ref
  // during an earlier event in the same gesture, read it in a later one"
  // idiom `dragJustEndedRef` already uses one line above.
  const suppressNextClickRef = useRef(false);

  // Founder feedback (2026-08-04), Part 1 — crosshair-follow state for the
  // DETACHED strip (see module doc for why the on-chart legend needs none of
  // this — it's a klinecharts-native default). `hoveredXRef`/
  // `hoveredPaneIdRef` hold the latest raw pixel position from
  // `onCrosshairChange`; `crosshairRafRef` throttles the dataIndex
  // conversion + prop callback to at most once per animation frame.
  const hoveredXRef = useRef<number | undefined>(undefined);
  const hoveredPaneIdRef = useRef<string | undefined>(undefined);
  const crosshairRafRef = useRef<number | null>(null);

  // DataLoader bridge state (see module doc above).
  const candlesRef = useRef<Candle[]>(candles);
  candlesRef.current = candles;
  const subscribeBarCallbackRef = useRef<((data: KLineData) => void) | null>(null);

  // ── Mount effect: init() exactly once. ─────────────────────────────────
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    initCountRef.current += 1;
    if (process.env.NODE_ENV !== "production" && initCountRef.current > 1) {
      // eslint-disable-next-line no-console
      console.warn(`[KlineChart] init() called ${initCountRef.current} times for one mount — the render-loop law was violated.`);
    }

    const chart = init(el, {});
    chartRef.current = chart;

    if (chart) {
      chart.setStyles(WORKBENCH_THEME);
      chart.setDataLoader({
        getBars: (params) => {
          params.callback(candlesRef.current as unknown as KLineData[], false);
        },
        subscribeBar: (params) => {
          subscribeBarCallbackRef.current = params.callback;
        },
        unsubscribeBar: () => {
          subscribeBarCallbackRef.current = null;
        }
      });
      chart.setSymbol({ ticker: "pf-workbench", pricePrecision: precision, volumePrecision: 0 });
      // The very first `getBars` pull — subsequent interval changes re-call
      // `setPeriod` from the data-change effect below, never `init` again.
      chart.setPeriod(intervalToPeriod(interval));
    }

    // Founder feedback (2026-08-04), Part 1 — crosshair-follow for the
    // detached strip. rAF-throttled: `onCrosshairChange` can fire on every
    // pointermove, but we only ever need the LATEST position by the next
    // paint (matches the house render-loop law's "throttle high-frequency
    // chart events via rAF" convention already used elsewhere in this
    // program's chart-adjacent code). See module doc for the verified
    // payload-shape gotcha (`{x, y, paneId}`, never `dataIndex` — re-derived
    // below via `convertFromPixel`).
    function flushCrosshair() {
      crosshairRafRef.current = null;
      const chart = chartRef.current;
      const callback = onCrosshairDataIndexChangeRef.current;
      if (!chart || !callback) return;
      const x = hoveredXRef.current;
      if (x === undefined) {
        callback(null);
        return;
      }
      const converted = chart.convertFromPixel([{ x }], { paneId: hoveredPaneIdRef.current ?? MAIN_PANE_ID });
      const point = Array.isArray(converted) ? converted[0] : converted;
      const dataIndex = typeof point?.dataIndex === "number" ? Math.round(point.dataIndex) : undefined;
      callback(dataIndex !== undefined && dataIndex >= 0 && dataIndex < candlesRef.current.length ? dataIndex : null);
    }
    function scheduleCrosshairFlush() {
      if (crosshairRafRef.current !== null) return;
      crosshairRafRef.current = requestAnimationFrame(flushCrosshair);
    }
    function handleCrosshairChange(raw: unknown) {
      const r = raw as { x?: number; paneId?: string } | null | undefined;
      if (r && typeof r.x === "number") {
        hoveredXRef.current = r.x;
        hoveredPaneIdRef.current = r.paneId;
      } else {
        hoveredXRef.current = undefined;
      }
      scheduleCrosshairFlush();
    }
    function handleMouseLeave() {
      hoveredXRef.current = undefined;
      scheduleCrosshairFlush();
    }
    chart?.subscribeAction("onCrosshairChange", handleCrosshairChange);
    el.addEventListener("mouseleave", handleMouseLeave);

    // Founder feedback (2026-08-04), Part 1 — the on-chart legend's eye/
    // gear/remove icon clicks (see `custom-indicators/tooltip-features.ts`'s
    // own doc for the verified `onIndicatorTooltipFeatureClick` payload
    // shape: `{paneId, feature, indicator}`, no pixel coordinate).
    interface IndicatorFeatureClickInfo {
      paneId?: string;
      feature?: { id?: string };
      indicator?: { id?: string; visible?: boolean };
    }
    function handleIndicatorFeatureClick(raw: unknown) {
      const info = raw as IndicatorFeatureClickInfo | null | undefined;
      const featureId = info?.feature?.id;
      const instanceId = info?.indicator?.id;
      if (!featureId || !instanceId) return;
      suppressNextClickRef.current = true; // see this ref's own doc above — always precedes the browser's own 'click' for this same gesture.
      const chart = chartRef.current;
      if (!chart) return;

      switch (featureId) {
        case INDICATOR_FEATURE_EYE_ID: {
          const [live] = chart.getIndicators({ id: instanceId });
          // `name` is a REQUIRED field on `overrideIndicator`'s own `IndicatorCreate` type
          // (`ExcludePickPartial<..., "name">` — verified against dist/index.d.ts) even
          // though only `visible` is actually changing here.
          if (live) chart.overrideIndicator({ id: instanceId, name: live.name, visible: !live.visible });
          break;
        }
        case INDICATOR_FEATURE_GEAR_ID: {
          const instance = allIndicatorInstancesRef.current.find((i) => i.instanceId === instanceId);
          if (!instance) break;
          const bounding = info?.paneId ? chart.getSize(info.paneId) : null;
          const anchor = bounding ? { left: bounding.left + 8, top: bounding.top + 28 } : { left: 60, top: 60 };
          onIndicatorOpenSettingsRef.current?.(instance, anchor);
          break;
        }
        case INDICATOR_FEATURE_REMOVE_ID: {
          onIndicatorRemoveRef.current?.(instanceId); // MUST go through React state, not a raw chart.removeIndicator — see prop doc.
          break;
        }
      }
    }
    chart?.subscribeAction("onIndicatorTooltipFeatureClick", handleIndicatorFeatureClick);

    function handleClick(e: MouseEvent) {
      if (suppressNextClickRef.current) {
        suppressNextClickRef.current = false;
        return;
      }
      if (dragJustEndedRef.current) {
        dragJustEndedRef.current = false;
        return;
      }
      if (suspendClickRef.current) return;
      if (!onSurfaceClickRef.current || !chartRef.current || !el) return;
      const rect = el.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      const converted = chartRef.current.convertFromPixel([{ x, y }], { paneId: MAIN_PANE_ID });
      const point = Array.isArray(converted) ? converted[0] : converted;
      if (!point || typeof point.value !== "number" || !Number.isFinite(point.value)) return;
      onSurfaceClickRef.current({ price: snapToTick(point.value), left: x, top: y });
    }
    el.addEventListener("click", handleClick);

    // W3, T4 — Backspace/Delete removes the currently-SELECTED drawing (a
    // real, on-canvas anchor-based click-to-select via each drawing
    // instance's own onSelected/onDeselected — see the drawings-hydration
    // and draw-start effects below). Guarded against firing while the user
    // is typing in the docked order ticket's own inputs (same fullscreen
    // portal, sibling DOM) — a Backspace keystroke while editing a lot-size
    // field must never also delete a drawing.
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key !== "Backspace" && e.key !== "Delete") return;
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable)) return;
      const chart = chartRef.current;
      const id = selectedDrawingOverlayIdRef.current;
      if (!chart || !id || !drawingOverlayIdsRef.current.has(id)) return;
      e.preventDefault();
      chart.removeOverlay({ id }); // NOT suspended — a real user delete, reaches onDrawingRemoved via the overlay's own onRemoved handler.
    }
    document.addEventListener("keydown", handleKeyDown);

    return () => {
      el.removeEventListener("click", handleClick);
      el.removeEventListener("mouseleave", handleMouseLeave);
      document.removeEventListener("keydown", handleKeyDown);
      chart?.unsubscribeAction("onCrosshairChange", handleCrosshairChange);
      chart?.unsubscribeAction("onIndicatorTooltipFeatureClick", handleIndicatorFeatureClick);
      if (crosshairRafRef.current !== null) {
        cancelAnimationFrame(crosshairRafRef.current);
        crosshairRafRef.current = null;
      }
      dispose(el);
      chartRef.current = null;
      initCountRef.current = 0;
    };
    // Mount-only: `precision` is read once at init (setSymbol) — this sprint
    // never varies it mid-session for a single workbench open, matching
    // every current entry point (one fixed instrument per maximize).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Data effect: full reload vs tail-advance. Keyed on the primitives
  // (interval + first/last timestamp + count) PLUS `candles`' identity — the
  // identity dep is required, not an accident: an in-progress bar's OHLC can
  // tick while interval/firstTs/lastTs/count all stay identical, and only the
  // fresh array from the parent's 60s poll signals that. Safe despite the
  // identity key because the body only pushes into klinecharts (one-way sync,
  // no parent-state feedback — same justification as the orderLines sync). ──
  const firstTs = candles[0]?.timestamp;
  const lastTs = candles[candles.length - 1]?.timestamp;
  const count = candles.length;
  const lastIntervalRef = useRef<string | null>(null);
  const lastFirstTsRef = useRef<number | undefined>(undefined);
  const lastCountRef = useRef(0);
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;
    candlesRef.current = candles;

    const isFirstLoad = lastIntervalRef.current === null;
    const intervalChanged = !isFirstLoad && lastIntervalRef.current !== interval;
    const windowShifted = !isFirstLoad && lastFirstTsRef.current !== firstTs;

    if (isFirstLoad || intervalChanged || windowShifted) {
      // Full reload — the plan's "applyNewData" moment. `setPeriod` forces
      // KLineCharts to call our DataLoader's `getBars` again, which answers
      // from the now-current `candlesRef`.
      chart.setPeriod(intervalToPeriod(interval));
    } else if (count > 0 && (count !== lastCountRef.current || lastTs !== undefined)) {
      // Same window, same interval — only the tail moved (a new bar
      // appended, or the in-progress bar's OHLC ticked). Push just the last
      // bar through the live-bar channel — the plan's "updateData" moment —
      // never a full reload for a routine 60s poll tick.
      const last = candles[candles.length - 1];
      if (last) subscribeBarCallbackRef.current?.(last as unknown as KLineData);
    }

    lastIntervalRef.current = interval;
    lastFirstTsRef.current = firstTs;
    lastCountRef.current = count;
  }, [interval, firstTs, lastTs, count, candles]);

  // ── Indicators effect: TA Suite S2 multi-instance rework. Keyed on a
  // JSON-stringified `[instanceId, name, resolvedParams]` snapshot (the
  // brief's own prescribed key shape) rather than the `mainIndicators`/
  // `subIndicators` ARRAY identities (house render-loop law — the parent
  // rebuilds these arrays fresh every render) — a params-only edit (T4
  // settings popover) changes this string, correctly re-triggering the
  // effect even though no instance was added/removed. `syncIndicatorInstances`
  // (module scope, above) does the actual create/override/remove diff. ──
  const mainInstanceKey = JSON.stringify(mainIndicators.map((i) => [i.instanceId, i.name, resolveParams(i)]));
  const subInstanceKey = JSON.stringify(subIndicators.map((i) => [i.instanceId, i.name, resolveParams(i)]));
  const activeMainInstancesRef = useRef<Map<string, { name: string; paramsKey: string }>>(new Map());
  const activeSubInstancesRef = useRef<Map<string, { name: string; paramsKey: string }>>(new Map());
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;
    syncIndicatorInstances(chart, mainIndicators, activeMainInstancesRef, { paneId: MAIN_PANE_ID, isStack: true });
    syncIndicatorInstances(chart, subIndicators, activeSubInstancesRef, { isStack: false });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mainInstanceKey, subInstanceKey]);

  // ── TA Suite S3, T2 — PF_SIGNALS sync effect. Same JSON-keyed idiom as the
  // indicator effect above, but for a SINGLE fixed-id instance (no
  // multi-instance model needed — only one strategy's signals show at once).
  // `null`/`undefined` removes the indicator entirely; a present config
  // creates it once then `overrideIndicator`s on every subsequent param/
  // strategy change (recalculates immediately per S2's verified
  // `overrideIndicator` internals — no extra plumbing needed, same
  // `shouldUpdate` calcParams-diff path `syncIndicatorInstances` already
  // relies on). "Clear signals" (chart-workbench.tsx) is just this prop
  // going back to `null` — it only ever calls `removeIndicator`, never
  // `removeOverlay`, so it structurally cannot touch an S1 drawing. ───────
  const signalsKey = signalsConfig ? JSON.stringify([signalsConfig.id, signalsConfig.params]) : null;
  const activeSignalsKeyRef = useRef<string | null>(null);
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;

    if (!signalsConfig) {
      if (activeSignalsKeyRef.current !== null) {
        chart.removeIndicator({ id: PF_SIGNALS_INSTANCE_ID });
        activeSignalsKeyRef.current = null;
      }
      return;
    }

    const calcParams: (string | number)[] = [signalsConfig.id, ...signalsConfig.params];
    if (activeSignalsKeyRef.current === null) {
      chart.createIndicator({ id: PF_SIGNALS_INSTANCE_ID, name: PF_SIGNALS_NAME, calcParams, paneId: MAIN_PANE_ID }, true);
    } else {
      chart.overrideIndicator({ id: PF_SIGNALS_INSTANCE_ID, name: PF_SIGNALS_NAME, calcParams });
    }
    activeSignalsKeyRef.current = signalsKey;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signalsKey]);

  // ── Order-line prop-sync effect. Deliberately keyed on `orderLines`'
  // own identity (an exception to the "never key on object identity" law,
  // documented here per that law's own carve-out): every parent
  // (paper-trading-dashboard.tsx / futures-page-client.tsx /
  // options-page-client.tsx) builds `orderLines` fresh at render time
  // WITHOUT memoizing it, deliberately, so a stale array can never mask a
  // just-filled/just-cancelled order — see those files' own doc comments.
  // Since this effect's body only calls klinecharts overlay methods and
  // NEVER calls a prop callback that would itself cause the parent to
  // re-render (unlike price-chart.tsx's onQuoteChange effect, which DOES
  // feed back into its caller's state and therefore had to move to a
  // primitive-keyed dependency array to avoid a loop), an identity-keyed
  // effect here cannot cycle — it's a one-way sync, not a feedback loop. ──
  const overlaySnapshotRef = useRef<Map<string, ChartOrderLine>>(new Map());
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;

    function buildExtendData(line: ChartOrderLine): PfOrderLineExtendData {
      return {
        line,
        onDragStart: (id, currentPrice) => {
          draggingIdRef.current = id;
          dragStartPriceRef.current[id] = currentPrice;
        },
        onDragEnd: (id, snapped) => {
          draggingIdRef.current = null;
          dragJustEndedRef.current = true;
          if (snapped == null) return;
          const original = dragStartPriceRef.current[id];
          if (original != null && snapToTick(original) === snapped) return; // no-op tap, matches price-chart.tsx's identical skip.
          onOrderLineDragRef.current?.(id, snapped);
        },
        onCancel: (id) => onOrderLineCancelRef.current?.(id),
        onAnyInteraction: () => {
          dragJustEndedRef.current = true;
        }
      };
    }

    const seen = new Set<string>();
    for (const line of orderLines) {
      seen.add(line.id);
      const overlayId = `pf-order-${line.id}`;
      const existing = overlaySnapshotRef.current.get(line.id);

      if (!existing) {
        chart.createOverlay({
          name: "pfOrderLine",
          id: overlayId,
          points: [{ value: line.price }],
          lock: !line.draggable,
          extendData: buildExtendData(line)
        });
        overlaySnapshotRef.current.set(line.id, line);
        continue;
      }

      // Anti-snap-back: never override the line the user is actively
      // dragging — a mid-drag account poll response would otherwise yank it
      // back under the pointer (see use-price-overrides.ts's identical
      // reasoning for the SVG chart's own optimistic-UI guard).
      if (draggingIdRef.current === line.id) continue;

      const changed =
        existing.price !== line.price ||
        existing.label !== line.label ||
        existing.kind !== line.kind ||
        existing.side !== line.side ||
        existing.cancellable !== line.cancellable ||
        existing.draggable !== line.draggable;
      if (changed) {
        chart.overrideOverlay({ id: overlayId, points: [{ value: line.price }], lock: !line.draggable, extendData: buildExtendData(line) });
        overlaySnapshotRef.current.set(line.id, line);
      }
    }

    for (const id of Array.from(overlaySnapshotRef.current.keys())) {
      if (!seen.has(id)) {
        chart.removeOverlay({ id: `pf-order-${id}` });
        overlaySnapshotRef.current.delete(id);
      }
    }
  }, [orderLines]);

  /**
   * Builds the per-instance event handlers shared by BOTH the hydration
   * effect (server-loaded rows) and the active-tool draw-start effect
   * (fresh draws) — one definition so the onRemoved/onPressedMoveEnd/
   * onSelected/onDeselected contract can never drift between the two call
   * sites. Reads everything through the module-scope refs above (never a
   * closure over a prop directly), so it's safe to construct fresh at each
   * `createOverlay` call without any staleness risk. Wrapped in
   * `useCallback` with an empty dependency array — it closures ONLY over
   * the stable refs above (never a prop/state value directly) so its own
   * identity never needs to change, which lets the effects below list it
   * as a dependency honestly instead of disabling the lint rule.
   */
  const buildDrawingEventHandlers = useCallback((): {
    onRemoved: OverlayEventCallback<unknown>;
    onPressedMoveEnd: OverlayEventCallback<unknown>;
    onSelected: OverlayEventCallback<unknown>;
    onDeselected: OverlayEventCallback<unknown>;
  } => {
    return {
      onRemoved: (event) => {
        const overlayId = event.overlay.id;
        drawingOverlayIdsRef.current.delete(overlayId);
        if (selectedDrawingOverlayIdRef.current === overlayId) selectedDrawingOverlayIdRef.current = null;
        const persistedId = overlayIdToPersistedIdRef.current.get(overlayId) ?? null;
        overlayIdToPersistedIdRef.current.delete(overlayId);
        if (suspendDrawingSyncRef.current) return; // programmatic teardown (hydration replace / clear-all) — never DELETE. See module-scope doc.
        if (persistedId) {
          hydratedRowIdsRef.current.delete(persistedId);
          onDrawingRemovedRef.current?.(persistedId);
        }
      },
      onPressedMoveEnd: (event) => {
        const persistedId = overlayIdToPersistedIdRef.current.get(event.overlay.id);
        if (!persistedId) return; // a drag before the create-POST resolved — vanishingly rare (drag can't start until the draw itself, which IS the create trigger, has already completed); no-op rather than a lossy partial update.
        const points = toDrawingPoints(event.overlay.points);
        if (points.length > 0) onDrawingMoveEndRef.current?.(persistedId, { points });
      },
      onSelected: (event) => {
        selectedDrawingOverlayIdRef.current = event.overlay.id;
        const persistedId = overlayIdToPersistedIdRef.current.get(event.overlay.id) ?? null;
        const anchor = firstPointPixelAnchor(event.overlay.points);
        if (anchor) onDrawingSelectedRef.current?.({ overlayId: event.overlay.id, persistedId, overlayName: event.overlay.name, left: anchor.left, top: anchor.top });
      },
      onDeselected: (event) => {
        if (selectedDrawingOverlayIdRef.current === event.overlay.id) selectedDrawingOverlayIdRef.current = null;
        onDrawingDeselectedRef.current?.();
      }
      // eslint-disable-next-line react-hooks/exhaustive-deps
    };
  }, []);

  // ── W3, T4 — drawings hydration effect: load-on-open. Identity-keyed on
  // `drawings` (populated once by `use-chart-drawings.ts`'s `load()`) — safe
  // per this file's own "one-way sync can't cycle" reasoning documented at
  // the top of this file, since nothing this effect calls feeds back into
  // `drawings`' own recreation. `hydratedRowIdsRef` prevents a double-create
  // both across repeated hydration passes AND against a row that was JUST
  // created via the active-tool draw flow below (which adds to
  // `hydratedRowIdsRef` itself, synchronously, the moment its create-POST
  // resolves — see that effect). Unknown `overlayName` values (a future
  // tool added after a drawing was saved) are skipped, not rendered broken
  // and not treated as an error — forward-compatible degradation per W1's
  // schema design.
  //
  // **S1, T7 — the hydration-gap fix**: `row.styles` is now passed into
  // `createOverlay` (`styles: row.styles ?? undefined`) — previously
  // dropped entirely, meaning a saved color/width choice silently reverted
  // on every reload. This is the concrete "was silently broken, now fixed"
  // proof the style editor ticket names explicitly. ───────────────────────
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart || !drawings) return;

    const seenRowIds = new Set<string>();
    for (const row of drawings) {
      seenRowIds.add(row.id);
      if (hydratedRowIdsRef.current.has(row.id)) continue; // already on-canvas (prior hydration pass, or a just-finished fresh draw).
      if (!(ALL_DRAWING_OVERLAYS as readonly string[]).includes(row.overlayName)) continue; // unknown overlay name — skip, don't render broken.
      const overlayId = `dw_${row.id}`;
      const created = chart.createOverlay({
        name: row.overlayName,
        id: overlayId,
        points: row.points.map((p) => ({ timestamp: p.timestamp, value: p.value })),
        visible: row.visible,
        lock: false,
        styles: asOverlayStyles(row.styles),
        extendData: buildExtendDataForOverlay(row.overlayName),
        ...buildDrawingEventHandlers()
      });
      if (created != null) {
        drawingOverlayIdsRef.current.add(overlayId);
        hydratedRowIdsRef.current.add(row.id);
        overlayIdToPersistedIdRef.current.set(overlayId, row.id);
      }
    }

    // A row that left `drawings` (deleted via another tab / the hotkey /
    // clear-all on a stale reference) but is still shown here — visual
    // cleanup only, guarded so it can never re-fire a DELETE for a row
    // that's already gone server-side.
    for (const rowId of Array.from(hydratedRowIdsRef.current)) {
      if (seenRowIds.has(rowId)) continue;
      const overlayId = `dw_${rowId}`;
      suspendDrawingSyncRef.current = true;
      try {
        chart.removeOverlay({ id: overlayId });
      } finally {
        suspendDrawingSyncRef.current = false;
      }
      hydratedRowIdsRef.current.delete(rowId);
      drawingOverlayIdsRef.current.delete(overlayId);
      overlayIdToPersistedIdRef.current.delete(overlayId);
    }
  }, [drawings, buildDrawingEventHandlers]);

  // ── W3, T3 — active-tool draw-start effect. `activeTool` is a primitive
  // string prop; a NEW non-null value starts one KLineCharts native
  // step-by-step drawing session (built-in click-through-N-points behavior
  // — no custom click handling needed here at all, confirmed against the
  // installed package's real behavior). `onDrawEnd` both notifies the
  // parent (clears `activeTool`) and, if a create callback is wired, POSTs
  // the finished points and patches the persistedId side-channel onto this
  // SAME overlay once that resolves — entirely within this closure, no
  // ref/imperative-handle needed. S1 additions: `pendingToolStyles` (a
  // preset, e.g. the emoji flyout's chosen emoji or the highlighter's
  // preset brush styles) is applied AT CREATION, and text-family tools fire
  // `onDrawingNeedsText` once their row exists. ──────────────────────────
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart || !activeTool) return;
    if (activeToolRef.current === activeTool) return;
    const toolName = activeTool; // captured into a `const` so the closures below keep a non-nullable `string` even though the `activeTool` prop's own type is `string | null | undefined` (TS narrowing doesn't persist into nested closures for a destructured prop binding).
    activeToolRef.current = toolName;

    const overlayId = `draw_pending_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    const handlers = buildDrawingEventHandlers();
    const initialStyles = pendingToolStylesRef.current ?? undefined;
    const onDrawEnd: OverlayEventCallback<unknown> = (event) => {
      const id = event.overlay.id;
      pendingDrawOverlayIdRef.current = null;
      activeToolRef.current = null;
      drawingOverlayIdsRef.current.add(id);
      const points = toDrawingPoints(event.overlay.points);
      onToolDrawEndRef.current?.();
      const creator = onDrawingCreateRef.current;
      if (!creator || points.length === 0) return;
      void creator(toolName, points, initialStyles).then((row) => {
        if (!row) return; // create() already surfaced the "not saved" toast via use-chart-drawings.ts's own error state — the overlay stays on-screen, unpersisted, exactly per the brief.
        hydratedRowIdsRef.current.add(row.id);
        overlayIdToPersistedIdRef.current.set(id, row.id);
        if (TEXT_INPUT_OVERLAYS.has(toolName)) {
          const anchor = firstPointPixelAnchor(event.overlay.points);
          if (anchor) onDrawingNeedsTextRef.current?.({ overlayId: id, persistedId: row.id, overlayName: toolName, left: anchor.left, top: anchor.top });
        }
      });
    };

    const createdId = chart.createOverlay({
      name: toolName,
      id: overlayId,
      mode: magnetModeRef.current ?? "normal",
      styles: asOverlayStyles(initialStyles),
      extendData: buildExtendDataForOverlay(toolName),
      ...handlers,
      onDrawEnd
    });

    const resolvedId = Array.isArray(createdId) ? createdId[0] : createdId;
    pendingDrawOverlayIdRef.current = resolvedId ?? overlayId;
  }, [activeTool, buildDrawingEventHandlers]);

  // ── W3, T3 — cancel-in-progress-draw (Escape) and clear-all nonces. ────
  const lastCancelNonceRef = useRef(cancelDrawingNonce ?? 0);
  useEffect(() => {
    if (cancelDrawingNonce === undefined || cancelDrawingNonce === lastCancelNonceRef.current) return;
    lastCancelNonceRef.current = cancelDrawingNonce;
    const chart = chartRef.current;
    const pendingId = pendingDrawOverlayIdRef.current;
    if (chart && pendingId) {
      suspendDrawingSyncRef.current = true;
      try {
        chart.removeOverlay({ id: pendingId });
      } finally {
        suspendDrawingSyncRef.current = false;
      }
      drawingOverlayIdsRef.current.delete(pendingId);
    }
    pendingDrawOverlayIdRef.current = null;
    activeToolRef.current = null;
  }, [cancelDrawingNonce]);

  const lastClearNonceRef = useRef(clearAllDrawingsNonce ?? 0);
  useEffect(() => {
    if (clearAllDrawingsNonce === undefined || clearAllDrawingsNonce === lastClearNonceRef.current) return;
    lastClearNonceRef.current = clearAllDrawingsNonce;
    const chart = chartRef.current;
    if (chart) {
      suspendDrawingSyncRef.current = true;
      try {
        for (const overlayId of Array.from(drawingOverlayIdsRef.current)) {
          chart.removeOverlay({ id: overlayId });
        }
      } finally {
        suspendDrawingSyncRef.current = false;
      }
      drawingOverlayIdsRef.current.clear();
      hydratedRowIdsRef.current.clear();
      overlayIdToPersistedIdRef.current.clear();
      selectedDrawingOverlayIdRef.current = null;
    }
    onAllDrawingsClearedRef.current?.();
  }, [clearAllDrawingsNonce]);

  // ── S1, T7 — style-editor instant visual feedback: `overrideOverlay` on
  // command, zero round-trip latency (the debounced PATCH itself is fired
  // by the caller directly against `use-chart-drawings.ts`'s `update()`). ─
  const lastStyleNonceRef = useRef(drawingStyleCommand?.nonce ?? 0);
  useEffect(() => {
    if (!drawingStyleCommand || drawingStyleCommand.nonce === lastStyleNonceRef.current) return;
    lastStyleNonceRef.current = drawingStyleCommand.nonce;
    chartRef.current?.overrideOverlay({ id: drawingStyleCommand.id, styles: asOverlayStyles(drawingStyleCommand.styles) });
  }, [drawingStyleCommand]);

  // ── S1, T5/T7 — remove-by-id command: the D10 empty-text-popover delete
  // and the style editor's Delete button. NOT suspended — a real
  // user-initiated delete, reaches `onDrawingRemoved` → the server DELETE
  // via the exact same path as the Backspace hotkey. ─────────────────────
  const lastRemoveNonceRef = useRef(removeDrawingCommand?.nonce ?? 0);
  useEffect(() => {
    if (!removeDrawingCommand || removeDrawingCommand.nonce === lastRemoveNonceRef.current) return;
    lastRemoveNonceRef.current = removeDrawingCommand.nonce;
    chartRef.current?.removeOverlay({ id: removeDrawingCommand.id });
  }, [removeDrawingCommand]);

  // ── Founder feedback (2026-08-04), Part 1 — the indicator settings ─────
  // popover's STYLE section: nonce-driven `overrideIndicator({id, styles})`,
  // same idiom as `drawingStyleCommand` above. See this prop's own doc for
  // why a single-element `styles.lines` array is deliberately applied
  // UNIFORMLY to every line-type figure of the instance.
  const lastIndicatorStyleNonceRef = useRef(indicatorStyleCommand?.nonce ?? 0);
  useEffect(() => {
    if (!indicatorStyleCommand || indicatorStyleCommand.nonce === lastIndicatorStyleNonceRef.current) return;
    lastIndicatorStyleNonceRef.current = indicatorStyleCommand.nonce;
    const chart = chartRef.current;
    if (!chart) return;
    // `name` is a REQUIRED field on `overrideIndicator`'s own type (same gotcha as the
    // eye-toggle handler above) — read live off the instance rather than widening this
    // prop's payload with a redundant `name` the caller would have to keep in sync itself.
    const [live] = chart.getIndicators({ id: indicatorStyleCommand.id });
    if (!live) return;
    chart.overrideIndicator({ id: indicatorStyleCommand.id, name: live.name, styles: indicatorStyleCommand.styles as DeepPartial<IndicatorStyle> });
  }, [indicatorStyleCommand]);

  return <div ref={containerRef} className="h-full w-full min-h-[420px]" />;
}
