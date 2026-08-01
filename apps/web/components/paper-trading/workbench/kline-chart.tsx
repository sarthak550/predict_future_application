"use client";

/**
 * Charting Workbench (W2, T1) — the imperative KLineCharts wrapper.
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
 */
import { useCallback, useEffect, useRef } from "react";
import {
  init,
  dispose,
  type Chart,
  type KLineData,
  type Period,
  type Styles,
  type DeepPartial,
  type NeighborData,
  type OverlayEventCallback
} from "klinecharts";

import { snapToTick, type ChartOrderLine } from "@/components/finance/chart-order-lines";
import { registerWorkbenchOrderLineOverlay, type PfOrderLineExtendData } from "./order-line-overlay";
import { registerCustomDrawingOverlays, ALL_DRAWING_OVERLAYS } from "./custom-overlays";
import type { ChartDrawingPoint, ChartDrawingRow } from "./use-chart-drawings";
import type { Candle } from "./use-workbench-candles";

registerWorkbenchOrderLineOverlay();
registerCustomDrawingOverlays();

/**
 * W3, T7 polish — dark-mode token mapping for the workbench's hardcoded
 * light-mode colors (`WORKBENCH_THEME` below, `custom-overlays.ts`'s
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
 * W3, T4 — the `extendData` shape every drawing overlay (built-in or
 * custom) carries at runtime: `{ persistedId: string | null }`, a mutable
 * pointer to its server row id, `null` until the create-POST resolves.
 *
 * Deliberately NOT expressed as a TypeScript interface threaded through
 * `OverlayEventCallback<E>`'s generic — `Chart.createOverlay`/
 * `overrideOverlay` are declared as FIXED (non-generic) methods on the
 * `Chart` interface (`createOverlay(value: string | OverlayCreate | ...)`,
 * `OverlayCreate` defaulting its own `E` to `unknown` with no way for a call
 * site to supply a narrower one) — confirmed by a direct `tsc` failure when
 * handlers were first typed against a `DrawingExtendData` interface
 * (contravariant parameter mismatch: `OverlayEventCallback<DrawingExtendData>`
 * is not assignable where `OverlayEventCallback<unknown>` is expected).
 * Handlers below are typed `OverlayEventCallback<unknown>` and use
 * `getPersistedId()` to narrow `extendData` at each read instead.
 */
function getPersistedId(extendData: unknown): string | null {
  if (extendData && typeof extendData === "object" && "persistedId" in extendData) {
    const value = (extendData as { persistedId: unknown }).persistedId;
    return typeof value === "string" ? value : null;
  }
  return null;
}

