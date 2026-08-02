/**
 * TA Suite Sprint S1, T2 — the 7 fibonacci tools. All level arithmetic
 * happens in VALUE space (`overlay.points[i].value`, the real anchor
 * price — not re-derived from pixels) and is converted to a pixel y via
 * `yAxis.convertToPixel(price)` only at the very end, so every level line
 * lands at the mathematically exact price regardless of zoom/pan.
 *
 * `fibTimezone`'s verticals are the one EXCEPTION — bar offsets, not price
 * levels — see its own doc comment and `figure-kit.ts`'s
 * `pixelXToDataIndex` for why dataIndex delta (not `timestamp ÷
 * interval-ms`) is used, a deliberate, documented improvement flagged in
 * the sprint's final report.
 */
import { registerOverlay, type Coordinate, type OverlayFigure, type OverlayCreateFiguresCallbackParams } from "klinecharts";
import {
  solidLine,
  dashedLine,
  fillPolygon,
  circleFigure,
  arcFigure,
  extendToRightEdge,
  resolveLineColor,
  resolvePolygonColor,
  labelFigure,
  formatRupeesLabel,
  formatPercentLabel,
  FIB_RETRACEMENT_LEVELS,
  FIB_EXTENSION_LEVELS,
  FIB_SEQUENCE,
  pixelXToDataIndex,
  dataIndexToPixelX,
  SKY,
  SKY_FILL,
  VIOLET,
} from "./figure-kit";

function pointValue(points: Array<{ value?: number }>, index: number): number {
  return points[index]?.value ?? 0;
}

/** Renders one horizontal level line + its ₹-formatted label, from `fromX` to `toX` at the pixel y for `price`. Level 0/1 get a solid emphasis line; interior levels are dashed. */
function levelLine(fromX: number, toX: number, y: number, level: number, price: number, color: string): OverlayFigure[] {
  const coords = [{ x: fromX, y }, { x: toX, y }];
  const line = level === 0 || level === 1 ? solidLine(coords, color, 1.3) : dashedLine(coords, color, 1);
  return [line, labelFigure({ x: fromX, y }, `${formatPercentLabel(level)} · ${formatRupeesLabel(price)}`, { align: "left", background: color })];
}

