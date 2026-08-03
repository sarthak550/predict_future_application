/**
 * TA Suite Sprint S1, T1 refactor — the 4 W3 custom shapes (`rect`, `arrow`,
 * `abcd`, `xabcd`), moved verbatim (geometry unchanged, hand-verified
 * working code) from the old `custom-overlays.ts` into this family file,
 * now sourcing their line/label/fill primitives from `figure-kit.ts`
 * instead of duplicating them locally. See git history / W3 memory
 * (`project_workbench_w3.md`) for the original design rationale — repeated
 * here only where it still applies.
 *
 * All 4 use `needDefaultPointFigure: true` (native draggable anchor
 * handles) and render progressively at 2..N-1 points, same as every real
 * built-in multi-point template.
 */
import { registerOverlay, type Coordinate, type OverlayFigure, type OverlayCreateFiguresCallbackParams } from "klinecharts";
import {
  labelFigure,
  solidLine,
  dashedLine,
  fillPolygon,
  resolveLineColor,
  resolvePolygonColor,
  resolvePolygonBorderColor,
  midpoint,
  formatRatioLabel,
  INK_400,
  INK_600,
  SKY_FILL,
  TEAL_FILL,
  TEAL_BORDER,
  AMBER,
  VIOLET
} from "./figure-kit";

