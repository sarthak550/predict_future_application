"use client";

import { useLayoutEffect, useRef, useState } from "react";

/**
 * Fundamentals Panel v2 (Sprint 1, T1.2) — shared combo-chart core, replacing
 * the five near-duplicate SVG chart implementations that used to live in
 * fundamentals-panel.tsx (FinancialsBars, SmallBars, EpsBars,
 * DividendYieldBars, DividendPayoutBars, DebtCoverageBars — all deleted as
 * part of this migration). One component renders every bar/line/combo chart
 * across the Fundamentals panel; the founder-approved plan (§1) is the
 * complete, locked spec for this file — no redesign here, straight
 * implementation.
 *
 * House convention preserved from price-chart.tsx: pure inline viewBox SVG,
 * no chart library, works for mouse and touch.
 *
 * DUAL-AXIS NOTE: this chart intentionally supports a secondary %/× axis
 * alongside the primary ₹/$ axis — a deliberate, founder-locked deviation
 * from the general "never dual-axis" guidance, mitigated exactly as the plan
 * specifies: every secondary-axis series is a DASHED line (never a bar),
 * visually marking it as "a different kind of quantity" rather than letting
 * it blend with the primary bars.
 */

// ── Public types (locked — founder-approved plan §1) ─────────────────────────

export type ComboSeriesDef = {
  id: string;
  label: string;
  color: string;
  kind: "bar" | "line";
  axis: "primary" | "secondary";
  /** Secondary-axis lines are ALWAYS rendered dashed regardless of this flag (see file doc comment) — set this on a PRIMARY-axis line if it also needs a dashed treatment. Ignored for bars. */
  dashed?: boolean;
  /** Index-aligned with `categories`. */
  values: (number | null)[];
  formatValue: (v: number) => string;
  /** Optional per-row detail sub-line rendered under this series' tooltip row at the active category — e.g. the founder-mandated annualised-yield disclosure ("₹20.50 TTM ÷ ₹402.00 price") or a dividend-growth comparison basis ("vs ₹18.20 TTM a year earlier"). Return null to render no sub-line for that category. */
  tooltipDetail?: (idx: number) => string | null;
  /** Rendered as an ink-400 fallback row when `values[idx]` is null AND this returns non-null (e.g. "Annualised yield unavailable"). Return null to omit the row entirely for that category. */
  tooltipFallback?: (idx: number) => string | null;
};

export type ComboChartProps = {
  /** X-axis labels, index-aligned with every series' `values`. */
  categories: string[];
  series: ComboSeriesDef[];
  /** SVG viewBox height in px. Default 200. */
  height?: number;
  /** §06 Asset Base Composition mode (Sprint 2) — bar-kind series in a group stack cumulatively instead of clustering side by side. Default false. */
  stackedBars?: boolean;
  formatPrimaryAxis: (v: number) => string;
  formatSecondaryAxis?: (v: number) => string;
  /** Tooltip title row for a category index. Defaults to `categories[idx]`. */
  tooltipTitle?: (idx: number) => string;
  ariaLabel: string;
  /** Small ink-400 note rendered below the chart/legend — e.g. a quarterly-growth-gating explanation. */
  footnote?: string;
  /** Default: shown when more than one series has at least one non-null value. */
  legend?: boolean;
};

// ── Layout constants ──────────────────────────────────────────────────────────

const CHART_W = 640;
const LEFT_AXIS_W = 44;
const RIGHT_AXIS_W = 40;
const PAD_TOP = 14;
const PAD_BOTTOM = 26;
const BAR_GAP = 2;
const MAX_BAR_W = 14;
const TOOLTIP_OFFSET_X = 14;
const TOOLTIP_OFFSET_Y = 12;

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

/**
 * Groups a series' index-aligned point list into contiguous runs by INDEX
 * adjacency (not by value) — a null breaks the run so the rendered polyline
 * shows a genuine GAP rather than bridging across missing data, which would
 * visually imply a trend we don't actually have. Shared by every line
 * series (reused convention from the pre-migration dividend charts).
 */
