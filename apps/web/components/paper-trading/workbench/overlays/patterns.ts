/**
 * TA Suite Sprint S1, T3 — the 9 pattern/Elliott tools. Two families share
 * one shape: a labeled zigzag polyline (`buildLabeledZigzag`) covers
 * `cypher`, `threeDrives`, and all 5 Elliott variants (the point count and
 * label sequence differ per tool, the rendering doesn't); `headAndShoulders`
 * and `trianglePattern` get their own geometry since they draw a fitted
 * neckline / converging trendlines respectively, not a plain zigzag.
 */
import { registerOverlay, type Coordinate, type OverlayFigure, type OverlayCreateFiguresCallbackParams } from "klinecharts";
import { solidLine, dashedLine, extendToRightEdge, fillPolygon, resolveLineColor, resolvePolygonColor, labelFigure, formatPercentLabel, INK_600, SKY, SKY_FILL, AMBER } from "./figure-kit";

function circledLabel(point: Coordinate, text: string, color: string): OverlayFigure {
  return labelFigure(point, text, { background: color, dy: 16 });
}

/** A sequential zigzag connecting every anchor point in click order, one circled label per point — the shared shape for cypher/threeDrives/elliott*. */
function buildLabeledZigzag(labels: string[], color: string) {
  return ({ coordinates }: OverlayCreateFiguresCallbackParams<unknown>): OverlayFigure[] => {
    if (coordinates.length < 2) return [];
    const figures: OverlayFigure[] = [];
    for (let i = 1; i < coordinates.length; i++) {
      figures.push(solidLine([coordinates[i - 1], coordinates[i]], color, 1.4));
    }
    coordinates.forEach((point, i) => {
      figures.push(circledLabel(point, labels[i] ?? String(i), color));
    });
    return figures;
  };
}

/** Value-space ratio labels at each leg's midpoint — cypher's own acceptance criterion ("ratio labels in VALUE space", not pixel-distance ratios). Ratio is each leg's |Δvalue| relative to the FIRST leg's |Δvalue|. */
function buildRatioLabeledZigzag(labels: string[], color: string) {
  return ({ coordinates, overlay }: OverlayCreateFiguresCallbackParams<unknown>): OverlayFigure[] => {
    if (coordinates.length < 2) return [];
    const figures: OverlayFigure[] = [];
    const values = overlay.points.map((p) => p.value ?? 0);
    const firstLeg = Math.abs((values[1] ?? 0) - (values[0] ?? 0)) || 1;
    for (let i = 1; i < coordinates.length; i++) {
      const p0 = coordinates[i - 1];
      const p1 = coordinates[i];
      figures.push(solidLine([p0, p1], color, 1.4));
      const legValue = Math.abs((values[i] ?? 0) - (values[i - 1] ?? 0));
      const mid = { x: (p0.x + p1.x) / 2, y: (p0.y + p1.y) / 2 };
      figures.push(labelFigure(mid, formatPercentLabel(legValue / firstLeg), { background: color, dy: 10 }));
    }
    coordinates.forEach((point, i) => figures.push(circledLabel(point, labels[i] ?? String(i), color)));
    return figures;
  };
}

