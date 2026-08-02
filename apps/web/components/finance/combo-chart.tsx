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
 *
 * AXIS POLISH PASS (founder chart-polish iteration on the shipped v2) —
 * three related fixes, all confined to this file's axis machinery, none of
 * which change any caller's data flow:
 *   1. NICE-SCALE ticks (`computeNiceScale`) — gridline/tick values are now
 *      drawn from the 1/2/2.5/5 × 10^k "nice number" family and the domain is
 *      snapped OUTWARD to whole multiples of that step (always including 0),
 *      instead of the old two-tick [dataMax, mid] scheme whose tick VALUES
 *      were arbitrary fractions of the raw data range. 3-5 ticks per axis.
 *   2. "Declared-once" axis unit (`AxisFormat`) — callers' `formatPrimaryAxis`
 *      / `formatSecondaryAxis` props are now FACTORIES keyed by the axis's
 *      own nice-scale max (`(domainMax) => { unit, tick }`) rather than plain
 *      formatters, so every tick on one axis shares ONE consistent magnitude
 *      band (e.g. "₹ L Cr") shown once, with each tick rendering just its
 *      short number ("5", "10", "15") — a research-deck convention that also
 *      keeps tick strings short enough to auto-size the gutter (below). Full
 *      ₹/currency formatting is UNCHANGED in the tooltip (`s.formatValue`),
 *      which never routes through this factory.
 *   3. Auto-sized gutters (`computeGutterWidth` / `computeAxisPresentation`)
 *      — the left/right axis gutters are no longer fixed 44px/40px; they're
 *      measured from the longest rendered tick/unit string (~5.5 viewBox
 *      units per 10px char) and clamped to [MIN_GUTTER_W, MAX_GUTTER_W]. A
 *      defensive coarsen-to-3-ticks fallback exists for the (in practice
 *      unreachable, given how short the compact formats are) case where even
 *      the max gutter can't fit a label.
 * Every section in fundamentals-panel.tsx (§01-§07, including §06's stacked
 * mode) inherits all three fixes automatically — none of them special-case
 * `stackedBars`.
 */

// ── Public types (locked — founder-approved plan §1; `AxisFormat` added by the axis-polish pass above) ──

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

/**
 * An axis's rendering contract for ONE chart instance — `unit` is the
 * "declared once" short annotation shown a single time at the top of the
 * axis's gutter (e.g. "₹ L Cr", "%", "×"; empty string renders no
 * annotation), and `tick` formats a single gridline VALUE into its short
 * number string already expressed in terms of `unit` (e.g. `unit: "₹ Cr"`,
 * `tick: (v) => (v / 1e7).toFixed(1)`-ish). Full/precise formatting for the
 * tooltip stays on each series' own `formatValue` — this type is axis-only.
 */
export type AxisFormat = { unit: string; tick: (v: number) => string };

