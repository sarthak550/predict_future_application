"use client";

/**
 * Chart Trading + Stop-Loss/Take-Profit (Sprint B, B4) — the options
 * terminal's "Contract premium" chart mode (decision 6 of the Sprint B
 * brief). A NEW component, deliberately NOT a `PriceChart` prop-bag mode:
 * `PriceChart` is shared by four OTHER consumers (the equity/futures
 * terminals plus three non-terminal pages) with a 1D-intraday/EOD-series data
 * model that doesn't fit this chart's actual shape — `OptionPremiumSnapshot`
 * history (1-minute cadence for index underlyings, 5-minute for single-stock
 * underlyings as of the 2026-08-07 interval-parity project — see
 * apps/api's premiumCapture.ts) plus live in-session ticks appended from
 * the options terminal's own chain-derived premium (~15s during NSE trading
 * hours as of the 2026-08-07b dedicated poll/TTL fix — see
 * options-page-client.tsx's own doc), no timeframe selector, denominated in
 * premium rather than spot. Forcing that shape into
 * `PriceChart` would grow exactly the kind of branchy complexity the Sprint B
 * brief warns against for a component with this many existing consumers.
 *
 * What IS shared with `price-chart.tsx` (never forked): the pixel<->price
 * inverse, tick-snapping, and off-scale-line clamping math, all imported from
 * `chart-order-lines.ts` — see that module's doc for why duplicating this
 * specific formula is the brief's single named highest-risk mistake for this
 * whole sprint.
 *
 * Honest-data framing (decision 6 / Sprint A's decision 7, enforced here at
 * the render layer): a contract with populated `premium-history` snapshots
 * shows a "{1-minute|5-minute} snapshots since <date> · delayed" label (the
 * cadence word reflects the ACTUAL track this contract's underlying
 * captures on, not a hardcoded "5-min" — see `captureCadenceLabel` below)
 * and the real historical series. A contract with ZERO snapshots yet —
 * normal for a freshly-browsed strike outside the capture cron's ATM±10
 * window of browsed chains — renders the live-tick-only session view (this
 * chart's OWN in-session ticks, appended from `livePremium` below) with an
 * explicit "history accrues as this contract is viewed" note. Absent data is
 * NEVER rendered as a flat/zero line.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { Loader2 } from "lucide-react";

import { isIndexOptionUnderlying } from "@predict-future/business-rules/papertrading/optionContract";

import {
  CANCEL_HIT_DIAMETER,
  DRAG_HIT_STROKE_WIDTH,
  clampLineY,
  orderLineColor,
  priceAtFraction,
  snapToTick,
  type ChartOrderLine,
  type OrderSide,
  type OrderVariant
} from "@/components/finance/chart-order-lines";
import { ChartOrderIntentPopover } from "@/components/finance/chart-order-intent-popover";
import { ChartAxisPlusButton } from "@/components/finance/chart-axis-plus-button";
import { ChartContextMenu } from "@/components/finance/chart-context-menu";
import { ChartTradeHint, useTradeHintDismissed } from "@/components/finance/chart-trade-hint";

const W = 640;
const H = 200;
const PAD = { top: 12, right: 12, bottom: 22, left: 12 };

interface PremiumTick {
  capturedAt: string;
  lastPrice: number;
}

type HistoryState = { status: "loading" } | { status: "error" } | { status: "ready"; points: PremiumTick[] };

function formatRupees(v: number): string {
  return `₹${v.toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;
}

/** "14:32" IST wall-clock time from an ISO timestamp — same convention as price-chart.tsx's formatIstTime. */
function formatIstTime(iso: string): string {
  return new Intl.DateTimeFormat("en-IN", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Asia/Kolkata" }).format(
    new Date(iso)
  );
}

function formatIstDateShort(iso: string): string {
  return new Intl.DateTimeFormat("en-IN", { day: "2-digit", month: "short", timeZone: "Asia/Kolkata" }).format(new Date(iso));
}

