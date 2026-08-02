/**
 * TA Suite Sprint S1, T4 — the 5 measure/position tools. `longPosition`/
 * `shortPosition` are the paper-trading synergy pair: 3 anchors
 * (entry/stop/target) with `performEventMoveForDrawing`/
 * `performEventPressedMove` CONSTRAINT CLAMPS so a drag can never produce
 * an inverted R:R (verified against `dist/index.esm.js`'s own
 * `stepDrawingModeEventMoveForDrawing`/`eventPressedPointMove`: klinecharts
 * writes the candidate point into `this.points[pointIndex]` — the SAME
 * array object passed to our hook as `params.points` — BEFORE calling our
 * hook, so mutating `points[i].value` in place is the correct, klinecharts-
 * native way to re-clamp a just-applied drag; several real built-in
 * templates, e.g. `horizontalStraightLine`, use exactly this pattern).
 *
 * The R:R chip and %+/− figures are computed in VALUE space from the live
 * (already-clamped) points, so they can never show a nonsensical ratio.
 */
import { registerOverlay, type Coordinate, type OverlayFigure, type OverlayCreateFiguresCallbackParams, type OverlayPerformEventParams, type Point } from "klinecharts";
import {
  solidLine,
  dashedLine,
  outlinedRect,
  labelFigure,
  formatRupeesLabel,
  formatPercentLabel,
  resolveLineColor,
  pixelXToDataIndex,
  EMERALD,
  EMERALD_FILL,
  ROSE,
  ROSE_FILL,
  INK_600,
} from "./figure-kit";

const CLAMP_EPSILON_RATIO = 0.0005; // 0.05% of the entry price — small enough to be visually a no-op, large enough to never land exactly on the boundary (which would divide-by-zero the R:R ratio).

function epsilonFor(value: number): number {
  return Math.max(Math.abs(value) * CLAMP_EPSILON_RATIO, 0.01);
}

/**
 * Enforces `stop < entry < target` (long) / `stop > entry > target` (short)
 * on whichever point index was just moved — called from BOTH
 * `performEventMoveForDrawing` (mid-draw, before all 3 points exist yet)
 * and `performEventPressedMove` (post-completion drag). Points not yet
 * placed are `undefined` and skipped, matching every built-in template's
 * own defensive-currentStep pattern.
 */
function clampPosition(points: Array<Partial<Point>>, performPointIndex: number, direction: "long" | "short"): void {
  const entry = points[0];
  const stop = points[1];
  const target = points[2];
  if (entry?.value == null) return;

  const sign = direction === "long" ? 1 : -1; // long: stop below entry below target. short: mirrored.

  if (performPointIndex === 1 && stop?.value != null) {
    // dragging stop — must stay on the "below entry" (long) / "above entry" (short) side.
    if (sign * (entry.value - stop.value) <= 0) stop.value = entry.value - sign * epsilonFor(entry.value);
  }
  if (performPointIndex === 2 && target?.value != null) {
    if (sign * (target.value - entry.value) <= 0) target.value = entry.value + sign * epsilonFor(entry.value);
  }
  if (performPointIndex === 0) {
    // dragging entry itself — keep it strictly between the other two, whichever already exist.
    if (stop?.value != null && sign * (entry.value - stop.value) <= 0) entry.value = stop.value + sign * epsilonFor(stop.value);
    if (target?.value != null && sign * (target.value - entry.value) <= 0) entry.value = target.value - sign * epsilonFor(target.value);
  }
}