function buildLineSegments(
  values: (number | null)[],
  xOf: (i: number) => number,
  yOf: (v: number) => number
): { points: { x: number; y: number }[]; indices: number[] }[] {
  const present = values
    .map((v, i) => (v != null ? { i, x: xOf(i), y: yOf(v) } : null))
    .filter((p): p is { i: number; x: number; y: number } => p !== null);

  const segments: { points: { x: number; y: number }[]; indices: number[] }[] = [];
  let currentPoints: { x: number; y: number }[] = [];
  let currentIndices: number[] = [];
  let lastIdx = -2;
  for (const p of present) {
    if (p.i !== lastIdx + 1 && currentPoints.length > 0) {
      segments.push({ points: currentPoints, indices: currentIndices });
      currentPoints = [];
      currentIndices = [];
    }
    currentPoints.push({ x: p.x, y: p.y });
    currentIndices.push(p.i);
    lastIdx = p.i;
  }
  if (currentPoints.length > 0) segments.push({ points: currentPoints, indices: currentIndices });
  return segments;
}

export function ComboChart({
  categories,
  series,
  height = 200,
  stackedBars = false,
  formatPrimaryAxis,
  formatSecondaryAxis,
  tooltipTitle,
  ariaLabel,
  footnote,
  legend,
}: ComboChartProps) {
  const wrapperRef = useRef<HTMLDivElement>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);

  const [activeIdx, setActiveIdx] = useState<number | null>(null);
  const [pointerPx, setPointerPx] = useState<{ x: number; y: number } | null>(null);
  const [touchAnchorIdx, setTouchAnchorIdx] = useState<number | null>(null);
  const [tooltipSize, setTooltipSize] = useState({ w: 0, h: 0 });

  const rafRef = useRef<number | null>(null);
  const pendingRef = useRef<{ x: number; y: number; idx: number } | null>(null);

  // A series with zero non-null values renders nothing anywhere (bars,
  // lines, legend, tooltip rows) — callers may still pass it (e.g. so a
  // caller doesn't have to re-derive "does EBITDA exist at all" twice), but
  // this component is the single source of truth for "absent -> omitted."
  const activeSeries = series.filter((s) => s.values.some((v) => v != null));
  const hasSecondary = activeSeries.some((s) => s.axis === "secondary");

  const plotLeft = LEFT_AXIS_W;
  const plotRight = CHART_W - (hasSecondary ? RIGHT_AXIS_W : 0);
  const plotWidth = plotRight - plotLeft;
  const plotTop = PAD_TOP;
  const plotBottom = height - PAD_BOTTOM;
  const plotHeight = plotBottom - plotTop;
  const groupW = categories.length > 0 ? plotWidth / categories.length : plotWidth;

  const barSeries = activeSeries.filter((s) => s.kind === "bar");
  const lineSeries = activeSeries.filter((s) => s.kind === "line");
  const nBars = barSeries.length;

  // Primary axis domain (§06 Sprint 2 smoke-test fix, T2.1): in `stackedBars`
  // mode the visual top of a group is the CUMULATIVE SUM of its bar series,
  // not any single series' own value — using each series' individual max (as
  // this used to) badly under-scales the domain (e.g. Fixed=500/Current=300/
  // Other=200 stacking to a 1000 total would size the axis to 500, pushing
  // the top segment off the plot entirely). Non-stacked (clustered) mode is
  // unaffected — each bar's own value is still its own visual extent there.
  const primaryValues: number[] = [];
  if (stackedBars) {
    for (let i = 0; i < categories.length; i++) {
      let total = 0;
      let any = false;
      for (const s of barSeries) {
        const v = s.values[i];
        if (v != null) {
          total += v;
          any = true;
        }
      }
      if (any) primaryValues.push(total);
    }
  } else {
    for (const s of barSeries) {
      for (const v of s.values) if (v != null) primaryValues.push(v);
    }
  }
  // Bars always render against the primary axis regardless of their declared
  // `axis` (see the "Bars" render block below, which always calls
  // `yPrimary`) — only primary-axis LINE series additionally widen the
  // primary domain here.
  for (const s of lineSeries) {
    if (s.axis !== "primary") continue;
    for (const v of s.values) if (v != null) primaryValues.push(v);
  }
  const primaryMax = Math.max(0, ...primaryValues);
  const primaryMin = Math.min(0, ...primaryValues);
  const primarySpan = primaryMax - primaryMin || 1;
  const yPrimary = (v: number) => plotTop + ((primaryMax - v) / primarySpan) * plotHeight;
  const zeroYPrimary = yPrimary(0);

  const secondarySeries = activeSeries.filter((s) => s.axis === "secondary");
  const secondaryValues = secondarySeries.flatMap((s) => s.values).filter((v): v is number => v != null);
  const secondaryMax = Math.max(0, ...secondaryValues);
  const secondaryMin = Math.min(0, ...secondaryValues);
  const secondarySpan = secondaryMax - secondaryMin || 1;
  const ySecondary = (v: number) => plotTop + ((secondaryMax - v) / secondarySpan) * plotHeight;
  const secondaryAxisColor = secondarySeries.length === 1 ? secondarySeries[0].color : "#94a3b8";

  const yFor = (s: ComboSeriesDef) => (s.axis === "secondary" ? ySecondary : yPrimary);
  const xCenter = (i: number) => plotLeft + groupW * (i + 0.5);

  const maxClusterW = groupW * 0.82;
  // §06 smoke-test fix, T2.1: a stacked bar is ONE column regardless of how
  // many series stack inside it — it must not shrink as `nBars` grows the
  // way a clustered bar's per-series width does (the old shared formula
  // divided by `nBars` unconditionally, which would render a 3-series stack
  // at 1/3 width, as if it were 3 side-by-side bars).
  const barW = stackedBars
    ? Math.max(2, Math.min(MAX_BAR_W, maxClusterW))
    : nBars > 0
      ? Math.max(2, Math.min(MAX_BAR_W, (maxClusterW - BAR_GAP * (nBars - 1)) / nBars))
      : 0;
  const clusterW = stackedBars ? barW : nBars * barW + Math.max(0, nBars - 1) * BAR_GAP;

  const groupTopViewBoxY = (idx: number): number => {
    let minY = plotTop;
    // §06 smoke-test fix, T2.1: in stacked mode a bar series' own value is
    // its SEGMENT height, not its visual y-position — the topmost point of a
    // stacked group is at the cumulative total, matching the render block's
    // own cumulative math below, not each series' raw value independently.
    if (stackedBars) {
      let stackTotal = 0;
      for (const s of barSeries) {
        const v = s.values[idx];
        if (v != null) stackTotal += v;
      }
      if (stackTotal > 0) minY = Math.min(minY, yPrimary(stackTotal));
    } else {
      for (const s of barSeries) {
        const v = s.values[idx];
        if (v == null) continue;
        minY = Math.min(minY, yFor(s)(v));
      }
    }
    for (const s of lineSeries) {
      const v = s.values[idx];
      if (v == null) continue;
      minY = Math.min(minY, yFor(s)(v));
    }
    return minY;
  };

  const groupIndexFromClientX = (clientX: number, rect: DOMRect): number => {
    const fracX = clamp((clientX - rect.left) / rect.width, 0, 1);
    const vbX = clamp(fracX * CHART_W, plotLeft, plotRight);
    return clamp(Math.floor((vbX - plotLeft) / groupW), 0, categories.length - 1);
  };

  const scheduleUpdate = (x: number, y: number, idx: number) => {
    pendingRef.current = { x, y, idx };
    if (rafRef.current == null) {
      rafRef.current = requestAnimationFrame(() => {
        rafRef.current = null;
        const pending = pendingRef.current;
        if (pending) {
          setPointerPx({ x: pending.x, y: pending.y });
          setActiveIdx(pending.idx);
        }
      });
    }
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.pointerType === "touch") return; // touch uses discrete tap-anchoring below, not continuous tracking
    const rect = wrapperRef.current?.getBoundingClientRect();
    if (!rect) return;
    const idx = groupIndexFromClientX(e.clientX, rect);
    scheduleUpdate(e.clientX - rect.left, e.clientY - rect.top, idx);
  };

  const handlePointerLeave = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.pointerType === "touch") return;
    if (rafRef.current != null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    setActiveIdx(null);
    setPointerPx(null);
  };

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.pointerType !== "touch") return;
    const rect = wrapperRef.current?.getBoundingClientRect();
    if (!rect) return;
    const idx = groupIndexFromClientX(e.clientX, rect);

    if (touchAnchorIdx === idx) {
      // Tap-again dismisses.
      setTouchAnchorIdx(null);
      setActiveIdx(null);
      setPointerPx(null);
      return;
    }

    setTouchAnchorIdx(idx);
    setActiveIdx(idx);
    // Anchor ABOVE the tapped group's topmost mark — not the raw finger
    // position, which would sit ON TOP of the data the user just tapped.
    const anchorVbX = xCenter(idx);
    const anchorVbY = groupTopViewBoxY(idx);
    setPointerPx({
      x: (anchorVbX / CHART_W) * rect.width,
      y: (anchorVbY / height) * rect.height,
    });
  };

  useLayoutEffect(() => {
    if (tooltipRef.current) {
      setTooltipSize({ w: tooltipRef.current.offsetWidth, h: tooltipRef.current.offsetHeight });
    }
  }, [activeIdx]);

  // All hooks above this line run unconditionally on every render — this
  // early return (no data to plot at all) must stay AFTER every hook call,
  // never before (React's rules-of-hooks: hook call order must never depend
  // on props/state).
  if (categories.length === 0 || activeSeries.length === 0) return null;

  const wrapperRect = wrapperRef.current?.getBoundingClientRect();
  const containerW = wrapperRect?.width ?? CHART_W;
  const containerH = wrapperRect?.height ?? height;

  let tooltipLeft = 0;
  let tooltipTop = 0;
  if (pointerPx) {
    tooltipLeft = pointerPx.x + TOOLTIP_OFFSET_X;
    if (tooltipLeft + tooltipSize.w > containerW) tooltipLeft = pointerPx.x - TOOLTIP_OFFSET_X - tooltipSize.w;
    tooltipLeft = clamp(tooltipLeft, 4, Math.max(4, containerW - tooltipSize.w - 4));

    tooltipTop = pointerPx.y - tooltipSize.h - TOOLTIP_OFFSET_Y;
    if (tooltipTop < 0) tooltipTop = pointerPx.y + TOOLTIP_OFFSET_Y;
    tooltipTop = clamp(tooltipTop, 4, Math.max(4, containerH - tooltipSize.h - 4));
  }

  const legendEntries = activeSeries;
  const showLegend = legend ?? legendEntries.length > 1;

  return (
    <div>
      <div
        ref={wrapperRef}
        className="relative touch-none select-none"
        onPointerMove={handlePointerMove}
        onPointerLeave={handlePointerLeave}
        onPointerDown={handlePointerDown}
      >
        <svg viewBox={`0 0 ${CHART_W} ${height}`} className="block w-full" role="img" aria-label={ariaLabel}>
          {/* Primary axis gridlines + labels (left gutter) */}
          {[primaryMax, (primaryMax + Math.min(primaryMin, 0)) / 2].map((gv, gi) => (
            <g key={`p-${gi}`}>
              <line x1={plotLeft} x2={plotRight} y1={yPrimary(gv)} y2={yPrimary(gv)} stroke="#f1f5f9" strokeWidth={1} />
              <text x={plotLeft - 6} y={yPrimary(gv) + 3} textAnchor="end" fontSize={10} fill="#94a3b8">
                {formatPrimaryAxis(gv)}
              </text>
            </g>
          ))}
          <line x1={plotLeft} x2={plotRight} y1={zeroYPrimary} y2={zeroYPrimary} stroke="#e2e8f0" strokeWidth={1} />

          {/* Secondary axis labels (right gutter), tinted to the line's own color when it's the only secondary series */}
          {hasSecondary &&
            formatSecondaryAxis &&
            [secondaryMax, secondaryMin].map((gv, gi) => (
              <text key={`s-${gi}`} x={plotRight + 6} y={ySecondary(gv) + 3} fontSize={10} fill={secondaryAxisColor}>
                {formatSecondaryAxis(gv)}
              </text>
            ))}

          {/* Active-group vertical guide */}
          {activeIdx != null && (
            <line
              x1={xCenter(activeIdx)}
              x2={xCenter(activeIdx)}
              y1={plotTop}
              y2={plotBottom}
              stroke="#94a3b8"
              strokeWidth={1}
            />
          )}

          {/* Bars */}
          {categories.map((_, i) => {
            const dim = activeIdx != null && activeIdx !== i;
            const cx = xCenter(i);

            if (stackedBars) {
              let cumulative = 0;
              return (
                <g key={`bar-group-${i}`} opacity={dim ? 0.35 : 1}>
                  {barSeries.map((s) => {
                    const v = s.values[i];
                    if (v == null) return null;
                    const y0 = yPrimary(cumulative);
                    cumulative += v;
                    const y1 = yPrimary(cumulative);
                    return (
                      <rect
                        key={s.id}
                        x={cx - barW / 2}
                        width={barW}
                        y={Math.min(y0, y1)}
                        height={Math.max(2, Math.abs(y1 - y0))}
                        rx={2}
                        fill={s.color}
                      />
                    );
                  })}
                </g>
              );
            }

            const clusterStart = cx - clusterW / 2;
            return (
              <g key={`bar-group-${i}`} opacity={dim ? 0.35 : 1}>
                {barSeries.map((s, bi) => {
                  const v = s.values[i];
                  if (v == null) return null;
                  const bx = clusterStart + bi * (barW + BAR_GAP);
                  const by = yPrimary(v);
                  return (
                    <rect
                      key={s.id}
                      x={bx}
                      width={barW}
                      y={Math.min(by, zeroYPrimary)}
                      height={Math.max(2, Math.abs(by - zeroYPrimary))}
                      rx={2}
                      fill={s.color}
                    />
                  );
                })}
              </g>
            );
          })}

          {/* Lines (gap-not-bridge segments) + markers */}
          {lineSeries.map((s) => {
            const yOf = yFor(s);
            const isDashed = s.axis === "secondary" || s.dashed;
            const segments = buildLineSegments(s.values, xCenter, yOf);
            return (
              <g key={s.id}>
                {segments.map((seg, si) => (
                  <polyline
                    key={si}
                    points={seg.points.map((p) => `${p.x},${p.y}`).join(" ")}
                    fill="none"
                    stroke={s.color}
                    strokeWidth={2}
                    strokeDasharray={isDashed ? "4 3" : undefined}
                  />
                ))}
                {segments.flatMap((seg) =>
                  seg.points.map((p, pi) => {
                    const idx = seg.indices[pi];
                    const dim = activeIdx != null && activeIdx !== idx;
                    return (
                      <circle
                        key={idx}
                        cx={p.x}
                        cy={p.y}
                        r={activeIdx === idx ? 4 : 3}
                        fill={s.color}
                        stroke="white"
                        strokeWidth={1.5}
                        opacity={dim ? 0.35 : 1}
                      />
                    );
                  })
                )}
              </g>
            );
          })}

          {/* X-axis category labels */}
          {categories.map((label, i) => {
            const dim = activeIdx != null && activeIdx !== i;
            return (
              <text
                key={`label-${i}`}
                x={xCenter(i)}
                y={height - 8}
                textAnchor="middle"
                fontSize={categories.length > 8 ? 9 : 11}
                fill={dim ? "#cbd5e1" : "#94a3b8"}
              >
                {label}
              </text>
            );
          })}
        </svg>

        {/* Cursor-following DOM tooltip */}
        {activeIdx != null && pointerPx && (
          <div
            ref={tooltipRef}
            className="pointer-events-none absolute z-10 min-w-[160px] max-w-[240px] rounded-lg border border-ink-200 bg-white px-3 py-2 shadow-lg"
            style={{ left: tooltipLeft, top: tooltipTop }}
          >
            <p className="mb-1 text-xs font-semibold text-ink-900">
              {tooltipTitle ? tooltipTitle(activeIdx) : categories[activeIdx]}
            </p>
            <div className="space-y-1">
              {activeSeries.map((s) => {
                const v = s.values[activeIdx];
                if (v == null) {
                  const fallback = s.tooltipFallback?.(activeIdx);
                  if (fallback == null) return null;
                  return (
                    <div key={s.id} className="flex items-center gap-1.5">
                      <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: s.color }} />
                      <span className="text-[10px] text-ink-400">{fallback}</span>
                    </div>
                  );
                }
                const detail = s.tooltipDetail?.(activeIdx);
                return (
                  <div key={s.id}>
                    <div className="flex items-center gap-1.5">
                      <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: s.color }} />
                      <span className="flex-1 truncate text-[11px] text-ink-500">{s.label}</span>
                      <span className="text-xs font-semibold tabular-nums text-ink-900">{s.formatValue(v)}</span>
                    </div>
                    {detail && <p className="pl-3.5 text-[10px] text-ink-400">{detail}</p>}
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {(showLegend || footnote) && (
        <div className="mt-1.5 space-y-1">
          {showLegend && (
            <div className="flex flex-wrap gap-4">
              {legendEntries.map((s) => (
                <span key={s.id} className="inline-flex items-center gap-1.5 text-xs text-ink-500">
                  <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: s.color }} />
                  {s.label}
                </span>
              ))}
            </div>
          )}
          {footnote && <p className="text-[11px] text-ink-400">{footnote}</p>}
        </div>
      )}
    </div>
  );
}