export function registerPatternOverlays(): void {
  // ── cypher — 5pt (X,A,B,C,D), totalStep 6. Ratio labels in value space. ─
  registerOverlay({
    name: "cypher",
    totalStep: 6,
    needDefaultPointFigure: true,
    needDefaultXAxisFigure: true,
    needDefaultYAxisFigure: true,
    createPointFigures: buildRatioLabeledZigzag(["X", "A", "B", "C", "D"], AMBER),
  });

  // ── threeDrives — 7pt (0,A,1,B,2,C,3), totalStep 8. ─────────────────────
  registerOverlay({
    name: "threeDrives",
    totalStep: 8,
    needDefaultPointFigure: true,
    needDefaultXAxisFigure: true,
    needDefaultYAxisFigure: true,
    createPointFigures: buildLabeledZigzag(["0", "A", "1", "B", "2", "C", "3"], INK_600),
  });

  // ── headAndShoulders — 7pt (baseline, L-shoulder, L-trough, head, ──────
  // R-trough, R-shoulder, baseline), totalStep 8. Neckline = a genuinely
  // FITTED dashed line through the two troughs (P2, P4) — not a fixed
  // slope — extended across the full pattern width.
  registerOverlay({
    name: "headAndShoulders",
    totalStep: 8,
    needDefaultPointFigure: true,
    needDefaultXAxisFigure: true,
    needDefaultYAxisFigure: true,
    createPointFigures: ({ coordinates, bounding, overlay }: OverlayCreateFiguresCallbackParams<unknown>): OverlayFigure[] => {
      if (coordinates.length < 2) return [];
      const color = resolveLineColor(overlay.styles, INK_600);
      const figures: OverlayFigure[] = [];
      for (let i = 1; i < coordinates.length; i++) figures.push(solidLine([coordinates[i - 1], coordinates[i]], color, 1.4));
      const labels = ["", "LS", "L-trough", "Head", "R-trough", "RS", ""];
      coordinates.forEach((point, i) => {
        if (labels[i]) figures.push(circledLabel(point, labels[i], color));
      });
      if (coordinates.length >= 5) {
        const leftTrough = coordinates[2];
        const rightTrough = coordinates[4];
        const necklineFar = extendToRightEdge(leftTrough, rightTrough, bounding.width);
        figures.push(dashedLine([leftTrough, necklineFar], color, 1.6));
      }
      return figures;
    },
  });

  // ── trianglePattern — 4pt (upper1, upper2, lower1, lower2), totalStep 5. ─
  // 2 converging trendlines extended right + a translucent wedge fill
  // between them.
  registerOverlay({
    name: "trianglePattern",
    totalStep: 5,
    needDefaultPointFigure: true,
    needDefaultXAxisFigure: true,
    needDefaultYAxisFigure: true,
    createPointFigures: ({ coordinates, bounding, overlay }: OverlayCreateFiguresCallbackParams<unknown>): OverlayFigure[] => {
      if (coordinates.length < 2) return [];
      if (coordinates.length < 4) return [solidLine(coordinates.slice(0, 2), resolveLineColor(overlay.styles, INK_600), 1)];
      const color = resolveLineColor(overlay.styles, INK_600);
      const fill = resolvePolygonColor(overlay.styles, SKY_FILL);
      const [u0, u1, l0, l1] = coordinates;
      const rightX = bounding.width;
      const upperFar = extendToRightEdge(u0, u1, rightX);
      const lowerFar = extendToRightEdge(l0, l1, rightX);
      return [
        fillPolygon([u0, upperFar, lowerFar, l0], fill, color, 1),
        solidLine([u0, upperFar], color, 1.4),
        solidLine([l0, lowerFar], color, 1.4),
      ];
    },
  });

  // ── Elliott wave variants — all labeled zigzags, point count + labels ───
  // per the plan's documented sequence.
  registerOverlay({
    name: "elliottImpulse",
    totalStep: 7,
    needDefaultPointFigure: true,
    needDefaultXAxisFigure: true,
    needDefaultYAxisFigure: true,
    createPointFigures: buildLabeledZigzag(["0", "1", "2", "3", "4", "5"], SKY),
  });
  registerOverlay({
    name: "elliottCorrection",
    totalStep: 5,
    needDefaultPointFigure: true,
    needDefaultXAxisFigure: true,
    needDefaultYAxisFigure: true,
    createPointFigures: buildLabeledZigzag(["0", "A", "B", "C"], "#e11d48"),
  });
  registerOverlay({
    name: "elliottTriangle",
    totalStep: 7,
    needDefaultPointFigure: true,
    needDefaultXAxisFigure: true,
    needDefaultYAxisFigure: true,
    createPointFigures: buildLabeledZigzag(["0", "A", "B", "C", "D", "E"], "#7c3aed"),
  });
  registerOverlay({
    name: "elliottDoubleCombo",
    totalStep: 5,
    needDefaultPointFigure: true,
    needDefaultXAxisFigure: true,
    needDefaultYAxisFigure: true,
    createPointFigures: buildLabeledZigzag(["0", "W", "X", "Y"], "#059669"),
  });
  registerOverlay({
    name: "elliottTripleCombo",
    totalStep: 7,
    needDefaultPointFigure: true,
    needDefaultXAxisFigure: true,
    needDefaultYAxisFigure: true,
    createPointFigures: buildLabeledZigzag(["0", "W", "X", "Y", "X", "Z"], "#d97706"),
  });
}