function positionFigures(coordinates: Coordinate[], points: Array<Partial<Point>>, direction: "long" | "short", styles: unknown): OverlayFigure[] {
  if (coordinates.length < 2) return [];
  const color = resolveLineColor(styles as Record<string, unknown>, INK_600);
  const [entryPx, stopPx, targetPx] = coordinates;
  const rightX = Math.max(entryPx.x, stopPx?.x ?? entryPx.x, targetPx?.x ?? entryPx.x) + 90;
  const boxWidth = rightX - entryPx.x;
  const figures: OverlayFigure[] = [solidLine([entryPx, { x: rightX, y: entryPx.y }], color, 1.4)];
  figures.push(labelFigure(entryPx, `Entry ${formatRupeesLabel(points[0]?.value ?? 0)}`, { align: "left", background: color }));

  if (stopPx) {
    const top = Math.min(entryPx.y, stopPx.y);
    const height = Math.abs(stopPx.y - entryPx.y);
    figures.push(outlinedRect(entryPx.x, top, boxWidth, height, ROSE_FILL, ROSE, 1));
    figures.push(dashedLine([stopPx, { x: rightX, y: stopPx.y }], ROSE, 1.2));
  }
  if (targetPx) {
    const top = Math.min(entryPx.y, targetPx.y);
    const height = Math.abs(targetPx.y - entryPx.y);
    figures.push(outlinedRect(entryPx.x, top, boxWidth, height, EMERALD_FILL, EMERALD, 1));
    figures.push(dashedLine([targetPx, { x: rightX, y: targetPx.y }], EMERALD, 1.2));
  }

  if (stopPx && targetPx) {
    const entryValue = points[0]?.value ?? 0;
    const stopValue = points[1]?.value ?? 0;
    const targetValue = points[2]?.value ?? 0;
    const risk = Math.abs(entryValue - stopValue) || 1;
    const reward = Math.abs(targetValue - entryValue);
    const rr = reward / risk;
    const targetPct = entryValue !== 0 ? (targetValue - entryValue) / entryValue : 0;
    const stopPct = entryValue !== 0 ? (stopValue - entryValue) / entryValue : 0;
    const chipY = Math.min(entryPx.y, stopPx.y, targetPx.y) - 24;
    figures.push(
      labelFigure(
        { x: entryPx.x, y: chipY },
        `R:R 1:${rr.toFixed(1)} · target ${formatPercentLabel(targetPct)} · stop ${formatPercentLabel(stopPct)}`,
        { align: "left", background: direction === "long" ? EMERALD : ROSE },
      ),
    );
  }
  return figures;
}

