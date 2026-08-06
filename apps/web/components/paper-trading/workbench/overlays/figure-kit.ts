/**
 * TA Suite Sprint S1, T1 — shared figure-building helpers for every family
 * file under `workbench/overlays/`. Extracted from W3's `custom-overlays.ts`
 * (see that file's original doc comment, preserved in `legacy-shapes.ts`)
 * and widened for the 42 new tools.
 *
 * **Style-override resolution from `overlay.styles`** (the mechanism the S1
 * brief names explicitly): KLineCharts' own `OverlayView.prototype
 * .drawFigures` (verified directly against `dist/index.esm.js`) merges
 * per-figure styles as `{...defaultStyles[type], ...overlay.styles?.[type],
 * ...figure.styles}` — the figure's OWN `styles` object wins per-key over
 * `overlay.styles`. That means a family file that hardcodes
 * `styles: { color: INK_600 }` on every returned figure would silently
 * defeat the T7 style editor's `overrideOverlay({styles:{line:{color}}})`
 * call — the user's color pick would never render. The resolver functions
 * below read `overlay.styles` THEMSELVES and thread the resolved value back
 * into the figure's own `styles`, so "no override yet" falls back to this
 * family's documented default color and "user picked a swatch" surfaces
 * immediately, both through the exact same code path.
 *
 * `styles.pfContent = {text?, emoji?}` (plan decision D1) is a SEPARATE,
 * non-figure-type key on the same `overlay.styles` object — annotations.ts
 * reads it via `resolvePfContent`, not through the line/polygon/text
 * resolvers above.
 */
import type { Coordinate, OverlayFigure } from "klinecharts";

// ── Indigo-Futures palette (apps/web/tailwind.config.ts's ink/signal
// scales — matches the tokens already used by order-line-overlay.ts and the
// original 4 W3 custom shapes). ──────────────────────────────────────────
export const INK_400 = "#64748b";
export const INK_600 = "#334155";
export const SKY = "#0ea5e9";
export const SKY_FILL = "rgba(14,165,233,0.08)";
export const TEAL = "#14b8a6";
export const TEAL_FILL = "rgba(20,184,166,0.10)";
export const TEAL_BORDER = "rgba(20,184,166,0.4)";
export const AMBER = "#d97706";
export const AMBER_FILL = "rgba(217,119,6,0.10)";
export const VIOLET = "#7c3aed";
export const VIOLET_FILL = "rgba(124,58,237,0.10)";
export const ROSE = "#e11d48";
export const ROSE_FILL = "rgba(225,29,72,0.10)";
export const EMERALD = "#059669";
export const EMERALD_FILL = "rgba(5,150,105,0.10)";

/**
 * klinecharts' OWN default overlay line color (`Color.BLUE` in
 * `dist/index.esm.js:11215`, `= '#1677FF'`), used by `getDefaultOverlayStyle
 * ()`'s `line.color` — the color EVERY built-in template (`segment`/
 * `rayLine`/`straightLine`/`horizontal*`/`vertical*`/`priceChannelLine`/
 * `parallelStraightLine`) already renders in today, since none of them set
 * an explicit figure-level color and this app's own `WORKBENCH_THEME`
 * (`kline-chart.tsx`) never overrides the `overlay.line` default either
 * (verified: no `overlay:` key in that theme object). `built-in-stats.ts`'s
 * override templates use THIS as their `resolveLineColor` fallback (not
 * `INK_600`, this file's usual default) specifically so every already-
 * persisted drawing of these 12 tools keeps rendering in the exact color a
 * user would see today if they never touched the style editor — the stats
 * pill is new, the LINE'S OWN look is not.
 */
export const KLINECHARTS_DEFAULT_LINE = "#1677FF";
/** Matching default line WIDTH (`getDefaultOverlayStyle().line.size = 1`, not this file's usual `1.4`) — same backward-compatibility rationale as `KLINECHARTS_DEFAULT_LINE` above. */
export const KLINECHARTS_DEFAULT_LINE_WIDTH = 1;

/** The style editor's 3 line-width choices. */
export const LINE_WIDTHS = [1, 2, 3] as const;

