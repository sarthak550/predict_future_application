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
  formatUnsignedPercentLabel,
  FIB_RETRACEMENT_LEVELS,
  FIB_EXTENSION_LEVELS,
  FIB_SEQUENCE,
  pixelXToDataIndex,
  dataIndexToPixelX,
  lerp,
  SKY,
  SKY_FILL,
  VIOLET,
  AMBER,
  TEAL,
} from "./figure-kit";
import { computePitchforkGeometry, medianDirection } from "./pitchfork-math";

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
        // Tool-values-gap-fixes brief, T2.1 — add ₹ price alongside the level
        // (matching `fibExtension`'s combined format), and use the UNSIGNED
        // percent formatter (a fib level has no natural direction — the
        // signed `formatPercentLabel`'s "+61.8%" read wrong here).
        figures.push(labelFigure(rayPoint, `${formatUnsignedPercentLabel(level)} · ${formatRupeesLabel(price)}`, { background: color }));
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
        // Tool-values-gap-fixes brief, T2.2 — % label where the arc crosses
        // the A→B ray direction (no dedicated TV page found, but 7/9 sibling
        // fib tools have a confirmed Levels toggle — pattern-matched gap).
        figures.push(labelFigure({ x: pA.x + r * Math.cos(angle), y: pA.y + r * Math.sin(angle) }, formatUnsignedPercentLabel(level), { background: color }));
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
        // Tool-values-gap-fixes brief, T2.3 — TradingView-CONFIRMED gap
        // (`43000518159`, "Levels" toggle = "labels with the circles' values").
        figures.push(labelFigure({ x: center.x, y: center.y - radiusFull * level }, formatUnsignedPercentLabel(level), { background: color }));
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
      // Tool-values-gap-fixes brief, T2.4 — TradingView-CONFIRMED gap
      // (`43000518156`, "left/right/top/bottom labels with levels' values" on
      // the grid). Label the top of each vertical division and the left of
      // each horizontal division with its `formatUnsignedPercentLabel`
      // fraction — the existing "1/3"/"2/3" diagonal-ray labels below are a
      // distinct, legitimate Speed-Resistance-Lines convention and are left
      // untouched.
      for (let i = 1; i < 8; i++) {
        const fraction = i / 8;
        const vx = x0 + (x1 - x0) * fraction;
        const hy = y0 + (y1 - y0) * fraction;
        figures.push(dashedLine([{ x: vx, y: y0 }, { x: vx, y: y1 }], color, 0.8));
        figures.push(dashedLine([{ x: x0, y: hy }, { x: x1, y: hy }], color, 0.8));
        figures.push(labelFigure({ x: vx, y: y0 }, formatUnsignedPercentLabel(fraction), { background: color, dy: 2 }));
        figures.push(labelFigure({ x: x0, y: hy }, formatUnsignedPercentLabel(fraction), { background: color, align: "left" }));
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
  // **Founder feedback (2026-08-04)**: the level geometry itself stays in
  // PIXEL space (a parallel vertical offset from the A→B base line, unchanged
  // — verified working since S1), but each level's label now ALSO shows the
  // real ₹ price at that line (`yAxis.convertFromPixel(y)`, the exact
  // inverse of the `convertToPixel` calls every other fib tool's VALUE-space
  // math already uses) — matching `fibExtension`'s own `levelLine` price
  // display, per the audit's own "verify fibChannel shows ₹ values" finding.
  registerOverlay({
    name: "fibChannel",
    totalStep: 4,
    needDefaultPointFigure: true,
    needDefaultXAxisFigure: true,
    needDefaultYAxisFigure: true,
    createPointFigures: ({ coordinates, bounding, overlay, yAxis }: OverlayCreateFiguresCallbackParams<unknown>): OverlayFigure[] => {
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
        const price = yAxis ? yAxis.convertFromPixel(a.y) : undefined;
        const text = price === undefined ? formatPercentLabel(level) : `${formatPercentLabel(level)} · ${formatRupeesLabel(price)}`;
        figures.push(labelFigure(a, text, { align: "left", background: color }));
      }
      return figures;
    },
  });

  // ── trendBasedFibTime — 3pt (A, B, C), totalStep 4. Verticals at ────────
  // dataIndex(C) + fib(n) * (dataIndex(B) - dataIndex(A)) for n in the
  // Fibonacci sequence — the SAME dataIndex-delta convention `fibTimezone`
  // established, just with the "unit" span measured between A→B while the
  // verticals themselves originate from C (the "trend-based" distinction
  // from plain `fibTimezone`).
  registerOverlay({
    name: "trendBasedFibTime",
    totalStep: 4,
    needDefaultPointFigure: true,
    needDefaultXAxisFigure: true,
    needDefaultYAxisFigure: true,
    createPointFigures: ({ coordinates, bounding, xAxis, overlay }: OverlayCreateFiguresCallbackParams<unknown>): OverlayFigure[] => {
      if (coordinates.length < 2) return [dashedLine(coordinates)];
      const color = resolveLineColor(overlay.styles, SKY);
      if (coordinates.length < 3) return [dashedLine([coordinates[0], coordinates[1]], color, 1)];
      const [pA, pB, pC] = coordinates;
      const dataIndexA = pixelXToDataIndex(xAxis, pA.x);
      const dataIndexB = pixelXToDataIndex(xAxis, pB.x);
      const dataIndexC = pixelXToDataIndex(xAxis, pC.x);
      const unit = dataIndexB - dataIndexA;
      const top = 0;
      const bottom = bounding.height;
      const figures: OverlayFigure[] = [dashedLine([pA, pB], color, 1)];
      const maxX = bounding.width * 3;
      for (const fib of FIB_SEQUENCE) {
        const targetDataIndex = dataIndexC + fib * unit;
        const x = dataIndexToPixelX(xAxis, targetDataIndex, pC.x);
        if (Math.abs(x) > maxX) break;
        figures.push(dashedLine([{ x, y: top }, { x, y: bottom }], color, 1));
        figures.push(labelFigure({ x, y: top + 14 }, String(fib), { background: color }));
      }
      return figures;
    },
  });

  // ── fibSpiral — 2pt (A, B), totalStep 3. Logarithmic (golden) spiral ────
  // from A: r(θ) = a·φ^(2θ/π) — grows by the golden ratio φ every quarter
  // turn, the standard "golden spiral" parametrization — scaled so radius
  // = |AB| after exactly one full turn (a = |AB|/φ⁴). ~3 turns, sampled
  // into ONE polyline `solidLine` figure (verified multi-point `line`
  // figures render as a true connected polyline — see `cycles.ts`'s
  // `sineLine` doc for the same verification, against `dist/index.esm.js`'s
  // `drawLine`).
  registerOverlay({
    name: "fibSpiral",
    totalStep: 3,
    needDefaultPointFigure: true,
    needDefaultXAxisFigure: true,
    needDefaultYAxisFigure: true,
    createPointFigures: ({ coordinates, overlay }: OverlayCreateFiguresCallbackParams<unknown>): OverlayFigure[] => {
      if (coordinates.length < 2) return [];
      const color = resolveLineColor(overlay.styles, VIOLET);
      const [pA, pB] = coordinates;
      const scale = Math.hypot(pB.x - pA.x, pB.y - pA.y) || 1;
      const phase = Math.atan2(pB.y - pA.y, pB.x - pA.x);
      const PHI = (1 + Math.sqrt(5)) / 2;
      const a = scale / Math.pow(PHI, 4);
      const turns = 3;
      const points: Coordinate[] = [];
      const steps = 180; // 3 turns * 60 samples/turn — smooth without being an unbounded loop.
      for (let i = 0; i <= steps; i++) {
        const theta = (i / steps) * turns * 2 * Math.PI;
        const r = a * Math.pow(PHI, (2 * theta) / Math.PI);
        points.push({ x: pA.x + r * Math.cos(theta + phase), y: pA.y + r * Math.sin(theta + phase) });
      }
      return [solidLine(points, color, 1.4)];
    },
  });

  // ── fibSpeedResistanceArcs — 2pt (A, B), totalStep 3. Quarter-arcs ──────
  // centered at A, radius = |AB| * fib level, sweeping from the horizontal
  // (0°, the positive-x pixel axis) to the A→B ray — the classic "bounded
  // in the A-B box" Speed Resistance Arcs look, distinct from `fibArc`'s
  // own full semicircle (±90° around the A→B direction). Correct for the
  // common down-right/up-right drag directions this tool is normally drawn
  // in; a leftward drag (B left of A) sweeps the LONG way round instead of
  // reflecting across a second reference angle — a documented simplification
  // for the uncommon case, not a silent bug.
  registerOverlay({
    name: "fibSpeedResistanceArcs",
    totalStep: 3,
    needDefaultPointFigure: true,
    needDefaultXAxisFigure: true,
    needDefaultYAxisFigure: true,
    createPointFigures: ({ coordinates, overlay }: OverlayCreateFiguresCallbackParams<unknown>): OverlayFigure[] => {
      if (coordinates.length < 2) return [];
      const color = resolveLineColor(overlay.styles, SKY);
      const [pA, pB] = coordinates;
      const radiusFull = Math.hypot(pB.x - pA.x, pB.y - pA.y);
      const angleToB = Math.atan2(pB.y - pA.y, pB.x - pA.x);
      const startAngle = Math.min(0, angleToB);
      const endAngle = Math.max(0, angleToB);
      const figures: OverlayFigure[] = [solidLine([pA, pB], color, 1)];
      for (const level of FIB_RETRACEMENT_LEVELS) {
        if (level === 0) continue;
        const r = radiusFull * level;
        figures.push(arcFigure(pA.x, pA.y, r, startAngle, endAngle, color, level === 1 ? 1.4 : 1));
        // Tool-values-gap-fixes brief, T2.5 — TradingView-CONFIRMED gap
        // (`43000518157`). Same placement approach as `fibArc` (T2.2): label
        // at the arc's point along the A→B ray direction (`angleToB`, always
        // one of the two sweep bounds by construction above).
        figures.push(labelFigure({ x: pA.x + r * Math.cos(angleToB), y: pA.y + r * Math.sin(angleToB) }, formatUnsignedPercentLabel(level), { background: color }));
      }
      return figures;
    },
  });

  // ── fibWedge — 3pt (A, B, C), totalStep 4. Two rays A→B, A→C + fib- ─────
  // fraction arcs of the SHORTER ray, swept between the two ray angles.
  registerOverlay({
    name: "fibWedge",
    totalStep: 4,
    needDefaultPointFigure: true,
    needDefaultXAxisFigure: true,
    needDefaultYAxisFigure: true,
    createPointFigures: ({ coordinates, overlay }: OverlayCreateFiguresCallbackParams<unknown>): OverlayFigure[] => {
      if (coordinates.length < 2) return [dashedLine(coordinates)];
      const color = resolveLineColor(overlay.styles, AMBER);
      const [pA, pB, pC] = coordinates;
      if (!pC) return [solidLine([pA, pB], color, 1.2)];
      const lenB = Math.hypot(pB.x - pA.x, pB.y - pA.y);
      const lenC = Math.hypot(pC.x - pA.x, pC.y - pA.y);
      const shorter = Math.min(lenB, lenC) || 1;
      const angleB = Math.atan2(pB.y - pA.y, pB.x - pA.x);
      const angleC = Math.atan2(pC.y - pA.y, pC.x - pA.x);
      const startAngle = Math.min(angleB, angleC);
      const endAngle = Math.max(angleB, angleC);
      const midAngle = (startAngle + endAngle) / 2;
      const figures: OverlayFigure[] = [solidLine([pA, pB], color, 1.2), solidLine([pA, pC], color, 1.2)];
      for (const level of FIB_RETRACEMENT_LEVELS) {
        if (level === 0) continue;
        const r = shorter * level;
        figures.push(arcFigure(pA.x, pA.y, r, startAngle, endAngle, color, level === 1 ? 1.4 : 1));
        // Tool-values-gap-fixes brief, T2.6 — TradingView-CONFIRMED gap
        // (`43000518153`, "Levels" = "text displaying arcs' levels values").
        // Label at the arc's midpoint angle between the two rays.
        figures.push(labelFigure({ x: pA.x + r * Math.cos(midAngle), y: pA.y + r * Math.sin(midAngle) }, formatUnsignedPercentLabel(level), { background: color }));
      }
      return figures;
    },
  });

  // ── pitchfan — 3pt (A, B, C), totalStep 4. Andrews-style median (A → ────
  // midpoint(B,C)) + fib-fraction fan rays parallel to the median, anchored
  // at fib-fraction points along the B→C "tine line" — reuses
  // `pitchfork-math.ts`'s shared geometry (the "andrews" variant) rather
  // than re-deriving the median, same discipline as S1's `pitchforks.ts`.
  registerOverlay({
    name: "pitchfan",
    totalStep: 4,
    needDefaultPointFigure: true,
    needDefaultXAxisFigure: true,
    needDefaultYAxisFigure: true,
    createPointFigures: ({ coordinates, bounding, overlay }: OverlayCreateFiguresCallbackParams<unknown>): OverlayFigure[] => {
      if (coordinates.length < 2) return [dashedLine(coordinates)];
      const color = resolveLineColor(overlay.styles, TEAL);
      if (coordinates.length < 3) return [dashedLine([coordinates[0], coordinates[1]], color, 1)];
      const [p0, p1, p2] = coordinates;
      const geo = computePitchforkGeometry(p0, p1, p2, "andrews");
      const dir = medianDirection(geo);
      const rightX = bounding.width;
      const medianExtended = extendToRightEdge(geo.medianStart, geo.medianEnd, rightX);
      const figures: OverlayFigure[] = [solidLine([geo.medianStart, medianExtended], color, 1.6)];
      for (const level of FIB_RETRACEMENT_LEVELS) {
        const anchor = lerp(geo.tineAAnchor, geo.tineBAnchor, level);
        const rayFar: Coordinate = { x: anchor.x + dir.x, y: anchor.y + dir.y };
        const extended = extendToRightEdge(anchor, rayFar, rightX);
        figures.push(level === 0 || level === 1 ? solidLine([anchor, extended], color, 1.2) : dashedLine([anchor, extended], color, 0.9));
        figures.push(labelFigure(anchor, formatPercentLabel(level), { background: color }));
      }
      return figures;
    },
  });
}
