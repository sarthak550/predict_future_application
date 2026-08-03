/**
 * Founder-feedback pass (2026-08-05), "ratios in trend lines are still not
 * there — look at TradingView very closely" — TradingView-parity stats
 * pills (Δ price/%/bar-count, pinned price/date, channel width) for the 12
 * klinecharts BUILT-IN "Lines" overlays this workbench never registered
 * itself: `segment`/`rayLine`/`straightLine`/`horizontalSegment`/
 * `horizontalRayLine`/`horizontalStraightLine`/`verticalSegment`/
 * `verticalRayLine`/`verticalStraightLine`/`priceChannelLine`/
 * `parallelStraightLine` (11 — `priceLine` is deliberately NOT re-registered
 * here, see below).
 *
 * **Override-vs-wrapper decision, verified against `dist/index.esm.js`, not
 * assumed**: `registerOverlay(template)` is `overlays[template.name] =
 * OverlayImp.extend(template)` (line ~12644) — a PLAIN OBJECT-KEY
 * ASSIGNMENT into the same `overlays` registry the 16 built-ins populate
 * via their own `extensions.forEach(...)` loop at module-init time (line
 * ~12640, runs when `klinecharts` itself first loads — always strictly
 * BEFORE any of this app's code runs, since we import `klinecharts` to call
 * `registerOverlay` at all). Re-registering `"segment"` etc. with our own
 * template therefore REPLACES the built-in entry outright, with no special
 * casing anywhere else in the library — `getOverlayClass(name)` (what
 * `createOverlay`/hydration/the toolbar all resolve through) just reads
 * `overlays[name]`. This means: same `DrawingOverlayName`, same enum, same
 * toolbar entry, same persistence shape — the override path fully applies,
 * no wrapper-name fallback was needed.
 *
 * **Geometry fidelity**: every override below reproduces its built-in's
 * exact `createPointFigures` logic (verbatim-ported from the dist source,
 * not reimplemented from a formula — see `figure-kit.ts`'s
 * `linearYAtX`/`rayEndpoint`/`straightLineEndpoints`/`parallelLinesGeometry`
 * doc for the exact dist line numbers each was ported from) AND the exact
 * `performEventPressedMove`/`performEventMoveForDrawing` drag-pinning hooks
 * the horizontal/vertical ray/segment built-ins have (dropping these would
 * silently break "drag stays level/plumb" for anyone who already drew one).
 * Default line color/width also matches the TRUE built-in default
 * (`KLINECHARTS_DEFAULT_LINE`/`_WIDTH` in `figure-kit.ts` — klinecharts'
 * own `Color.BLUE` #1677FF at size 1, NOT this codebase's usual `INK_600`
 * @ 1.4) — an already-drawn `segment` a user never recolored keeps
 * rendering exactly as it does today; only the STATS pill is new.
 *
 * **`priceLine` is intentionally left as the untouched built-in** — its own
 * `createPointFigures` already inline-renders the price value as a `text`
 * figure UNCONDITIONALLY (`dist/index.esm.js:12161`, no selection/drawing
 * gate at all), which already fully satisfies "price value pill" with zero
 * gap to close. Re-registering it would only add risk (one more built-in
 * geometry to keep byte-identical) for no behavioral gain.
 *
 * **Stats visibility — two DIFFERENT rules, by design, not inconsistency**:
 * 1. `segment`/`rayLine`/`straightLine` (plain, undecorated line tools —
 *    TradingView's actual "Trend Line"/"Ray"/"Extended Line") use
 *    `isStatsPillVisible` (draw-OR-selected) — TRUE TV parity: an idle,
 *    unselected trend line shows nothing extra, exactly like TradingView's
 *    own.
 * 2. `horizontalSegment`/`horizontalRayLine`/`horizontalStraightLine`
 *    (price) and `verticalSegment`/`verticalRayLine`/`verticalStraightLine`
 *    (date) show their new pill ONLY WHILE DRAWING (`isOverlayDrawing`,
 *    narrower than rule 1). Reason, verified against
 *    `OverlayYAxisView.prototype.getDefaultFigures`/`OverlayXAxisView
 *    .prototype.getDefaultFigures` (`dist/index.esm.js:9779`/`10975`):
 *    `needDefaultYAxisFigure`/`needDefaultXAxisFigure` (already `true` on
 *    every one of these, unchanged) already render a native price/date tag
 *    ON THE AXIS whenever `overlay.id === clickOverlayInfo.overlay?.id` —
 *    i.e. exactly the SELECTED half of the TV-parity rule, natively, for
 *    free. Adding our own pill for the selected case too would be the
 *    "don't double-label" collision the brief explicitly warned about; the
 *    real, previously-unfilled gap was DURING DRAWING (before any click-
 *    select event can exist), which the native mechanism structurally
 *    cannot cover (`clickOverlayInfo` is never populated for an
 *    in-progress, not-yet-placed overlay) — that gap is what this file
 *    closes.
 * 3. `priceChannelLine`/`parallelStraightLine` use `isStatsPillVisible`
 *    (draw-OR-selected) for their channel-width pill — there is no native
 *    equivalent for "channel width" anywhere in klinecharts, so no
 *    double-label risk exists and the full TV-parity rule applies directly.
 */
