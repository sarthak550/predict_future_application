"use client";

/**
 * Charting Workbench (W2, T2 shell + T4 click-to-trade wiring; W3, T3/T4/T5
 * wires drawings + premium mode; TA Suite Sprint S1, T5/T6/T7 wires the new
 * drawing families' text popover + toolbar redesign + style editor) — the
 * fullscreen "maximize" surface: `createPortal`'d to `document.body`,
 * `fixed inset-0 z-50`, body-scroll-locked while open. Layout: a top bar
 * (title, honest-data chip, timeframe pills, indicator picker, minimize),
 * then a three-column row (44px drawing-tool rail / chart / a 360px
 * collapsible ticket panel).
 *
 * Rendered via `next/dynamic(..., {ssr:false})` ONLY while open by every
 * caller (paper-trading-dashboard.tsx / futures-page-client.tsx /
 * options-page-client.tsx) — see workbench-maximize-button.tsx — so the
 * ~200KB-gz `klinecharts` chunk this file (transitively, via kline-chart.tsx)
 * pulls in is paid only on first maximize, never on a terminal's initial
 * page load.
 *
 * **S1 additions**:
 *   - `pendingToolStyles`: set by `WorkbenchToolbar`'s widened
 *     `onSelectTool(name, presetStyles?)` — covers the `highlighter` alias
 *     (D2: maps to the real `brush` overlay name + a preset) and the emoji
 *     flyout's chosen `pfContent.emoji`, both applied at the MOMENT a new
 *     drawing is created.
 *   - `magnetEnabled` — the toolbar's magnet toggle, threaded to
 *     `<KlineChart>`'s `magnetMode` prop (`createOverlay`'s own `mode`
 *     field).
 *   - `selectedDrawing` — populated by `onDrawingSelected` (already-wired
 *     `onSelected` event, per T7's own doc), drives the floating
 *     `<DrawingStyleToolbar>`. Swatch/width picks merge into the
 *     drawing's CURRENT `styles` (looked up from `drawingsHook.drawings`
 *     by `persistedId`) across the `line`/`polygon`/`text` buckets a pick
 *     could plausibly affect, apply an instant `overrideOverlay` via
 *     `drawingStyleCommand`, and fire a debounced PATCH directly against
 *     `use-chart-drawings.ts`'s `update()`.
 *   - `textPopover` — the D10 popover, opened either right after a
 *     text-family tool finishes drawing (`onDrawingNeedsText`) or via the
 *     style editor's "Edit text" button. Empty-text dismissal removes the
 *     overlay AND its DB row via `removeDrawingCommand` (the exact same
 *     path the Backspace hotkey already uses).
 *   - Escape priority chain widens by one tier: text popover > popover >
 *     active drawing tool > workbench close (the text popover handles its
 *     own Escape internally, so this file's own listener just has to not
 *     ALSO close the workbench while it's open).
 */
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Loader2, Minimize2, PanelRightClose, PanelRightOpen } from "lucide-react";

import { ChartOrderIntentPopover } from "@/components/finance/chart-order-intent-popover";
import type { ChartOrderLine, OrderSide, OrderVariant } from "@/components/finance/chart-order-lines";
import { KlineChart } from "./kline-chart";
import { TimeframeSelector } from "./timeframe-selector";
import { IndicatorDialog } from "./indicator-dialog";
import { IndicatorActiveStrip } from "./indicator-active-strip";
import { IndicatorSettingsPopover } from "./indicator-settings-popover";
import {
  EMPTY_SELECTION,
  MAX_SUB_PANE_INSTANCES,
  createInstanceId,
  getIndicatorMeta,
  loadStoredSelection,
  saveStoredSelection,
  sanitizeSelectionForMode,
  resolveParams,
  type IndicatorInstance,
  type IndicatorSelection
} from "./indicator-registry";
import { WorkbenchToolbar } from "./workbench-toolbar";
import { DrawingStyleToolbar } from "./drawing-style-toolbar";
import { DrawingTextPopover } from "./drawing-text-popover";
import { useChartDrawings } from "./use-chart-drawings";
import { useWorkbenchCandles, WORKBENCH_INTERVALS, PREMIUM_INTERVALS, type CandleInterval, type WorkbenchFeed } from "./use-workbench-candles";
import {
  StrategyConfigPanel,
  StrategyDisclaimerFooter,
  loadStoredStrategyConfig,
  saveStoredStrategyConfig,
  type StrategyRunResult
} from "./strategy-panel";
import { STRATEGY_LIST, getStrategyDef, clampStrategyParams, resolveStrategyParams, defaultParamValues } from "@/lib/ta/strategies";
import { runBacktest, intervalToProductType } from "@/lib/ta/backtest";
import { computeIndicatorSignal, type IndicatorSignal } from "@/lib/ta/indicator-signals";
import { computeTechnicalRating } from "@/lib/ta/technicals";
import { TechnicalsGauge } from "./technicals-gauge";

