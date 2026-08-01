"use client";

/**
 * Charting Workbench (W2, T2 shell + T4 click-to-trade wiring; W3, T3/T4/T5
 * wires drawings + premium mode) — the fullscreen "maximize" surface:
 * `createPortal`'d to `document.body`, `fixed inset-0 z-50`, body-scroll-
 * locked while open. Layout: a top bar (title, honest-data chip, timeframe
 * pills, indicator picker, minimize), then a three-column row (44px
 * drawing-tool rail / chart / a 360px collapsible ticket panel).
 *
 * Rendered via `next/dynamic(..., {ssr:false})` ONLY while open by every
 * caller (paper-trading-dashboard.tsx / futures-page-client.tsx /
 * options-page-client.tsx) — see workbench-maximize-button.tsx — so the
 * ~200KB-gz `klinecharts` chunk this file (transitively, via kline-chart.tsx)
 * pulls in is paid only on first maximize, never on a terminal's initial
 * page load.
 *
 * W3 additions:
 *   - Drawings: owns `activeTool`/`cancelDrawingNonce`/`clearAllDrawingsNonce`
 *     state and the `useChartDrawings(chartKey)` hook, wiring both into
 *     `<KlineChart>` — see that file's own module doc for the full
 *     load/draw/persist/cancel/clear-all mechanics this component merely
 *     triggers.
 *   - Escape priority chain (T5): popover > active drawing tool > workbench
 *     close, in that order — a drawing tool being active is a NEW middle
 *     tier this sprint inserted between the two W2 cases.
 *   - Premium mode (T5/T6): `feed.kind === "optionPremium"` narrows the
 *     timeframe selector to 15m/30m, gates VOL off in the indicator picker,
 *     shows the mandatory pseudo-candle label (or the zero-snapshot accrual
 *     note) in place of the equity/index honest-data chip.
 */
import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Loader2, Minimize2, PanelRightClose, PanelRightOpen } from "lucide-react";

import { ChartOrderIntentPopover } from "@/components/finance/chart-order-intent-popover";
import type { ChartOrderLine, OrderSide, OrderVariant } from "@/components/finance/chart-order-lines";
import { KlineChart } from "./kline-chart";
import { TimeframeSelector } from "./timeframe-selector";
import { IndicatorPicker, type IndicatorSelection } from "./indicator-picker";
import { WorkbenchToolbar } from "./workbench-toolbar";
import { useChartDrawings } from "./use-chart-drawings";
import { useWorkbenchCandles, WORKBENCH_INTERVALS, PREMIUM_INTERVALS, type CandleInterval, type WorkbenchFeed } from "./use-workbench-candles";

export type { WorkbenchFeed } from "./use-workbench-candles";

function formatIstDateShort(iso: string): string {
  return new Intl.DateTimeFormat("en-IN", { day: "2-digit", month: "short", timeZone: "Asia/Kolkata" }).format(new Date(iso));
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
  const [indicators, setIndicators] = useState<IndicatorSelection>({ main: [], sub: [] });
  const [ticketCollapsed, setTicketCollapsed] = useState(false);
  const [intentPopover, setIntentPopover] = useState<{ price: number; left: number; top: number } | null>(null);

  const { candles, status, errorMessage, sourceLabel, quote, premiumMeta } = useWorkbenchCandles(feed, chartInterval);

  // W3, T3/T4 — drawing tool state + persistence hook.
  const [activeTool, setActiveTool] = useState<string | null>(null);
  const [cancelDrawingNonce, setCancelDrawingNonce] = useState(0);
  const [clearAllDrawingsNonce, setClearAllDrawingsNonce] = useState(0);
  const drawingsHook = useChartDrawings(chartKey);
  const loadDrawings = drawingsHook.load;
  useEffect(() => {
    void loadDrawings();
  }, [loadDrawings]);

  function cancelActiveDrawing() {
    if (!activeTool) return;
    setCancelDrawingNonce((n) => n + 1);
    setActiveTool(null);
  }

  function handleSelectTool(name: string) {
    if (activeTool) setCancelDrawingNonce((n) => n + 1); // abandon whatever was in progress before starting a new one.
    setActiveTool(name);
  }

  function handleClearAll() {
    setClearAllDrawingsNonce((n) => n + 1);
  }

  // Body scroll lock while the workbench is open, restored on close.
  useEffect(() => {
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prevOverflow;
    };
  }, []);

  // W3, T5 — Escape priority chain: popover > active drawing tool >
  // workbench close. A drawing tool being active is the new middle tier;
  // the popover-open and plain-close cases are unchanged from W2.
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key !== "Escape") return;
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
  }, [intentPopover, activeTool, onClose]);

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
        <IndicatorPicker selection={indicators} onChange={setIndicators} mode={isPremiumMode ? "premium" : "spot"} />
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
        <WorkbenchToolbar activeTool={activeTool} onSelectTool={handleSelectTool} onCancelActiveTool={cancelActiveDrawing} onClearAll={handleClearAll} />

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
              orderLines={orderLines}
              onSurfaceClick={handleSurfaceClick}
              onOrderLineDrag={onOrderLineDrag}
              onOrderLineCancel={onOrderLineCancel}
              suspendClick={isDrawingActive}
              drawings={drawingsHook.drawings}
              activeTool={activeTool}
              onToolDrawEnd={() => setActiveTool(null)}
              onDrawingCreate={drawingsHook.create}
              onDrawingMoveEnd={drawingsHook.update}
              onDrawingRemoved={drawingsHook.remove}
              cancelDrawingNonce={cancelDrawingNonce}
              clearAllDrawingsNonce={clearAllDrawingsNonce}
              onAllDrawingsCleared={drawingsHook.clearAll}
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

        {!ticketCollapsed && <div className="w-[360px] shrink-0 overflow-y-auto border-l border-ink-100 p-3">{ticket}</div>}
      </div>
    </div>
  );

  return createPortal(content, document.body);
}
