"use client";

/**
 * Strategy Results UI (OVERVIEW sub-tab) — a lean, purpose-built SVG equity
 * curve, in the house's own established convention (`price-chart.tsx`,
 * `components/finance/combo-chart.tsx`: "pure inline viewBox SVG, no chart
 * library, works for mouse and touch"). `ComboChart` itself was evaluated
 * and rejected for this job: it's built for a HANDFUL of category-aligned
 * bars/lines (quarterly fundamentals — a dozen or so points), rendering one
 * `<text>` x-axis label PER category unconditionally. A daily-interval
 * backtest over the workbench's default 5-year window is ~1,250 points —
 * reusing `ComboChart` here would paint over a thousand rotated, unreadable
 * axis labels. This component instead renders index-spaced points with only
 * 3 x-axis labels (first/mid/last) and zero per-point DOM markers (a single
 * `<polyline>` per series), which stays cheap at any bar count this engine
 * can realistically produce.
 *
 * Plots the account's own equity line (net OR gross depending on `view` —
 * the Ideal/Real toggle "switches every plot", per the product brief) against
 * a dashed buy-and-hold overlay, with the drawdown-from-running-peak gap
 * shaded directly on the chart. That shading is a TRANSIENT, chart-local
 * computation over whichever series is currently displayed — NOT a read of
 * any `BacktestStats` field. `backtest.ts`'s own module doc draws a
 * deliberate line ("costs are real cash flows, so only the net equity curve
 * is an actual economic curve") that forbids a persisted "gross drawdown"
 * STAT; that law is about the stats CONTRACT, not about whether a chart may
 * visually trace peak-to-trough on whatever series it happens to be
 * rendering — recomputing it locally here, every render, from the exact
 * points already on screen, satisfies the toggle requirement without
 * fabricating a new engine-level stat the rest of the app could mistake for
 * an audited figure.
 */
import { useRef, useState } from "react";

import type { EquityPoint } from "@/lib/ta/backtest";
import { formatRupees, formatBarTimestamp } from "./format";

const CHART_W = 640;
const PAD_TOP = 16;
const PAD_BOTTOM = 22;
const GUTTER_W = 52;
const TOOLTIP_OFFSET_X = 14;
const TOOLTIP_OFFSET_Y = 12;

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

/** Compact axis-tick money format — `formatRupees` is too verbose (full digit grouping) for a 4-tick gutter; this trims to `₹1.2L`/`₹3.4Cr`-style short units, matching the house's other axis-tick conventions (`combo-chart.tsx`'s own declared-once unit idea, simplified — no dual-axis need here). */
function formatAxisTick(v: number): string {
  const sign = v < 0 ? "-" : "";
  const abs = Math.abs(v);
  if (abs >= 1e7) return `${sign}₹${(abs / 1e7).toFixed(1)}Cr`;
  if (abs >= 1e5) return `${sign}₹${(abs / 1e5).toFixed(1)}L`;
  if (abs >= 1e3) return `${sign}₹${(abs / 1e3).toFixed(0)}k`;
  return `${sign}₹${abs.toFixed(0)}`;
}

/** Running peak of a series — shared by the drawdown shading AND the tooltip's own DD readout, so the two can never disagree. */
function computeRunningPeak(values: readonly number[]): number[] {
  const peaks: number[] = new Array(values.length);
  let peak = -Infinity;
  for (let i = 0; i < values.length; i++) {
    if (values[i] > peak) peak = values[i];
    peaks[i] = peak;
  }
  return peaks;
}