export function formatRupeesLabel(v: number): string {
  return `₹${v.toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;
}

export function formatPercentLabel(v: number): string {
  const sign = v > 0 ? "+" : v < 0 ? "−" : "";
  return `${sign}${Math.abs(v * 100).toFixed(1)}%`;
}

/** Unsigned percent — for magnitudes with no natural direction (e.g. a channel WIDTH, which is never "up" or "down"). Distinct from `formatPercentLabel` (signed, for a directional delta). */
export function formatUnsignedPercentLabel(v: number): string {
  return `${(Math.abs(v) * 100).toFixed(1)}%`;
}

/** `15 Nov 25` — TradingView-style compact date pill (vertical line/ray/straight-line stats). Distinct from `anchoredVWAP`'s own `day/month`-only format in `measure.ts` (no year) — this one names a specific calendar day precisely enough to disambiguate across years, matching the founder brief's own example format. */
export function formatDatePillLabel(timestamp: number): string {
  return new Date(timestamp).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "2-digit" });
}

/** TradingView-style 3-decimal ratio label (`0.618`, `1.272`) — for harmonic-pattern retracement/extension ratios computed in VALUE space (`abcd`/`xabcd` — see `legacy-shapes.ts`). Distinct from `formatPercentLabel` (which shows a signed %) — a raw ratio has no natural sign and TradingView never shows one. */
export function formatRatioLabel(v: number): string {
  return Number.isFinite(v) ? v.toFixed(3) : "—";
}

/**
 * Tool-values-gap-fixes brief, T1.1 — elapsed CALENDAR time between two
 * anchors (`dateRange`/`datePriceRange`), a sibling stat to the existing
 * bar-count label (TradingView's own Date Range tool is confirmed —
 * `43000517005` — to show BOTH). TradingView's exact on-canvas string isn't
 * literally quoted by that help article, so the bucket convention below is
 * OUR OWN, deliberately documented rather than guessed at silently:
 *
 *   < 1 day  → "{h}h"   (hours, rounded)
 *   1-7 days → "{d}d"   (days, rounded — a full week still reads "7d", not "1w")
 *   8-59 days → "{w}w"  (weeks, rounded — flat 7-day week)
 *   60-729 days → "{mo}mo" (months, rounded — flat 30-day month, a deliberate
 *                            simplification over a calendar-accurate 30.44,
 *                            consistent with this file's other "immune to
 *                            zoom/calendar-gap" bar-index conventions)
 *   ≥ 730 days → "{y.y}y" (years, ONE decimal, flat 365-day year)
 *
 * Boundaries are placed so the LOWER unit wins exactly at its own upper edge
 * (`abs <= WEEK` keeps a 7-day span as "7d", not "1w"; `abs <= DAY` keeps a
 * 1-day span as "1d") — picked once here and asserted in `selfcheck.ts`,
 * never re-decided ad hoc at a call site. Every non-zero span rounds to AT
 * LEAST 1 of its unit (`Math.max(1, Math.round(...))`) — a 2-minute drag
 * must never render "0h", which would read as "no time elapsed" and be
 * actively misleading for a genuinely nonzero span.
 */
export function formatElapsedLabel(ms: number): string {
  const abs = Math.abs(ms);
  if (abs <= 0) return "0h";
  const HOUR = 60 * 60 * 1000;
  const DAY = 24 * HOUR;
  const WEEK = 7 * DAY;
  const MONTH = 30 * DAY;
  const YEAR = 365 * DAY;
  if (abs < DAY) return `${Math.max(1, Math.round(abs / HOUR))}h`;
  if (abs <= WEEK) return `${Math.max(1, Math.round(abs / DAY))}d`;
  if (abs < 60 * DAY) return `${Math.max(1, Math.round(abs / WEEK))}w`;
  if (abs < 730 * DAY) return `${Math.max(1, Math.round(abs / MONTH))}mo`;
  return `${(abs / YEAR).toFixed(1)}y`;
}

/**
 * Tool-values-gap-fixes brief, T4.1 — `cypher`'s CORRECTED ratio-base
 * formula. The pattern's 5 anchors (`values` = `[X, A, B, C, D]`, click
 * order, VALUE/price space) validate against three DIFFERENT base legs, not
 * a single uniform reference (the bug this replaces divided every leg by
 * the first leg, `XA`, which is only correct for B):
 *
 *   B = |AB| / |XA|  — B retraces the reference leg XA. (unchanged — already correct)
 *   C = |BC| / |AB|  — C extends the AB leg, NOT XA.
 *   D = |CD| / |XC|  — D retraces the XC completion leg (the standard
 *                      78.6%-style Cypher completion rule), NOT XA.
 *
 * `XC` is a NEW local (not computed by the pre-fix code at all) — the
 * distance from the very first anchor to the third-drawn point (C), which
 * only exists once C has been placed. Every leg length is `|| 1` guarded
 * against a degenerate (zero-length) base leg, matching this file's other
 * ratio helpers.
 */
export function computeCypherRatios(values: readonly number[]): { b: number; c: number; d: number } {
  const [x, a, b, c, d] = values;
  const xa = Math.abs(a - x) || 1;
  const ab = Math.abs(b - a) || 1;
  const bc = Math.abs(c - b);
  const xc = Math.abs(c - x) || 1;
  const cd = Math.abs(d - c);
  return { b: Math.abs(b - a) / xa, c: bc / ab, d: cd / xc };
}

/**
 * Tool-values-gap-fixes brief, T4.2 — `threeDrives`'s per-leg ratio
 * convention: EVERY leg validates against its IMMEDIATELY PRECEDING leg
 * (not a single fixed reference leg like `computeCypherRatios` above) —
 * `ratio[i] = |values[i] - values[i-1]| / |values[i-1] - values[i-2]|`. The
 * first leg (`values[0]` → `values[1]`) has no predecessor and gets no
 * ratio, matching `abcd`'s own established convention (its first leg, A→B,
 * is undecorated too — see `legacy-shapes.ts`). Returns one ratio per leg
 * from index 2 onward, i.e. `values.length - 2` entries, aligned to
 * `values[2..]` (caller pairs `ratios[i-2]` with the leg ending at
 * `values[i]`).
 */
export function computeAdjacentLegRatios(values: readonly number[]): number[] {
  const ratios: number[] = [];
  for (let i = 2; i < values.length; i++) {
    const prevLeg = Math.abs(values[i - 1] - values[i - 2]) || 1;
    const leg = Math.abs(values[i] - values[i - 1]);
    ratios.push(leg / prevLeg);
  }
  return ratios;
}

/**
 * Tool-values-gap-fixes brief, T3.2/T3.3 — the TradingView-confirmed
 * "Ranges And Ratio" corner label (`43000518149` — "time and price ranges
 * and ratio... at the Square's corners"), shared VERBATIM by `gannSquare`
 * (T3.2) and `gannSquareFixed` (T3.3) so the two variants render
 * byte-identical corner text instead of two independently-drifting string
 * formats. `bars` guarded `|| 1` against a degenerate same-pixel drag
 * (mirrors `gannSquareFixed`'s own existing `pricePerBar` guard).
 */
export function formatGannRangeRatioLabel(bars: number, priceRange: number): string {
  const safeBars = bars || 1;
  const ratio = priceRange / safeBars;
  return `${safeBars} bar${safeBars === 1 ? "" : "s"} · ${formatRupeesLabel(priceRange)} · ratio ${ratio.toFixed(2)}/bar`;
}

// ── Style-override resolution ───────────────────────────────────────────
type StylesRecord = Record<string, unknown> | null | undefined;

function readStyle<T>(styles: StylesRecord, type: string, key: string, fallback: T): T {
  if (!styles || typeof styles !== "object") return fallback;
  const bucket = (styles as Record<string, unknown>)[type];
  if (!bucket || typeof bucket !== "object") return fallback;
  const value = (bucket as Record<string, unknown>)[key];
  return value === undefined || value === null ? fallback : (value as T);
}

export function resolveLineColor(styles: StylesRecord, fallback: string = INK_600): string {
  return readStyle(styles, "line", "color", fallback);
}
export function resolveLineWidth(styles: StylesRecord, fallback = 1.4): number {
  return readStyle(styles, "line", "size", fallback);
}
export function resolvePolygonColor(styles: StylesRecord, fallback: string = SKY_FILL): string {
  return readStyle(styles, "polygon", "color", fallback);
}
export function resolvePolygonBorderColor(styles: StylesRecord, fallback: string = INK_400): string {
  return readStyle(styles, "polygon", "borderColor", fallback);
}
export function resolveTextColor(styles: StylesRecord, fallback: string = "#ffffff"): string {
  return readStyle(styles, "text", "color", fallback);
}
export function resolveTextBackground(styles: StylesRecord, fallback: string = INK_600): string {
  return readStyle(styles, "text", "backgroundColor", fallback);
}

/** Plan decision D1 — text/emoji content lives at `overlay.styles.pfContent`, a sibling of the `line`/`polygon`/`text` style buckets, not nested inside one. */
export interface PfContent {
  text?: string;
  emoji?: string;
}
export function resolvePfContent(styles: StylesRecord): PfContent {
  if (!styles || typeof styles !== "object") return {};
  const raw = (styles as Record<string, unknown>).pfContent;
  if (!raw || typeof raw !== "object") return {};
  const { text, emoji } = raw as Record<string, unknown>;
  return {
    text: typeof text === "string" ? text : undefined,
    emoji: typeof emoji === "string" ? emoji : undefined,
  };
}

// ── Figure builders ──────────────────────────────────────────────────────
export function labelFigure(
  point: Coordinate,
  text: string,
  opts?: { color?: string; background?: string; dy?: number; align?: "left" | "center" | "right" }
): OverlayFigure {
  return {
    type: "text",
    attrs: { x: point.x, y: point.y - (opts?.dy ?? 14), text, align: opts?.align ?? "center", baseline: "bottom" },
    styles: {
      color: opts?.color ?? "#ffffff",
      backgroundColor: opts?.background ?? INK_600,
      size: 10,
      weight: 700,
      paddingLeft: 4,
      paddingRight: 4,
      paddingTop: 1,
      paddingBottom: 1,
      borderRadius: 3,
    },
  };
}

export function solidLine(coordinates: Coordinate[], color: string = INK_600, size = 1.4): OverlayFigure {
  return { type: "line", attrs: { coordinates }, styles: { style: "solid", color, size } };
}

export function dashedLine(coordinates: Coordinate[], color: string = INK_400, size = 1.2): OverlayFigure {
  return { type: "line", attrs: { coordinates }, styles: { style: "dashed", color, size, dashedValue: [4, 3] } };
}

export function fillPolygon(coordinates: Coordinate[], fill: string, border: string = INK_400, borderSize = 1): OverlayFigure {
  return {
    type: "polygon",
    attrs: { coordinates },
    styles: { style: "stroke_fill", color: fill, borderColor: border, borderSize, borderStyle: "solid" },
  };
}

export function outlinedRect(x: number, y: number, width: number, height: number, fill: string, border: string, borderSize = 1): OverlayFigure {
  return {
    type: "rect",
    attrs: { x, y, width, height },
    styles: { style: "stroke_fill", color: fill, borderColor: border, borderSize, borderStyle: "solid" },
  };
}

export function circleFigure(x: number, y: number, r: number, color: string, opts?: { fill?: string; size?: number; dashed?: boolean }): OverlayFigure {
  return {
    type: "circle",
    attrs: { x, y, r },
    styles: {
      style: opts?.fill ? "stroke_fill" : "stroke",
      color: opts?.fill ?? "transparent",
      borderColor: color,
      borderSize: opts?.size ?? 1.2,
      borderStyle: opts?.dashed ? "dashed" : "solid",
    },
  };
}

/** `arc`'s OverlayStyle key is `LineStyle` (stroke only, no fill) — distinct from `circle`'s `PolygonStyle`. Angles in radians. */
export function arcFigure(x: number, y: number, r: number, startAngle: number, endAngle: number, color: string, size = 1.2): OverlayFigure {
  return { type: "arc", attrs: { x, y, r, startAngle, endAngle }, styles: { style: "solid", color, size, dashedValue: [] } };
}

/**
 * SVG-path figure — `path`'s attrs are `{x, y, path}`: `x`/`y` translate
 * the ENTIRE path's coordinate space (every command's args, absolute or
 * relative, get offset by this point — confirmed against
 * `dist/index.esm.js`'s `drawPath`, which destructures only `x`/`y`/`path`
 * and offsets every absolute command's args by them). `width`/`height` are
 * accepted for the figure's own rect-based hit-testing
 * (`checkEventOn: checkCoordinateOnRect`) but never affect the drawn scale
 * — the SVG path string itself must already be in final pixel units.
 */
export function pathFigure(
  x: number,
  y: number,
  path: string,
  color: string,
  opts?: { fill?: boolean; lineWidth?: number; width?: number; height?: number }
): OverlayFigure {
  return {
    type: "path",
    attrs: { x, y, path, width: opts?.width ?? 1, height: opts?.height ?? 1 },
    styles: { style: opts?.fill ? "fill" : "stroke", color, lineWidth: opts?.lineWidth ?? 1.4 },
  };
}

// ── TradingView-parity stats-pill visibility ("while DRAWING and when ────
// SELECTED") — founder-feedback pass (2026-08-04/05, "ratios in trend
// lines"). Two independently-verified signals (both read directly against
// `node_modules/klinecharts/dist/index.esm.js`, not assumed):
//
// 1. **Drawing**: `overlay.currentStep` is a real field on the PUBLIC
//    `Overlay<E>` type (`OverlayCreateFiguresCallbackParams.overlay:
//    Overlay<E>`), and `OverlayImp`'s own step machinery sets it to `-1`
//    (`OVERLAY_DRAW_STEP_FINISHED`) the instant the last point is placed —
//    `isDrawing()` internally is literally `currentStep !== -1`. The
//    `overlay` object `createPointFigures` receives IS the live `OverlayImp`
//    instance (`o` in `_b = (_a = o.createPointFigures)…?.call(o, {…,
//    overlay: o, …})`), so reading `.currentStep` needs no cast and is
//    always current at render time — no separate tracking needed.
// 2. **Selected**: klinecharts' public `Overlay` type carries NO `selected`
//    boolean, and there is no public getter for "the currently selected
//    overlay" either (`Chart`/`Store` expose neither). The ONLY selection
//    signal reachable from a registered template is the `onSelected`/
//    `onDeselected` event pair (`OverlayEventCollection`, settable on the
//    TEMPLATE itself, fired per-instance). Verified these are BOTH reliable
//    or ("proves unreliable, fall back to always-show" was the brief's own
//    contingency — not needed): `StoreImp.prototype.setClickOverlayInfo`
//    calls `processOnSelectedEvent`/`processOnDeselectedEvent` and THEN
//    unconditionally `this._chart.updatePane(UpdateLevel.Overlay, …)` — a
//    real repaint is GUARANTEED on every selection change, so
//    `createPointFigures` reliably re-runs with the updated Set state.
//    Clicking blank canvas (no figure hit) also calls `setClickOverlayInfo`
//    with `overlay: null`, correctly deselecting whatever was selected
//    before — verified via the `mouseClickEvent` handler's own fallback
//    branch.
const OVERLAY_STEP_FINISHED = -1;
const SELECTED_OVERLAY_IDS = new Set<string>();

export function isOverlayDrawing(overlay: { currentStep: number }): boolean {
  return overlay.currentStep !== OVERLAY_STEP_FINISHED;
}
export function isOverlaySelected(overlay: { id: string }): boolean {
  return SELECTED_OVERLAY_IDS.has(overlay.id);
}
/** The TV-parity rule itself: visible while actively being drawn OR while selected. */
export function isStatsPillVisible(overlay: { id: string; currentStep: number }): boolean {
  return isOverlayDrawing(overlay) || isOverlaySelected(overlay);
}
/** Spread onto any `registerOverlay` template to wire the Set above — `onRemoved` is defensive belt-and-suspenders (a selected overlay that gets deleted without a prior deselect should not leak its id forever, though the Set is small enough that this is cosmetic, not a real leak concern). */
export const trackOverlaySelection = {
  onSelected: (event: { overlay: { id: string } }): void => {
    SELECTED_OVERLAY_IDS.add(event.overlay.id);
  },
  onDeselected: (event: { overlay: { id: string } }): void => {
    SELECTED_OVERLAY_IDS.delete(event.overlay.id);
  },
  onRemoved: (event: { overlay: { id: string } }): void => {
    SELECTED_OVERLAY_IDS.delete(event.overlay.id);
  },
};

// ── Shared Lines-family stats-pill CONTENT builders ─────────────────────
/**
 * `"₹Δ (±%) · N bars"` — the exact format `infoLine` established (S1
 * founder-feedback pass, 2026-08-03); extracted here so every 2-anchor
 * line/ray/segment/arrow tool renders byte-identical stats, not a
 * reimplementation that could drift. `positive` drives the caller's
 * background color choice (green/rose), matching `infoLine`'s own original
 * inline `delta >= 0 ? "#059669" : "#e11d48"` (= `EMERALD`/`ROSE` below).
 */
export function buildDeltaStatsText(v0: number, v1: number, dataIndex0: number, dataIndex1: number): { text: string; positive: boolean } {
  const delta = v1 - v0;
  const pct = v0 !== 0 ? delta / v0 : 0;
  const bars = Math.round(Math.abs(dataIndex1 - dataIndex0));
  return {
    text: `${formatRupeesLabel(delta)} (${formatPercentLabel(pct)}) · ${bars} bar${bars === 1 ? "" : "s"}`,
    positive: delta >= 0,
  };
}

/** `"width ₹X (Y%)"` for parallel-channel tools (`priceChannelLine`/`parallelStraightLine`/`flatTopBottom`/`disjointChannel`) — % is of the AVERAGE of the two boundary prices (a defensible, documented base — there is no single "entry price" a channel width is naturally a percent of, unlike a directional Δ). Unsigned (a width has no direction). */
export function buildChannelWidthText(price1: number, price2: number): string {
  const width = Math.abs(price1 - price2);
  const base = Math.abs((price1 + price2) / 2);
  const pct = base !== 0 ? width / base : 0;
  return `width ${formatRupeesLabel(width)} (${formatUnsignedPercentLabel(pct)})`;
}

// ── Pixel<->price (Y-axis) round-trip — the Y-axis sibling of ────────────
// `pixelXToDataIndex`/`dataIndexToPixelX` below (same rationale: read
// straight off the public `Axis` interface, verified against
// `dist/index.d.ts`).
export function pixelYToPrice(yAxis: { convertFromPixel: (px: number) => number } | null | undefined, y: number): number {
  return yAxis ? yAxis.convertFromPixel(y) : 0;
}
export function priceToPixelY(yAxis: { convertToPixel: (value: number) => number } | null | undefined, price: number, fallbackY: number): number {
  return yAxis ? yAxis.convertToPixel(price) : fallbackY;
}

// ── Built-in-template geometry, reimplemented ─────────────────────────
/**
 * The klinecharts built-ins this pass overrides (`segment`/`rayLine`/
 * `straightLine`/`horizontal*`/`vertical*`/`priceChannelLine`/
 * `parallelStraightLine` — see `built-in-stats.ts`'s own module doc for the
 * override-vs-wrapper decision) lean on THREE small internal helper
 * functions inside `dist/index.esm.js` — `getLinearSlopeIntercept`,
 * `getLinearYFromSlopeIntercept`/`getLinearYFromCoordinates`, and
 * `getParallelLines` — none of which are exported from the package (grepped
 * `index.d.ts`: absent). Reimplemented here verbatim from the dist source
 * (line-by-line, not from a textbook formula) so the overridden templates'
 * GEOMETRY is byte-for-byte identical to the original built-ins, only the
 * STATS are new.
 */
function linearSlopeIntercept(c1: Coordinate, c2: Coordinate): [number, number] | null {
  const difX = c1.x - c2.x;
  if (difX === 0) return null;
  const k = (c1.y - c2.y) / difX;
  const b = c1.y - k * c1.x;
  return [k, b];
}
function linearYFromSlopeIntercept(kb: [number, number] | null, target: Coordinate): number {
  return kb ? target.x * kb[0] + kb[1] : target.y;
}
function linearYFromCoordinates(c1: Coordinate, c2: Coordinate, target: Coordinate): number {
  return linearYFromSlopeIntercept(linearSlopeIntercept(c1, c2), target);
}
/** Exported — `built-in-stats.ts`'s channel-width stats reuse this same slope/intercept math against the caller's own anchors (avoids a second, independently-drifting reimplementation). */
export function linearYAtX(c1: Coordinate, c2: Coordinate, x: number): number {
  return linearYFromCoordinates(c1, c2, { x, y: c1.y });
}

/** `rayLine`'s geometry (`getRayLine`, `dist/index.esm.js:12213`) — the far endpoint a 2-anchor ray extends to at the pane edge. */
export function rayEndpoint(p0: Coordinate, p1: Coordinate, bounding: { width: number; height: number }): Coordinate {
  if (p0.x === p1.x && p0.y !== p1.y) {
    return { x: p0.x, y: p0.y < p1.y ? bounding.height : 0 };
  }
  if (p0.x > p1.x) {
    return { x: 0, y: linearYFromCoordinates(p0, p1, { x: 0, y: p0.y }) };
  }
  return { x: bounding.width, y: linearYFromCoordinates(p0, p1, { x: bounding.width, y: p0.y }) };
}

/** `straightLine`'s geometry (`dist/index.esm.js:12437`) — both full-width/full-height endpoints. */
export function straightLineEndpoints(p0: Coordinate, p1: Coordinate, bounding: { width: number; height: number }): [Coordinate, Coordinate] {
  if (p0.x === p1.x) {
    return [
      { x: p0.x, y: 0 },
      { x: p0.x, y: bounding.height },
    ];
  }
  return [
    { x: 0, y: linearYFromCoordinates(p0, p1, { x: 0, y: p0.y }) },
    { x: bounding.width, y: linearYFromCoordinates(p0, p1, { x: bounding.width, y: p0.y }) },
  ];
}

/** `priceChannelLine`/`parallelStraightLine`'s geometry (`getParallelLines`, `dist/index.esm.js:12034`) — `extendCount` reproduces `priceChannelLine`'s own extra reflected line (called with `1`; `parallelStraightLine` calls with `0`/undefined). Returns one `[start, end]` pair per line — `[line1]` if only 2 anchors placed yet, `[line1, line2, ...extensions]` once the 3rd (width) anchor is placed. */
export function parallelLinesGeometry(p0: Coordinate, p1: Coordinate, p2: Coordinate | undefined, bounding: { width: number; height: number }, extendCount = 0): Coordinate[][] {
  const lines: Coordinate[][] = [];
  if (p0.x === p1.x) {
    const startY = 0;
    const endY = bounding.height;
    lines.push([
      { x: p0.x, y: startY },
      { x: p0.x, y: endY },
    ]);
    if (p2) {
      lines.push([
        { x: p2.x, y: startY },
        { x: p2.x, y: endY },
      ]);
      const distance = p0.x - p2.x;
      for (let i = 0; i < extendCount; i++) {
        const d = distance * (i + 1);
        lines.push([
          { x: p0.x + d, y: startY },
          { x: p0.x + d, y: endY },
        ]);
      }
    }
  } else {
    const startX = 0;
    const endX = bounding.width;
    const kb = linearSlopeIntercept(p0, p1) as [number, number]; // non-null: p0.x !== p1.x guaranteed by the branch above.
    const [k, b] = kb;
    lines.push([
      { x: startX, y: startX * k + b },
      { x: endX, y: endX * k + b },
    ]);
    if (p2) {
      const b1 = p2.y - k * p2.x;
      lines.push([
        { x: startX, y: startX * k + b1 },
        { x: endX, y: endX * k + b1 },
      ]);
      const distance = b - b1;
      for (let i = 0; i < extendCount; i++) {
        const b2 = b + distance * (i + 1);
        lines.push([
          { x: startX, y: startX * k + b2 },
          { x: endX, y: endX * k + b2 },
        ]);
      }
    }
  }
  return lines;
}

export function midpoint(a: Coordinate, b: Coordinate): Coordinate {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

export function lerp(a: Coordinate, b: Coordinate, t: number): Coordinate {
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
}

export function distance(a: Coordinate, b: Coordinate): number {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

/** Extends the ray from `p0` through `p1` until it reaches `targetX` (a pane-local pixel x, e.g. `bounding.width` for "extend to the right edge"). Falls back to `p1` unchanged for a near-vertical segment (dx ~ 0), since "extend to the right edge" is meaningless for a vertical line. */
export function extendToRightEdge(p0: Coordinate, p1: Coordinate, targetX: number): Coordinate {
  const dx = p1.x - p0.x;
  if (Math.abs(dx) < 1e-6) return { x: p1.x, y: p1.y };
  const t = (targetX - p0.x) / dx;
  return { x: targetX, y: p0.y + (p1.y - p0.y) * t };
}

// ── Arc-free elliptical/circular arc path builder ────────────────────────
/**
 * Founder bug (2026-08-07), prod `3fa6ddc`: "few drawing tools ... for
 * example ellipse" render wrong. Root-caused by reading klinecharts@10.0.1's
 * OWN `dist/index.esm.js` `drawPath` (the `path` figure's SVG-mini-parser,
 * `~L5753`): inside its per-command `commands.forEach(...)` callback,
 * `currentX`/`currentY` are declared `var currentX = 0; var currentY = 0;`
 * — i.e. RESET TO THE ORIGIN ON EVERY SINGLE COMMAND, not carried forward
 * from the previous command's endpoint. `M`/`L`/`C`/`Q` (their absolute
 * uppercase forms) are unaffected because each computes its own endpoint
 * purely from its own args + the figure's `x`/`y` offset — none of them
 * READ incoming `currentX`/`currentY` to know where to start. `A`/`a`
 * (`~L5859-5872`) is the one command whose whole job is "arc FROM the
 * current point TO (x,y)" — it calls `drawEllipticalArc(ctx, currentX,
 * currentY, ...)`, and because `currentX`/`currentY` were just reset to `0`
 * by the bug, the arc always starts from the coordinate-space origin
 * instead of wherever the path actually was. This is a real upstream bug
 * (not a usage error), verified line-by-line against the installed dist,
 * not assumed from docs.
 *
 * Grepped every `path`-figure string in this `overlays/` tree (2026-08-07
 * audit): exactly two tools ever emit an `A`/`a` command — `shapes.ts`'s
 * `ellipse` (two `A`s, the full-ellipse sweep) and `measure.ts`'s `sector`
 * (one `A`, the pie-slice's curved edge). Every other path-figure tool
 * (`arcShape`/`curve`'s `Q`, `doubleCurve`'s `C`, `annotations.ts`'s
 * `M/L/C/Z` marks) never used `A` and was never affected. All circular fib
 * tools (`fibArc`/`fibCircle`/`fibSpeedResistanceArcs`/`fibWedge`,
 * `cycles.ts`'s `sineLine`) already render via the NATIVE `arc`/`circle`
 * figure types (`arcFigure`/`circleFigure` above), which klinecharts draws
 * via `ctx.arc(...)` directly — a completely separate code path from
 * `drawPath`, confirmed unaffected by this bug.
 *
 * Fix: replace every `A`/`a` opcode with an equivalent run of cubic-Bézier
 * (`C`) segments — `C` is one of the safe, self-contained absolute commands
 * above, so a path built ONLY from `M`/`L`/`C`/`Q`/`Z` can never hit this
 * bug regardless of how klinecharts' `drawPath` mishandles `currentX`/
 * `currentY` internally. The math below (cubic-Bézier-per-≤90°-segment via
 * the standard tangent-half-angle `alpha` formula) is the same well-known
 * closed-form SVG-arc-to-Bézier construction klinecharts' OWN internal
 * `ellipticalArcToBezier`/`ellipticalArcToBeziers` helpers use elsewhere
 * (`dist/index.esm.js` `~L5687-5751`, used for OTHER internal rendering,
 * just never reachable from a `path` FIGURE's own `A` opcode) —
 * reimplemented here as pure geometry so this file's own path strings never
 * touch the broken opcode at all. `rotation` is in RADIANS (matches every
 * other angle in this file); `startAngle`/`endAngle` sweep in the ellipse's
 * own local parameter space (θ=0 is the point at `rx` along the rotated
 * major axis — i.e. exactly `{x: cx + rx·cos(rotation), y: cy + rx·sin
 * (rotation)}`, the same convention `ellipse`'s pre-fix `p1`/`p2` anchors
 * already used, so callers migrating off the old `A`-based path need no
 * angle-convention changes).
 */
function ellipticalArcToBezierSegments(
  cx: number,
  cy: number,
  rx: number,
  ry: number,
  rotation: number,
  startAngle: number,
  endAngle: number
): { cp1x: number; cp1y: number; cp2x: number; cp2y: number; x: number; y: number }[] {
  const cosPhi = Math.cos(rotation);
  const sinPhi = Math.sin(rotation);
  const deltaAngle = endAngle - startAngle;
  if (Math.abs(deltaAngle) < 1e-9) return [];
  const numSegments = Math.max(1, Math.ceil(Math.abs(deltaAngle) / (Math.PI / 2)));
  const segments: { cp1x: number; cp1y: number; cp2x: number; cp2y: number; x: number; y: number }[] = [];
  const pointAt = (theta: number): { x: number; y: number } => ({
    x: cx + rx * Math.cos(theta) * cosPhi - ry * Math.sin(theta) * sinPhi,
    y: cy + rx * Math.cos(theta) * sinPhi + ry * Math.sin(theta) * cosPhi,
  });
  const tangentAt = (theta: number): { x: number; y: number } => ({
    x: -rx * Math.sin(theta) * cosPhi - ry * Math.cos(theta) * sinPhi,
    y: -rx * Math.sin(theta) * sinPhi + ry * Math.cos(theta) * cosPhi,
  });
  for (let i = 0; i < numSegments; i++) {
    const a0 = startAngle + (i * deltaAngle) / numSegments;
    const a1 = startAngle + ((i + 1) * deltaAngle) / numSegments;
    const alpha = (Math.sin(a1 - a0) * (Math.sqrt(4 + 3 * Math.pow(Math.tan((a1 - a0) / 2), 2)) - 1)) / 3;
    const p0 = pointAt(a0);
    const p1 = pointAt(a1);
    const t0 = tangentAt(a0);
    const t1 = tangentAt(a1);
    segments.push({
      cp1x: p0.x + alpha * t0.x,
      cp1y: p0.y + alpha * t0.y,
      cp2x: p1.x - alpha * t1.x,
      cp2y: p1.y - alpha * t1.y,
      x: p1.x,
      y: p1.y,
    });
  }
  return segments;
}

/**
 * The arc-free drop-in for an `A`/`a` opcode — returns ONLY the `"C x1 y1 x2
 * y2 x y"`-per-segment continuation string (no leading `M`, no trailing
 * `Z`), so callers splice it into their own path exactly where the `A`
 * command used to sit (after their own `M`/`L` to the arc's start point).
 * See `ellipticalArcToBezierSegments` above for the full bug writeup and
 * the math. A circular arc is just `rx === ry` with `rotation = 0`.
 */
export function arcPathCommands(cx: number, cy: number, rx: number, ry: number, rotation: number, startAngle: number, endAngle: number): string {
  return ellipticalArcToBezierSegments(cx, cy, rx, ry, rotation, startAngle, endAngle)
    .map((s) => `C ${s.cp1x} ${s.cp1y} ${s.cp2x} ${s.cp2y} ${s.x} ${s.y}`)
    .join(" ");
}

/** The arc's own start point (θ=`startAngle`) — for building the initial `M`/`L` a caller splices `arcPathCommands` after. */
export function pointOnEllipse(cx: number, cy: number, rx: number, ry: number, rotation: number, theta: number): Coordinate {
  return {
    x: cx + rx * Math.cos(theta) * Math.cos(rotation) - ry * Math.sin(theta) * Math.sin(rotation),
    y: cy + rx * Math.cos(theta) * Math.sin(rotation) + ry * Math.sin(theta) * Math.cos(rotation),
  };
}

// ── Fibonacci level sets ─────────────────────────────────────────────────
export const FIB_RETRACEMENT_LEVELS = [0, 0.236, 0.382, 0.5, 0.618, 0.786, 1] as const;
export const FIB_EXTENSION_LEVELS = [0, 0.382, 0.618, 1, 1.272, 1.618, 2, 2.618] as const;
/** Classic Fibonacci sequence used for fibTimezone's vertical bar offsets — 1,2,3,5,8,... (never 0; a 0-offset vertical would coincide with the anchor itself). */
export const FIB_SEQUENCE = [1, 2, 3, 5, 8, 13, 21, 34, 55, 89, 144] as const;

// ── Bar-index math (fibTimezone / dateRange / datePriceRange) ───────────
/**
 * `xAxis.convertFromPixel` maps a pane-local pixel x back to `dataIndex`
 * space (verified against `dist/index.d.ts`'s `XAxis extends Axis` —
 * `convertFromPixel: (px: number) => number`, the exact inverse of the
 * `dataIndexToCoordinate` call `OverlayView` itself uses to turn a point's
 * `dataIndex` into the pixel `coordinates` this file's callers receive).
 * `dataIndex` is a bar COUNT (array index into the loaded candle list), not
 * a pixel or calendar-time value — it is therefore immune to both zoom
 * (bar-pixel-width changes) AND calendar gaps (weekends/holidays are never
 * present in the loaded array, so consecutive indices are always exactly
 * one real trading bar apart). This is what `dateRange`/`fibTimezone` use
 * for their bar counts — see those overlays' own doc comments for why this
 * is a deliberate, documented improvement on the brief's literal
 * "timestamp delta ÷ fixed interval-ms" formula (that formula
 * mis-counts across a weekly/1d weekend gap; dataIndex delta cannot).
 */
export function pixelXToDataIndex(xAxis: { convertFromPixel: (px: number) => number } | null | undefined, x: number): number {
  return xAxis ? xAxis.convertFromPixel(x) : 0;
}

export function dataIndexToPixelX(xAxis: { convertToPixel: (value: number) => number } | null | undefined, dataIndex: number, fallbackX: number): number {
  return xAxis ? xAxis.convertToPixel(dataIndex) : fallbackX;
}