import { registerOverlay, type Coordinate, type OverlayFigure, type OverlayCreateFiguresCallbackParams, type OverlayPerformEventParams } from "klinecharts";
import {
  solidLine,
  labelFigure,
  formatRupeesLabel,
  buildDeltaStatsText,
  buildChannelWidthText,
  formatDatePillLabel,
  resolveLineColor,
  resolveLineWidth,
  pixelXToDataIndex,
  pixelYToPrice,
  midpoint,
  linearYAtX,
  rayEndpoint,
  straightLineEndpoints,
  parallelLinesGeometry,
  isOverlayDrawing,
  isStatsPillVisible,
  trackOverlaySelection,
  KLINECHARTS_DEFAULT_LINE,
  KLINECHARTS_DEFAULT_LINE_WIDTH,
  EMERALD,
  ROSE,
  VIOLET,
} from "./figure-kit";

/** Shared by `segment`/`rayLine`/`straightLine` — the Δ/%/bar-count pill at the anchor-pair midpoint, gated draw-OR-selected. `p0`/`p1` are always the two real CLICKED anchors (never a ray/straight-line's extended endpoint), matching `infoLine`'s own established convention. */
function deltaStatsFigure(
  overlay: OverlayCreateFiguresCallbackParams<unknown>["overlay"],
  xAxis: OverlayCreateFiguresCallbackParams<unknown>["xAxis"],
  p0: Coordinate,
  p1: Coordinate,
): OverlayFigure | null {
  if (!isStatsPillVisible(overlay)) return null;
  const v0 = overlay.points[0]?.value ?? 0;
  const v1 = overlay.points[1]?.value ?? 0;
  const dataIndex0 = pixelXToDataIndex(xAxis, p0.x);
  const dataIndex1 = pixelXToDataIndex(xAxis, p1.x);
  const { text, positive } = buildDeltaStatsText(v0, v1, dataIndex0, dataIndex1);
  return labelFigure(midpoint(p0, p1), text, { background: positive ? EMERALD : ROSE });
}