export type { WorkbenchFeed } from "./use-workbench-candles";

/** Text-family tools that get the D10 popover — see kline-chart.tsx's own `TEXT_INPUT_OVERLAYS` (this is a small, deliberate duplication rather than exporting an internal symbol from that file). Founder-feedback pass (2026-08-03) widens this with `textLabel`/`priceNote`/`commentBubble`/`signpost`. */
const TEXT_FAMILY_OVERLAYS = new Set(["calloutText", "noteAnchored", "textLabel", "priceNote", "commentBubble", "signpost"]);
/** Popover titles for each text-family tool — falls back to "Callout text" for anything unlisted (defensive, should never actually hit given the Set above is kept in sync). */
const TEXT_POPOVER_TITLES: Record<string, string> = {
  calloutText: "Callout text",
  noteAnchored: "Note",
  textLabel: "Text label",
  priceNote: "Price note",
  commentBubble: "Comment",
  signpost: "Signpost"
};

interface SelectedDrawingInfo {
  overlayId: string;
  persistedId: string | null;
  overlayName: string;
  left: number;
  top: number;
}

interface TextPopoverInfo {
  overlayId: string;
  persistedId: string;
  overlayName: string;
  left: number;
  top: number;
  initialText: string;
}

function formatIstDateShort(iso: string): string {
  return new Intl.DateTimeFormat("en-IN", { day: "2-digit", month: "short", timeZone: "Asia/Kolkata" }).format(new Date(iso));
}

function mergeStylesPatch(current: Record<string, unknown> | null | undefined, patch: Record<string, unknown>): Record<string, unknown> {
  const base = (current ?? {}) as Record<string, Record<string, unknown> | undefined>;
  const result: Record<string, unknown> = { ...base };
  for (const [bucket, value] of Object.entries(patch)) {
    result[bucket] = { ...(base[bucket] ?? {}), ...(value as Record<string, unknown>) };
  }
  return result;
}

