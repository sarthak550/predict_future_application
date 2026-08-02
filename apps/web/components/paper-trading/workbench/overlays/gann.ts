/**
 * TA Suite Sprint S1, T3 — the 3 Gann tools, all 2-point (totalStep 3).
 *
 * `gannFan`'s 9 rays (1×8…8×1) are scaled by the SLOPE of the p0→p1 anchor
 * pair — the ticket's own acceptance criterion. Hand-check: the "1×1" ray
 * (ratio 1) must be the exact same line as the raw p0→p1 anchor, extended;
 * the "4×1" ray must be 4× steeper (slope multiplied by 4, not divided).
 */
import { registerOverlay, type Coordinate, type OverlayFigure, type OverlayCreateFiguresCallbackParams } from "klinecharts";
import { solidLine, dashedLine, fillPolygon, resolveLineColor, resolvePolygonColor, labelFigure, pixelXToDataIndex, formatRupeesLabel, SKY_FILL, AMBER } from "./figure-kit";

/** Classic Gann Fan ratios, label → slope multiplier relative to the 1×1 (p0→p1) line. */
const GANN_FAN_RATIOS: Array<{ label: string; multiplier: number }> = [
  { label: "1×8", multiplier: 1 / 8 },
  { label: "1×4", multiplier: 1 / 4 },
  { label: "1×3", multiplier: 1 / 3 },
  { label: "1×2", multiplier: 1 / 2 },
  { label: "1×1", multiplier: 1 },
  { label: "2×1", multiplier: 2 },
  { label: "3×1", multiplier: 3 },
  { label: "4×1", multiplier: 4 },
  { label: "8×1", multiplier: 8 },
];

