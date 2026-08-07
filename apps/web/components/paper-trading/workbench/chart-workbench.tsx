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
 *
 * **Founder feature (2026-08-04) — option chain visible while maximized,
 * widened 2026-08-09 to the futures contract table.** An optional `chain`
 * prop widens the right-panel segmented control from `[Ticket | Strategy]`
 * to `[Ticket | <chainLabel> | Strategy]` (options-page-client.tsx passes its
 * `OptionChainBrowser` element labeled "Chain"; futures-page-client.tsx
 * passes its `FuturesContractTable` element labeled "Contracts" via the
 * optional `chainLabel` prop — every other caller omits `chain` and keeps
 * the original two-tab control exactly as before). `chain`, like `ticket`,
 * is the caller's SAME single-mount element instance (null'd out of
 * `TerminalShell`'s ladder slot while any workbench is open — the exact
 * conditional-swap idiom this file's `ticket` prop already uses) — rendered
 * here in its OWN CSS-hidden wrapper, always mounted alongside
 * Ticket/Strategy, so its own poll and internal selection state survive
 * every tab switch. An optional `chartModeSwitcher` prop renders a small
 * pill in the top bar (e.g. options' Underlying/Premium toggle) so a strike
 * picked from the Chain tab can jump straight to viewing its premium chart
 * without minimizing first — deliberately generic (label + onClick only),
 * so this file stays instrument-agnostic. Futures has only one chart mode
 * (index spot), so its call site omits `chartModeSwitcher` entirely.
 *
 * **Interaction-model rework (2026-08-04) — founder complaint, verbatim:
 * "I cant have buy/sell popup on every click, thats irritating."** A plain
 * click on the canvas no longer opens `ChartOrderIntentPopover` (T4's
 * original click-to-trade wiring is removed outright — see kline-chart.tsx's
 * own `onAxisHoverChange`/`onSurfaceContextMenu` doc). Replaced by
 * TradingView's own two-summon-point pattern: a price-axis "+" button
 * (`ChartAxisPlusButton`, positioned by the continuous `axisHover` state
 * KlineChart's `onAxisHoverChange` feeds) opens the SAME popover, and a
 * right-click opens a compact `ChartContextMenu` ("Buy at ₹X / Sell at ₹X")
 * that fires `onOrderIntentConfirm` directly. Both are suppressed
 * (`suppressTradeAffordances`) while a drawing tool is armed OR a drawing is
 * selected — drawing interactions always win. A one-time `ChartTradeHint`
 * (localStorage-dismissed, shared across all four chart surfaces) tells
 * returning users where trading moved.
 *
 * **Founder feature (2026-08-07) — TradingView-style symbol switcher.**
 * "The ability to change the stock or option or future from enlarged chart
 * view only... click on the top left where you see the asset name... search
 * for any other asset and open the chart view directly." The header title
 * (below) becomes a clickable button whenever the optional `onSymbolPick`
 * prop is supplied, opening `SymbolSearchPopover` (`symbol-search-popover.tsx`)
 * anchored underneath it. This file stays instrument-agnostic about what a
 * pick actually DOES — same posture as `chartModeSwitcher` — the caller's
 * `onSymbolPick` decides whether a pick switches THIS workbench in place
 * (new `feed`/`chartKey` props on the caller's own state) or navigates to a
 * different terminal (see paper-trading-dashboard.tsx's/
 * futures-page-client.tsx's/options-page-client.tsx's own
 * `handleWorkbenchSymbolPick` docs for the exact in-place-vs-navigate
 * matrix). Omitted entirely by no current caller — every one of the 4
 * `DynamicChartWorkbench` mounts across the 3 terminals wires it — but kept
 * optional so a future bare caller degrades to the plain, non-interactive
 * title this component always had, never a crash.
 */
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import dynamic from "next/dynamic";
import { ArrowLeftRight, Code2, Loader2, Minimize2, PanelRightClose, PanelRightOpen, Search } from "lucide-react";

import { isIndexOptionUnderlying } from "@predict-future/business-rules/papertrading/optionContract";

import { ChartOrderIntentPopover } from "@/components/finance/chart-order-intent-popover";
import { ChartAxisPlusButton } from "@/components/finance/chart-axis-plus-button";
import { ChartContextMenu } from "@/components/finance/chart-context-menu";
import { ChartTradeHint, useTradeHintDismissed } from "@/components/finance/chart-trade-hint";
import type { ChartOrderLine, OrderSide, OrderVariant } from "@/components/finance/chart-order-lines";
import { KlineChart, type PfSignalsConfig } from "./kline-chart";
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
  buildIndicatorLineStyles,
  type IndicatorInstance,
  type IndicatorSelection,
  type IndicatorLineFigure,
  type LineStyleOverride
} from "./indicator-registry";
import { WorkbenchToolbar } from "./workbench-toolbar";
import { DrawingStyleToolbar } from "./drawing-style-toolbar";
import { DrawingTextPopover } from "./drawing-text-popover";
import { PanelResizeHandle, PANEL_DEFAULT_WIDTH, clampPanelWidth } from "./panel-resize-handle";
import { useChartDrawings } from "./use-chart-drawings";
import { useWorkbenchCandles, WORKBENCH_INTERVALS, premiumIntervalsFor, type CandleInterval, type WorkbenchFeed } from "./use-workbench-candles";
import {
  StrategyConfigPanel,
  StrategyDisclaimerFooter,
  loadStoredStrategyConfig,
  saveStoredStrategyConfig,
  type StrategyRunResult
} from "./strategy-panel";
import { STRATEGY_LIST, getStrategyDef, clampStrategyParams, resolveStrategyParams, defaultParamValues } from "@/lib/ta/strategies";
import type { StrategySignal } from "@/lib/ta/strategies";
import { runBacktest, intervalToProductType } from "@/lib/ta/backtest";
import { computeIndicatorSignal, type IndicatorSignal } from "@/lib/ta/indicator-signals";
import { combineRatingWithCustoms, computeTechnicalRating, computeTechnicalDetail, evaluateCustomSignal, type DetailRow } from "@/lib/ta/technicals";
import { TechnicalsGauge } from "./technicals-gauge";
import { SignalsTable } from "./signals-table";
import { CustomSignalBuilder, loadStoredCustomSignals, saveStoredCustomSignals, type CustomSignalItem } from "./custom-signal-builder";
import { HeartbeatChip } from "./heartbeat-chip";
import { SymbolSearchPopover } from "./symbol-search-popover";
import type { SymbolPick } from "./use-symbol-search";

export type { WorkbenchFeed } from "./use-workbench-candles";

/**
 * User Strategy Scripting (SS2), D2 — the script editor drawer is a THIRD-
 * level lazy chunk: this file is already the SECOND level (rendered only
 * via `next/dynamic(..., {ssr:false})` from `workbench-maximize-button.tsx`,
 * see this file's own module doc), and `ScriptEditorDrawer` is dynamically
 * imported from HERE, nested one level deeper — so CodeMirror's payload is
 * paid only when a user who has ALREADY paid for the klinecharts chunk (by
 * maximizing a chart) THEN also opens the Scripts drawer. This file itself
 * never statically imports anything from `codemirror`/
 * `@codemirror/lang-javascript` — only the small toggle button below and a
 * `boolean` open/closed state live here; everything downstream of this
 * `dynamic(...)` call is where CodeMirror actually gets pulled in.
 */
const ScriptEditorDrawer = dynamic(() => import("./user-scripts/script-editor-drawer").then((m) => m.ScriptEditorDrawer), { ssr: false });

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

/** Human label per interval for the premium honest-data chip — see this file's premiumLabel doc. */
const PREMIUM_INTERVAL_LABEL: Record<CandleInterval, string> = {
  "1m": "1-min",
  "5m": "5-min",
  "15m": "15-min",
  "30m": "30-min",
  "60m": "1-hour",
  "1d": "1-day"
};

// Founder-feedback pass (2026-08-04) — resizable right panel width,
// localStorage-persisted (same "restore once, after mount" posture as
// `indicators`/`strategyId`/`customSignals` below — this file's established
// convention for every localStorage-backed preference, so a stored value
// never causes an SSR/first-paint mismatch even though this whole component
// only ever mounts client-side, see module doc). Validated + clamped on
// read so a hand-edited or stale-schema localStorage value can never hand
// klinecharts' container a width outside `[PANEL_MIN_WIDTH,
// PANEL_MAX_WIDTH]`.
const PANEL_WIDTH_STORAGE_KEY = "pf.workbench.panelWidth";

function loadStoredPanelWidth(): number {
  try {
    const raw = window.localStorage.getItem(PANEL_WIDTH_STORAGE_KEY);
    if (!raw) return PANEL_DEFAULT_WIDTH;
    const parsed = Number(raw);
    return clampPanelWidth(parsed);
  } catch {
    return PANEL_DEFAULT_WIDTH; // private mode / storage disabled.
  }
}

function saveStoredPanelWidth(width: number): void {
  try {
    window.localStorage.setItem(PANEL_WIDTH_STORAGE_KEY, String(width));
  } catch {
    // Preference just won't survive the refresh.
  }
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
  ticket,
  chain,
  chainLabel = "Chain",
  chartModeSwitcher,
  onSymbolPick
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
  /** Founder feature (2026-08-04) — the SAME `OptionChainBrowser`/`FuturesContractTable` element instance the caller's terminal shell would otherwise render in its ladder slot, single-mount just like `ticket`. Present: right panel gains a tab (labeled `chainLabel`) between Ticket and Strategy. Absent (every other caller): the panel stays `[Ticket | Strategy]`, unchanged. */
  chain?: ReactNode;
  /** Founder feature (2026-08-09) — the tab label for `chain`, since what's actually embedded differs per terminal (options: "Chain" for the strike browser; futures: "Contracts" for the near/next/far ladder). Defaults to "Chain" so options' existing call site needs no change. Ignored when `chain` is absent. */
  chainLabel?: string;
  /** Founder feature (2026-08-04) — an optional top-bar pill for jumping to a sibling workbench (e.g. options' Underlying <-> Premium chart) without minimizing first. Purely a label + callback so this file never needs to know what "the other chart" means for a given terminal. */
  chartModeSwitcher?: { label: string; onClick: () => void };
  /** Founder feature (2026-08-07) — makes the header title clickable, opening the symbol-search popover; see this file's own module doc for the full feature and the caller-owned in-place-vs-navigate decision. Optional so a bare caller keeps the plain, non-interactive title. */
  onSymbolPick?: (pick: SymbolPick) => void;
}) {
  const isPremiumMode = feed.kind === "optionPremium";
  // Interval-parity cadence project (2026-08-07) — the offered timeframe
  // set now differs by contract type (index vs stock, see
  // `premiumIntervalsFor`'s own doc); defaulting to that set's OWN fastest
  // entry (1m for index, 5m for stock) is the interval most likely to show
  // data immediately for a freshly-opened contract, matching this project's
  // "build the live chart from the moment they watch" goal. Computed
  // straight from `feed` rather than `isPremiumMode` so TypeScript narrows
  // `feed.underlying` correctly inside this lazy initializer (it only runs
  // once, at mount, same as before).
  const [chartInterval, setChartInterval] = useState<CandleInterval>(() =>
    feed.kind === "optionPremium" ? premiumIntervalsFor(feed.underlying)[0] : "5m"
  );
  const premiumIntervals = feed.kind === "optionPremium" ? premiumIntervalsFor(feed.underlying) : WORKBENCH_INTERVALS;

  // TA Suite S2 — indicator library state: a multi-instance selection (see
  // `indicator-registry.ts`'s own doc for why an instance, not a bare name,
  // is the unit of selection). Restored once, after mount (same
  // localStorage-after-hydration posture `indicator-picker.tsx` used), via
  // the graceful v1→v2 reader — sanitized against THIS instance's mode
  // (spot/premium) and starting interval immediately on restore.
  const [indicators, setIndicators] = useState<IndicatorSelection>(EMPTY_SELECTION);
  const [indicatorDialogOpen, setIndicatorDialogOpen] = useState(false);
  // Founder bug fix (2026-08-04, per-line style pass) — holds only the
  // OPENED instance's id + anchor, never a snapshot of the instance object
  // itself: the Style section's swatch clicks update `indicators` (React
  // state, see `applyIndicatorLineStyle` below) while the popover stays
  // open for further clicks, so the rendered `instance` prop must always be
  // looked up fresh from `indicators` (`settingsInstance` below) — a
  // captured snapshot would show a stale "active" swatch ring after the
  // first click.
  const [indicatorSettings, setIndicatorSettings] = useState<{ instanceId: string; left: number; top: number } | null>(null);
  const settingsInstance = indicatorSettings
    ? ([...indicators.main, ...indicators.sub].find((i) => i.instanceId === indicatorSettings.instanceId) ?? null)
    : null;
  // Founder bug fix (2026-08-04, per-line style pass) — `instanceId -> line
  // figure[]` map, kept fresh by `KlineChart`'s `onIndicatorFiguresChange`
  // (fires whenever its own indicator-sync effect runs — mount, add/remove,
  // or a params edit; see kline-chart.tsx's own doc for why this is always
  // re-read from the live chart rather than a hand-built catalogue).
  const [indicatorFigures, setIndicatorFigures] = useState<Map<string, IndicatorLineFigure[]>>(() => new Map());

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
    if (indicatorSettings?.instanceId === instanceId) setIndicatorSettings(null);
  }

  function handleOpenIndicatorSettings(instance: IndicatorInstance, anchor: { left: number; top: number }) {
    setIndicatorSettings({ instanceId: instance.instanceId, ...anchor });
  }

  function handleApplyIndicatorSettings(params: number[]) {
    if (!indicatorSettings) return;
    const targetId = indicatorSettings.instanceId;
    const updateList = (list: IndicatorInstance[]) => list.map((i) => (i.instanceId === targetId ? { ...i, params } : i));
    persistIndicators({ main: updateList(indicators.main), sub: updateList(indicators.sub) });
  }

  // Founder bug fix (2026-08-04, per-line style pass) — the settings
  // popover's Style section: a nonce-driven command channel straight to
  // `KlineChart`'s `overrideIndicator({styles})` call, same idiom as the S1
  // drawing style editor's `drawingStyleCommand`. UNLIKE the original
  // founder-feedback-pass version, per-line overrides ARE now persisted —
  // into `indicators` (React state) and localStorage via the normal
  // `persistIndicators` path — because a per-line override is a deliberate
  // user customization (not the ephemeral eye-toggle visibility bit), and
  // the whole point of this fix is that it survives a reload/params edit.
  const [indicatorStyleCommand, setIndicatorStyleCommand] = useState<{ id: string; styles: { lines: ReturnType<typeof buildIndicatorLineStyles> }; nonce: number } | null>(
    null
  );
  const indicatorStyleNonceRef = useRef(0);

  /**
   * Shared by both the per-line color picker and the shared-width control
   * below: updates every listed line INDEX's stored override with `patch`,
   * persists the whole selection (localStorage), then sends ONE dense
   * `styles.lines[]` array (`buildIndicatorLineStyles` — see its own doc for
   * why this must be dense, not sparse) through the instant-apply command
   * channel. A single state/command transaction for however many indices
   * are touched, so picking a shared width across N lines doesn't fire N
   * separate re-renders/overrideIndicator calls.
   */
  function applyIndicatorLineStyle(lineIndices: number[], patch: LineStyleOverride) {
    if (!indicatorSettings || lineIndices.length === 0) return;
    const targetId = indicatorSettings.instanceId;
    const figures = indicatorFigures.get(targetId) ?? [];
    if (figures.length === 0) return;

    let updated: IndicatorInstance | undefined;
    const updateList = (list: IndicatorInstance[]) =>
      list.map((i) => {
        if (i.instanceId !== targetId) return i;
        const nextLines = [...(i.styles?.lines ?? [])];
        for (const idx of lineIndices) nextLines[idx] = { ...(nextLines[idx] ?? {}), ...patch };
        updated = { ...i, styles: { lines: nextLines } };
        return updated;
      });
    const nextMain = updateList(indicators.main);
    const nextSub = updateList(indicators.sub);
    if (!updated) return;
    persistIndicators({ main: nextMain, sub: nextSub });

    indicatorStyleNonceRef.current += 1;
    setIndicatorStyleCommand({
      id: targetId,
      styles: { lines: buildIndicatorLineStyles(updated.styles?.lines, figures.length) },
      nonce: indicatorStyleNonceRef.current
    });
  }

  /** One color swatch row PER line figure — see `IndicatorSettingsPopover`'s Style section. */
  function handleApplyIndicatorLineColor(lineIndex: number, color: string) {
    applyIndicatorLineStyle([lineIndex], { color });
  }

  /**
   * A SINGLE shared width control for the whole instance rather than N
   * independent per-line width rows — a deliberate scope call (the brief
   * left this to CTO judgment): per-line width would double the Style
   * section's row count (color row + width row per line) for indicators
   * like `CR` (5 lines) or `MA`(4 lines) with little real-world value —
   * traders overwhelmingly want to tell lines APART by color, not by
   * varying line thickness. Applies `size` to every current line figure's
   * override in one transaction via `applyIndicatorLineStyle` above.
   */
  function handleApplyIndicatorWidth(size: number) {
    if (!indicatorSettings) return;
    const figures = indicatorFigures.get(indicatorSettings.instanceId) ?? [];
    applyIndicatorLineStyle(
      figures.map((f) => f.index),
      { size }
    );
  }

  const [ticketCollapsed, setTicketCollapsed] = useState(false);
  const [intentPopover, setIntentPopover] = useState<{ price: number; left: number; top: number } | null>(null);
  // Interaction-model rework (2026-08-04) — founder complaint, verbatim:
  // "I cant have buy/sell popup on every click, thats irritating." Plain
  // clicks on the canvas no longer open `intentPopover` at all (see
  // kline-chart.tsx's own `onAxisHoverChange`/`onSurfaceContextMenu` doc for
  // the full rework). `axisHover` mirrors KlineChart's continuous hover feed
  // (null while the pointer isn't over the price axis); `contextMenu` is the
  // right-click compact menu's own state, mutually exclusive with both
  // `intentPopover` and `axisHover`'s rendered button (see
  // `handleSurfaceClick`/`handleSurfaceContextMenu` below).
  const [axisHover, setAxisHover] = useState<{ price: number; left: number; top: number } | null>(null);
  const [contextMenu, setContextMenu] = useState<{ price: number; left: number; top: number } | null>(null);
  const [hintDismissed, dismissHint] = useTradeHintDismissed();

  // Founder feature (2026-08-07) — symbol-search popover anchor, `{left,top}`
  // from the header title button's own `getBoundingClientRect()` at click
  // time, same shape/idiom `indicatorSettings`/`customSignalBuilder` already
  // use for an anchored popover. `null` = closed.
  const [symbolSearchAnchor, setSymbolSearchAnchor] = useState<{ left: number; top: number } | null>(null);

  // Founder-feedback pass (2026-08-04) — resizable right panel. `panelRef`
  // is the imperative write target DURING a drag (`PanelResizeHandle`'s
  // `onResize`, rAF-throttled, never through `setState` — render-loop law);
  // `panelWidth` (React state) is only committed at drag-end and drives the
  // panel's `style.width` on every NORMAL render, so the two are always back
  // in sync the instant a drag finishes (no visual snap).
  const panelRef = useRef<HTMLDivElement | null>(null);
  /**
   * Founder bug fix (2026-08-07) — `panelWidth` used to be React STATE
   * driving both `getCurrentWidth` and the panel's own rendered
   * `style.width`. Live-reproduced (real DOM, prod standalone bundle, see
   * `script-editor-drawer.tsx`'s `drawerHeightRef` doc for the full
   * root-cause writeup on the Scripts drawer's own equivalent handle): an
   * unrelated re-render landing MID-DRAG reconciles a `style` prop back to
   * whatever React state last held, clobbering the drag's live imperative
   * DOM write — and this component is an especially live risk for exactly
   * that, since it re-renders on every live candle/quote tick
   * (`useWorkbenchCandles` below polls every few seconds during market
   * hours) while a user could easily still be mid-drag on this handle.
   * Converted from `useState` to a plain ref outright (a strictly SIMPLER
   * fix than mirroring state with a ref, which is what the drawer's own
   * `drawerHeightRef` still has to do because that value ALSO drives a
   * `[drawerHeight]`-keyed effect elsewhere — this value drives nothing but
   * its own rendered width, so there is no reason to keep a parallel state
   * copy around at all). The mount-restore effect below now does its own
   * one-time imperative DOM write (matching `handlePanelResize`'s own
   * pattern) instead of relying on a state-triggered re-render to apply the
   * restored width on first paint.
   */
  const panelWidthRef = useRef(PANEL_DEFAULT_WIDTH);
  useEffect(() => {
    const restored = loadStoredPanelWidth();
    panelWidthRef.current = restored;
    if (panelRef.current) panelRef.current.style.width = `${restored}px`;
  }, []);
  function handlePanelResize(width: number) {
    panelWidthRef.current = width;
    if (panelRef.current) panelRef.current.style.width = `${width}px`;
  }
  function handlePanelResizeEnd(width: number) {
    panelWidthRef.current = width;
    saveStoredPanelWidth(width);
  }
  function handlePanelReset() {
    handlePanelResize(PANEL_DEFAULT_WIDTH);
    saveStoredPanelWidth(PANEL_DEFAULT_WIDTH);
  }

  const { candles, status, errorMessage, sourceLabel, quote, premiumMeta, lastUpdatedAt, pollIntervalMs, liveTicksActive } = useWorkbenchCandles(feed, chartInterval);

  // Founder-feedback pass (2026-08-03) — PART A (per-indicator signal chips) + PART B (Technicals Rating gauge).
  // Both `computeIndicatorSignal`/`computeTechnicalRating` are pure functions over `candles` — recomputed here
  // (the owner of both the candle array and the indicator-selection state) and threaded down as plain data,
  // same "compute in the parent, render in the child" split `drawingsHook`/`strategyRunResult` already use.
  // Keyed on PRIMITIVES only (render-loop law) — `candlesKey` is the candle array's own last timestamp + length
  // (recomputes exactly when the loaded window actually changes, not on every render), `instancesKey` is a
  // stringified snapshot of every active instance's id/name/params (recomputes exactly when an indicator is
  // added/removed/reconfigured) — NEITHER memo depends on the `candles`/`indicators` object references directly.
  // Founder 2026-08-04: signals must update INSTANTLY during market hours —
  // an in-progress bar mutates close/high/low WITHOUT changing its timestamp,
  // so the key must include the last bar's values or intrabar ticks would
  // repaint the chart while the signal chips/table/gauge silently staled.
  const last = candles.length > 0 ? candles[candles.length - 1] : null;
  const candlesKey = last ? `${candles.length}:${last.timestamp}:${last.close}:${last.high}:${last.low}` : "empty";
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

  // Founder-feedback pass (2026-08-06) — the Signals table (TradingView's
  // Technicals DETAIL view). Same memo-key discipline as `technicalRating`
  // above (recomputed only when the loaded candle window actually changes)
  // — both now read the SAME `lib/ta/technicals.ts` rule table, see that
  // module's own "single source, no drift" doc.
  const technicalDetail = useMemo(
    () => computeTechnicalDetail(candles),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [candlesKey]
  );

  // Founder-feedback pass — the Signals table's THIRD "Custom" section:
  // "custom strategy… a '+' button for user to build and customise the
  // parameters and allowing to name these strategies." This component owns
  // the persisted `CustomSignalItem[]` array (restored-after-mount, same
  // localStorage posture as `indicators`/`strategyId` above) AND the
  // builder popover's open/closed state — `signals-table.tsx` stays purely
  // presentational, same "+"/gear split `indicator-active-strip.tsx`
  // already uses for `IndicatorDialog`/`IndicatorSettingsPopover`.
  const [customSignals, setCustomSignals] = useState<CustomSignalItem[]>([]);
  const [customSignalBuilder, setCustomSignalBuilder] = useState<{ editingItem: CustomSignalItem | null; anchor: { left: number; top: number } } | null>(
    null
  );

  useEffect(() => {
    setCustomSignals(loadStoredCustomSignals());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function persistCustomSignals(next: CustomSignalItem[]) {
    setCustomSignals(next);
    saveStoredCustomSignals(next);
  }

  function handleAddCustomSignal(anchor: { left: number; top: number }) {
    setCustomSignalBuilder({ editingItem: null, anchor });
  }

  function handleEditCustomSignal(item: CustomSignalItem, anchor: { left: number; top: number }) {
    setCustomSignalBuilder({ editingItem: item, anchor });
  }

  function handleRemoveCustomSignal(id: string) {
    persistCustomSignals(customSignals.filter((i) => i.id !== id));
  }

  function handleSaveCustomSignal(item: CustomSignalItem) {
    const exists = customSignals.some((i) => i.id === item.id);
    persistCustomSignals(exists ? customSignals.map((i) => (i.id === item.id ? item : i)) : [...customSignals, item]);
    setCustomSignalBuilder(null);
  }

  // Same memo-key discipline as `technicalDetail` above (candles) plus a
  // stringified snapshot of the custom items themselves (recomputes exactly
  // when a signal is added/edited/removed, not on every render — render-loop
  // law, keyed on primitives only, never the `customSignals` array reference
  // directly).
  const customSignalsKey = customSignals.map((i) => `${i.id}:${i.ruleId}:${i.params.join(",")}`).join("|");
  const customSignalRows = useMemo(() => {
    const map = new Map<string, DetailRow | undefined>();
    for (const item of customSignals) {
      map.set(item.id, evaluateCustomSignal(item.ruleId, item.params, candles));
    }
    return map;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [candlesKey, customSignalsKey]);

  // Founder 2026-08-04: the FINAL rating includes custom rows. Pure combine,
  // keyed on the same primitives as its inputs; skipped (needs-N-bars) rows
  // never vote (they have no signal).
  const combinedRating = useMemo(() => {
    const signals: Array<"buy" | "sell" | "neutral"> = [];
    for (const row of customSignalRows.values()) {
      if (row && !row.skipped) signals.push(row.signal);
    }
    if (signals.length === 0) return null;
    return combineRatingWithCustoms(technicalRating, signals);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [candlesKey, customSignalsKey]);

  // TA Suite S3 — right-panel tabs (D5: [Ticket | Strategy] segmented,
  // ticket stays MOUNTED and CSS-hidden, never conditionally rendered — the
  // single-mount rule). `hasOpenedStrategyTab` is sticky true (never resets
  // to false) once the Strategy tab is first opened — it gates
  // `StrategyDisclaimerFooter`'s render (see that component's own doc for
  // why the disclaimer lives OUTSIDE the tab-scoped wrapper and needs its
  // own separate visibility condition).
  const [rightPanelTab, setRightPanelTab] = useState<"ticket" | "chain" | "strategy">("ticket");
  const [hasOpenedStrategyTab, setHasOpenedStrategyTab] = useState(false);
  function selectRightPanelTab(tab: "ticket" | "chain" | "strategy") {
    setRightPanelTab(tab);
    if (tab === "strategy") setHasOpenedStrategyTab(true);
  }

  const [strategyId, setStrategyId] = useState<string>(STRATEGY_LIST[0].id);
  const [strategyParams, setStrategyParams] = useState<number[]>(() => defaultParamValues(STRATEGY_LIST[0]));
  const [strategyNotional, setStrategyNotional] = useState(100000);
  const [strategyRunResult, setStrategyRunResult] = useState<StrategyRunResult | null>(null);

  // User Strategy Scripting (SS2) — the `</> Scripts` bottom drawer.
  // `hasOpenedScriptDrawer` is sticky-true (never resets), same pattern as
  // `hasOpenedStrategyTab` above — it mounts `ScriptEditorDrawer` (and pays
  // its lazy-chunk cost) exactly once per workbench session; `scriptDrawerOpen`
  // only toggles a CSS `display` after that, so an in-progress edit/console
  // output/open-script selection survives closing and reopening the drawer.
  const [scriptDrawerOpen, setScriptDrawerOpen] = useState(false);
  const [hasOpenedScriptDrawer, setHasOpenedScriptDrawer] = useState(false);
  function toggleScriptDrawer() {
    setScriptDrawerOpen((v) => !v);
    setHasOpenedScriptDrawer(true);
  }

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
      ranProductType: productType,
      origin: { kind: "template", strategyId }
    });
    setActiveSignalsSource("template");
  }

  function handleClearSignals() {
    setStrategyRunResult(null);
    // Only clears the CHART's markers if the template run was actually the
    // active source — a script run's own markers (if any) are a fully
    // independent producer and must survive this button (User Strategy
    // Scripting SS2's "neither corrupts the other" contract).
    setActiveSignalsSource((prev) => (prev === "template" ? null : prev));
  }

  // User Strategy Scripting (SS2) — the script editor drawer's run results
  // feed the chart through this callback, completely independent of the
  // Strategy tab's own `strategyRunResult`/`handleRunStrategy` above (SS1's
  // `script-runner.ts` already resolved price/timestamp on the main thread
  // before this ever fires — see that file's own doc). `scriptSignalsConfig`
  // and `strategyRunResult` are BOTH always kept up to date independently;
  // `activeSignalsSource` alone decides which one is currently painted on
  // the single shared `PF_SIGNALS` chart instance — "last run wins," same
  // as a real terminal only ever shows one active strategy overlay at a
  // time. Switching the [Ticket | Strategy] tab, or opening/closing the
  // Scripts drawer, never touches this state — only clicking Run (either
  // producer) or Clear (template-scoped, see `handleClearSignals`) does.
  const [scriptSignalsConfig, setScriptSignalsConfig] = useState<{ kind: "script"; runToken: string; signals: StrategySignal[] } | null>(null);
  const [activeSignalsSource, setActiveSignalsSource] = useState<"template" | "script" | null>(null);

  function handleScriptSignals(config: { kind: "script"; runToken: string; signals: StrategySignal[] }) {
    setScriptSignalsConfig(config);
    setActiveSignalsSource("script");
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
  const signalsConfig: PfSignalsConfig | null =
    activeSignalsSource === "script" && scriptSignalsConfig
      ? scriptSignalsConfig
      : activeSignalsSource === "template" && strategyRunResult
        ? { kind: "template", id: strategyRunResult.id, params: strategyRunResult.params }
        : null;

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

  // Founder feature (2026-08-04) — the embedded Chain tab can now change
  // `chartKey` (e.g. selecting a different strike) while THIS workbench
  // instance stays mounted (see `useWorkbenchAutoRestore`'s no-op close in
  // options-page-client.tsx). `useChartDrawings`/`useWorkbenchCandles` above
  // already refetch correctly for the new chartKey/feed on their own
  // (identity/primitive-keyed effects — verified against both hooks' own
  // source), but any in-progress drawing tool/selection state belongs to the
  // PREVIOUS contract's canvas and must not silently carry over onto the new
  // one — `prevChartKeyRef` only fires this on a REAL change, never on mount.
  const prevChartKeyRef = useRef(chartKey);
  useEffect(() => {
    if (prevChartKeyRef.current === chartKey) return;
    prevChartKeyRef.current = chartKey;
    cancelActiveDrawing();
    setSelectedDrawing(null);
    setTextPopover(null);
    // Founder feature (2026-08-07) — a symbol pick already closes the popover
    // itself (see the `onPick` wiring below), but this guards the case of a
    // chartKey changing for some OTHER reason (e.g. the embedded Chain tab)
    // while it happened to still be open.
    setSymbolSearchAnchor(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chartKey]);

  // Interval-parity cadence project (2026-08-07) — a chartKey change (e.g.
  // the embedded Chain tab jumping from a STOCK premium contract to an INDEX
  // one) can land on a `premiumIntervals` set that no longer contains the
  // currently-selected `chartInterval` (index offers "1m", stock doesn't —
  // see `premiumIntervalsFor`'s own doc). Falls back to the new set's own
  // fastest entry, same choice the mount initializer makes.
  useEffect(() => {
    if (!premiumIntervals.includes(chartInterval)) setChartInterval(premiumIntervals[0]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [premiumIntervals]);

  // Body scroll lock while the workbench is open, restored on close.
  useEffect(() => {
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prevOverflow;
    };
  }, []);

  // W3, T5; S1 widens with a new top tier — Escape priority chain: symbol-
  // search popover (2026-08-07, handles its own Escape internally via its
  // input's own onKeyDown — this listener just has to step aside, same
  // deferral every other popover tier below already uses) > text popover >
  // order-intent popover > right-click trade menu (2026-08-04 rework, same
  // "handles its own Escape" deferral) > active drawing tool > workbench
  // close.
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key !== "Escape") return;
      if (symbolSearchAnchor) return; // SymbolSearchPopover's own listener handles it first.
      if (textPopover) return;
      if (intentPopover) return; // ChartOrderIntentPopover's own listener handles it first.
      if (contextMenu) return; // ChartContextMenu's own listener handles it first.
      if (activeTool) {
        cancelActiveDrawing();
        return;
      }
      onClose();
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [symbolSearchAnchor, textPopover, intentPopover, contextMenu, activeTool, onClose]);

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
  // reserved this flag for. Interaction-model rework (2026-08-04) widens
  // this with `selectedDrawing !== null` — the sprint brief's own item 4:
  // "while a drawing tool is armed or a drawing is selected, the hover-plus
  // stays hidden." A selected drawing (the floating `DrawingStyleToolbar`
  // is showing) means the user is actively editing that shape; a trade
  // affordance popping up nearby would compete with it.
  const isDrawingActive = activeTool !== null;
  const suppressTradeAffordances = isDrawingActive || selectedDrawing !== null;

  // Interaction-model rework (2026-08-04) — opens the SAME order-intent
  // popover Sprint C built. Called directly from the price-axis "+"
  // button's own `onClick` below — no longer routed through KlineChart at
  // all (the button lives OUTSIDE the canvas, in this component, driven by
  // the `axisHover` state KlineChart's `onAxisHoverChange` feeds). The
  // right-click menu deliberately does NOT go through this function — see
  // `handleSurfaceContextMenu` below, which fires `onOrderIntentConfirm`
  // directly as a LIMIT order (a right-click is already an explicit "trade
  // here," it doesn't need the popover's LIMIT/STOP inference on top).
  function handleSurfaceClick(info: { price: number; left: number; top: number }) {
    if (!onOrderIntentConfirm) return;
    setContextMenu(null);
    setAxisHover(null);
    setIntentPopover(info);
  }

  // Interaction-model rework (2026-08-04) — right-click's compact menu
  // state. Mutually exclusive with `intentPopover`/`axisHover`.
  function handleSurfaceContextMenu(info: { price: number; left: number; top: number }) {
    if (!onOrderIntentConfirm) return;
    setIntentPopover(null);
    setAxisHover(null);
    setContextMenu(info);
  }

  const currentPrice = candles.length > 0 ? candles[candles.length - 1].close : (isPremiumMode ? feed.livePremium : null);

  // W3, T5 — premium-mode honest-data framing, replacing the equity/index
  // chip.
  //
  // **Interval-parity cadence project (2026-08-07)** — this whole block was
  // built around a flat 5-minute cadence and a fixed 15m/30m interval set;
  // both are now per-contract (see `premiumIntervalsFor`'s own doc).
  // `premiumTooSparse` used to gate on a raw "<3 total snapshots ever"
  // count, which was only ever an approximation of "can ANY bucket render"
  // — now that native-granularity buckets need just 1 sample (see
  // `premium-candles.ts`'s own doc), that approximation would show the
  // empty-state text even once a real bar exists. Gates on the ACTUAL
  // aggregation result instead: `candles.length === 0` is the one true
  // "nothing to plot yet" signal, whatever the interval or contract type.
  const captureCadenceLabel = isPremiumMode && isIndexOptionUnderlying(feed.underlying) ? "1-minute" : "5-minute";
  const premiumSnapshotCount = premiumMeta?.totalSnapshots ?? 0;
  const premiumTooSparse = isPremiumMode && candles.length === 0;
  // The current interval is "native" when it's this contract's own fastest
  // offered timeframe (1m for index, 5m for stock) — at that width, a bar
  // IS a real capture (or live tick), not an aggregation; see
  // `premium-candles.ts`'s native-granularity doc.
  const isNativePremiumInterval = isPremiumMode && premiumIntervals[0] === chartInterval;
  const premiumSinceDate = isNativePremiumInterval
    ? (premiumMeta?.earliestFineGrainedCapturedAt ?? premiumMeta?.earliestCapturedAt)
    : premiumMeta?.earliestCapturedAt;
  const premiumLabel =
    isPremiumMode && premiumSinceDate
      ? isNativePremiumInterval
        ? `${PREMIUM_INTERVAL_LABEL[chartInterval]} snapshots · delayed · since ${formatIstDateShort(premiumSinceDate)}`
        : `${PREMIUM_INTERVAL_LABEL[chartInterval]} pseudo-candles from ${captureCadenceLabel} snapshots · delayed · since ${formatIstDateShort(premiumSinceDate)}`
      : null;
  // Cadence-aware update of terminal/premium-chart.tsx's original copy — a
  // deliberate DEVIATION from that file's "never invent new wording"
  // precedent, because the underlying truth it described (a flat 5-minute
  // cadence for every contract) is no longer accurate for index contracts;
  // repeating the old wording here would itself be the dishonest choice.
  // Both files now derive the same cadence number from the same
  // `isIndexOptionUnderlying` check rather than either hardcoding it.
  const premiumAccrualNote =
    premiumSnapshotCount === 0
      ? `No premium history captured for this contract yet — history accrues as this contract is viewed (${captureCadenceLabel} snapshots while it's on someone's screen; live ticks start building today's chart on this screen within the first minute).`
      : "Not enough premium ticks yet — check back shortly.";

  const activeColor = (selectedRow?.styles as { line?: { color?: string } } | undefined)?.line?.color ?? null;
  const activeWidth = (selectedRow?.styles as { line?: { size?: number } } | undefined)?.line?.size ?? null;

  const content = (
    <div className="fixed inset-0 z-50 flex flex-col bg-white" data-chart-key={chartKey}>
      <div className="flex flex-wrap items-center gap-3 border-b border-ink-100 px-4 py-2.5">
        {/* Founder feature (2026-08-07) — the header title doubles as the
            symbol-search trigger whenever `onSymbolPick` is wired (every
            current caller — see this file's own module doc). Anchored via
            the clicked button's own `getBoundingClientRect()`, same idiom
            `handleOpenIndicatorSettings` already uses for its popover. */}
        {onSymbolPick ? (
          <button
            type="button"
            onClick={(e) => {
              const rect = e.currentTarget.getBoundingClientRect();
              setSymbolSearchAnchor({ left: rect.left, top: rect.bottom + 6 });
            }}
            className="group flex items-center gap-1.5 rounded-lg px-1.5 py-1 text-sm font-semibold text-ink-900 hover:bg-ink-100"
            title="Change symbol"
          >
            {title}
            <Search className="h-3 w-3 text-ink-300 group-hover:text-ink-500" aria-hidden="true" />
          </button>
        ) : (
          <p className="text-sm font-semibold text-ink-900">{title}</p>
        )}
        {isPremiumMode ? (
          premiumLabel && (
            <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-700">{premiumLabel}</span>
          )
        ) : (
          <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-700">
            Delayed data · {sourceLabel.replace("Delayed market data ", "").replace(/[()]/g, "") || "Yahoo"}
          </span>
        )}
        <HeartbeatChip
          lastUpdatedAt={lastUpdatedAt}
          pollIntervalMs={pollIntervalMs}
          cadenceNote={
            isPremiumMode
              ? "Premium mode: live session ticks fold in as they arrive (~15s during market hours, from the selected contract's own poll); full history re-polls every 60s (snapshots are captured every 5 minutes)."
              : liveTicksActive
                ? "Price ticks fold in every ~5s during market hours; full candle bars re-sync every 30-60s. Also bounded by Yahoo's own delayed-data latency."
                : undefined
          }
        />
        <TimeframeSelector intervals={premiumIntervals} value={chartInterval} onChange={setChartInterval} />
        <IndicatorActiveStrip
          instances={[...indicators.main, ...indicators.sub]}
          signals={instanceSignals}
          onOpenSettings={handleOpenIndicatorSettings}
          onRemove={handleRemoveIndicator}
          onOpenDialog={() => setIndicatorDialogOpen(true)}
        />
        <button
          type="button"
          onClick={toggleScriptDrawer}
          className={`flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-medium ${
            scriptDrawerOpen ? "border-sky-300 bg-sky-50 text-sky-700" : "border-ink-200 text-ink-600 hover:bg-ink-100 hover:text-ink-900"
          }`}
          title="Script editor"
        >
          <Code2 className="h-3.5 w-3.5" aria-hidden="true" />
          Scripts
        </button>
        <div className="ml-auto flex items-center gap-2">
          {chartModeSwitcher && (
            <button
              type="button"
              onClick={chartModeSwitcher.onClick}
              className="flex items-center gap-1.5 rounded-lg border border-ink-200 px-2.5 py-1.5 text-xs font-medium text-ink-600 hover:bg-ink-100 hover:text-ink-900"
              title={`Switch to ${chartModeSwitcher.label}`}
            >
              <ArrowLeftRight className="h-3.5 w-3.5" aria-hidden="true" />
              {chartModeSwitcher.label}
            </button>
          )}
          <button
            type="button"
            onClick={() => setTicketCollapsed((v) => !v)}
            className="rounded-lg p-2 text-ink-400 hover:bg-ink-100 hover:text-ink-700"
            title={ticketCollapsed ? "Show order ticket" : "Hide order ticket"}
          >
            {ticketCollapsed ? <PanelRightOpen className="h-4 w-4" /> : <PanelRightClose className="h-4 w-4" />}
          </button>
          <button type="button" onClick={onClose} className="rounded-lg p-2 text-ink-500 hover:bg-ink-100 hover:text-ink-900" title="Minimize (Esc)">
            <Minimize2 className="h-4 w-4" />
          </button>
        </div>
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

        {/* Founder bug fix (2026-08-07) — structural fix for "the scripts
            drawer overlaps the drawing-tools rail." The chart+panel row and
            the Scripts drawer (below) are now both children of THIS shared
            column, itself a SIBLING of `WorkbenchToolbar` above — not, as
            before, all four (rail/chart/panel/drawer) siblings of one row
            with the drawer living one level further up, outside that row
            entirely. Under the old structure, opening the drawer shrank the
            WHOLE row's height via flex distribution, including the rail's:
            `workbench-toolbar.tsx`'s rail is itself a flex column whose
            content (family buttons, search, magnet, favorites/recents) has
            a content-driven `min-height: auto` that flexbox's stretch
            algorithm cannot shrink below, so once the row got squeezed short
            enough by an open drawer, the rail's real rendered height
            exceeded its allotted box and overflowed DOWNWARD past it —
            visually intruding into the drawer's own screen region. Worse,
            because the rail's wrapper (`workbench-toolbar.tsx`'s `railRef`
            div) is `position: relative` while the drawer's own wrapper
            below was plain `position: static`, CSS stacking rules paint the
            (relatively) positioned rail ABOVE the static drawer regardless
            of DOM order — so the overflowing rail visually sat on top of
            the drawer AND physically intercepted pointer events meant for
            the drawer's resize handle (confirmed live via
            `elementFromPoint` at the handle's own coordinates resolving to
            the rail, not the handle) — one confirmed root cause of "the
            drag handles show a cursor but nothing happens," not just the
            visual overlap on its own.
            Fixed structurally (chosen over a magic margin/z-index patch,
            which would only mask the symptom and leave the rail's real
            overflow — and the pointer interception it causes — intact): by
            pulling the chart+panel row and the drawer into a column that
            excludes the rail, the drawer's height only ever subtracts from
            THIS column's own budget, never the row that sizes the rail.
            `WorkbenchToolbar` now stretches to the FULL height of the outer
            row (topbar to the very bottom of the workbench, unaffected by
            whether the drawer is open or how tall it is) — TradingView's
            own "rail keeps full height, bottom panel spans everything to
            its right" convention, matching this ticket's explicit design
            ask. The drawer (moved below, still sticky-mounted, still
            gated on `hasOpenedScriptDrawer`) now spans exactly from the
            rail's right edge to the workbench's right edge — the chart area
            AND the ticket/chain/strategy panel both sit above it in this
            SAME column, so both shrink to make room for the drawer, but the
            rail never does. Rail flyouts (`tool-flyout.tsx`) are unaffected
            — they already clamp against `window.innerHeight` directly, not
            against this column's height. */}
        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          <div className="flex min-h-0 flex-1">
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
              onOrderLineDrag={onOrderLineDrag}
              onOrderLineCancel={onOrderLineCancel}
              // Gated on `onOrderIntentConfirm`, NOT passed unconditionally
              // — the options terminal's underlying-only maximized workbench
              // (W2's "click-inert" decision, EMPTY_ORDER_LINES + no
              // onOrderIntentConfirm) must keep its normal browser
              // right-click menu. If these were always-truthy function
              // references, kline-chart.tsx's `handleContextMenu` would
              // still `preventDefault()` the native menu there even though
              // `handleSurfaceContextMenu` itself no-ops internally — a
              // silent dead right-click, exactly the "zero behavior change
              // when the capability isn't wired up" contract this whole
              // program enforces everywhere else (see price-chart.tsx's/
              // premium-chart.tsx's own `onContextMenu={onOrderIntentConfirm
              // ? handleContextMenu : undefined}` for the identical pattern).
              onAxisHoverChange={onOrderIntentConfirm ? setAxisHover : undefined}
              onSurfaceContextMenu={onOrderIntentConfirm ? handleSurfaceContextMenu : undefined}
              suspendClick={suppressTradeAffordances}
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
              onIndicatorFiguresChange={setIndicatorFigures}
              // Founder bug fix (2026-08-07) — "I can't adjust the script
              // vertically." Only shrink the chart's own floor while the
              // Scripts drawer is actually open (`display:flex`, not merely
              // sticky-mounted — see `scriptDrawerOpen` below) — a closed
              // drawer keeps the chart's full 420px minimum, unchanged. See
              // `kline-chart.tsx`'s own `minHeightPx` doc for the full
              // mechanism and `drawer-resize-handle.tsx`'s `CHART_COMPACT_MIN_PX`
              // for why 200 specifically.
              minHeightPx={scriptDrawerOpen ? 200 : 420}
            />
          )}

          {/* Interaction-model rework (2026-08-04) — one-time discoverability hint, terminal-only (gated on onOrderIntentConfirm — the options underlying-only maximized workbench never shows it). */}
          {onOrderIntentConfirm && (
            <div className="absolute left-3 right-3 top-3 z-10">
              <ChartTradeHint dismissed={hintDismissed} onDismiss={dismissHint} />
            </div>
          )}

          {selectedDrawing && !textPopover && (
            <DrawingStyleToolbar
              activeColor={activeColor}
              activeWidth={activeWidth}
              canEditText={TEXT_FAMILY_OVERLAYS.has(selectedDrawing.overlayName)}
              onPickColor={(color) => applyStylePatch({ line: { color }, polygon: { color, borderColor: color }, text: { backgroundColor: color } })}
              onPickWidth={(width) => applyStylePatch({ line: { size: width } })}
              onEditText={TEXT_FAMILY_OVERLAYS.has(selectedDrawing.overlayName) ? handleEditText : undefined}
              onDelete={handleStyleDelete}
              onClose={() => setSelectedDrawing(null)}
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

          {/* Interaction-model rework (2026-08-04) — the price-axis "+" affordance, hidden while the intent popover or right-click menu is already open (`axisHover` render-gated, not cleared — see kline-chart.tsx's own `onAxisHoverChange` doc for why it keeps updating underneath). */}
          {axisHover && !intentPopover && !contextMenu && onOrderIntentConfirm && (
            <ChartAxisPlusButton top={axisHover.top} onClick={() => handleSurfaceClick(axisHover)} />
          )}

          {/* Interaction-model rework (2026-08-04) — right-click's compact "Buy at ₹X / Sell at ₹X" menu. */}
          {contextMenu && onOrderIntentConfirm && (
            <ChartContextMenu
              price={contextMenu.price}
              left={contextMenu.left}
              top={contextMenu.top}
              onBuy={() => {
                onOrderIntentConfirmRef.current?.({ price: contextMenu.price, side: "BUY", variant: "LIMIT" });
                setContextMenu(null);
              }}
              onSell={() => {
                onOrderIntentConfirmRef.current?.({ price: contextMenu.price, side: "SELL", variant: "LIMIT" });
                setContextMenu(null);
              }}
              onDismiss={() => setContextMenu(null)}
            />
          )}
        </div>

        {!ticketCollapsed && (
          <PanelResizeHandle
            getCurrentWidth={() => panelWidthRef.current}
            onResize={handlePanelResize}
            onResizeEnd={handlePanelResizeEnd}
            onDoubleClickReset={handlePanelReset}
          />
        )}

        {!ticketCollapsed && (
          <div ref={panelRef} className="flex shrink-0 flex-col" style={{ width: panelWidthRef.current }}>
            {/* TA Suite S3, T3 — [Ticket | Strategy] segmented control (D5), widened by the founder's Chain-in-
                workbench feature (2026-08-04, futures 2026-08-09) to [Ticket | <chainLabel> | Strategy] whenever a
                `chain` prop is supplied. Switching tabs NEVER unmounts any side (the single-mount rule) — every
                wrapper below is always in the DOM, toggled by CSS `display` only, so an in-progress order-ticket
                draft OR the embedded chain/contract browser's own poll/selection state survives a trip through
                any other tab. */}
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
              {chain && (
                <button
                  type="button"
                  onClick={() => selectRightPanelTab("chain")}
                  className={`flex-1 rounded-lg py-1.5 text-xs font-semibold ${
                    rightPanelTab === "chain" ? "bg-sky-600 text-white" : "text-ink-500 hover:bg-ink-100"
                  }`}
                >
                  {chainLabel}
                </button>
              )}
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
              {chain && <div style={{ display: rightPanelTab === "chain" ? "block" : "none" }}>{chain}</div>}
              {hasOpenedStrategyTab && (
                <div style={{ display: rightPanelTab === "strategy" ? "block" : "none" }}>
                  <TechnicalsGauge rating={technicalRating} combined={combinedRating} />
                  <SignalsTable
                    detail={technicalDetail}
                    rating={technicalRating}
                    customItems={customSignals}
                    customRows={customSignalRows}
                    onAddCustomSignal={handleAddCustomSignal}
                    onEditCustomSignal={handleEditCustomSignal}
                    onRemoveCustomSignal={handleRemoveCustomSignal}
                  />
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

          {/* User Strategy Scripting (SS2), D2/D4 — the script editor
              drawer. Mounted once `hasOpenedScriptDrawer` goes true
              (sticky), then purely CSS-toggled by `scriptDrawerOpen` so
              editor/console/list state survives closing and reopening it —
              see the state's own doc above. `display: none` rather than
              unmounting also means the lazy-loaded CodeMirror chunk, once
              paid for, is never re-fetched.

              Founder bug fix (2026-08-07) — moved from a sibling of the
              rail+chart+panel row (one level up) to a sibling of ONLY the
              chart+panel row, inside the new shared column
              `WorkbenchToolbar` no longer participates in — see that
              column wrapper's own doc, above, for the full mechanism (rail
              overflow + CSS stacking caused a real pointer-interception
              bug, not just a visual nit). Functionally identical
              otherwise: still sticky-mounted, still purely CSS-toggled,
              still spans the SAME full width it always rendered at
              (`w-full` on this component's own root, per its module doc)
              — that width is now measured from the rail's right edge
              instead of the workbench's left edge, which is the whole
              point of the fix. */}
          {hasOpenedScriptDrawer && (
            <div style={{ display: scriptDrawerOpen ? "flex" : "none" }} className="min-h-0">
              <ScriptEditorDrawer
                candles={candles}
                interval={chartInterval}
                isPremiumMode={isPremiumMode}
                notional={strategyNotional}
                onRunSignals={handleScriptSignals}
                open={scriptDrawerOpen}
                shortcutsSuppressed={Boolean(textPopover || intentPopover || contextMenu)}
              />
            </div>
          )}
        </div>
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
      {indicatorSettings && settingsInstance && (
        <IndicatorSettingsPopover
          instance={settingsInstance}
          figures={indicatorFigures.get(indicatorSettings.instanceId) ?? []}
          left={indicatorSettings.left}
          top={indicatorSettings.top}
          onApply={handleApplyIndicatorSettings}
          onApplyLineColor={handleApplyIndicatorLineColor}
          onApplyWidth={handleApplyIndicatorWidth}
          onClose={() => setIndicatorSettings(null)}
        />
      )}
      {customSignalBuilder && (
        <CustomSignalBuilder
          anchorRect={customSignalBuilder.anchor}
          editingItem={customSignalBuilder.editingItem}
          onSave={handleSaveCustomSignal}
          onClose={() => setCustomSignalBuilder(null)}
        />
      )}
      {symbolSearchAnchor && onSymbolPick && (
        <SymbolSearchPopover
          left={symbolSearchAnchor.left}
          top={symbolSearchAnchor.top}
          onPick={(pick) => {
            setSymbolSearchAnchor(null);
            onSymbolPick(pick);
          }}
          onClose={() => setSymbolSearchAnchor(null)}
        />
      )}
    </div>
  );

  return createPortal(content, document.body);
}