export function registerFibonacciOverlays(): void {
  // ── fibExtension — 3pt (A, B, C), totalStep 4. Extension levels applied ─
  // from C over the A→B range: price(level) = C.value + (B.value -
  // A.value) * level.
  registerOverlay({
    name: "fibExtension",
    totalStep: 4,
    needDefaultPointFigure: true,
    needDefaultXAxisFigure: true,
    needDefaultYAxisFigure: true,
    createPointFigures: ({ coordinates, bounding, overlay, yAxis }: OverlayCreateFiguresCallbackParams<unknown>): OverlayFigure[] => {
      if (coordinates.length < 2) return [];
      if (coordinates.length === 2) return [dashedLine(coordinates)];
      const color = resolveLineColor(overlay.styles, VIOLET);
      const [pA, pB, pC] = coordinates;
      const valueA = pointValue(overlay.points, 0);
      const valueB = pointValue(overlay.points, 1);
      const valueC = pointValue(overlay.points, 2);
      const range = valueB - valueA;
      const rightX = bounding.width;
      const figures: OverlayFigure[] = [solidLine([pA, pB], color, 1), solidLine([pB, pC], color, 1)];
      for (const level of FIB_EXTENSION_LEVELS) {
        const price = valueC + range * level;
        const y = yAxis ? yAxis.convertToPixel(price) : pC.y;
        figures.push(...levelLine(pC.x, rightX, y, level, price, color));
      }
      return figures;
    },
  });

  // ── fibFan — 2pt (A, B), totalStep 3. Rays from A through the fib-level ─
  // points on the A→B vertical price range at x=B.x, extended right.
  registerOverlay({
    name: "fibFan",
    totalStep: 3,
    needDefaultPointFigure: true,
    needDefaultXAxisFigure: true,
    needDefaultYAxisFigure: true,
    createPointFigures: ({ coordinates, bounding, overlay, yAxis }: OverlayCreateFiguresCallbackParams<unknown>): OverlayFigure[] => {
      if (coordinates.length < 2) return [];
      const color = resolveLineColor(overlay.styles, SKY);
      const [pA, pB] = coordinates;
      const valueA = pointValue(overlay.points, 0);
      const valueB = pointValue(overlay.points, 1);
      const rightX = bounding.width;
      const figures: OverlayFigure[] = [];
      for (const level of FIB_RETRACEMENT_LEVELS) {
        const price = valueA + (valueB - valueA) * level;
        const y = yAxis ? yAxis.convertToPixel(price) : pB.y;
        const rayPoint: Coordinate = { x: pB.x, y };
        const extended = extendToRightEdge(pA, rayPoint, rightX);
        figures.push(level === 0 || level === 1 ? solidLine([pA, extended], color, 1.3) : dashedLine([pA, extended], color, 1));
        figures.push(labelFigure(rayPoint, formatPercentLabel(level), { background: color }));
      }
      return figures;
    },
  });

  // ── fibTimezone — 2pt (A, B), totalStep 3. Verticals at
  // dataIndex(A) + fib(n) * (dataIndex(B) - dataIndex(A)) for n in the
  // Fibonacci sequence — bar offsets, NOT pixel/time offsets. See module doc.
  registerOverlay({
    name: "fibTimezone",
    totalStep: 3,
    needDefaultPointFigure: true,
    needDefaultXAxisFigure: true,
    needDefaultYAxisFigure: true,
    createPointFigures: ({ coordinates, bounding, overlay, xAxis }: OverlayCreateFiguresCallbackParams<unknown>): OverlayFigure[] => {
      if (coordinates.length < 2) return [];
      const color = resolveLineColor(overlay.styles, SKY);
      const [pA, pB] = coordinates;
      const dataIndexA = pixelXToDataIndex(xAxis, pA.x);
      const dataIndexB = pixelXToDataIndex(xAxis, pB.x);
      const unit = dataIndexB - dataIndexA;
      const top = 0;
      const bottom = bounding.height;
      const figures: OverlayFigure[] = [];
      // A generous pixel-space cutoff (3x pane width) so the sequence
      // terminates instead of drawing an unbounded number of off-screen
      // verticals for a large unit spacing.
      const maxX = bounding.width * 3;
      for (const fib of FIB_SEQUENCE) {
        const targetDataIndex = dataIndexA + fib * unit;
        const x = dataIndexToPixelX(xAxis, targetDataIndex, pA.x);
        if (Math.abs(x) > maxX) break;
        figures.push(dashedLine([{ x, y: top }, { x, y: bottom }], color, 1));
        figures.push(labelFigure({ x, y: top + 14 }, String(fib), { background: color }));
      }
      return figures;
    },
  });

  // ── fibArc — 2pt (A, B), totalStep 3. Semicircular arcs centered at A, ──
  // radius = distance(A,B) * level, facing the A→B direction.
  registerOverlay({
    name: "fibArc",
    totalStep: 3,
    needDefaultPointFigure: true,
    needDefaultXAxisFigure: true,
    needDefaultYAxisFigure: true,
    createPointFigures: ({ coordinates, overlay }: OverlayCreateFiguresCallbackParams<unknown>): OverlayFigure[] => {
      if (coordinates.length < 2) return [];
      const color = resolveLineColor(overlay.styles, SKY);
      const [pA, pB] = coordinates;
      const radiusFull = Math.hypot(pB.x - pA.x, pB.y - pA.y);
      const angle = Math.atan2(pB.y - pA.y, pB.x - pA.x);
      const figures: OverlayFigure[] = [solidLine([pA, pB], color, 1)];
      for (const level of FIB_RETRACEMENT_LEVELS) {
        if (level === 0) continue;
        const r = radiusFull * level;
        figures.push(arcFigure(pA.x, pA.y, r, angle - Math.PI / 2, angle + Math.PI / 2, color, level === 1 ? 1.4 : 1));
      }
      return figures;
    },
  });

  // ── fibCircle — 2pt (A, B), totalStep 3. Concentric full circles ────────
  // centered at midpoint(A,B), radius = distance(A,B) * level / 2.
  registerOverlay({
    name: "fibCircle",
    totalStep: 3,
    needDefaultPointFigure: true,
    needDefaultXAxisFigure: true,
    needDefaultYAxisFigure: true,
    createPointFigures: ({ coordinates, overlay }: OverlayCreateFiguresCallbackParams<unknown>): OverlayFigure[] => {
      if (coordinates.length < 2) return [];
      const color = resolveLineColor(overlay.styles, VIOLET);
      const [pA, pB] = coordinates;
      const center = { x: (pA.x + pB.x) / 2, y: (pA.y + pB.y) / 2 };
      const radiusFull = Math.hypot(pB.x - pA.x, pB.y - pA.y) / 2;
      const figures: OverlayFigure[] = [solidLine([pA, pB], color, 1)];
      for (const level of FIB_RETRACEMENT_LEVELS) {
        if (level === 0) continue;
        figures.push(circleFigure(center.x, center.y, radiusFull * level, color, { size: level === 1 ? 1.4 : 1, dashed: level !== 1 }));
      }
      return figures;
    },
  });

  // ── fibSpeedResistanceFan — 2pt (A, B), totalStep 3. Rect grid at ───────
  // eighths + 2 diagonal fan lines through the 1/3 and 2/3 points.
  registerOverlay({
    name: "fibSpeedResistanceFan",
    totalStep: 3,
    needDefaultPointFigure: true,
    needDefaultXAxisFigure: true,
    needDefaultYAxisFigure: true,
    createPointFigures: ({ coordinates, bounding, overlay }: OverlayCreateFiguresCallbackParams<unknown>): OverlayFigure[] => {
      if (coordinates.length < 2) return [];
      const color = resolveLineColor(overlay.styles, SKY);
      const fill = resolvePolygonColor(overlay.styles, SKY_FILL);
      const [pA, pB] = coordinates;
      const x0 = Math.min(pA.x, pB.x);
      const x1 = Math.max(pA.x, pB.x);
      const y0 = Math.min(pA.y, pB.y);
      const y1 = Math.max(pA.y, pB.y);
      const figures: OverlayFigure[] = [
        fillPolygon([{ x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 }], fill, color, 1),
      ];
      for (let i = 1; i < 8; i++) {
        const fraction = i / 8;
        const vx = x0 + (x1 - x0) * fraction;
        const hy = y0 + (y1 - y0) * fraction;
        figures.push(dashedLine([{ x: vx, y: y0 }, { x: vx, y: y1 }], color, 0.8));
        figures.push(dashedLine([{ x: x0, y: hy }, { x: x1, y: hy }], color, 0.8));
      }
      const rightX = bounding.width;
      const oneThird = { x: pB.x, y: pA.y + (pB.y - pA.y) / 3 };
      const twoThird = { x: pB.x, y: pA.y + ((pB.y - pA.y) * 2) / 3 };
      figures.push(solidLine([pA, extendToRightEdge(pA, oneThird, rightX)], color, 1.2));
      figures.push(solidLine([pA, extendToRightEdge(pA, twoThird, rightX)], color, 1.2));
      figures.push(labelFigure(oneThird, "1/3", { background: color }));
      figures.push(labelFigure(twoThird, "2/3", { background: color }));
      return figures;
    },
  });

  // ── fibChannel — 3pt (A, B, C), totalStep 4. Base line A→B, a parallel ──
  // line through C, and fib-fraction level lines in between, all extended
  // to the right bounding edge; translucent fill between the 0 and 1 lines.
  registerOverlay({
    name: "fibChannel",
    totalStep: 4,
    needDefaultPointFigure: true,
    needDefaultXAxisFigure: true,
    needDefaultYAxisFigure: true,
    createPointFigures: ({ coordinates, bounding, overlay }: OverlayCreateFiguresCallbackParams<unknown>): OverlayFigure[] => {
      if (coordinates.length < 2) return [];
      if (coordinates.length === 2) return [dashedLine(coordinates)];
      const color = resolveLineColor(overlay.styles, VIOLET);
      const fill = resolvePolygonColor(overlay.styles, SKY_FILL);
      const [pA, pB, pC] = coordinates;
      const rightX = bounding.width;
      // Perpendicular (really just vertical, matching this codebase's other
      // parallel-line tools) offset from the base line A→B to C, measured at
      // C's own x so the parallel line is a true vertical-offset copy.
      const baseYAtCx = pA.y + ((pB.y - pA.y) * (pC.x - pA.x)) / (pB.x - pA.x || 1);
      const offset = pC.y - baseYAtCx;

      const levelCoords: Array<{ level: number; a: Coordinate; b: Coordinate }> = FIB_RETRACEMENT_LEVELS.map((level) => ({
        level,
        a: { x: pA.x, y: pA.y + offset * level },
        b: { x: pB.x, y: pB.y + offset * level },
      }));

      const figures: OverlayFigure[] = [];
      const zeroLine = levelCoords[0];
      const oneLine = levelCoords[levelCoords.length - 1];
      figures.push(
        fillPolygon(
          [zeroLine.a, extendToRightEdge(zeroLine.a, zeroLine.b, rightX), extendToRightEdge(oneLine.a, oneLine.b, rightX), oneLine.a],
          fill,
          color,
          1,
        ),
      );
      for (const { level, a, b } of levelCoords) {
        const extended = extendToRightEdge(a, b, rightX);
        figures.push(level === 0 || level === 1 ? solidLine([a, extended], color, 1.3) : dashedLine([a, extended], color, 1));
        figures.push(labelFigure(a, formatPercentLabel(level), { align: "left", background: color }));
      }
      return figures;
    },
  });
}
