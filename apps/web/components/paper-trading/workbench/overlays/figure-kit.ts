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

/** The style editor's (T7) 6 color swatches — `drawing-style-toolbar.tsx` maps each to a `line`/`polygon`/`text` style patch. */
export const SWATCH_COLORS = [INK_600, SKY, TEAL, AMBER, VIOLET, ROSE] as const;
/** The style editor's 3 line-width choices. */
export const LINE_WIDTHS = [1, 2, 3] as const;

export function formatRupeesLabel(v: number): string {
  return `₹${v.toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;
}

export function formatPercentLabel(v: number): string {
  const sign = v > 0 ? "+" : v < 0 ? "−" : "";
  return `${sign}${Math.abs(v * 100).toFixed(1)}%`;
}

/** TradingView-style 3-decimal ratio label (`0.618`, `1.272`) — for harmonic-pattern retracement/extension ratios computed in VALUE space (`abcd`/`xabcd` — see `legacy-shapes.ts`). Distinct from `formatPercentLabel` (which shows a signed %) — a raw ratio has no natural sign and TradingView never shows one. */
export function formatRatioLabel(v: number): string {
  return Number.isFinite(v) ? v.toFixed(3) : "—";
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