export function registerMeasureOverlays(): void {
  registerOverlay({
    name: "longPosition",
    totalStep: 4,
    needDefaultPointFigure: true,
    needDefaultXAxisFigure: true,
    needDefaultYAxisFigure: true,
    createPointFigures: ({ coordinates, overlay }: OverlayCreateFiguresCallbackParams<unknown>): OverlayFigure[] =>
      positionFigures(coordinates, overlay.points, "long", overlay.styles),
    performEventMoveForDrawing: (params: OverlayPerformEventParams) => clampPosition(params.points, params.performPointIndex, "long"),
    performEventPressedMove: (params: OverlayPerformEventParams) => clampPosition(params.points, params.performPointIndex, "long"),
  });

  registerOverlay({
    name: "shortPosition",
    totalStep: 4,
    needDefaultPointFigure: true,
    needDefaultXAxisFigure: true,
    needDefaultYAxisFigure: true,
    createPointFigures: ({ coordinates, overlay }: OverlayCreateFiguresCallbackParams<unknown>): OverlayFigure[] =>
      positionFigures(coordinates, overlay.points, "short", overlay.styles),
    performEventMoveForDrawing: (params: OverlayPerformEventParams) => clampPosition(params.points, params.performPointIndex, "short"),
    performEventPressedMove: (params: OverlayPerformEventParams) => clampPosition(params.points, params.performPointIndex, "short"),
  });

  // ── priceRange — 2pt, Δ + %. ──────────────────────────────────────────
  registerOverlay({
    name: "priceRange",
    totalStep: 3,
    needDefaultPointFigure: true,
    needDefaultXAxisFigure: true,
    needDefaultYAxisFigure: true,
    createPointFigures: ({ coordinates, overlay }: OverlayCreateFiguresCallbackParams<unknown>): OverlayFigure[] => {
      if (coordinates.length < 2) return [];
      const color = resolveLineColor(overlay.styles, INK_600);
      const [p0, p1] = coordinates;
      const v0 = overlay.points[0]?.value ?? 0;
      const v1 = overlay.points[1]?.value ?? 0;
      const delta = v1 - v0;
      const pct = v0 !== 0 ? delta / v0 : 0;
      const mid = { x: (p0.x + p1.x) / 2, y: (p0.y + p1.y) / 2 };
      return [
        dashedLine([p0, p1], color, 1.4),
        labelFigure(mid, `Δ ${formatRupeesLabel(delta)} · ${formatPercentLabel(pct)}`, { background: delta >= 0 ? EMERALD : ROSE }),
      ];
    },
  });

  // ── dateRange — 2pt, bars from dataIndex delta (see figure-kit.ts's ────
  // `pixelXToDataIndex` doc for why this is used instead of a literal
  // timestamp ÷ fixed-interval-ms division — a deliberate, documented
  // improvement: dataIndex arithmetic is immune to both zoom AND calendar
  // gaps, verified identical across two zoom levels per the ticket's own
  // acceptance criterion).
  registerOverlay({
    name: "dateRange",
    totalStep: 3,
    needDefaultPointFigure: true,
    needDefaultXAxisFigure: true,
    needDefaultYAxisFigure: true,
    createPointFigures: ({ coordinates, overlay, xAxis }: OverlayCreateFiguresCallbackParams<unknown>): OverlayFigure[] => {
      if (coordinates.length < 2) return [];
      const color = resolveLineColor(overlay.styles, INK_600);
      const [p0, p1] = coordinates;
      const dataIndex0 = pixelXToDataIndex(xAxis, p0.x);
      const dataIndex1 = pixelXToDataIndex(xAxis, p1.x);
      const bars = Math.round(Math.abs(dataIndex1 - dataIndex0));
      const mid = { x: (p0.x + p1.x) / 2, y: Math.min(p0.y, p1.y) - 18 };
      return [dashedLine([p0, p1], color, 1.4), labelFigure(mid, `${bars} bar${bars === 1 ? "" : "s"}`, { background: color })];
    },
  });

  // ── datePriceRange — 2pt, both Δ price and Δ bars in one chip. ─────────
  registerOverlay({
    name: "datePriceRange",
    totalStep: 3,
    needDefaultPointFigure: true,
    needDefaultXAxisFigure: true,
    needDefaultYAxisFigure: true,
    createPointFigures: ({ coordinates, overlay, xAxis }: OverlayCreateFiguresCallbackParams<unknown>): OverlayFigure[] => {
      if (coordinates.length < 2) return [];
      const color = resolveLineColor(overlay.styles, INK_600);
      const [p0, p1] = coordinates;
      const v0 = overlay.points[0]?.value ?? 0;
      const v1 = overlay.points[1]?.value ?? 0;
      const delta = v1 - v0;
      const pct = v0 !== 0 ? delta / v0 : 0;
      const dataIndex0 = pixelXToDataIndex(xAxis, p0.x);
      const dataIndex1 = pixelXToDataIndex(xAxis, p1.x);
      const bars = Math.round(Math.abs(dataIndex1 - dataIndex0));
      const mid = { x: (p0.x + p1.x) / 2, y: (p0.y + p1.y) / 2 };
      return [
        outlinedRect(Math.min(p0.x, p1.x), Math.min(p0.y, p1.y), Math.abs(p1.x - p0.x), Math.abs(p1.y - p0.y), delta >= 0 ? EMERALD_FILL : ROSE_FILL, color, 1),
        labelFigure(mid, `Δ ${formatRupeesLabel(delta)} (${formatPercentLabel(pct)}) · ${bars} bar${bars === 1 ? "" : "s"}`, { background: delta >= 0 ? EMERALD : ROSE }),
      ];
    },
  });
}