export function ChartWorkbench({
  feed,
  chartKey,
  title,
  onClose,
  orderLines,
  onOrderIntentConfirm,
  onOrderLineDrag,
  onOrderLineCancel,
  onQuoteChange,
  ticket
}: {
  feed: WorkbenchFeed;
  /** `EQ:SYMBOL` / `INDEX:SYMBOL` / `OPT:UNDERLYING:EXPIRY:STRIKE:TYPE` — drives `use-chart-drawings.ts`'s per-chart persistence (W3). Futures and the options terminal's underlying chart deliberately share the SAME `INDEX:` key (W1's schema design) so a trendline drawn on one appears on the other. */
  chartKey: string;
  title: string;
  onClose: () => void;
  orderLines: ChartOrderLine[];
  onOrderIntentConfirm?: (input: { price: number; side: OrderSide; variant: OrderVariant }) => void;
  onOrderLineDrag?: (id: string, newPrice: number) => void;
  onOrderLineCancel?: (id: string) => void;
  onQuoteChange?: (quote: { price: number; prevClose: number | null; changeAbs: number; changePct: number } | null) => void;
  /** The SAME `DockedOrderTicket` element instance the caller's terminal shell would otherwise render — the ticket single-mount rule (see workbench-maximize-button.tsx's own doc) requires this be the ONE mounted copy while the workbench is open. */
  ticket: ReactNode;
}) {
  const isPremiumMode = feed.kind === "optionPremium";
  const [chartInterval, setChartInterval] = useState<CandleInterval>(() => (isPremiumMode ? "15m" : "5m"));

  // TA Suite S2 — indicator library state: a multi-instance selection (see
  // `indicator-registry.ts`'s own doc for why an instance, not a bare name,
  // is the unit of selection). Restored once, after mount (same
  // localStorage-after-hydration posture `indicator-picker.tsx` used), via
  // the graceful v1→v2 reader — sanitized against THIS instance's mode
  // (spot/premium) and starting interval immediately on restore.
  const [indicators, setIndicators] = useState<IndicatorSelection>(EMPTY_SELECTION);
  const [indicatorDialogOpen, setIndicatorDialogOpen] = useState(false);
  const [indicatorSettings, setIndicatorSettings] = useState<{ instance: IndicatorInstance; left: number; top: number } | null>(null);

  useEffect(() => {
    const stored = loadStoredSelection();
    if (stored) setIndicators(sanitizeSelectionForMode(stored, { mode: isPremiumMode ? "premium" : "spot", interval: chartInterval }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // T5 — the dual VWAP gate (premium OR 1d) and the premium volume-set gate
  // are both interval/mode-dependent; re-sanitize whenever either changes
  // underneath an already-open workbench (e.g. the user flips to `1d` with
  // VWAP already on the chart) — not just once at restore.
  useEffect(() => {
    setIndicators((prev) => sanitizeSelectionForMode(prev, { mode: isPremiumMode ? "premium" : "spot", interval: chartInterval }));
  }, [chartInterval, isPremiumMode]);

  function persistIndicators(next: IndicatorSelection) {
    setIndicators(next);
    saveStoredSelection(next);
  }

  function handleAddIndicator(name: string) {
    const meta = getIndicatorMeta(name);
    if (!meta) return;
    const instance: IndicatorInstance = { instanceId: createInstanceId(name), name };
    if (meta.pane === "main") {
      persistIndicators({ ...indicators, main: [...indicators.main, instance] });
    } else {
      if (indicators.sub.length >= MAX_SUB_PANE_INSTANCES) return; // dialog already disables this row — defensive no-op.
      persistIndicators({ ...indicators, sub: [...indicators.sub, instance] });
    }
  }

  function handleRemoveIndicator(instanceId: string) {
    persistIndicators({
      main: indicators.main.filter((i) => i.instanceId !== instanceId),
      sub: indicators.sub.filter((i) => i.instanceId !== instanceId)
    });
    if (indicatorSettings?.instance.instanceId === instanceId) setIndicatorSettings(null);
  }

  function handleOpenIndicatorSettings(instance: IndicatorInstance, anchor: { left: number; top: number }) {
    setIndicatorSettings({ instance, ...anchor });
  }

  function handleApplyIndicatorSettings(params: number[]) {
    if (!indicatorSettings) return;
    const targetId = indicatorSettings.instance.instanceId;
    const updateList = (list: IndicatorInstance[]) => list.map((i) => (i.instanceId === targetId ? { ...i, params } : i));
    persistIndicators({ main: updateList(indicators.main), sub: updateList(indicators.sub) });
  }

  // Founder feedback (2026-08-04), Part 1 — the settings popover's STYLE
  // section: a nonce-driven command channel straight to `KlineChart`'s
  // `overrideIndicator({styles})` call, same idiom as the S1 drawing style
  // editor's `drawingStyleCommand`. Deliberately NOT persisted to React
  // state/localStorage (line color/width is chart-session-only, ephemeral —
  // consistent with the eye-toggle's own visibility state, which lives
  // entirely inside klinecharts, never round-tripped into `IndicatorInstance`).
  const [indicatorStyleCommand, setIndicatorStyleCommand] = useState<{ id: string; styles: Record<string, unknown>; nonce: number } | null>(null);
  const indicatorStyleNonceRef = useRef(0);
  function handleApplyIndicatorStyle(patch: { color?: string; size?: number }) {
    if (!indicatorSettings) return;
    indicatorStyleNonceRef.current += 1;
    const line: Record<string, unknown> = {};
    if (patch.color !== undefined) line.color = patch.color;
    if (patch.size !== undefined) line.size = patch.size;
    setIndicatorStyleCommand({ id: indicatorSettings.instance.instanceId, styles: { lines: [line] }, nonce: indicatorStyleNonceRef.current });
  }

  const [ticketCollapsed, setTicketCollapsed] = useState(false);
  const [intentPopover, setIntentPopover] = useState<{ price: number; left: number; top: number } | null>(null);

  const { candles, status, errorMessage, sourceLabel, quote, premiumMeta } = useWorkbenchCandles(feed, chartInterval);

  // Founder-feedback pass (2026-08-03) — PART A (per-indicator signal chips) + PART B (Technicals Rating gauge).
  // Both `computeIndicatorSignal`/`computeTechnicalRating` are pure functions over `candles` — recomputed here
  // (the owner of both the candle array and the indicator-selection state) and threaded down as plain data,
  // same "compute in the parent, render in the child" split `drawingsHook`/`strategyRunResult` already use.
  // Keyed on PRIMITIVES only (render-loop law) — `candlesKey` is the candle array's own last timestamp + length
  // (recomputes exactly when the loaded window actually changes, not on every render), `instancesKey` is a
  // stringified snapshot of every active instance's id/name/params (recomputes exactly when an indicator is
  // added/removed/reconfigured) — NEITHER memo depends on the `candles`/`indicators` object references directly.
  const candlesKey = candles.length > 0 ? `${candles.length}:${candles[candles.length - 1].timestamp}` : "empty";
  const instancesKey = [...indicators.main, ...indicators.sub].map((i) => `${i.instanceId}:${i.name}:${(i.params ?? []).join(",")}`).join("|");

  // Founder feedback (2026-08-04), Part 1 — the detached strip now
  // crosshair-follows too (the on-chart legend gets this natively — see
  // `kline-chart.tsx`'s own doc; this strip has no such native mechanism).
  // `hoveredDataIndex` is `null` when the crosshair isn't over the chart —
  // `computeIndicatorSignal`'s own `atIndex` contract already treats
  // `undefined` as "use the latest bar," so `?? undefined` below is the
  // correct null->undefined bridge, not a workaround.
  const [hoveredDataIndex, setHoveredDataIndex] = useState<number | null>(null);

  const instanceSignals = useMemo(() => {
    const map = new Map<string, IndicatorSignal>();
    for (const instance of [...indicators.main, ...indicators.sub]) {
      map.set(instance.instanceId, computeIndicatorSignal(instance.name, resolveParams(instance), candles, hoveredDataIndex ?? undefined));
    }
    return map;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [instancesKey, candlesKey, hoveredDataIndex]);

  const technicalRating = useMemo(
    () => computeTechnicalRating(candles),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [candlesKey]
  );

  // TA Suite S3 — right-panel tabs (D5: [Ticket | Strategy] segmented,
  // ticket stays MOUNTED and CSS-hidden, never conditionally rendered — the
  // single-mount rule). `hasOpenedStrategyTab` is sticky true (never resets
  // to false) once the Strategy tab is first opened — it gates
  // `StrategyDisclaimerFooter`'s render (see that component's own doc for
  // why the disclaimer lives OUTSIDE the tab-scoped wrapper and needs its
  // own separate visibility condition).
  const [rightPanelTab, setRightPanelTab] = useState<"ticket" | "strategy">("ticket");
  const [hasOpenedStrategyTab, setHasOpenedStrategyTab] = useState(false);
  function selectRightPanelTab(tab: "ticket" | "strategy") {
    setRightPanelTab(tab);
    if (tab === "strategy") setHasOpenedStrategyTab(true);
  }

  const [strategyId, setStrategyId] = useState<string>(STRATEGY_LIST[0].id);
  const [strategyParams, setStrategyParams] = useState<number[]>(() => defaultParamValues(STRATEGY_LIST[0]));
  const [strategyNotional, setStrategyNotional] = useState(100000);
  const [strategyRunResult, setStrategyRunResult] = useState<StrategyRunResult | null>(null);

  // Restored once, after mount (same localStorage-after-hydration posture as the indicator selection above).
  useEffect(() => {
    const stored = loadStoredStrategyConfig();
    if (!stored) return;
    setStrategyId(stored.id);
    setStrategyParams(stored.params);
    setStrategyNotional(stored.notional);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    saveStoredStrategyConfig({ id: strategyId, params: strategyParams, notional: strategyNotional });
  }, [strategyId, strategyParams, strategyNotional]);

  function handleStrategyIdChange(id: string) {
    const def = getStrategyDef(id);
    if (!def) return;
    setStrategyId(id);
    setStrategyParams(defaultParamValues(def)); // a different strategy's params are a different shape/scale entirely — reset to its own defaults, never carry over the previous strategy's positional values.
  }

  function handleRunStrategy() {
    const def = getStrategyDef(strategyId);
    if (!def || candles.length === 0) return;
    const clampedParams = clampStrategyParams(def, strategyParams);
    const keyedParams = resolveStrategyParams(def, clampedParams);
    const signals = def.compute(candles, keyedParams);
    const productType = intervalToProductType(chartInterval);
    const stats = runBacktest(candles, signals, { notional: strategyNotional, productType });
    setStrategyParams(clampedParams);
    setStrategyRunResult({
      id: strategyId,
      params: clampedParams,
      signals,
      stats,
      ranInterval: chartInterval,
      ranCandleCount: candles.length,
      ranProductType: productType
    });
  }

  function handleClearSignals() {
    setStrategyRunResult(null);
  }

  // D8 — the SAME {id, params} the last Run used, not the live (possibly
  // since-edited) strategyId/strategyParams state — the on-chart markers
  // and the stats card must always describe the SAME run, never a
  // markers-updated-live-but-stats-stale mismatch (params are still edited
  // freely between runs; only clicking Run commits a new markers+stats pair
  // together). PF_SIGNALS' own `calc` still recomputes fresh from whatever
  // candles are CURRENTLY loaded on every render (an interval change is
  // self-correcting for the markers), it's only strategyRunResult's STATS
  // that can go stale relative to a changed interval — see
  // `strategy-panel.tsx`'s `isStale` check for that surfacing.
  const signalsConfig = strategyRunResult ? { id: strategyRunResult.id, params: strategyRunResult.params } : null;

  // W3, T3/T4 — drawing tool state + persistence hook.
  const [activeTool, setActiveTool] = useState<string | null>(null);
  const [pendingToolStyles, setPendingToolStyles] = useState<Record<string, unknown> | null>(null);
  const [cancelDrawingNonce, setCancelDrawingNonce] = useState(0);
  const [clearAllDrawingsNonce, setClearAllDrawingsNonce] = useState(0);
  const drawingsHook = useChartDrawings(chartKey);
  const loadDrawings = drawingsHook.load;
  useEffect(() => {
    void loadDrawings();
  }, [loadDrawings]);

  // S1, T6 — magnet toggle.
  const [magnetEnabled, setMagnetEnabled] = useState(false);

  // S1, T7 — the currently-selected drawing (style editor target) + the
  // instant-visual `overrideOverlay` command channel + the shared
  // remove-by-id command channel (both the style editor's Delete AND the
  // T5 empty-text-popover dismissal use the SAME channel).
  const [selectedDrawing, setSelectedDrawing] = useState<SelectedDrawingInfo | null>(null);
  const [drawingStyleCommand, setDrawingStyleCommand] = useState<{ id: string; styles: Record<string, unknown>; nonce: number } | null>(null);
  const [removeDrawingCommand, setRemoveDrawingCommand] = useState<{ id: string; nonce: number } | null>(null);
  const styleCommandNonceRef = useRef(0);
  const removeCommandNonceRef = useRef(0);

  // S1, T5 — the D10 text popover.
  const [textPopover, setTextPopover] = useState<TextPopoverInfo | null>(null);

  const selectedRow = useMemo(
    () => (selectedDrawing?.persistedId ? drawingsHook.drawings.find((d) => d.id === selectedDrawing.persistedId) ?? null : null),
    [selectedDrawing, drawingsHook.drawings]
  );

  function cancelActiveDrawing() {
    if (!activeTool) return;
    setCancelDrawingNonce((n) => n + 1);
    setActiveTool(null);
    setPendingToolStyles(null);
  }

  function handleSelectTool(name: string, presetStyles?: Record<string, unknown>) {
    if (activeTool) setCancelDrawingNonce((n) => n + 1); // abandon whatever was in progress before starting a new one.
    setPendingToolStyles(presetStyles ?? null);
    setActiveTool(name);
  }

  function handleClearAll() {
    setClearAllDrawingsNonce((n) => n + 1);
    setSelectedDrawing(null);
    setTextPopover(null);
  }

  function applyStylePatch(patch: Record<string, unknown>) {
    if (!selectedDrawing) return;
    const nextStyles = mergeStylesPatch(selectedRow?.styles, patch);
    styleCommandNonceRef.current += 1;
    setDrawingStyleCommand({ id: selectedDrawing.overlayId, styles: nextStyles, nonce: styleCommandNonceRef.current });
    if (selectedDrawing.persistedId) drawingsHook.update(selectedDrawing.persistedId, { styles: nextStyles });
  }

  function handleStyleDelete() {
    if (!selectedDrawing) return;
    removeCommandNonceRef.current += 1;
    setRemoveDrawingCommand({ id: selectedDrawing.overlayId, nonce: removeCommandNonceRef.current });
    setSelectedDrawing(null);
  }

  function handleEditText() {
    if (!selectedDrawing?.persistedId) return;
    const pfContent = (selectedRow?.styles as { pfContent?: { text?: string } } | undefined)?.pfContent;
    setTextPopover({
      overlayId: selectedDrawing.overlayId,
      persistedId: selectedDrawing.persistedId,
      overlayName: selectedDrawing.overlayName,
      left: selectedDrawing.left,
      top: selectedDrawing.top,
      initialText: pfContent?.text ?? ""
    });
  }

  function handleDrawingNeedsText(info: { overlayId: string; persistedId: string; overlayName: string; left: number; top: number }) {
    setTextPopover({ ...info, initialText: "" });
  }

  function handleTextConfirm(text: string) {
    if (!textPopover) return;
    const row = drawingsHook.drawings.find((d) => d.id === textPopover.persistedId);
    const nextStyles = mergeStylesPatch(row?.styles, { pfContent: { text } });
    drawingsHook.update(textPopover.persistedId, { styles: nextStyles });
    styleCommandNonceRef.current += 1;
    setDrawingStyleCommand({ id: textPopover.overlayId, styles: nextStyles, nonce: styleCommandNonceRef.current });
    setTextPopover(null);
  }

  function handleTextDismissEmpty() {
    if (!textPopover) return;
    removeCommandNonceRef.current += 1;
    setRemoveDrawingCommand({ id: textPopover.overlayId, nonce: removeCommandNonceRef.current });
    setTextPopover(null);
    setSelectedDrawing(null);
  }

  // Body scroll lock while the workbench is open, restored on close.
  useEffect(() => {
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prevOverflow;
    };
  }, []);

  // W3, T5; S1 widens with a new top tier — Escape priority chain: text
  // popover (handles its own Escape internally — this listener just has to
  // step aside) > order-intent popover > active drawing tool > workbench
  // close.
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key !== "Escape") return;
      if (textPopover) return;
      if (intentPopover) return; // ChartOrderIntentPopover's own listener handles it first.
      if (activeTool) {
        cancelActiveDrawing();
        return;
      }
      onClose();
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [textPopover, intentPopover, activeTool, onClose]);

  const onQuoteChangeRef = useRef(onQuoteChange);
  onQuoteChangeRef.current = onQuoteChange;
  useEffect(() => {
    onQuoteChangeRef.current?.(quote);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [quote?.price, quote?.prevClose, quote?.changeAbs, quote?.changePct]);

  const onOrderIntentConfirmRef = useRef(onOrderIntentConfirm);
  onOrderIntentConfirmRef.current = onOrderIntentConfirm;

  // W3, T4 — drawing tools suppress click-to-trade for their entire session
  // (from tool selection through draw completion/cancel), same contract W2
  // reserved this flag for.
  const isDrawingActive = activeTool !== null;

  function handleSurfaceClick(info: { price: number; left: number; top: number }) {
    if (!onOrderIntentConfirm) return;
    setIntentPopover(info);
  }

  const currentPrice = candles.length > 0 ? candles[candles.length - 1].close : (isPremiumMode ? feed.livePremium : null);

  // W3, T5 — premium-mode honest-data framing, replacing the equity/index
  // chip. Bucket size reflects the ACTUAL active interval (15 or 30) rather
  // than a hardcoded "15-min" string — a 30m chart labeled "15-min" would
  // itself be a dishonest label, contradicting the whole point of this
  // feature (flagged as a deliberate deviation from the brief's literal
  // fixed-string wording — see final report).
  const premiumSnapshotCount = premiumMeta?.totalSnapshots ?? 0;
  const premiumTooSparse = isPremiumMode && premiumSnapshotCount < 3;
  const premiumLabel =
    isPremiumMode && premiumMeta?.earliestCapturedAt
      ? `${chartInterval === "30m" ? "30" : "15"}-min pseudo-candles from 5-min snapshots · delayed · since ${formatIstDateShort(premiumMeta.earliestCapturedAt)}`
      : null;
  // Reused verbatim from terminal/premium-chart.tsx's own copy (never invent new wording — the brief's explicit instruction).
  const premiumAccrualNote =
    premiumSnapshotCount === 0
      ? "No premium history captured for this contract yet — history accrues as this contract is viewed (5-minute snapshots while it's on someone's screen)."
      : "Not enough premium ticks yet — check back shortly.";

  const activeColor = (selectedRow?.styles as { line?: { color?: string } } | undefined)?.line?.color ?? null;
  const activeWidth = (selectedRow?.styles as { line?: { size?: number } } | undefined)?.line?.size ?? null;

  const content = (
    <div className="fixed inset-0 z-50 flex flex-col bg-white" data-chart-key={chartKey}>
      <div className="flex flex-wrap items-center gap-3 border-b border-ink-100 px-4 py-2.5">
        <p className="text-sm font-semibold text-ink-900">{title}</p>
        {isPremiumMode ? (
          premiumLabel && (
            <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-700">{premiumLabel}</span>
          )
        ) : (
          <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-700">
            Delayed data · {sourceLabel.replace("Delayed market data ", "").replace(/[()]/g, "") || "Yahoo"}
          </span>
        )}
        <TimeframeSelector intervals={isPremiumMode ? PREMIUM_INTERVALS : WORKBENCH_INTERVALS} value={chartInterval} onChange={setChartInterval} />
        <IndicatorActiveStrip
          instances={[...indicators.main, ...indicators.sub]}
          signals={instanceSignals}
          onOpenSettings={handleOpenIndicatorSettings}
          onRemove={handleRemoveIndicator}
          onOpenDialog={() => setIndicatorDialogOpen(true)}
        />
        <button
          type="button"
          onClick={() => setTicketCollapsed((v) => !v)}
          className="ml-auto rounded-lg p-2 text-ink-400 hover:bg-ink-100 hover:text-ink-700"
          title={ticketCollapsed ? "Show order ticket" : "Hide order ticket"}
        >
          {ticketCollapsed ? <PanelRightOpen className="h-4 w-4" /> : <PanelRightClose className="h-4 w-4" />}
        </button>
        <button type="button" onClick={onClose} className="rounded-lg p-2 text-ink-500 hover:bg-ink-100 hover:text-ink-900" title="Minimize (Esc)">
          <Minimize2 className="h-4 w-4" />
        </button>
      </div>

      {drawingsHook.error && (
        <div className="flex items-center gap-2 border-b border-rose-200 bg-rose-50 px-4 py-1.5 text-xs text-rose-800">
          <span>{drawingsHook.error}</span>
          <button type="button" className="underline" onClick={drawingsHook.dismissError}>
            Dismiss
          </button>
        </div>
      )}

      <div className="flex min-h-0 flex-1">
        <WorkbenchToolbar
          activeTool={activeTool}
          onSelectTool={handleSelectTool}
          onCancelActiveTool={cancelActiveDrawing}
          onClearAll={handleClearAll}
          magnetEnabled={magnetEnabled}
          onToggleMagnet={() => setMagnetEnabled((v) => !v)}
          premiumMode={isPremiumMode}
        />

        <div className="relative min-w-0 flex-1">
          {status === "loading" && (
            <div className="flex h-full items-center justify-center text-sm text-ink-400">
              <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />
              Loading candles…
            </div>
          )}
          {status === "error" && (
            <div className="flex h-full items-center justify-center px-6 text-center text-sm text-ink-500">{errorMessage}</div>
          )}
          {status === "unsupported" && (
            <div className="flex h-full items-center justify-center px-6 text-center text-sm text-ink-500">{errorMessage}</div>
          )}
          {status === "ready" && premiumTooSparse && (
            <div className="flex h-full items-center justify-center px-6 text-center text-sm text-ink-500">{premiumAccrualNote}</div>
          )}
          {status === "ready" && !premiumTooSparse && (
            <KlineChart
              candles={candles}
              interval={chartInterval}
              mainIndicators={indicators.main}
              subIndicators={indicators.sub}
              signalsConfig={signalsConfig}
              orderLines={orderLines}
              onSurfaceClick={handleSurfaceClick}
              onOrderLineDrag={onOrderLineDrag}
              onOrderLineCancel={onOrderLineCancel}
              suspendClick={isDrawingActive}
              drawings={drawingsHook.drawings}
              activeTool={activeTool}
              pendingToolStyles={pendingToolStyles}
              magnetMode={magnetEnabled ? "weak_magnet" : "normal"}
              onToolDrawEnd={() => {
                setActiveTool(null);
                setPendingToolStyles(null);
              }}
              onDrawingCreate={drawingsHook.create}
              onDrawingMoveEnd={drawingsHook.update}
              onDrawingRemoved={drawingsHook.remove}
              onDrawingSelected={setSelectedDrawing}
              onDrawingDeselected={() => setSelectedDrawing(null)}
              onDrawingNeedsText={handleDrawingNeedsText}
              cancelDrawingNonce={cancelDrawingNonce}
              clearAllDrawingsNonce={clearAllDrawingsNonce}
              onAllDrawingsCleared={drawingsHook.clearAll}
              drawingStyleCommand={drawingStyleCommand}
              removeDrawingCommand={removeDrawingCommand}
              onCrosshairDataIndexChange={setHoveredDataIndex}
              onIndicatorOpenSettings={handleOpenIndicatorSettings}
              onIndicatorRemove={handleRemoveIndicator}
              indicatorStyleCommand={indicatorStyleCommand}
            />
          )}

          {selectedDrawing && !textPopover && (
            <DrawingStyleToolbar
              left={selectedDrawing.left}
              top={selectedDrawing.top}
              activeColor={activeColor}
              activeWidth={activeWidth}
              canEditText={TEXT_FAMILY_OVERLAYS.has(selectedDrawing.overlayName)}
              onPickColor={(color) => applyStylePatch({ line: { color }, polygon: { color, borderColor: color }, text: { backgroundColor: color } })}
              onPickWidth={(width) => applyStylePatch({ line: { size: width } })}
              onEditText={TEXT_FAMILY_OVERLAYS.has(selectedDrawing.overlayName) ? handleEditText : undefined}
              onDelete={handleStyleDelete}
            />
          )}

          {textPopover && (
            <DrawingTextPopover
              left={textPopover.left}
              top={textPopover.top}
              initialText={textPopover.initialText}
              title={TEXT_POPOVER_TITLES[textPopover.overlayName] ?? "Callout text"}
              onConfirm={handleTextConfirm}
              onDismissEmpty={handleTextDismissEmpty}
            />
          )}

          {intentPopover && onOrderIntentConfirm && currentPrice != null && (
            <ChartOrderIntentPopover
              price={intentPopover.price}
              currentPrice={currentPrice}
              left={intentPopover.left}
              top={intentPopover.top}
              onConfirm={(side, variant) => {
                onOrderIntentConfirmRef.current?.({ price: intentPopover.price, side, variant });
                setIntentPopover(null);
              }}
              onDismiss={() => setIntentPopover(null)}
            />
          )}
        </div>

        {!ticketCollapsed && (
          <div className="flex w-[360px] shrink-0 flex-col border-l border-ink-100">
            {/* TA Suite S3, T3 — [Ticket | Strategy] segmented control (D5). Switching tabs NEVER unmounts either
                side (the single-mount rule) — both wrappers below are always in the DOM, toggled by CSS
                `display` only, so an in-progress order-ticket draft survives a trip through the Strategy tab. */}
            <div className="flex shrink-0 gap-1 border-b border-ink-100 p-2">
              <button
                type="button"
                onClick={() => selectRightPanelTab("ticket")}
                className={`flex-1 rounded-lg py-1.5 text-xs font-semibold ${
                  rightPanelTab === "ticket" ? "bg-sky-600 text-white" : "text-ink-500 hover:bg-ink-100"
                }`}
              >
                Ticket
              </button>
              <button
                type="button"
                onClick={() => selectRightPanelTab("strategy")}
                className={`flex-1 rounded-lg py-1.5 text-xs font-semibold ${
                  rightPanelTab === "strategy" ? "bg-sky-600 text-white" : "text-ink-500 hover:bg-ink-100"
                }`}
              >
                Strategy
              </button>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto p-3">
              <div style={{ display: rightPanelTab === "ticket" ? "block" : "none" }}>{ticket}</div>
              {hasOpenedStrategyTab && (
                <div style={{ display: rightPanelTab === "strategy" ? "block" : "none" }}>
                  <TechnicalsGauge rating={technicalRating} />
                  <StrategyConfigPanel
                    strategyId={strategyId}
                    onStrategyIdChange={handleStrategyIdChange}
                    paramValues={strategyParams}
                    onParamValuesChange={setStrategyParams}
                    notional={strategyNotional}
                    onNotionalChange={setStrategyNotional}
                    interval={chartInterval}
                    candleCount={candles.length}
                    isPremiumMode={isPremiumMode}
                    runResult={strategyRunResult}
                    onRun={handleRunStrategy}
                  />
                </div>
              )}
            </div>

            {/* Deliberately OUTSIDE the tab-scoped/scrollable region above — see strategy-panel.tsx's own doc for
                why the disclaimer needs its own always-visible position, not a child of either CSS-hidden wrapper. */}
            {hasOpenedStrategyTab && (
              <StrategyDisclaimerFooter
                runResult={strategyRunResult}
                liveInterval={chartInterval}
                liveCandleCount={candles.length}
                isPremiumMode={isPremiumMode}
                hasActiveSignals={strategyRunResult !== null}
                onClear={handleClearSignals}
              />
            )}
          </div>
        )}
      </div>

      {indicatorDialogOpen && (
        <IndicatorDialog
          mode={isPremiumMode ? "premium" : "spot"}
          interval={chartInterval}
          subCount={indicators.sub.length}
          onAdd={handleAddIndicator}
          onClose={() => setIndicatorDialogOpen(false)}
        />
      )}
      {indicatorSettings && (
        <IndicatorSettingsPopover
          instance={indicatorSettings.instance}
          left={indicatorSettings.left}
          top={indicatorSettings.top}
          onApply={handleApplyIndicatorSettings}
          onApplyStyle={handleApplyIndicatorStyle}
          onClose={() => setIndicatorSettings(null)}
        />
      )}
    </div>
  );

  return createPortal(content, document.body);
}