export function EquityCurveChart({
  points,
  view,
  interval,
  height = 220
}: {
  points: readonly EquityPoint[];
  view: "real" | "ideal";
  interval: string;
  height?: number;
}) {
  const wrapperRef = useRef<HTMLDivElement>(null);
  const [activeIdx, setActiveIdx] = useState<number | null>(null);
  const [pointerPx, setPointerPx] = useState<{ x: number; y: number } | null>(null);

  if (points.length === 0) {
    return <div className="rounded-lg bg-ink-50 p-4 text-center text-xs text-ink-400">No equity curve to plot.</div>;
  }

  const displayed = points.map((p) => (view === "real" ? p.equity : p.grossEquity));
  const buyHold = points.map((p) => p.buyHoldEquity);
  const peak = computeRunningPeak(displayed);

  const allValues = [...displayed, ...buyHold];
  let yMin = Math.min(...allValues);
  let yMax = Math.max(...allValues);
  if (yMin === yMax) {
    // Degenerate flat series (e.g. a 0-trade run) — widen artificially so the plot area isn't a divide-by-zero line.
    yMin -= 1;
    yMax += 1;
  }
  const yPad = (yMax - yMin) * 0.08;
  yMin -= yPad;
  yMax += yPad;
  const ySpan = yMax - yMin || 1;

  const plotLeft = GUTTER_W;
  const plotRight = CHART_W - 8;
  const plotTop = PAD_TOP;
  const plotBottom = height - PAD_BOTTOM;
  const plotHeight = plotBottom - plotTop;
  const n = points.length;

  const xOf = (i: number) => (n <= 1 ? plotLeft : plotLeft + ((plotRight - plotLeft) * i) / (n - 1));
  const yOf = (v: number) => plotTop + ((yMax - v) / ySpan) * plotHeight;

  const linePath = (values: readonly number[]) => values.map((v, i) => `${i === 0 ? "M" : "L"}${xOf(i)},${yOf(v)}`).join(" ");
  const equityPath = linePath(displayed);
  const buyHoldPath = linePath(buyHold);

  // Drawdown shading: a closed ribbon between the equity line (forward) and the running-peak line (backward) —
  // see this file's own doc for why this is a transient chart computation, not a stats-engine field.
  const forward = displayed.map((v, i) => `${i === 0 ? "M" : "L"}${xOf(i)},${yOf(v)}`).join(" ");
  const backward = [...peak]
    .map((v, i) => `L${xOf(i)},${yOf(v)}`)
    .reverse()
    .join(" ");
  const drawdownAreaPath = `${forward} ${backward} Z`;

  const positive = displayed[displayed.length - 1] >= displayed[0];
  const lineColor = positive ? "#059669" : "#e11d48"; // emerald-600 / rose-600, matches the house's win/loss palette elsewhere.

  const ticks = 4;
  const tickValues = Array.from({ length: ticks + 1 }, (_, i) => yMin + (ySpan * i) / ticks).reverse();

  const xIndexFromClientX = (clientX: number, rect: DOMRect): number => {
    const fracX = clamp((clientX - rect.left) / rect.width, 0, 1);
    const vbX = clamp(fracX * CHART_W, plotLeft, plotRight);
    const raw = n <= 1 ? 0 : ((vbX - plotLeft) / (plotRight - plotLeft)) * (n - 1);
    return clamp(Math.round(raw), 0, n - 1);
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const rect = wrapperRef.current?.getBoundingClientRect();
    if (!rect) return;
    const idx = xIndexFromClientX(e.clientX, rect);
    setActiveIdx(idx);
    setPointerPx({ x: e.clientX - rect.left, y: e.clientY - rect.top });
  };

  const handlePointerLeave = () => {
    setActiveIdx(null);
    setPointerPx(null);
  };

  const wrapperRect = wrapperRef.current?.getBoundingClientRect();
  const containerW = wrapperRect?.width ?? CHART_W;
  const containerH = wrapperRect?.height ?? height;

  let tooltipLeft = 0;
  let tooltipTop = 0;
  const TOOLTIP_W = 168;
  const TOOLTIP_H = 76;
  if (pointerPx) {
    tooltipLeft = clamp(pointerPx.x + TOOLTIP_OFFSET_X, 4, Math.max(4, containerW - TOOLTIP_W - 4));
    tooltipTop = clamp(pointerPx.y - TOOLTIP_H - TOOLTIP_OFFSET_Y, 4, Math.max(4, containerH - TOOLTIP_H - 4));
  }

  const activePoint = activeIdx != null ? points[activeIdx] : null;
  const activeDisplayed = activeIdx != null ? displayed[activeIdx] : null;
  const activePeak = activeIdx != null ? peak[activeIdx] : null;
  const activeDdAmount = activePeak != null && activeDisplayed != null ? activePeak - activeDisplayed : null;
  const activeDdPct = activePeak != null && activePeak > 0 && activeDdAmount != null ? (activeDdAmount / activePeak) * 100 : null;

  return (
    <div>
      <div
        ref={wrapperRef}
        className="relative touch-none select-none"
        onPointerMove={handlePointerMove}
        onPointerLeave={handlePointerLeave}
      >
        <svg viewBox={`0 0 ${CHART_W} ${height}`} className="block w-full" role="img" aria-label="Backtest equity curve">
          {tickValues.map((tv, i) => (
            <g key={i}>
              <line x1={plotLeft} x2={plotRight} y1={yOf(tv)} y2={yOf(tv)} stroke="#f1f5f9" strokeWidth={1} />
              <text x={plotLeft - 6} y={yOf(tv) + 4} textAnchor="end" fontSize={11} fill="#64748b" className="tabular-nums">
                {formatAxisTick(tv)}
              </text>
            </g>
          ))}

          {/* Drawdown-from-running-peak shading — see this file's doc. */}
          <path d={drawdownAreaPath} fill={positive ? "#f43f5e" : "#f43f5e"} fillOpacity={0.08} />

          {/* Buy & hold overlay — dashed, always behind the equity line. */}
          <path d={buyHoldPath} fill="none" stroke="#94a3b8" strokeWidth={1.5} strokeDasharray="4 3" />

          {/* Equity line */}
          <path d={equityPath} fill="none" stroke={lineColor} strokeWidth={2} />

          {activeIdx != null && (
            <line x1={xOf(activeIdx)} x2={xOf(activeIdx)} y1={plotTop} y2={plotBottom} stroke="#94a3b8" strokeWidth={1} />
          )}

          {/* Only 3 x-axis labels (first/mid/last) — see this file's own doc for why NOT one-per-point. */}
          {[0, Math.floor((n - 1) / 2), n - 1].map((i, k) => (
            <text
              key={k}
              x={xOf(i)}
              y={height - 6}
              textAnchor={k === 0 ? "start" : k === 2 ? "end" : "middle"}
              fontSize={10}
              fill="#94a3b8"
            >
              {formatBarTimestamp(points[i].timestamp, interval)}
            </text>
          ))}
        </svg>

        {activePoint && activeDisplayed != null && pointerPx && (
          <div
            className="pointer-events-none absolute z-10 w-[168px] rounded-lg border border-ink-200 bg-white px-2.5 py-2 shadow-lg"
            style={{ left: tooltipLeft, top: tooltipTop }}
          >
            <p className="mb-1 text-[10px] font-semibold text-ink-900">{formatBarTimestamp(activePoint.timestamp, interval)}</p>
            <div className="space-y-0.5 text-[10px]">
              <div className="flex justify-between">
                <span className="text-ink-400">Equity ({view === "real" ? "net" : "gross"})</span>
                <span className="font-semibold tabular-nums text-ink-900">{formatRupees(activeDisplayed)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-ink-400">Buy &amp; hold</span>
                <span className="tabular-nums text-ink-600">{formatRupees(buyHold[activeIdx as number])}</span>
              </div>
              {activeDdPct != null && activeDdAmount != null && (
                <div className="flex justify-between">
                  <span className="text-ink-400">Drawdown</span>
                  <span className="tabular-nums text-rose-600">
                    -{activeDdPct.toFixed(2)}% ({formatRupees(activeDdAmount)})
                  </span>
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      <div className="mt-1.5 flex flex-wrap justify-center gap-4 text-[11px] text-ink-500">
        <span className="inline-flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-full" style={{ backgroundColor: lineColor }} />
          Equity ({view === "real" ? "net of costs" : "no costs"})
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="h-0.5 w-3 bg-ink-300" style={{ borderTop: "1.5px dashed #94a3b8" }} />
          Buy &amp; hold
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-full bg-rose-500/20" />
          Drawdown
        </span>
      </div>
    </div>
  );
}
