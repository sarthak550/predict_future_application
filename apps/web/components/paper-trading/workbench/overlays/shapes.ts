/**
 * TA Suite Sprint S1, T4 — the 7 shape tools (`highlighter` is a toolbar
 * alias for the built-in `brush`, per D2 — it is NOT registered here, see
 * `tool-registry.ts`).
 *
 * `ellipse` is the one genuinely tricky shape: "3pt: rotated major axis +
 * minor radius — ONE path figure w/ two A commands" per the plan. Built via
 * raw SVG-path arc commands, whose rotation is expressed natively by the
 * `A` command's own x-axis-rotation argument (arg index 3 of
 * `A rx ry x-axis-rotation large-arc-flag sweep-flag x y`) — this correctly
 * renders a NON-axis-aligned ellipse without needing a canvas transform the
 * mini SVG-path parser doesn't support. See `figure-kit.ts`'s `pathFigure`
 * doc for why passing `x=0, y=0` and embedding true absolute pixel
 * coordinates directly in the path string (rather than relative offsets)
 * is the correct usage here — `drawPath` offsets EVERY command's args by
 * the figure's own `(x,y)`, uppercase or lowercase alike.
 */
import { registerOverlay, type Coordinate, type OverlayFigure, type OverlayCreateFiguresCallbackParams } from "klinecharts";
import {
  solidLine,
  dashedLine,
  fillPolygon,
  circleFigure,
  pathFigure,
  labelFigure,
  midpoint,
  resolveLineColor,
  resolvePolygonColor,
  buildDeltaStatsText,
  pixelXToDataIndex,
  isStatsPillVisible,
  trackOverlaySelection,
  EMERALD,
  ROSE,
  INK_600,
  SKY_FILL,
} from "./figure-kit";