export function KlineChart({
  candles,
  interval,
  precision = 2,
  mainIndicators,
  subIndicators,
  orderLines,
  onSurfaceClick,
  onOrderLineDrag,
  onOrderLineCancel,
  suspendClick,
  drawings,
  activeTool,
  onToolDrawEnd,
  onDrawingCreate,
  onDrawingMoveEnd,
  onDrawingRemoved,
  cancelDrawingNonce,
  clearAllDrawingsNonce,
  onAllDrawingsCleared
}: {
  candles: Candle[];
  interval: string;
  /** Decimal places for price display/tooltip — the plan's fixed "precision 2" for every instrument this sprint charts. */
  precision?: number;
  /** MA/EMA/BOLL — rendered stacked in the main candle pane. */
  mainIndicators: string[];
  /** VOL/MACD/RSI — each rendered in its own sub-pane; the caller (indicator-picker.tsx via chart-workbench.tsx) enforces the max-2 cap, this wrapper just reflects whatever it's given. */
  subIndicators: string[];
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
  /** Fires once a draw session ends — completed OR cancelled — so the parent can clear `activeTool` (and un-suspend click-to-trade). */
  onToolDrawEnd?: () => void;
  /** W3, T4 step 3 — called with the finished drawing's overlay name + anchor points once `onDrawEnd` fires; the returned row (or `null` on failure) is used to patch `extendData.persistedId` onto the already-on-canvas overlay directly in this file — never round-tripped back out through a prop. */
  onDrawingCreate?: (overlayName: string, points: ChartDrawingPoint[]) => Promise<ChartDrawingRow | null>;
  /** W3, T4 step 4 — fired on `onPressedMoveEnd` for an already-persisted drawing; the debounce lives in `use-chart-drawings.ts`'s `update()`, not here. */
  onDrawingMoveEnd?: (persistedId: string, points: ChartDrawingPoint[]) => void;
  /** W3, T4 step 5 — fired on `onRemoved` for an already-persisted drawing, ONLY when not suspended (see `suspendDrawingSyncRef` below — the sprint's top-named correctness risk). */
  onDrawingRemoved?: (persistedId: string) => void;
  /** W3, T3 — bump to cancel the in-progress draw (Escape, chart-workbench.tsx's priority chain). Nonce idiom, matching this codebase's existing `selectionNonce`/`presetNonce` convention rather than a `forwardRef` imperative handle. */
  cancelDrawingNonce?: number;
  /** W3, T3 — bump to remove every drawing overlay from the canvas (toolbar's "Clear all", already confirmed by the caller) and fire `onAllDrawingsCleared`. */
  clearAllDrawingsNonce?: number;
  /** Fires once clear-all has finished removing overlays from the canvas — the parent calls `use-chart-drawings.ts`'s `clearAll()` (the ONE batched `DELETE ?chartKey=`) from here. */
  onAllDrawingsCleared?: () => void;
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
  //   - `suspendDrawingSyncRef` — true only for the DURATION of a
  //     programmatic `removeOverlay` call this component itself makes
  //     (hydration cleanup, clear-all) — false at every other moment,
  //     including the delete-hotkey path below, so a real user delete still
  //     reaches `onDrawingRemoved`. THE guard the brief names as this
  //     sprint's top correctness risk: without it, loading a user's saved
  //     drawings (createOverlay in a loop, each of which can trigger a
  //     KLineCharts-internal cleanup of a REPLACED same-id overlay) could
  //     fire `onRemoved` and immediately re-delete what was just loaded.
  //   - `pendingDrawOverlayIdRef` — the overlay id of an in-progress
  //     (not-yet-`totalStep`-complete) draw, so Escape can cancel exactly
  //     that one (confirmed against the installed package's own
  //     `getOverlaysByFilter`: an in-progress overlay IS matched by id, so
  //     `removeOverlay({id})` correctly aborts a mid-draw shape too).
  //   - `selectedDrawingOverlayIdRef` — tracks the currently-selected
  //     drawing (via each instance's own `onSelected`/`onDeselected`) for
  //     the Backspace/Delete-to-remove hotkey.
  const drawingOverlayIdsRef = useRef<Set<string>>(new Set());
  const hydratedRowIdsRef = useRef<Set<string>>(new Set());
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

  // Chart Trading + SL/TP parity (Sprint C, C1) — the SAME anti-snap-back /
  // click-suppression pair price-chart.tsx uses, reimplemented here since
  // KLineCharts renders everything on one canvas (no separate DOM element
  // per line to `stopPropagation` on — see order-line-overlay.ts's own doc).
  const draggingIdRef = useRef<string | null>(null);
  const dragJustEndedRef = useRef(false);
  const dragStartPriceRef = useRef<Record<string, number>>({});

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

    function handleClick(e: MouseEvent) {
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
      document.removeEventListener("keydown", handleKeyDown);
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

  // ── Indicators effect: keyed on primitive joined-name strings. ─────────
  const mainKey = mainIndicators.join(",");
  const subKey = subIndicators.join(",");
  const activeMainRef = useRef<Set<string>>(new Set());
  const activeSubRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;

    const nextMain = new Set(mainKey ? mainKey.split(",") : []);
    for (const name of activeMainRef.current) {
      if (!nextMain.has(name)) chart.removeIndicator({ name, paneId: MAIN_PANE_ID });
    }
    for (const name of nextMain) {
      if (!activeMainRef.current.has(name)) chart.createIndicator({ name, paneId: MAIN_PANE_ID }, true);
    }
    activeMainRef.current = nextMain;

    const nextSub = new Set(subKey ? subKey.split(",") : []);
    for (const name of activeSubRef.current) {
      if (!nextSub.has(name)) chart.removeIndicator({ name });
    }
    for (const name of nextSub) {
      if (!activeSubRef.current.has(name)) chart.createIndicator(name, false);
    }
    activeSubRef.current = nextSub;
  }, [mainKey, subKey]);

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
        if (suspendDrawingSyncRef.current) return; // programmatic teardown (hydration replace / clear-all) — never DELETE. See module-scope doc.
        const persistedId = getPersistedId(event.overlay.extendData);
        if (persistedId) {
          hydratedRowIdsRef.current.delete(persistedId);
          onDrawingRemovedRef.current?.(persistedId);
        }
      },
      onPressedMoveEnd: (event) => {
        const persistedId = getPersistedId(event.overlay.extendData);
        if (!persistedId) return; // a drag before the create-POST resolved — vanishingly rare (drag can't start until the draw itself, which IS the create trigger, has already completed); no-op rather than a lossy partial update.
        const points = toDrawingPoints(event.overlay.points);
        if (points.length > 0) onDrawingMoveEndRef.current?.(persistedId, points);
      },
      onSelected: (event) => {
        selectedDrawingOverlayIdRef.current = event.overlay.id;
      },
      onDeselected: (event) => {
        if (selectedDrawingOverlayIdRef.current === event.overlay.id) selectedDrawingOverlayIdRef.current = null;
      }
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
  // schema design. ───────────────────────────────────────────────────────
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
        extendData: { persistedId: row.id },
        ...buildDrawingEventHandlers()
      });
      if (created != null) {
        drawingOverlayIdsRef.current.add(overlayId);
        hydratedRowIdsRef.current.add(row.id);
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
    }
  }, [drawings, buildDrawingEventHandlers]);

  // ── W3, T3 — active-tool draw-start effect. `activeTool` is a primitive
  // string prop; a NEW non-null value starts one KLineCharts native
  // step-by-step drawing session (built-in click-through-N-points behavior
  // — no custom click handling needed here at all, confirmed against the
  // installed package's real behavior, see custom-overlays.ts's module
  // doc). `onDrawEnd` both notifies the parent (clears `activeTool`) and, if
  // a create callback is wired, POSTs the finished points and patches
  // `extendData.persistedId` onto this SAME overlay once that resolves —
  // entirely within this closure, no ref/imperative-handle needed. ───────
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart || !activeTool) return;
    if (activeToolRef.current === activeTool) return;
    const toolName = activeTool; // captured into a `const` so the closures below keep a non-nullable `string` even though the `activeTool` prop's own type is `string | null | undefined` (TS narrowing doesn't persist into nested closures for a destructured prop binding).
    activeToolRef.current = toolName;

    const overlayId = `draw_pending_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    const handlers = buildDrawingEventHandlers();
    const onDrawEnd: OverlayEventCallback<unknown> = (event) => {
      const id = event.overlay.id;
      pendingDrawOverlayIdRef.current = null;
      activeToolRef.current = null;
      drawingOverlayIdsRef.current.add(id);
      const points = toDrawingPoints(event.overlay.points);
      onToolDrawEndRef.current?.();
      const creator = onDrawingCreateRef.current;
      if (!creator || points.length === 0) return;
      void creator(toolName, points).then((row) => {
        if (!row) return; // create() already surfaced the "not saved" toast via use-chart-drawings.ts's own error state — the overlay stays on-screen, unpersisted, exactly per the brief.
        hydratedRowIdsRef.current.add(row.id);
        chartRef.current?.overrideOverlay({ id, extendData: { persistedId: row.id } });
      });
    };

    const createdId = chart.createOverlay({
      name: toolName,
      id: overlayId,
      extendData: { persistedId: null },
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
      selectedDrawingOverlayIdRef.current = null;
    }
    onAllDrawingsClearedRef.current?.();
  }, [clearAllDrawingsNonce]);

  return <div ref={containerRef} className="h-full w-full min-h-[420px]" />;
}