export function PremiumChart({
  underlying,
  expiry,
  strikePrice,
  optionType,
  livePremium,
  orderLines,
  onOrderIntentConfirm,
  onOrderLineDrag,
  onOrderLineCancel,
}: {
  underlying: string;
  /** NSE "DD-MMM-YYYY" format — same convention `SelectedContract.expiry` already uses, passed straight through to the premium-history endpoint. */
  expiry: string;
  strikePrice: number;
  optionType: "CE" | "PE";
  /** The contract's current premium, straight off the options terminal's own chain-derived poll (owned by the parent — this component does NOT poll on its own; ~15s during NSE trading hours as of the 2026-08-07b fix, see options-page-client.tsx's dedicated selected-contract poll). A changed value appends one in-session tick; the SAME value re-rendering is a no-op (no duplicate ticks on every unrelated parent re-render). */
  livePremium: number | null;
  orderLines?: ChartOrderLine[];
  /** Chart Trading + SL/TP (Sprint C, C2) — replaces Sprint B's `onPriceClick(price)`. Interaction-model rework (2026-08-04, founder complaint "I cant have buy/sell popup on every click, thats irritating") — see price-chart.tsx's identical prop for the full contract: a plain click never fires this any more; it fires only from the price-axis "+" button (via the popover) or the right-click compact menu. */
  onOrderIntentConfirm?: (input: { price: number; side: OrderSide; variant: OrderVariant }) => void;
  /** Chart Trading + SL/TP (Sprint C, C1) — pointer-capture drag-to-reprice on a `draggable` line, same contract as price-chart.tsx's identical prop (fires once on pointerup, tick-snapped). New this sprint — the options terminal's premium chart is where a repriced OPTION pending order's line actually lives (equity/futures pending lines live on price-chart.tsx's own spot chart). */
  onOrderLineDrag?: (id: string, newPrice: number) => void;
  onOrderLineCancel?: (id: string) => void;
}) {
  const contractKey = `${underlying}::${expiry}::${strikePrice}::${optionType}`;
  // Interval-parity cadence project (2026-08-07) — apps/api's premiumCapture.ts
  // now captures index underlyings every 1 minute (was, and single-stock
  // underlyings still every, 5 minutes — see that file's own module doc).
  // This chart's copy below reflects whichever is actually true for THIS
  // contract rather than a hardcoded "5-minute" — see chart-workbench.tsx's
  // identical `captureCadenceLabel` for the sibling copy this deliberately matches.
  const captureCadenceLabel = isIndexOptionUnderlying(underlying) ? "1-minute" : "5-minute";

  const [history, setHistory] = useState<HistoryState>({ status: "loading" });
  const [sessionTicks, setSessionTicks] = useState<PremiumTick[]>([]);
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);
  const svgRef = useRef<SVGSVGElement | null>(null);
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  // Sprint C, C1/C2 — same local-state/ref discipline as price-chart.tsx
  // (see that file's module-level doc on the render-loop failure class this
  // program's own drag interaction is most exposed to).
  const [dragState, setDragState] = useState<{ id: string; price: number } | null>(null);
  const dragJustEndedRef = useRef(false);
  const [intentPopover, setIntentPopover] = useState<{ price: number; left: number; top: number } | null>(null);
  // Interaction-model rework (2026-08-04) — same axis-hover/right-click state as price-chart.tsx (see that file's own doc).
  const [axisHover, setAxisHover] = useState<{ top: number; price: number } | null>(null);
  const [contextMenu, setContextMenu] = useState<{ price: number; left: number; top: number } | null>(null);
  const [hintDismissed, dismissHint] = useTradeHintDismissed();
  const onOrderLineDragRef = useRef(onOrderLineDrag);
  onOrderLineDragRef.current = onOrderLineDrag;
  const onOrderIntentConfirmRef = useRef(onOrderIntentConfirm);
  onOrderIntentConfirmRef.current = onOrderIntentConfirm;

  // Fetches the 5-min snapshot history fresh whenever the CONTRACT identity
  // changes — never on a `livePremium` tick (the endpoint's own data only
  // advances every 5 minutes server-side regardless; re-fetching on every
  // ~15s chain-derived tick would be pure waste).
  useEffect(() => {
    let cancelled = false;
    setHistory({ status: "loading" });
    setSessionTicks([]);
    setHoverIdx(null);
    const url = `/api/paper-trading/options/premium-history?underlying=${encodeURIComponent(underlying)}&expiry=${encodeURIComponent(expiry)}&strike=${strikePrice}&type=${optionType}`;
    fetch(url)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((data) => {
        if (cancelled) return;
        const points: PremiumTick[] = Array.isArray(data?.points)
          ? data.points
              .filter((p: { capturedAt?: string; lastPrice?: number }) => typeof p.capturedAt === "string" && Number.isFinite(p.lastPrice) && (p.lastPrice ?? 0) > 0)
              .map((p: { capturedAt: string; lastPrice: number }) => ({ capturedAt: p.capturedAt, lastPrice: p.lastPrice }))
          : [];
        setHistory({ status: "ready", points });
      })
      .catch(() => {
        if (!cancelled) setHistory({ status: "error" });
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contractKey]);

  // Appends ONE in-session tick every time the parent's chain poll reports a
  // genuinely changed premium for THIS contract — never a re-fetch, purely a
  // client-side point so the chart stays live between 5-minute captures.
  const lastAppendedPrice = useRef<number | null>(null);
  useEffect(() => {
    lastAppendedPrice.current = null;
  }, [contractKey]);
  useEffect(() => {
    if (livePremium == null || livePremium <= 0) return;
    if (lastAppendedPrice.current === livePremium) return;
    lastAppendedPrice.current = livePremium;
    setSessionTicks((prev) => [...prev, { capturedAt: new Date().toISOString(), lastPrice: livePremium }]);
  }, [livePremium]);

  const historyPoints = useMemo(() => (history.status === "ready" ? history.points : []), [history]);
  const allPoints = useMemo(() => [...historyPoints, ...sessionTicks], [historyPoints, sessionTicks]);
  const points = useMemo(() => allPoints.map((p, i) => ({ x: i, y: p.lastPrice, label: formatIstTime(p.capturedAt) })), [allPoints]);

  const geometry = useMemo(() => {
    if (points.length < 2) return null;
    const values = points.map((p) => p.y);
    const min = Math.min(...values);
    const max = Math.max(...values);
    const span = max - min || max * 0.01 || 1;
    const x = (i: number) => PAD.left + (points.length === 1 ? 0 : (i / (points.length - 1)) * (W - PAD.left - PAD.right));
    const y = (v: number) => PAD.top + (1 - (v - min) / span) * (H - PAD.top - PAD.bottom);
    const path = points.map((p, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(2)},${y(p.y).toFixed(2)}`).join(" ");
    const area = `${path} L${x(points.length - 1).toFixed(2)},${H - PAD.bottom} L${PAD.left},${H - PAD.bottom} Z`;
    return { min, max, x, y, path, area };
  }, [points]);

  if (history.status === "loading") {
    return (
      <div className="flex h-[200px] items-center justify-center rounded-xl border border-ink-100 bg-ink-50/40 text-sm text-ink-400">
        <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />
        Loading premium history…
      </div>
    );
  }

  // Not enough data to draw ANY line yet — never a fabricated flat/zero line.
  // Distinguishes "history exists but this session hasn't ticked enough yet"
  // from "this contract has never been snapshotted" only in the copy, not the
  // underlying honesty: both cases show nothing plotted.
  if (!geometry || points.length < 2) {
    return (
      <div className="rounded-xl border border-ink-100 bg-ink-50/40 p-6 text-sm text-ink-500">
        {historyPoints.length === 0
          ? `No premium history captured for this contract yet — history accrues as this contract is viewed (${captureCadenceLabel} snapshots while it's on someone's screen).`
          : "Not enough premium ticks yet — check back shortly."}
      </div>
    );
  }

  const first = points[0];
  const last = points[points.length - 1];
  const changeAbs = last.y - first.y;
  const changePct = first.y > 0 ? (changeAbs / first.y) * 100 : 0;
  const up = changeAbs >= 0;
  const tone = up ? "#059669" : "#e11d48";
  const active = hoverIdx != null ? points[hoverIdx] : null;

  const onPointer = (clientX: number) => {
    if (dragState) return; // Sprint C, C1 — crosshair suppressed during a drag (see price-chart.tsx's identical guard).
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect) return;
    const frac = (clientX - rect.left) / rect.width;
    const idx = Math.round(frac * (points.length - 1));
    setHoverIdx(Math.max(0, Math.min(points.length - 1, idx)));
  };

  const priceAtClientY = (clientY: number): number | null => {
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect || !rect.height) return null;
    const frac = (clientY - rect.top) / rect.height;
    return priceAtFraction(frac, H, PAD.top, PAD.bottom, geometry.min, geometry.max);
  };

  // Interaction-model rework (2026-08-04) — byte-for-byte mirror of
  // price-chart.tsx's identical handlers (see that file's own doc for the
  // full founder-complaint rationale): a plain click no longer opens
  // anything; the price-axis "+" button and the right-click menu are the
  // only two summon points now.
  const openIntentPopoverAt = (price: number, left: number, top: number) => {
    if (!onOrderIntentConfirm) return;
    setContextMenu(null);
    setAxisHover(null);
    setIntentPopover({ price: snapToTick(price), left, top });
  };

  const updateAxisHover = (clientX: number, clientY: number) => {
    if (!onOrderIntentConfirm || dragState || intentPopover || contextMenu) {
      setAxisHover(null);
      return;
    }
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect || !rect.width) {
      setAxisHover(null);
      return;
    }
    const axisBandWidth = Math.max(48, rect.width * 0.12);
    if (rect.right - clientX > axisBandWidth) {
      setAxisHover(null);
      return;
    }
    const price = priceAtClientY(clientY);
    const wrapperRect = wrapperRef.current?.getBoundingClientRect();
    if (price == null || !wrapperRect) {
      setAxisHover(null);
      return;
    }
    setAxisHover({ top: clientY - wrapperRect.top, price: snapToTick(price) });
  };

  const handleContextMenu = (e: React.MouseEvent<SVGSVGElement>) => {
    e.preventDefault();
    const wrapperRect = wrapperRef.current?.getBoundingClientRect();
    const raw = priceAtClientY(e.clientY);
    if (!wrapperRect || raw == null) return;
    setIntentPopover(null);
    setAxisHover(null);
    setContextMenu({ price: snapToTick(raw), left: e.clientX - wrapperRect.left, top: e.clientY - wrapperRect.top });
  };

  // Sprint C, C1 — pointer-capture drag handlers, identical contract to
  // price-chart.tsx's (see that file for the full pointer-capture rationale).
  const handleLinePointerDown = (e: React.PointerEvent<SVGLineElement>, line: ChartOrderLine) => {
    if (!line.draggable || !onOrderLineDragRef.current) return;
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    setDragState({ id: line.id, price: line.price });
  };
  const handleLinePointerMove = (e: React.PointerEvent<SVGLineElement>) => {
    if (!dragState) return;
    e.stopPropagation();
    const raw = priceAtClientY(e.clientY);
    if (raw == null) return;
    setDragState((prev) => (prev ? { ...prev, price: raw } : prev));
  };
  const handleLinePointerUp = (e: React.PointerEvent<SVGLineElement>) => {
    if (!dragState) return;
    e.stopPropagation();
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
    const { id, price: originalPrice } = dragState;
    const finalPrice = snapToTick(dragState.price);
    setDragState(null);
    dragJustEndedRef.current = true;
    if (finalPrice === snapToTick(originalPrice)) return;
    onOrderLineDragRef.current?.(id, finalPrice);
  };
  const handleLinePointerCancel = (e: React.PointerEvent<SVGLineElement>) => {
    if (!dragState) return;
    e.stopPropagation();
    setDragState(null);
  };

  const footerNote =
    historyPoints.length > 0
      ? `${captureCadenceLabel} snapshots since ${formatIstDateShort(historyPoints[0].capturedAt)} · delayed`
      : "Live session only · history accrues as this contract is viewed";

  return (
    <div ref={wrapperRef} className="relative">
      <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
        <div className="flex items-baseline gap-2">
          <span className="text-lg font-semibold text-ink-900">{formatRupees((active ?? last).y)}</span>
          <span className="text-sm font-medium" style={{ color: tone }}>
            {up ? "+" : ""}
            {formatRupees(Math.abs(changeAbs)).replace("₹", up ? "₹" : "-₹")} ({up ? "+" : ""}
            {changePct.toFixed(2)}%)
          </span>
        </div>
        <span className="text-xs text-ink-400">{active ? active.label : `${first.label} → ${last.label}`}</span>
      </div>

      {/* Interaction-model rework (2026-08-04) — one-time discoverability hint, terminal-only (gated on onOrderIntentConfirm). */}
      {onOrderIntentConfirm && (
        <div className="mb-2">
          <ChartTradeHint dismissed={hintDismissed} onDismiss={dismissHint} />
        </div>
      )}

      <svg
        ref={svgRef}
        viewBox={`0 0 ${W} ${H}`}
        className="w-full cursor-crosshair touch-none select-none"
        onMouseMove={(e) => {
          onPointer(e.clientX);
          updateAxisHover(e.clientX, e.clientY);
        }}
        onMouseLeave={() => {
          setHoverIdx(null);
          setAxisHover(null);
        }}
        onTouchStart={(e) => onPointer(e.touches[0].clientX)}
        onTouchMove={(e) => onPointer(e.touches[0].clientX)}
        onTouchEnd={() => setHoverIdx(null)}
        onContextMenu={onOrderIntentConfirm ? handleContextMenu : undefined}
        role="img"
        aria-label={`Premium chart: ${formatRupees(first.y)} to ${formatRupees(last.y)}`}
      >
        <defs>
          <linearGradient id="prem-fill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={tone} stopOpacity="0.18" />
            <stop offset="100%" stopColor={tone} stopOpacity="0.01" />
          </linearGradient>
        </defs>
        <line x1={PAD.left} x2={W - PAD.right} y1={geometry.y(geometry.max)} y2={geometry.y(geometry.max)} stroke="#e7e8ee" strokeDasharray="3 4" />
        <line x1={PAD.left} x2={W - PAD.right} y1={geometry.y(geometry.min)} y2={geometry.y(geometry.min)} stroke="#e7e8ee" strokeDasharray="3 4" />
        <text x={W - PAD.right} y={geometry.y(geometry.max) - 4} textAnchor="end" fontSize="10" fill="#9aa1b2">
          {formatRupees(geometry.max)}
        </text>
        <text x={W - PAD.right} y={geometry.y(geometry.min) + 12} textAnchor="end" fontSize="10" fill="#9aa1b2">
          {formatRupees(geometry.min)}
        </text>
        <path d={geometry.area} fill="url(#prem-fill)" />
        <path d={geometry.path} fill="none" stroke={tone} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
        <circle cx={geometry.x(points.length - 1)} cy={geometry.y(last.y)} r="3" fill={tone} />
        {hoverIdx != null && (
          <g>
            <line x1={geometry.x(hoverIdx)} x2={geometry.x(hoverIdx)} y1={PAD.top} y2={H - PAD.bottom} stroke="#9aa1b2" strokeDasharray="2 3" />
            <circle cx={geometry.x(hoverIdx)} cy={geometry.y(points[hoverIdx].y)} r="4" fill="#fff" stroke={tone} strokeWidth="2" />
          </g>
        )}
        {orderLines && orderLines.length > 0 && (
          <g>
            {orderLines.map((line) => {
              const isDragging = dragState?.id === line.id;
              const renderPrice = isDragging ? dragState.price : line.price;
              const { y, offScale } = clampLineY(renderPrice, geometry.min, geometry.max, geometry.y);
              // Founder bug fix (2026-08-04b) — same live-P&L coloring as
              // price-chart.tsx's identical order-line overlay (see
              // orderLineColor's own doc). `last.y` is this chart's own
              // latest premium point (history tick or in-session livePremium
              // append), never a second/duplicate price source.
              const color = orderLineColor(line, last.y);
              const dash = line.kind === "position" ? undefined : "4 3";
              const label = isDragging ? `${line.label.split(" @ ")[0]} @ ${formatRupees(snapToTick(dragState.price))}` : line.label;
              return (
                <g key={line.id}>
                  <line
                    x1={PAD.left}
                    x2={W - PAD.right}
                    y1={y}
                    y2={y}
                    stroke={color}
                    strokeWidth={isDragging ? 2.2 : 1.4}
                    strokeDasharray={dash}
                  />
                  {offScale ? (
                    <text x={W / 2} y={offScale === "above" ? y + 10 : y - 4} textAnchor="middle" fontSize="9" fontWeight={600} fill={color}>
                      {offScale === "above" ? "▲ " : "▼ "}
                      {label}
                    </text>
                  ) : (
                    <text x={W - PAD.right} y={y - 4} textAnchor="end" fontSize="9" fontWeight={600} fill={color}>
                      {label}
                    </text>
                  )}
                  {line.draggable && onOrderLineDrag && (
                    <line
                      x1={PAD.left}
                      x2={W - PAD.right}
                      y1={y}
                      y2={y}
                      stroke="transparent"
                      strokeWidth={DRAG_HIT_STROKE_WIDTH}
                      vectorEffect="non-scaling-stroke"
                      style={{ pointerEvents: "all", cursor: "ns-resize" }}
                      onPointerDown={(e) => handleLinePointerDown(e, line)}
                      onPointerMove={handleLinePointerMove}
                      onPointerUp={handleLinePointerUp}
                      onPointerCancel={handleLinePointerCancel}
                    />
                  )}
                  {line.cancellable && onOrderLineCancel && (
                    <g
                      onClick={(e) => {
                        e.stopPropagation();
                        onOrderLineCancel(line.id);
                      }}
                      style={{ cursor: "pointer" }}
                    >
                      <circle
                        cx={PAD.left + 8}
                        cy={y}
                        r={1}
                        stroke="transparent"
                        strokeWidth={CANCEL_HIT_DIAMETER}
                        vectorEffect="non-scaling-stroke"
                        style={{ pointerEvents: "all" }}
                      />
                      <circle cx={PAD.left + 8} cy={y} r={7} fill="#fff" stroke={color} strokeWidth={1.2} />
                      <text x={PAD.left + 8} y={y + 3} textAnchor="middle" fontSize="10" fontWeight={700} fill={color}>
                        ×
                      </text>
                    </g>
                  )}
                </g>
              );
            })}
          </g>
        )}
      </svg>

      {axisHover && !intentPopover && !contextMenu && onOrderIntentConfirm && (
        <ChartAxisPlusButton top={axisHover.top} onClick={() => openIntentPopoverAt(axisHover.price, (wrapperRef.current?.getBoundingClientRect().width ?? 0) - 24, axisHover.top)} />
      )}

      {intentPopover && onOrderIntentConfirm && (
        <ChartOrderIntentPopover
          price={intentPopover.price}
          currentPrice={last.y}
          left={intentPopover.left}
          top={intentPopover.top}
          onConfirm={(side, variant) => {
            onOrderIntentConfirmRef.current?.({ price: intentPopover.price, side, variant });
            setIntentPopover(null);
          }}
          onDismiss={() => setIntentPopover(null)}
        />
      )}

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

      <p className="mt-2 text-[10px] uppercase tracking-wide text-ink-300">{footerNote}</p>
    </div>
  );
}