export function registerLegacyShapeOverlays(): void {
  // ── rect — 2 anchors (opposite corners), totalStep 3. ────────────────
  registerOverlay({
    name: "rect",
    totalStep: 3,
    needDefaultPointFigure: true,
    needDefaultXAxisFigure: true,
    needDefaultYAxisFigure: true,
    createPointFigures: ({ coordinates, overlay }: OverlayCreateFiguresCallbackParams<unknown>): OverlayFigure[] => {
      if (coordinates.length < 2) return [];
      const [p0, p1] = coordinates;
      const x0 = Math.min(p0.x, p1.x);
      const x1 = Math.max(p0.x, p1.x);
      const y0 = Math.min(p0.y, p1.y);
      const y1 = Math.max(p0.y, p1.y);
      return [
        fillPolygon(
          [
            { x: x0, y: y0 },
            { x: x1, y: y0 },
            { x: x1, y: y1 },
            { x: x0, y: y1 },
          ],
          resolvePolygonColor(overlay.styles, SKY_FILL),
          resolvePolygonBorderColor(overlay.styles, INK_400),
        ),
      ];
    },
  });

  // ── arrow — 2 anchors (start, end), totalStep 3. atan2 barb, ─────────
  // quadrant-safe by construction.
  registerOverlay({
    name: "arrow",
    totalStep: 3,
    needDefaultPointFigure: true,
    needDefaultXAxisFigure: true,
    needDefaultYAxisFigure: true,
    createPointFigures: ({ coordinates, overlay }: OverlayCreateFiguresCallbackParams<unknown>): OverlayFigure[] => {
      if (coordinates.length < 2) return [];
      const [p0, p1] = coordinates;
      const color = resolveLineColor(overlay.styles, INK_600);
      const angle = Math.atan2(p1.y - p0.y, p1.x - p0.x);
      const barbLength = 12;
      const barbAngle = Math.PI / 7;
      const backAngle = angle + Math.PI;
      const leftBarb: Coordinate = {
        x: p1.x + barbLength * Math.cos(backAngle - barbAngle),
        y: p1.y + barbLength * Math.sin(backAngle - barbAngle),
      };
      const rightBarb: Coordinate = {
        x: p1.x + barbLength * Math.cos(backAngle + barbAngle),
        y: p1.y + barbLength * Math.sin(backAngle + barbAngle),
      };
      return [
        solidLine([p0, p1], color),
        {
          type: "polygon",
          attrs: { coordinates: [p1, leftBarb, rightBarb] },
          styles: { style: "stroke_fill", color, borderColor: color, borderSize: 1, borderStyle: "solid" },
        },
      ];
    },
  });

  // ── abcd — 4 anchors (A,B,C,D), totalStep 5. Solid A-B/B-C, dashed ────
  // A-C/B-D diagonals (no C-D leg — founder-locked spec).
  //
  // **Founder feedback (2026-08-04) — value-space ratio labels**: TradingView
  // shows the BC/AB retracement ratio at BC's own midpoint and the CD/BC
  // ratio at CD's midpoint (3-decimal, e.g. `0.618`) — matches `cypher`'s own
  // established `formatRatioLabel`/value-space convention (see this file's
  // sibling `patterns.ts`), computed off `overlay.points[i].value` (real
  // anchor prices), never pixel distance.
  registerOverlay({
    name: "abcd",
    totalStep: 5,
    needDefaultPointFigure: true,
    needDefaultXAxisFigure: true,
    needDefaultYAxisFigure: true,
    createPointFigures: ({ coordinates, overlay }: OverlayCreateFiguresCallbackParams<unknown>): OverlayFigure[] => {
      if (coordinates.length < 2) return [];
      const color = resolveLineColor(overlay.styles, INK_600);
      const [a, b, c, d] = coordinates;
      const values = overlay.points.map((p) => p.value ?? 0);
      const figures: OverlayFigure[] = [solidLine([a, b], color), labelFigure(a, "A"), labelFigure(b, "B")];
      if (coordinates.length >= 3) {
        const abLen = Math.abs((values[1] ?? 0) - (values[0] ?? 0)) || 1;
        const bcLen = Math.abs((values[2] ?? 0) - (values[1] ?? 0));
        figures.push(solidLine([b, c], color), dashedLine([a, c]), labelFigure(c, "C"));
        figures.push(labelFigure(midpoint(b, c), formatRatioLabel(bcLen / abLen), { background: AMBER, dy: 10 }));
      }
      if (coordinates.length >= 4) {
        const bcLen = Math.abs((values[2] ?? 0) - (values[1] ?? 0)) || 1;
        const cdLen = Math.abs((values[3] ?? 0) - (values[2] ?? 0));
        figures.push(dashedLine([b, d]), labelFigure(d, "D"));
        figures.push(labelFigure(midpoint(c, d), formatRatioLabel(cdLen / bcLen), { background: AMBER, dy: 10 }));
      }
      return figures;
    },
  });

  // ── xabcd — 5 anchors (X,A,B,C,D), totalStep 6. Solid legs X-A/A-B/ ───
  // B-C/C-D, translucent X-A-B and B-C-D triangle fills, dashed X-B/B-D.
  //
  // **Founder feedback (2026-08-04) — value-space ratio labels**: B =
  // AB/XA retracement (at AB's midpoint), C = BC/AB (at BC's midpoint),
  // D = CD/BC (at CD's midpoint), plus the overall XAD completion ratio
  // (|AD|/|XA| — how far D sits beyond/short of the XA leg, the standard
  // harmonic-pattern "completion" read) labeled near D. All value-space,
  // 3-decimal, same `formatRatioLabel` convention as `abcd` above.
  registerOverlay({
    name: "xabcd",
    totalStep: 6,
    needDefaultPointFigure: true,
    needDefaultXAxisFigure: true,
    needDefaultYAxisFigure: true,
    createPointFigures: ({ coordinates, overlay }: OverlayCreateFiguresCallbackParams<unknown>): OverlayFigure[] => {
      if (coordinates.length < 2) return [];
      const color = resolveLineColor(overlay.styles, INK_600);
      const fill = resolvePolygonColor(overlay.styles, TEAL_FILL);
      const [x, a, b, c, d] = coordinates;
      const values = overlay.points.map((p) => p.value ?? 0);
      const xaLen = Math.abs((values[1] ?? 0) - (values[0] ?? 0)) || 1;
      const figures: OverlayFigure[] = [solidLine([x, a], color), labelFigure(x, "X"), labelFigure(a, "A")];
      if (coordinates.length >= 3) {
        const abLen = Math.abs((values[2] ?? 0) - (values[1] ?? 0));
        figures.push(solidLine([a, b], color), labelFigure(b, "B"), fillPolygon([x, a, b], fill, TEAL_BORDER), dashedLine([x, b]));
        figures.push(labelFigure(midpoint(a, b), `B ${formatRatioLabel(abLen / xaLen)}`, { background: VIOLET, dy: 10 }));
      }
      if (coordinates.length >= 4) {
        const abLen = Math.abs((values[2] ?? 0) - (values[1] ?? 0)) || 1;
        const bcLen = Math.abs((values[3] ?? 0) - (values[2] ?? 0));
        figures.push(solidLine([b, c], color), labelFigure(c, "C"));
        figures.push(labelFigure(midpoint(b, c), `C ${formatRatioLabel(bcLen / abLen)}`, { background: VIOLET, dy: 10 }));
      }
      if (coordinates.length >= 5) {
        const bcLen = Math.abs((values[3] ?? 0) - (values[2] ?? 0)) || 1;
        const cdLen = Math.abs((values[4] ?? 0) - (values[3] ?? 0));
        const adLen = Math.abs((values[4] ?? 0) - (values[1] ?? 0));
        figures.push(solidLine([c, d], color), labelFigure(d, "D"), fillPolygon([b, c, d], fill, TEAL_BORDER), dashedLine([b, d]));
        figures.push(labelFigure(midpoint(c, d), `D ${formatRatioLabel(cdLen / bcLen)}`, { background: VIOLET, dy: 10 }));
        figures.push(labelFigure(d, `XAD ${formatRatioLabel(adLen / xaLen)}`, { background: VIOLET, dy: 28 }));
      }
      return figures;
    },
  });
}
