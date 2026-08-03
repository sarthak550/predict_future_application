/**
 * TA Suite Sprint S1, T3 — the 9 pattern/Elliott tools. Two families share
 * one shape: a labeled zigzag polyline (`buildLabeledZigzag`) covers
 * `cypher`, `threeDrives`, and all 5 Elliott variants (the point count and
 * label sequence differ per tool, the rendering doesn't); `headAndShoulders`
 * and `trianglePattern` get their own geometry since they draw a fitted
 * neckline / converging trendlines respectively, not a plain zigzag.
 */
import { registerOverlay, type Coordinate, type OverlayFigure, type OverlayCreateFiguresCallbackParams } from "klinecharts";
import {
  solidLine,
  dashedLine,
  extendToRightEdge,
  fillPolygon,
  resolveLineColor,
  resolvePolygonColor,
  labelFigure,
  midpoint,
  formatRupeesLabel,
  formatRatioLabel,
  computeCypherRatios,
  computeAdjacentLegRatios,
  INK_600,
  SKY,
  SKY_FILL,
  AMBER,
} from "./figure-kit";

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

export function registerPatternOverlays(): void {
  // ── cypher — 5pt (X,A,B,C,D), totalStep 6. Ratio labels in VALUE space —
  // bespoke createPointFigures (not the shared `buildLabeledZigzag`, and no
  // longer the deleted `buildRatioLabeledZigzag`) since, per the corrected
  // Cypher convention, each point's ratio is measured against a DIFFERENT
  // base leg, not one uniform reference:
  //
  //   Tool-values-gap-fixes brief, T4.1 — CORRECTNESS FIX. The old code
  //   divided every leg by the FIRST leg (XA) — right for B, WRONG for C
  //   and D. See `figure-kit.ts`'s `computeCypherRatios` doc for the full
  //   worked example (X=100,A=150,B=130,C=180,D=140 → B=0.400, C=2.500,
  //   D=0.500, hand-verified and asserted in `lib/ta/selfcheck.ts`).
  //   X→A itself is the reference leg and gets no ratio label (a "1.000"
  //   there would be redundant).
  registerOverlay({
    name: "cypher",
    totalStep: 6,
    needDefaultPointFigure: true,
    needDefaultXAxisFigure: true,
    needDefaultYAxisFigure: true,
    createPointFigures: ({ coordinates, overlay }: OverlayCreateFiguresCallbackParams<unknown>): OverlayFigure[] => {
      if (coordinates.length < 2) return [];
      const color = AMBER;
      const [x, a, b, c, d] = coordinates;
      const values = overlay.points.map((p) => p.value ?? 0);
      const ratios = computeCypherRatios(values);
      const figures: OverlayFigure[] = [solidLine([x, a], color, 1.4), circledLabel(x, "X", color), circledLabel(a, "A", color)];
      if (coordinates.length >= 3) {
        figures.push(solidLine([a, b], color, 1.4), circledLabel(b, "B", color));
        figures.push(labelFigure(midpoint(a, b), `B ${formatRatioLabel(ratios.b)}`, { background: color, dy: 10 }));
      }
      if (coordinates.length >= 4) {
        figures.push(solidLine([b, c], color, 1.4), circledLabel(c, "C", color));
        figures.push(labelFigure(midpoint(b, c), `C ${formatRatioLabel(ratios.c)}`, { background: color, dy: 10 }));
      }
      if (coordinates.length >= 5) {
        figures.push(solidLine([c, d], color, 1.4), circledLabel(d, "D", color));
        figures.push(labelFigure(midpoint(c, d), `D ${formatRatioLabel(ratios.d)}`, { background: color, dy: 10 }));
      }
      return figures;
    },
  });

  // ── threeDrives — 7pt (0,A,1,B,2,C,3), totalStep 8. Point labels via the ─
  // shared zigzag geometry, PLUS (Tool-values-gap-fixes brief, T4.2) a
  // per-leg ratio label — a pattern tool whose whole purpose is validating
  // ratios was previously shipping with zero of them. Each leg validates
  // against its OWN immediately preceding leg (see `figure-kit.ts`'s
  // `computeAdjacentLegRatios` doc), NOT a single fixed reference leg like
  // `cypher` above — the first leg (0→A) has no predecessor and gets no
  // ratio, matching `abcd`'s own established convention. Ratio labels reuse
  // `formatRatioLabel` (3-decimal), same as `abcd`/`xabcd`/`cypher`.
  registerOverlay({
    name: "threeDrives",
    totalStep: 8,
    needDefaultPointFigure: true,
    needDefaultXAxisFigure: true,
    needDefaultYAxisFigure: true,
    createPointFigures: ({ coordinates, overlay }: OverlayCreateFiguresCallbackParams<unknown>): OverlayFigure[] => {
      if (coordinates.length < 2) return [];
      const color = INK_600;
      const labels = ["0", "A", "1", "B", "2", "C", "3"];
      const figures: OverlayFigure[] = [];
      for (let i = 1; i < coordinates.length; i++) {
        figures.push(solidLine([coordinates[i - 1], coordinates[i]], color, 1.4));
      }
      coordinates.forEach((point, i) => figures.push(circledLabel(point, labels[i] ?? String(i), color)));
      const values = overlay.points.map((p) => p.value ?? 0);
      const ratios = computeAdjacentLegRatios(values);
      for (let i = 2; i < coordinates.length; i++) {
        const ratio = ratios[i - 2];
        if (ratio === undefined) continue;
        figures.push(labelFigure(midpoint(coordinates[i - 1], coordinates[i]), formatRatioLabel(ratio), { background: AMBER, dy: 10 }));
      }
      return figures;
    },
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

        // Founder feedback (2026-08-04) — measured-move target: the classic,
        // cheap-and-honest H&S read. Mirrors the head's own excess above (or
        // below, for an inverse pattern — sign-correct by construction)
        // the FITTED neckline — interpolated at the head's own x, in the
        // same pixel-fraction space the neckline geometry above already
        // uses — by that same distance on the opposite side. Value-space,
        // never invented.
        const values = overlay.points.map((p) => p.value ?? 0);
        const headPx = coordinates[3];
        const headValue = values[3] ?? 0;
        const leftTroughValue = values[2] ?? 0;
        const rightTroughValue = values[4] ?? 0;
        const dx = rightTrough.x - leftTrough.x;
        const fraction = Math.abs(dx) < 1e-6 ? 0 : (headPx.x - leftTrough.x) / dx;
        const necklineValueAtHead = leftTroughValue + (rightTroughValue - leftTroughValue) * fraction;
        const necklineYAtHead = leftTrough.y + (rightTrough.y - leftTrough.y) * fraction;
        const targetValue = necklineValueAtHead - (headValue - necklineValueAtHead);
        const isTopping = headValue >= necklineValueAtHead;
        figures.push(
          labelFigure(
            { x: headPx.x, y: necklineYAtHead + (isTopping ? 26 : -26) },
            `Target ${formatRupeesLabel(targetValue)}`,
            { background: AMBER }
          )
        );
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