export function registerBuiltInStatsOverlays(): void {
  // ── segment — 2pt finite trend line. ────────────────────────────────────
  registerOverlay({
    name: "segment",
    totalStep: 3,
    needDefaultPointFigure: true,
    needDefaultXAxisFigure: true,
    needDefaultYAxisFigure: true,
    ...trackOverlaySelection,
    createPointFigures: ({ coordinates, overlay, xAxis }: OverlayCreateFiguresCallbackParams<unknown>): OverlayFigure[] => {
      if (coordinates.length < 2) return [];
      const color = resolveLineColor(overlay.styles, KLINECHARTS_DEFAULT_LINE);
      const width = resolveLineWidth(overlay.styles, KLINECHARTS_DEFAULT_LINE_WIDTH);
      const [p0, p1] = coordinates;
      const figures: OverlayFigure[] = [solidLine([p0, p1], color, width)];
      const stats = deltaStatsFigure(overlay, xAxis, p0, p1);
      if (stats) figures.push(stats);
      return figures;
    },
  });

  // ── rayLine — 2pt anchor, extends to the pane edge past p1. ─────────────
  registerOverlay({
    name: "rayLine",
    totalStep: 3,
    needDefaultPointFigure: true,
    needDefaultXAxisFigure: true,
    needDefaultYAxisFigure: true,
    ...trackOverlaySelection,
    createPointFigures: ({ coordinates, overlay, bounding, xAxis }: OverlayCreateFiguresCallbackParams<unknown>): OverlayFigure[] => {
      if (coordinates.length < 2) return [];
      const color = resolveLineColor(overlay.styles, KLINECHARTS_DEFAULT_LINE);
      const width = resolveLineWidth(overlay.styles, KLINECHARTS_DEFAULT_LINE_WIDTH);
      const [p0, p1] = coordinates;
      const end = rayEndpoint(p0, p1, bounding);
      const figures: OverlayFigure[] = [solidLine([p0, end], color, width)];
      const stats = deltaStatsFigure(overlay, xAxis, p0, p1);
      if (stats) figures.push(stats);
      return figures;
    },
  });

  // ── straightLine — 2pt anchor, extends across the FULL pane width. ──────
  registerOverlay({
    name: "straightLine",
    totalStep: 3,
    needDefaultPointFigure: true,
    needDefaultXAxisFigure: true,
    needDefaultYAxisFigure: true,
    ...trackOverlaySelection,
    createPointFigures: ({ coordinates, overlay, bounding, xAxis }: OverlayCreateFiguresCallbackParams<unknown>): OverlayFigure[] => {
      if (coordinates.length < 2) return [];
      const color = resolveLineColor(overlay.styles, KLINECHARTS_DEFAULT_LINE);
      const width = resolveLineWidth(overlay.styles, KLINECHARTS_DEFAULT_LINE_WIDTH);
      const [p0, p1] = coordinates;
      const [start, end] = straightLineEndpoints(p0, p1, bounding);
      const figures: OverlayFigure[] = [solidLine([start, end], color, width)];
      const stats = deltaStatsFigure(overlay, xAxis, p0, p1);
      if (stats) figures.push(stats);
      return figures;
    },
  });

  // ── horizontalSegment — 2pt, y PINNED level (drag hooks below). ─────────
  registerOverlay({
    name: "horizontalSegment",
    totalStep: 3,
    needDefaultPointFigure: true,
    needDefaultXAxisFigure: true,
    needDefaultYAxisFigure: true,
    ...trackOverlaySelection,
    createPointFigures: ({ coordinates, overlay }: OverlayCreateFiguresCallbackParams<unknown>): OverlayFigure[] => {
      const color = resolveLineColor(overlay.styles, KLINECHARTS_DEFAULT_LINE);
      const width = resolveLineWidth(overlay.styles, KLINECHARTS_DEFAULT_LINE_WIDTH);
      const figures: OverlayFigure[] = [];
      if (coordinates.length === 2) figures.push(solidLine(coordinates, color, width));
      if (isOverlayDrawing(overlay) && coordinates.length >= 1) {
        const price = overlay.points[0]?.value ?? 0;
        figures.push(labelFigure(coordinates[0], formatRupeesLabel(price), { background: color }));
      }
      return figures;
    },
    performEventPressedMove: ({ points, performPoint }: OverlayPerformEventParams) => {
      points[0].value = performPoint.value;
      points[1].value = performPoint.value;
    },
    performEventMoveForDrawing: ({ currentStep, points, performPoint }: OverlayPerformEventParams) => {
      if (currentStep === 2) points[0].value = performPoint.value;
    },
  });

  // ── horizontalRayLine — 2pt, y pinned, extends one direction to the ─────
  // edge (which edge depends on which anchor is left/right).
  registerOverlay({
    name: "horizontalRayLine",
    totalStep: 3,
    needDefaultPointFigure: true,
    needDefaultXAxisFigure: true,
    needDefaultYAxisFigure: true,
    ...trackOverlaySelection,
    createPointFigures: ({ coordinates, overlay, bounding }: OverlayCreateFiguresCallbackParams<unknown>): OverlayFigure[] => {
      const color = resolveLineColor(overlay.styles, KLINECHARTS_DEFAULT_LINE);
      const width = resolveLineWidth(overlay.styles, KLINECHARTS_DEFAULT_LINE_WIDTH);
      const figures: OverlayFigure[] = [];
      const [p0, p1] = coordinates;
      if (p0) {
        const end: Coordinate = { x: p1 && p0.x < p1.x ? bounding.width : 0, y: p0.y };
        figures.push(solidLine([p0, end], color, width));
      }
      if (isOverlayDrawing(overlay) && p0) {
        const price = overlay.points[0]?.value ?? 0;
        figures.push(labelFigure(p0, formatRupeesLabel(price), { background: color }));
      }
      return figures;
    },
    performEventPressedMove: ({ points, performPoint }: OverlayPerformEventParams) => {
      points[0].value = performPoint.value;
      points[1].value = performPoint.value;
    },
    performEventMoveForDrawing: ({ currentStep, points, performPoint }: OverlayPerformEventParams) => {
      if (currentStep === 2) points[0].value = performPoint.value;
    },
  });

  // ── horizontalStraightLine — 1pt, full pane width. ──────────────────────
  registerOverlay({
    name: "horizontalStraightLine",
    totalStep: 2,
    needDefaultPointFigure: true,
    needDefaultXAxisFigure: true,
    needDefaultYAxisFigure: true,
    ...trackOverlaySelection,
    createPointFigures: ({ coordinates, overlay, bounding }: OverlayCreateFiguresCallbackParams<unknown>): OverlayFigure[] => {
      if (coordinates.length < 1) return [];
      const color = resolveLineColor(overlay.styles, KLINECHARTS_DEFAULT_LINE);
      const width = resolveLineWidth(overlay.styles, KLINECHARTS_DEFAULT_LINE_WIDTH);
      const [p0] = coordinates;
      const figures: OverlayFigure[] = [
        solidLine(
          [
            { x: 0, y: p0.y },
            { x: bounding.width, y: p0.y },
          ],
          color,
          width,
        ),
      ];
      if (isOverlayDrawing(overlay)) {
        const price = overlay.points[0]?.value ?? 0;
        figures.push(labelFigure(p0, formatRupeesLabel(price), { background: color }));
      }
      return figures;
    },
  });

  // ── verticalSegment — 2pt, x PINNED plumb (drag hooks below). ───────────
  registerOverlay({
    name: "verticalSegment",
    totalStep: 3,
    needDefaultPointFigure: true,
    needDefaultXAxisFigure: true,
    needDefaultYAxisFigure: true,
    ...trackOverlaySelection,
    createPointFigures: ({ coordinates, overlay }: OverlayCreateFiguresCallbackParams<unknown>): OverlayFigure[] => {
      const color = resolveLineColor(overlay.styles, KLINECHARTS_DEFAULT_LINE);
      const width = resolveLineWidth(overlay.styles, KLINECHARTS_DEFAULT_LINE_WIDTH);
      const figures: OverlayFigure[] = [];
      if (coordinates.length === 2) figures.push(solidLine(coordinates, color, width));
      if (isOverlayDrawing(overlay) && coordinates.length >= 1) {
        const ts = overlay.points[0]?.timestamp ?? 0;
        figures.push(labelFigure(coordinates[0], formatDatePillLabel(ts), { background: color }));
      }
      return figures;
    },
    performEventPressedMove: ({ points, performPoint }: OverlayPerformEventParams) => {
      points[0].timestamp = performPoint.timestamp;
      points[0].dataIndex = performPoint.dataIndex;
      points[1].timestamp = performPoint.timestamp;
      points[1].dataIndex = performPoint.dataIndex;
    },
    performEventMoveForDrawing: ({ currentStep, points, performPoint }: OverlayPerformEventParams) => {
      if (currentStep === 2) {
        points[0].timestamp = performPoint.timestamp;
        points[0].dataIndex = performPoint.dataIndex;
      }
    },
  });

  // ── verticalRayLine — 2pt, x pinned, extends one direction (up/down). ───
  registerOverlay({
    name: "verticalRayLine",
    totalStep: 3,
    needDefaultPointFigure: true,
    needDefaultXAxisFigure: true,
    needDefaultYAxisFigure: true,
    ...trackOverlaySelection,
    createPointFigures: ({ coordinates, overlay, bounding }: OverlayCreateFiguresCallbackParams<unknown>): OverlayFigure[] => {
      const color = resolveLineColor(overlay.styles, KLINECHARTS_DEFAULT_LINE);
      const width = resolveLineWidth(overlay.styles, KLINECHARTS_DEFAULT_LINE_WIDTH);
      const figures: OverlayFigure[] = [];
      if (coordinates.length === 2) {
        const [p0, p1] = coordinates;
        const end: Coordinate = { x: p0.x, y: p0.y < p1.y ? bounding.height : 0 };
        figures.push(solidLine([p0, end], color, width));
      }
      if (isOverlayDrawing(overlay) && coordinates.length >= 1) {
        const ts = overlay.points[0]?.timestamp ?? 0;
        figures.push(labelFigure(coordinates[0], formatDatePillLabel(ts), { background: color }));
      }
      return figures;
    },
    performEventPressedMove: ({ points, performPoint }: OverlayPerformEventParams) => {
      points[0].timestamp = performPoint.timestamp;
      points[0].dataIndex = performPoint.dataIndex;
      points[1].timestamp = performPoint.timestamp;
      points[1].dataIndex = performPoint.dataIndex;
    },
    performEventMoveForDrawing: ({ currentStep, points, performPoint }: OverlayPerformEventParams) => {
      if (currentStep === 2) {
        points[0].timestamp = performPoint.timestamp;
        points[0].dataIndex = performPoint.dataIndex;
      }
    },
  });

  // ── verticalStraightLine — 1pt, full pane height. ────────────────────────
  registerOverlay({
    name: "verticalStraightLine",
    totalStep: 2,
    needDefaultPointFigure: true,
    needDefaultXAxisFigure: true,
    needDefaultYAxisFigure: true,
    ...trackOverlaySelection,
    createPointFigures: ({ coordinates, overlay, bounding }: OverlayCreateFiguresCallbackParams<unknown>): OverlayFigure[] => {
      if (coordinates.length < 1) return [];
      const color = resolveLineColor(overlay.styles, KLINECHARTS_DEFAULT_LINE);
      const width = resolveLineWidth(overlay.styles, KLINECHARTS_DEFAULT_LINE_WIDTH);
      const [p0] = coordinates;
      const figures: OverlayFigure[] = [
        solidLine(
          [
            { x: p0.x, y: 0 },
            { x: p0.x, y: bounding.height },
          ],
          color,
          width,
        ),
      ];
      if (isOverlayDrawing(overlay)) {
        const ts = overlay.points[0]?.timestamp ?? 0;
        figures.push(labelFigure(p0, formatDatePillLabel(ts), { background: color }));
      }
      return figures;
    },
  });

  // ── priceChannelLine — 3pt: trend p0->p1, width anchor p2, PLUS one ─────
  // reflected extension line beyond p2 (`extendParallelLineCount: 1` in the
  // original — see `figure-kit.ts`'s `parallelLinesGeometry` doc).
  registerOverlay({
    name: "priceChannelLine",
    totalStep: 4,
    needDefaultPointFigure: true,
    needDefaultXAxisFigure: true,
    needDefaultYAxisFigure: true,
    ...trackOverlaySelection,
    createPointFigures: ({ coordinates, overlay, bounding, yAxis }: OverlayCreateFiguresCallbackParams<unknown>): OverlayFigure[] => {
      if (coordinates.length < 2) return [];
      const color = resolveLineColor(overlay.styles, KLINECHARTS_DEFAULT_LINE);
      const width = resolveLineWidth(overlay.styles, KLINECHARTS_DEFAULT_LINE_WIDTH);
      const [p0, p1, p2] = coordinates;
      const lines = parallelLinesGeometry(p0, p1, p2, bounding, 1);
      const figures: OverlayFigure[] = lines.map((line) => solidLine(line, color, width));
      if (p2 && p0.x !== p1.x && yAxis && isStatsPillVisible(overlay)) {
        const p2b: Coordinate = { x: p2.x + (p1.x - p0.x), y: p2.y + (p1.y - p0.y) };
        const yLine2AtAnchor = linearYAtX(p2, p2b, p0.x);
        const price1 = pixelYToPrice(yAxis, p0.y);
        const price2 = pixelYToPrice(yAxis, yLine2AtAnchor);
        figures.push(labelFigure(midpoint(p0, { x: p0.x, y: yLine2AtAnchor }), buildChannelWidthText(price1, price2), { background: VIOLET }));
      }
      return figures;
    },
  });

  // ── parallelStraightLine — 3pt: trend p0->p1, width anchor p2. ──────────
  registerOverlay({
    name: "parallelStraightLine",
    totalStep: 4,
    needDefaultPointFigure: true,
    needDefaultXAxisFigure: true,
    needDefaultYAxisFigure: true,
    ...trackOverlaySelection,
    createPointFigures: ({ coordinates, overlay, bounding, yAxis }: OverlayCreateFiguresCallbackParams<unknown>): OverlayFigure[] => {
      if (coordinates.length < 2) return [];
      const color = resolveLineColor(overlay.styles, KLINECHARTS_DEFAULT_LINE);
      const width = resolveLineWidth(overlay.styles, KLINECHARTS_DEFAULT_LINE_WIDTH);
      const [p0, p1, p2] = coordinates;
      const lines = parallelLinesGeometry(p0, p1, p2, bounding, 0);
      const figures: OverlayFigure[] = lines.map((line) => solidLine(line, color, width));
      if (p2 && p0.x !== p1.x && yAxis && isStatsPillVisible(overlay)) {
        const p2b: Coordinate = { x: p2.x + (p1.x - p0.x), y: p2.y + (p1.y - p0.y) };
        const yLine2AtAnchor = linearYAtX(p2, p2b, p0.x);
        const price1 = pixelYToPrice(yAxis, p0.y);
        const price2 = pixelYToPrice(yAxis, yLine2AtAnchor);
        figures.push(labelFigure(midpoint(p0, { x: p0.x, y: yLine2AtAnchor }), buildChannelWidthText(price1, price2), { background: VIOLET }));
      }
      return figures;
    },
  });
}