export function registerShapeOverlays(): void {
  // ── ellipse — 3pt: P0 center, P1 major-axis endpoint (radius + ─────────
  // rotation), P2 sets the minor radius via its perpendicular distance from
  // the major axis line.
  registerOverlay({
    name: "ellipse",
    totalStep: 4,
    needDefaultPointFigure: true,
    needDefaultXAxisFigure: true,
    needDefaultYAxisFigure: true,
    createPointFigures: ({ coordinates, overlay }: OverlayCreateFiguresCallbackParams<unknown>): OverlayFigure[] => {
      if (coordinates.length < 2) return [];
      const color = resolveLineColor(overlay.styles, INK_600);
      const [center, majorEnd, minorRef] = coordinates;
      const rx = Math.hypot(majorEnd.x - center.x, majorEnd.y - center.y) || 1;
      const angle = Math.atan2(majorEnd.y - center.y, majorEnd.x - center.x);
      let ry = rx * 0.4; // sensible default minor radius until the 3rd point is placed.
      if (coordinates.length >= 3) {
        const v = { x: minorRef.x - center.x, y: minorRef.y - center.y };
        // Perpendicular distance from P2 to the major-axis line — rotate v
        // into the ellipse's own local frame and take the |y| component.
        ry = Math.max(2, Math.abs(-v.x * Math.sin(angle) + v.y * Math.cos(angle)));
      }
      const p1 = { x: center.x + rx * Math.cos(angle), y: center.y + rx * Math.sin(angle) };
      const p2 = { x: center.x - rx * Math.cos(angle), y: center.y - rx * Math.sin(angle) };
      const rotationDeg = (angle * 180) / Math.PI;
      const path = `M ${p1.x} ${p1.y} A ${rx} ${ry} ${rotationDeg} 1 1 ${p2.x} ${p2.y} A ${rx} ${ry} ${rotationDeg} 1 1 ${p1.x} ${p1.y} Z`;
      return [pathFigure(0, 0, path, color, { fill: true, width: rx * 2, height: ry * 2 }), solidLine([center, majorEnd], color, 0.8)];
    },
  });

  // ── rotatedRect — 3pt: P0→P1 is one edge, P2 sets the perpendicular ────
  // extent (the rectangle need not be axis-aligned).
  registerOverlay({
    name: "rotatedRect",
    totalStep: 4,
    needDefaultPointFigure: true,
    needDefaultXAxisFigure: true,
    needDefaultYAxisFigure: true,
    createPointFigures: ({ coordinates, overlay }: OverlayCreateFiguresCallbackParams<unknown>): OverlayFigure[] => {
      if (coordinates.length < 2) return [solidLine(coordinates)];
      const color = resolveLineColor(overlay.styles, INK_600);
      const fill = resolvePolygonColor(overlay.styles, SKY_FILL);
      const [p0, p1, p2] = coordinates;
      const edge = { x: p1.x - p0.x, y: p1.y - p0.y };
      const edgeLen = Math.hypot(edge.x, edge.y) || 1;
      const unit = { x: edge.x / edgeLen, y: edge.y / edgeLen };
      const perp = { x: -unit.y, y: unit.x };
      let height = 0;
      if (coordinates.length >= 3) {
        const v = { x: p2.x - p0.x, y: p2.y - p0.y };
        height = v.x * perp.x + v.y * perp.y;
      }
      const p3 = { x: p1.x + perp.x * height, y: p1.y + perp.y * height };
      const p4 = { x: p0.x + perp.x * height, y: p0.y + perp.y * height };
      return [fillPolygon([p0, p1, p3, p4], fill, color, 1.2)];
    },
  });

  // ── triangleShape — 3pt, filled polygon of the 3 raw anchors. ───────────
  registerOverlay({
    name: "triangleShape",
    totalStep: 4,
    needDefaultPointFigure: true,
    needDefaultXAxisFigure: true,
    needDefaultYAxisFigure: true,
    createPointFigures: ({ coordinates, overlay }: OverlayCreateFiguresCallbackParams<unknown>): OverlayFigure[] => {
      if (coordinates.length < 2) return [solidLine(coordinates)];
      const color = resolveLineColor(overlay.styles, INK_600);
      const fill = resolvePolygonColor(overlay.styles, SKY_FILL);
      return [fillPolygon(coordinates, fill, color, 1.2)];
    },
  });

  // ── arcShape — 3pt: quadratic-bezier arc from P0 to P2, curving through ─
  // control point P1.
  registerOverlay({
    name: "arcShape",
    totalStep: 4,
    needDefaultPointFigure: true,
    needDefaultXAxisFigure: true,
    needDefaultYAxisFigure: true,
    createPointFigures: ({ coordinates, overlay }: OverlayCreateFiguresCallbackParams<unknown>): OverlayFigure[] => {
      if (coordinates.length < 2) return [solidLine(coordinates)];
      const color = resolveLineColor(overlay.styles, INK_600);
      const [p0, p1, p2] = coordinates;
      const end = p2 ?? p1;
      const ctrl = p2 ? p1 : { x: (p0.x + p1.x) / 2, y: (p0.y + p1.y) / 2 };
      const path = `M ${p0.x} ${p0.y} Q ${ctrl.x} ${ctrl.y} ${end.x} ${end.y}`;
      return [pathFigure(0, 0, path, color, { lineWidth: 1.6 })];
    },
  });

  // ── curve — 3pt quadratic PASS-THROUGH (the curve visits all 3 clicked ──
  // points, unlike arcShape where P1 is a control point, not a waypoint).
  // Bezier-at-t=0.5-equals-P1 solved algebraically: ctrl = 2*P1 - 0.5*P0 -
  // 0.5*P2.
  registerOverlay({
    name: "curve",
    totalStep: 4,
    needDefaultPointFigure: true,
    needDefaultXAxisFigure: true,
    needDefaultYAxisFigure: true,
    createPointFigures: ({ coordinates, overlay }: OverlayCreateFiguresCallbackParams<unknown>): OverlayFigure[] => {
      if (coordinates.length < 2) return [solidLine(coordinates)];
      const color = resolveLineColor(overlay.styles, INK_600);
      const [p0, p1, p2] = coordinates;
      if (!p2) return [solidLine([p0, p1], color)];
      const ctrl = { x: 2 * p1.x - 0.5 * p0.x - 0.5 * p2.x, y: 2 * p1.y - 0.5 * p0.y - 0.5 * p2.y };
      const path = `M ${p0.x} ${p0.y} Q ${ctrl.x} ${ctrl.y} ${p2.x} ${p2.y}`;
      return [pathFigure(0, 0, path, color, { lineWidth: 1.6 })];
    },
  });

  // ── doubleCurve — 4pt cubic bezier: P0/P3 endpoints, P1/P2 control ──────
  // points.
  registerOverlay({
    name: "doubleCurve",
    totalStep: 5,
    needDefaultPointFigure: true,
    needDefaultXAxisFigure: true,
    needDefaultYAxisFigure: true,
    createPointFigures: ({ coordinates, overlay }: OverlayCreateFiguresCallbackParams<unknown>): OverlayFigure[] => {
      if (coordinates.length < 2) return [solidLine(coordinates)];
      const color = resolveLineColor(overlay.styles, INK_600);
      if (coordinates.length < 4) return [dashedLine(coordinates, color)];
      const [p0, p1, p2, p3] = coordinates;
      const path = `M ${p0.x} ${p0.y} C ${p1.x} ${p1.y} ${p2.x} ${p2.y} ${p3.x} ${p3.y}`;
      return [pathFigure(0, 0, path, color, { lineWidth: 1.6 })];
    },
  });

  // ── polyline — fixed 5 anchors (klinecharts has no finish-on-click; ────
  // `brush` covers freeform, per D3), totalStep 6.
  registerOverlay({
    name: "polyline",
    totalStep: 6,
    needDefaultPointFigure: true,
    needDefaultXAxisFigure: true,
    needDefaultYAxisFigure: true,
    createPointFigures: ({ coordinates, overlay }: OverlayCreateFiguresCallbackParams<unknown>): OverlayFigure[] => {
      if (coordinates.length < 2) return [];
      const color = resolveLineColor(overlay.styles, INK_600);
      const figures: OverlayFigure[] = [];
      for (let i = 1; i < coordinates.length; i++) figures.push(solidLine([coordinates[i - 1], coordinates[i]], color, 1.4));
      return figures;
    },
  });

  // ── arrowMarker — 2pt: ONE thick filled arrow polygon (shaft + head), ───
  // wider-bodied than the pre-existing thin-line-plus-barbs `arrow`
  // (`legacy-shapes.ts`) per the brief's own explicit contrast. `atan2`
  // direction + a perpendicular unit vector, same quadrant-safe technique
  // `arrow` itself established, just building a single closed polygon
  // instead of a line + separate barb triangle. Stats pill (2026-08-05
  // founder-feedback pass) — same Δ/%/bar-count content + draw-OR-selected
  // visibility as `arrow`/`segment`/`rayLine`/`straightLine`.
  registerOverlay({
    name: "arrowMarker",
    totalStep: 3,
    needDefaultPointFigure: true,
    needDefaultXAxisFigure: true,
    needDefaultYAxisFigure: true,
    ...trackOverlaySelection,
    createPointFigures: ({ coordinates, overlay, xAxis }: OverlayCreateFiguresCallbackParams<unknown>): OverlayFigure[] => {
      if (coordinates.length < 2) return [];
      const color = resolveLineColor(overlay.styles, INK_600);
      const [p0, p1] = coordinates;
      const len = Math.hypot(p1.x - p0.x, p1.y - p0.y) || 1;
      const ux = (p1.x - p0.x) / len;
      const uy = (p1.y - p0.y) / len;
      const perpX = -uy;
      const perpY = ux;
      const shaftHalfWidth = 4;
      const headLength = Math.min(18, len * 0.6);
      const headHalfWidth = 9;
      const shaftEnd: Coordinate = { x: p1.x - ux * headLength, y: p1.y - uy * headLength };
      const offset = (base: Coordinate, halfWidth: number, sign: 1 | -1): Coordinate => ({
        x: base.x + sign * perpX * halfWidth,
        y: base.y + sign * perpY * halfWidth,
      });
      const polygon: Coordinate[] = [
        offset(p0, shaftHalfWidth, 1),
        offset(shaftEnd, shaftHalfWidth, 1),
        offset(shaftEnd, headHalfWidth, 1),
        p1,
        offset(shaftEnd, headHalfWidth, -1),
        offset(shaftEnd, shaftHalfWidth, -1),
        offset(p0, shaftHalfWidth, -1),
      ];
      const figures: OverlayFigure[] = [fillPolygon(polygon, color, color, 1)];
      if (isStatsPillVisible(overlay)) {
        const v0 = overlay.points[0]?.value ?? 0;
        const v1 = overlay.points[1]?.value ?? 0;
        const dataIndex0 = pixelXToDataIndex(xAxis, p0.x);
        const dataIndex1 = pixelXToDataIndex(xAxis, p1.x);
        const { text, positive } = buildDeltaStatsText(v0, v1, dataIndex0, dataIndex1);
        figures.push(labelFigure(midpoint(p0, p1), text, { background: positive ? EMERALD : ROSE }));
      }
      return figures;
    },
  });

  // ── circleShape — 2pt: plain center→edge circle. The `fibCircle` tool ───
  // draws CONCENTRIC fib-fraction circles; this is the single, plain,
  // stroke_fill circle TradingView ships that this workbench never had.
  registerOverlay({
    name: "circleShape",
    totalStep: 3,
    needDefaultPointFigure: true,
    needDefaultXAxisFigure: true,
    needDefaultYAxisFigure: true,
    createPointFigures: ({ coordinates, overlay }: OverlayCreateFiguresCallbackParams<unknown>): OverlayFigure[] => {
      if (coordinates.length < 2) return [];
      const color = resolveLineColor(overlay.styles, INK_600);
      const fill = resolvePolygonColor(overlay.styles, SKY_FILL);
      const [center, edge] = coordinates;
      const radius = Math.hypot(edge.x - center.x, edge.y - center.y) || 1;
      return [circleFigure(center.x, center.y, radius, color, { fill, size: 1.4 })];
    },
  });

  // ── pathLine — up to 6 anchors (totalStep 7, same "fixed anchor count, ──
  // no finish-on-click" convention `polyline` established per D3) + a
  // filled arrowhead at the LAST point, oriented along the final segment's
  // own direction (falls back to the first→only segment while fewer than 2
  // points exist).
  registerOverlay({
    name: "pathLine",
    totalStep: 7,
    needDefaultPointFigure: true,
    needDefaultXAxisFigure: true,
    needDefaultYAxisFigure: true,
    createPointFigures: ({ coordinates, overlay }: OverlayCreateFiguresCallbackParams<unknown>): OverlayFigure[] => {
      if (coordinates.length < 2) return [];
      const color = resolveLineColor(overlay.styles, INK_600);
      const figures: OverlayFigure[] = [];
      for (let i = 1; i < coordinates.length; i++) figures.push(solidLine([coordinates[i - 1], coordinates[i]], color, 1.4));
      const last = coordinates[coordinates.length - 1];
      const prev = coordinates[coordinates.length - 2];
      const angle = Math.atan2(last.y - prev.y, last.x - prev.x);
      const headLength = 12;
      const headAngle = Math.PI / 7;
      const backAngle = angle + Math.PI;
      const leftBarb: Coordinate = { x: last.x + headLength * Math.cos(backAngle - headAngle), y: last.y + headLength * Math.sin(backAngle - headAngle) };
      const rightBarb: Coordinate = { x: last.x + headLength * Math.cos(backAngle + headAngle), y: last.y + headLength * Math.sin(backAngle + headAngle) };
      figures.push(fillPolygon([last, leftBarb, rightBarb], color, color, 1));
      return figures;
    },
  });
}