export type ComboChartProps = {
  /** X-axis labels, index-aligned with every series' `values`. */
  categories: string[];
  series: ComboSeriesDef[];
  /** SVG viewBox height in px. Default 200. */
  height?: number;
  /**
   * SVG viewBox WIDTH. Default 640 (full-width sections). Half-width grid
   * sections pass ~360 so text renders at natural size instead of being
   * CSS-scaled to ~half (founder 2026-08-02: paired charts "looking very
   * small, difficult to read" — the fix is a narrower canvas, not bigger
   * font numbers, which keeps every proportion intact).
   */
  width?: number;
  /**
   * Caps the RENDERED chart width in CSS px (centered when the container is
   * wider). Without it, a narrow-canvas chart stacking to a full-width
   * single column below `lg` scales up enormously (founder 2026-08-02:
   * "height is too large" — a 360×270 canvas at ~850px card width renders
   * ~640px tall). The viewBox aspect (e.g. the founder-requested 4:3) is
   * preserved at every display size.
   */
  maxDisplayWidth?: number;
  /** §06 Asset Base Composition mode (Sprint 2) — bar-kind series in a group stack cumulatively instead of clustering side by side. Default false. */
  stackedBars?: boolean;
  /** Factory: given the primary axis's own nice-scale domain max, returns its declared-once unit + per-tick short formatter (see `AxisFormat`). */
  formatPrimaryAxis: (domainMax: number) => AxisFormat;
  /** Factory: given the secondary axis's own nice-scale domain max, returns its declared-once unit + per-tick short formatter. Only consulted when a secondary-axis series is present. */
  formatSecondaryAxis?: (domainMax: number) => AxisFormat;
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
const PAD_TOP = 18; // headroom for the topmost gridline's own label PLUS the declared-once axis-unit annotation above it
const PAD_BOTTOM = 26;
const BAR_GAP = 4;
const MAX_BAR_W = 9;
const TOOLTIP_OFFSET_X = 14;
const TOOLTIP_OFFSET_Y = 12;

// ── Gutter auto-sizing (axis-polish pass, fix 4b) ─────────────────────────────

/** ~10px tabular-nums character width, expressed in this chart's 640-wide viewBox units (matches the founder brief's own estimate). */
const CHAR_W_VB = 7;
/** Gap between a tick label's inner edge and the plot area — matches the pre-existing `x = plotLeft ± 6` offset convention. */
const GUTTER_TEXT_GAP = 6;
/** Small buffer so the widest label's outer edge never touches the viewBox edge. */
const GUTTER_EDGE_MARGIN = 2;
const MIN_GUTTER_W = 28;
const MAX_GUTTER_W = 64;

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

function computeGutterWidth(labels: string[]): number {
  const maxChars = labels.reduce((m, s) => Math.max(m, s.length), 0);
  const raw = maxChars * CHAR_W_VB + GUTTER_TEXT_GAP + GUTTER_EDGE_MARGIN;
  return clamp(raw, MIN_GUTTER_W, MAX_GUTTER_W);
}

// ── Nice-scale ticks (axis-polish pass, fix 2) ────────────────────────────────

const NICE_STEP_FRACTIONS = [1, 2, 2.5, 5];
const MIN_TICKS = 3;
const MAX_TICKS = 5;
const TARGET_TICKS = 4;

type NiceScale = { min: number; max: number; step: number; ticks: number[] };

/**
 * A proper "nice scale": the step is drawn from the 1/2/2.5/5 × 10^k family
 * (never an arbitrary fraction of the raw data range), the domain is snapped
 * OUTWARD to whole multiples of that step, and 0 is always included in the
 * domain (never a deceptive non-zero baseline on a magnitude chart — matches
 * this house's existing zero-baseline convention, just generalized to every
 * tick instead of one hardcoded line). `targetTicks` is a preference: the
 * actual tick count is whichever candidate step lands closest to it while
 * staying inside [MIN_TICKS, MAX_TICKS], searched across a ±2-decade
 * neighborhood of the naive rough-step estimate.
 */
function computeNiceScale(dataMin: number, dataMax: number, targetTicks: number): NiceScale {
  const min0 = Math.min(0, dataMin);
  const max0 = Math.max(0, dataMax);

  if (min0 === 0 && max0 === 0) {
    // Degenerate all-zero domain (e.g. a lone series whose only non-null
    // values happen to be 0) — still a valid, if trivial, nice scale rather
    // than a divide-by-zero.
    return { min: 0, max: 1, step: 1, ticks: [0, 1] };
  }

  const range = max0 - min0;
  const roughStep = range / Math.max(1, targetTicks - 1);
  const exponent = Math.floor(Math.log10(roughStep));

  const build = (step: number): NiceScale => {
    const niceMin = -Math.ceil(-min0 / step) * step; // min0 <= 0 always (0 is always in-domain)
    const niceMax = Math.ceil(max0 / step) * step;
    const count = Math.round((niceMax - niceMin) / step) + 1;
    // Round each tick to the step's own decimal precision to kill float
    // accumulation drift (e.g. 0.7999999999999999 from repeated addition).
    const decimals = Math.max(0, Math.min(10, -Math.floor(Math.log10(step)) + 2));
    const ticks: number[] = [];
    for (let i = 0; i < count; i++) ticks.push(Number((niceMin + i * step).toFixed(decimals)));
    return { min: niceMin, max: niceMax, step, ticks };
  };

  const candidateSteps = new Set<number>();
  for (const e of [exponent - 1, exponent, exponent + 1, exponent + 2]) {
    for (const f of NICE_STEP_FRACTIONS) candidateSteps.add(f * Math.pow(10, e));
  }

  let best: NiceScale | null = null;
  let bestScore = Infinity;
  for (const step of [...candidateSteps].sort((a, b) => a - b)) {
    const scale = build(step);
    const count = scale.ticks.length;
    if (count < MIN_TICKS || count > MAX_TICKS) continue;
    const score = Math.abs(count - targetTicks);
    if (score < bestScore) {
      bestScore = score;
      best = scale;
    }
  }

  // Fallback (not expected to fire — the ±2-decade sweep above always finds
  // a step whose tick count is 3-5 for any finite, non-degenerate domain):
  // use the naive rough step directly rather than render nothing.
  return best ?? build(Math.pow(10, exponent));
}

/** One axis's complete render-time state: its nice-scale domain, its declared-once unit + per-tick formatter, the pre-formatted tick label strings (reused by both the JSX and the gutter-width measurement), and the resulting gutter width. */
type AxisPresentation = {
  scale: NiceScale;
  format: AxisFormat;
  tickLabels: string[];
  gutterW: number;
};

/**
 * Ties `computeNiceScale` + a caller's `AxisFormat` factory + `computeGutterWidth`
 * together for one axis, with a defensive coarsen-to-`MIN_TICKS` retry (plan
 * fix 4c: "never let a tick label overflow the gutter — if it would, coarsen
 * the tick count") for the pathological case where even `MAX_GUTTER_W` can't
 * fit a label. In practice this retry is not expected to fire — every
 * `AxisFormat` factory in fundamentals-panel.tsx caps its tick strings to a
 * handful of characters by construction (see that file's `makeMoneyAxisFormat`
 * etc.) — but it's here so an overflow degrades to fewer, still-correct
 * ticks rather than a silently clipped label.
 */
function computeAxisPresentation(
  dataMin: number,
  dataMax: number,
  formatFactory: (domainMax: number) => AxisFormat
): AxisPresentation {
  const build = (targetTicks: number): AxisPresentation => {
    const scale = computeNiceScale(dataMin, dataMax, targetTicks);
    const format = formatFactory(scale.max);
    const tickLabels = scale.ticks.map((t) => format.tick(t));
    const labels = format.unit ? [...tickLabels, format.unit] : tickLabels;
    return { scale, format, tickLabels, gutterW: computeGutterWidth(labels) };
  };

  let presentation = build(TARGET_TICKS);
  const rawWidth =
    (presentation.format.unit ? [...presentation.tickLabels, presentation.format.unit] : presentation.tickLabels).reduce(
      (m, s) => Math.max(m, s.length),
      0
    ) *
      CHAR_W_VB +
    GUTTER_TEXT_GAP +
    GUTTER_EDGE_MARGIN;
  if (rawWidth > MAX_GUTTER_W && TARGET_TICKS > MIN_TICKS) {
    presentation = build(MIN_TICKS);
  }
  return presentation;
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
  width: chartW = CHART_W,
  maxDisplayWidth,
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

  const barSeries = activeSeries.filter((s) => s.kind === "bar");
  const lineSeries = activeSeries.filter((s) => s.kind === "line");
  const nBars = barSeries.length;

  // Primary axis domain (§06 Sprint 2 smoke-test fix, T2.1, PRESERVED by the
  // axis-polish pass below): in `stackedBars` mode the visual top of a group
  // is the CUMULATIVE SUM of its bar series, not any single series' own
  // value — using each series' individual max badly under-scales the domain
  // (e.g. Fixed=500/Current=300/Other=200 stacking to a 1000 total would
  // size the axis to 500, pushing the top segment off the plot entirely).
  // Non-stacked (clustered) mode is unaffected — each bar's own value is
  // still its own visual extent there.
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
  const primaryDataMin = primaryValues.length > 0 ? Math.min(...primaryValues) : 0;
  const primaryDataMax = primaryValues.length > 0 ? Math.max(...primaryValues) : 0;
  const primaryPresentation = computeAxisPresentation(primaryDataMin, primaryDataMax, formatPrimaryAxis);
  const primaryScale = primaryPresentation.scale;
  const primaryMax = primaryScale.max;
  const primaryMin = primaryScale.min;
  const primarySpan = primaryMax - primaryMin || 1;

  const secondarySeries = activeSeries.filter((s) => s.axis === "secondary");
  const secondaryValues = secondarySeries.flatMap((s) => s.values).filter((v): v is number => v != null);
  const secondaryDataMin = secondaryValues.length > 0 ? Math.min(...secondaryValues) : 0;
  const secondaryDataMax = secondaryValues.length > 0 ? Math.max(...secondaryValues) : 0;
  const secondaryPresentation =
    hasSecondary && formatSecondaryAxis ? computeAxisPresentation(secondaryDataMin, secondaryDataMax, formatSecondaryAxis) : null;
  const secondaryScale = secondaryPresentation?.scale ?? computeNiceScale(secondaryDataMin, secondaryDataMax, TARGET_TICKS);
  const secondaryMax = secondaryScale.max;
  const secondaryMin = secondaryScale.min;
  const secondarySpan = secondaryMax - secondaryMin || 1;
  const secondaryAxisColor = secondarySeries.length === 1 ? secondarySeries[0].color : "#94a3b8";

  // Gutter auto-sizing (fix 4b): measured from the longest rendered tick/unit
  // string for EACH axis independently — never the old fixed 44px/40px.
  //
  // AXIS SIDES (founder reference image, 2026-08-02): when a secondary %
  // axis exists, it sits on the LEFT and the primary money axis moves to
  // the RIGHT (TradingView's Performance-chart layout); a single-axis chart
  // keeps its primary axis on the left as before.
  const secondaryGutterW = secondaryPresentation?.gutterW ?? MIN_GUTTER_W;
  const plotLeft = hasSecondary ? secondaryGutterW : primaryPresentation.gutterW;
  const plotRight = chartW - (hasSecondary ? primaryPresentation.gutterW : 0);
  const plotWidth = plotRight - plotLeft;
  // Rotated x-labels (founder 2026-08-02: "not all dates are visible" on
  // COALINDIA's 11-payout chart — thinning skipped every 2nd date): when the
  // labels can't all fit horizontally, render EVERY label rotated diagonally
  // instead of skipping any. Rotated labels need extra bottom padding.
  const xLabelFontSize = categories.length > 8 ? 11 : 13;
  const maxLabelChars = categories.reduce((m, s) => Math.max(m, s.length), 0);
  const approxLabelW = maxLabelChars * (xLabelFontSize * 0.55) + 8;
  const rotateXLabels = categories.length * approxLabelW > plotWidth;
  const plotTop = PAD_TOP;
  const plotBottom = height - (rotateXLabels ? 52 : PAD_BOTTOM);
  const plotHeight = plotBottom - plotTop;
  const groupW = categories.length > 0 ? plotWidth / categories.length : plotWidth;

  const yPrimary = (v: number) => plotTop + ((primaryMax - v) / primarySpan) * plotHeight;
  const zeroYPrimary = yPrimary(0);
  const ySecondary = (v: number) => plotTop + ((secondaryMax - v) / secondarySpan) * plotHeight;

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
    const vbX = clamp(fracX * chartW, plotLeft, plotRight);
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
      x: (anchorVbX / chartW) * rect.width,
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
  const containerW = wrapperRect?.width ?? chartW;
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
        className="relative mx-auto touch-none select-none"
        style={maxDisplayWidth != null ? { maxWidth: maxDisplayWidth } : undefined}
        onPointerMove={handlePointerMove}
        onPointerLeave={handlePointerLeave}
        onPointerDown={handlePointerDown}
      >
        <svg viewBox={`0 0 ${chartW} ${height}`} className="block w-full" role="img" aria-label={ariaLabel}>
          {/*
            Primary axis gridlines + labels (left gutter) — nice-scale ticks
            (3-5, axis-polish fix 2/5): every tick gets a full-width
            gridline (not just max/mid) at the light `#f1f5f9`, EXCEPT the
            zero tick — always present since the domain always includes 0 —
            which renders at the stronger `#e2e8f0` baseline color instead of
            a separately-drawn line (the old always-drawn zero baseline is
            now just "whichever tick equals 0" in this single unified loop).
          */}
          {primaryScale.ticks.map((gv, gi) => {
            const isZero = Math.abs(gv) < primaryScale.step * 1e-6;
            return (
              <g key={`p-${gi}`}>
                <line
                  x1={plotLeft}
                  x2={plotRight}
                  y1={yPrimary(gv)}
                  y2={yPrimary(gv)}
                  stroke={isZero ? "#e2e8f0" : "#f1f5f9"}
                  strokeWidth={1}
                />
                <text
                  x={hasSecondary ? plotRight + GUTTER_TEXT_GAP : plotLeft - GUTTER_TEXT_GAP}
                  y={yPrimary(gv) + 4}
                  textAnchor={hasSecondary ? "start" : "end"}
                  fontSize={12}
                  fill="#64748b"
                  className="tabular-nums"
                >
                  {primaryPresentation.tickLabels[gi]}
                </text>
              </g>
            );
          })}
          {primaryPresentation.format.unit && (
            <text
              x={hasSecondary ? plotRight + GUTTER_TEXT_GAP : plotLeft - GUTTER_TEXT_GAP}
              y={10}
              textAnchor={hasSecondary ? "start" : "end"}
              fontSize={10}
              fill="#94a3b8"
            >
              {primaryPresentation.format.unit}
            </text>
          )}

          {/* Secondary axis labels (LEFT gutter per the founder reference — see the axis-sides note above; no gridlines of its own, a second gridline set would just be noise), tinted to the line's own color when it's the only secondary series. */}
          {hasSecondary && secondaryPresentation && (
            <>
              {secondaryScale.ticks.map((gv, gi) => (
                <text
                  key={`s-${gi}`}
                  x={plotLeft - GUTTER_TEXT_GAP}
                  y={ySecondary(gv) + 4}
                  textAnchor="end"
                  fontSize={12}
                  fill={secondaryAxisColor}
                  className="tabular-nums"
                >
                  {secondaryPresentation.tickLabels[gi]}
                </text>
              ))}
              {secondaryPresentation.format.unit && (
                <text x={plotLeft - GUTTER_TEXT_GAP} y={10} textAnchor="end" fontSize={10} fill={secondaryAxisColor}>
                  {secondaryPresentation.format.unit}
                </text>
              )}
            </>
          )}

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
                        rx={4}
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
                      rx={4}
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
            const isDashed = s.dashed === true;
            const segments = buildLineSegments(s.values, xCenter, yOf);
            return (
              <g key={s.id}>
                {segments.map((seg, si) => (
                  <polyline
                    key={si}
                    points={seg.points.map((p) => `${p.x},${p.y}`).join(" ")}
                    fill="none"
                    stroke={s.color}
                    strokeWidth={2.5}
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
                        r={activeIdx === idx ? 5 : 3.5}
                        fill="white"
                        stroke={s.color}
                        strokeWidth={2}
                        opacity={dim ? 0.35 : 1}
                      />
                    );
                  })
                )}
              </g>
            );
          })}

          {/* X-axis category labels — EVERY label always renders (founder:
              all dates must be visible); when they can't fit horizontally
              they rotate diagonally instead of thinning. */}
          {categories.map((label, i) => {
            const dim = activeIdx != null && activeIdx !== i;
            const lx = xCenter(i);
            const ly = rotateXLabels ? plotBottom + 12 : height - 8;
            return (
              <text
                key={`label-${i}`}
                x={lx}
                y={ly}
                textAnchor={rotateXLabels ? "end" : "middle"}
                fontSize={rotateXLabels ? Math.min(xLabelFontSize, 11) : xLabelFontSize}
                fill={dim ? "#cbd5e1" : "#64748b"}
                transform={rotateXLabels ? `rotate(-38 ${lx} ${ly})` : undefined}
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
            <div className="flex flex-wrap justify-center gap-5">
              {legendEntries.map((s) => (
                <span key={s.id} className="inline-flex items-center gap-2 text-[13px] text-ink-500">
                  <span className="h-3 w-3 rounded-full" style={{ backgroundColor: s.color }} />
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