export function registerGannOverlays(): void {
  // ── gannBox — rect + fraction grid (eighths), same visual language as ───
  // fibSpeedResistanceFan's grid but without the diagonal fan lines.
  registerOverlay({
    name: "gannBox",
    totalStep: 3,
    needDefaultPointFigure: true,
    needDefaultXAxisFigure: true,
    needDefaultYAxisFigure: true,
    createPointFigures: ({ coordinates, overlay }: OverlayCreateFiguresCallbackParams<unknown>): OverlayFigure[] => {
      if (coordinates.length < 2) return [];
      const color = resolveLineColor(overlay.styles, AMBER);
      const fill = resolvePolygonColor(overlay.styles, SKY_FILL);
      const [p0, p1] = coordinates;
      const x0 = Math.min(p0.x, p1.x);
      const x1 = Math.max(p0.x, p1.x);
      const y0 = Math.min(p0.y, p1.y);
      const y1 = Math.max(p0.y, p1.y);
      const figures: OverlayFigure[] = [
        fillPolygon([{ x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 }], fill, color, 1.2),
      ];
      for (let i = 1; i < 8; i++) {
        const fraction = i / 8;
        const vx = x0 + (x1 - x0) * fraction;
        const hy = y0 + (y1 - y0) * fraction;
        figures.push(dashedLine([{ x: vx, y: y0 }, { x: vx, y: y1 }], color, 0.8));
        figures.push(dashedLine([{ x: x0, y: hy }, { x: x1, y: hy }], color, 0.8));
      }
      return figures;
    },
  });

  // ── gannFan — 1×8…8×1 rays scaled by the p0→p1 slope. ───────────────────
  registerOverlay({
    name: "gannFan",
    totalStep: 3,
    needDefaultPointFigure: true,
    needDefaultXAxisFigure: true,
    needDefaultYAxisFigure: true,
    createPointFigures: ({ coordinates, bounding, overlay }: OverlayCreateFiguresCallbackParams<unknown>): OverlayFigure[] => {
      if (coordinates.length < 2) return [];
      const color = resolveLineColor(overlay.styles, AMBER);
      const [p0, p1] = coordinates;
      const dx = p1.x - p0.x;
      const baseSlope = Math.abs(dx) < 1e-6 ? 0 : (p1.y - p0.y) / dx;
      const rightX = dx >= 0 ? bounding.width : 0;
      const figures: OverlayFigure[] = [];
      for (const { label, multiplier } of GANN_FAN_RATIOS) {
        const slope = baseSlope * multiplier;
        const rayFar: Coordinate = { x: rightX, y: p0.y + slope * (rightX - p0.x) };
        const line = multiplier === 1 ? solidLine([p0, rayFar], color, 1.4) : dashedLine([p0, rayFar], color, 0.9);
        figures.push(line, labelFigure(rayFar, label, { background: color }));
      }
      return figures;
    },
  });

  // ── gannSquare — rect + both diagonals + a mid cross. ────────────────────
  registerOverlay({
    name: "gannSquare",
    totalStep: 3,
    needDefaultPointFigure: true,
    needDefaultXAxisFigure: true,
    needDefaultYAxisFigure: true,
    createPointFigures: ({ coordinates, overlay }: OverlayCreateFiguresCallbackParams<unknown>): OverlayFigure[] => {
      if (coordinates.length < 2) return [];
      const color = resolveLineColor(overlay.styles, AMBER);
      const fill = resolvePolygonColor(overlay.styles, SKY_FILL);
      const [p0, p1] = coordinates;
      const x0 = Math.min(p0.x, p1.x);
      const x1 = Math.max(p0.x, p1.x);
      const y0 = Math.min(p0.y, p1.y);
      const y1 = Math.max(p0.y, p1.y);
      const midX = (x0 + x1) / 2;
      const midY = (y0 + y1) / 2;
      return [
        fillPolygon([{ x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 }], fill, color, 1.2),
        dashedLine([{ x: x0, y: y0 }, { x: x1, y: y1 }], color),
        dashedLine([{ x: x1, y: y0 }, { x: x0, y: y1 }], color),
        solidLine([{ x: midX, y: y0 }, { x: midX, y: y1 }], color, 1),
        solidLine([{ x: x0, y: midY }, { x: x1, y: midY }], color, 1),
      ];
    },
  });

  // ── gannSquareFixed — like gannSquare, but the grid is genuinely SQUARE ──
  // in a FIXED price-per-bar scale computed once from the two anchors
  // (`pricePerBar = |Δprice| / |Δbars|`, dataIndex-based per this program's
  // usual convention), not merely a pixel-space rectangle subdivided into 8
  // arbitrary fractions like plain `gannSquare`. Grid divisions = the real
  // bar count between the anchors (the Gann "1 point per bar" square),
  // capped at `MAX_GRID_DIVISIONS` for render cost — the ₹/bar SCALE label
  // always reflects the TRUE (uncapped) bar count, so the label stays
  // honest even when the drawn grid itself is visually thinned out for a
  // very wide drag. **Honesty note**: this "square" is only square in the
  // scale defined by THESE two anchors — the same ₹-per-bar assumption
  // wouldn't hold for a different pair of clicks, which is exactly what the
  // label makes explicit rather than presenting the grid as some
  // universal/absolute Gann scale.
  registerOverlay({
    name: "gannSquareFixed",
    totalStep: 3,
    needDefaultPointFigure: true,
    needDefaultXAxisFigure: true,
    needDefaultYAxisFigure: true,
    createPointFigures: ({ coordinates, overlay, xAxis }: OverlayCreateFiguresCallbackParams<unknown>): OverlayFigure[] => {
      if (coordinates.length < 2) return [];
      const color = resolveLineColor(overlay.styles, AMBER);
      const fill = resolvePolygonColor(overlay.styles, SKY_FILL);
      const [p0, p1] = coordinates;
      const x0 = Math.min(p0.x, p1.x);
      const x1 = Math.max(p0.x, p1.x);
      const y0 = Math.min(p0.y, p1.y);
      const y1 = Math.max(p0.y, p1.y);

      const dataIndex0 = pixelXToDataIndex(xAxis, p0.x);
      const dataIndex1 = pixelXToDataIndex(xAxis, p1.x);
      const barCount = Math.max(1, Math.round(Math.abs(dataIndex1 - dataIndex0)));
      const v0 = overlay.points[0]?.value ?? 0;
      const v1 = overlay.points[1]?.value ?? 0;
      const priceRange = Math.abs(v1 - v0) || 1;
      const pricePerBar = priceRange / barCount;

      const MAX_GRID_DIVISIONS = 50;
      const divisions = Math.min(barCount, MAX_GRID_DIVISIONS);

      const figures: OverlayFigure[] = [
        fillPolygon([{ x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 }], fill, color, 1.2),
      ];
      for (let i = 1; i < divisions; i++) {
        const fraction = i / divisions;
        const vx = x0 + (x1 - x0) * fraction;
        const hy = y0 + (y1 - y0) * fraction;
        figures.push(dashedLine([{ x: vx, y: y0 }, { x: vx, y: y1 }], color, 0.7));
        figures.push(dashedLine([{ x: x0, y: hy }, { x: x1, y: hy }], color, 0.7));
      }
      figures.push(dashedLine([{ x: x0, y: y0 }, { x: x1, y: y1 }], color, 1));
      figures.push(dashedLine([{ x: x1, y: y0 }, { x: x0, y: y1 }], color, 1));
      figures.push(labelFigure({ x: x0, y: y0 }, `${formatRupeesLabel(pricePerBar)}/bar`, { align: "left", background: color }));
      return figures;
    },
  });
}
