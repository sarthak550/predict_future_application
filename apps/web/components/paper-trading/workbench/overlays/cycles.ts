/**
 * Founder-feedback pass (2026-08-03), Part 2 — the new **Cycles** family (3
 * tools, `tool-registry.ts`'s own explicit "new family Cycles, rail icon"
 * instruction — the one family this pass adds outright rather than folding
 * into an existing one).
 *
 * All 3 take the same 2-point (P0 origin, P1 spacing-reference) shape and
 * repeat SOMETHING at a fixed Δ across the pane, capped at `MAX_REPEATS` (30
 * — the brief's own "k up to a sane cap ~30") so a user dragging a
 * near-zero spacing can never trigger an unbounded figure array.
 *
 * `cyclicLines` uses **dataIndex** spacing (Δ = bar count between the two
 * anchors, via `figure-kit.ts`'s `pixelXToDataIndex` — the same
 * zoom/calendar-gap-immune convention `dateRange`/`fibTimezone` established
 * in S1) per the brief's own explicit "Δ = dataIndex spacing" wording.
 * `timeCycles`/`sineLine` instead use raw PIXEL Δx (the brief's own literal
 * "width Δ along the time axis" / "wavelength = 2·Δx pixels") — a
 * deliberate, brief-directed split: one tool is bar-anchored (so it reads
 * the same after a zoom), the other two are pixel-anchored (so their
 * geometry matches literally what the user dragged on screen), matching
 * `trendAngle`'s (`lines.ts`) identical pixel-vs-dataIndex split rationale.
 */
import { registerOverlay, type Coordinate, type OverlayFigure, type OverlayCreateFiguresCallbackParams } from "klinecharts";
import { dashedLine, solidLine, arcFigure, resolveLineColor, pixelXToDataIndex, dataIndexToPixelX, INK_400, SKY, TEAL } from "./figure-kit";

const MAX_REPEATS = 30;

export function registerCycleOverlays(): void {
  // ── cyclicLines — verticals at p0 + k·Δ (dataIndex space), k=0..30. ─────
  registerOverlay({
    name: "cyclicLines",
    totalStep: 3,
    needDefaultPointFigure: true,
    needDefaultXAxisFigure: true,
    needDefaultYAxisFigure: true,
    createPointFigures: ({ coordinates, bounding, overlay, xAxis }: OverlayCreateFiguresCallbackParams<unknown>): OverlayFigure[] => {
      if (coordinates.length < 2) return [dashedLine(coordinates)];
      const color = resolveLineColor(overlay.styles, INK_400);
      const [p0, p1] = coordinates;
      const dataIndex0 = pixelXToDataIndex(xAxis, p0.x);
      const dataIndex1 = pixelXToDataIndex(xAxis, p1.x);
      const delta = dataIndex1 - dataIndex0;
      const figures: OverlayFigure[] = [];
      // A pixel-space cutoff (3x pane width, same margin `fibTimezone` uses)
      // so a large-magnitude Δ still terminates well before MAX_REPEATS if
      // it would already be far off-screen.
      const maxX = bounding.width * 3;
      const minX = -bounding.width * 2;
      for (let k = 0; k <= MAX_REPEATS; k++) {
        const x = Math.abs(delta) < 1e-6 ? (k === 0 ? p0.x : NaN) : dataIndexToPixelX(xAxis, dataIndex0 + k * delta, p0.x);
        if (!Number.isFinite(x) || x > maxX || x < minX) break;
        figures.push(dashedLine([{ x, y: 0 }, { x, y: bounding.height }], color, 1));
      }
      return figures;
    },
  });

  // ── timeCycles — repeating semicircle arcs of pixel-width Δx, sitting ──
  // on the p0.value baseline.
  registerOverlay({
    name: "timeCycles",
    totalStep: 3,
    needDefaultPointFigure: true,
    needDefaultXAxisFigure: true,
    needDefaultYAxisFigure: true,
    createPointFigures: ({ coordinates, bounding, overlay }: OverlayCreateFiguresCallbackParams<unknown>): OverlayFigure[] => {
      if (coordinates.length < 2) return [dashedLine(coordinates)];
      const color = resolveLineColor(overlay.styles, SKY);
      const [p0, p1] = coordinates;
      const rawStep = p1.x - p0.x;
      if (Math.abs(rawStep) < 1e-6) return [dashedLine(coordinates)];
      const step = Math.abs(rawStep);
      const direction = rawStep >= 0 ? 1 : -1;
      const baselineY = p0.y;
      const figures: OverlayFigure[] = [];
      for (let k = 0; k < MAX_REPEATS; k++) {
        const centerX = p0.x + direction * (k + 0.5) * step;
        if (direction > 0 ? centerX > bounding.width + step : centerX < -step) break;
        figures.push(arcFigure(centerX, baselineY, step / 2, Math.PI, 2 * Math.PI, color, 1.2));
      }
      return figures;
    },
  });

  // ── sineLine — sine wave: wavelength 2·Δx px, amplitude Δy px, phase ────
  // referenced at p0 (p0 sits at phase 0, p1 sits at the quarter-period
  // mark — both anchor points lie exactly ON the drawn curve by
  // construction). Sampled every 4px across the full pane width into ONE
  // polyline `solidLine` figure (klinecharts' built-in `line` figure draws
  // a true multi-point polyline for `coordinates.length > 2` — verified
  // against `dist/index.esm.js`'s `drawLine`, not just assumed).
  registerOverlay({
    name: "sineLine",
    totalStep: 3,
    needDefaultPointFigure: true,
    needDefaultXAxisFigure: true,
    needDefaultYAxisFigure: true,
    createPointFigures: ({ coordinates, bounding, overlay }: OverlayCreateFiguresCallbackParams<unknown>): OverlayFigure[] => {
      if (coordinates.length < 2) return [dashedLine(coordinates)];
      const color = resolveLineColor(overlay.styles, TEAL);
      const [p0, p1] = coordinates;
      const wavelength = 2 * (p1.x - p0.x);
      const amplitude = p1.y - p0.y;
      if (Math.abs(wavelength) < 1e-6) return [dashedLine(coordinates)];
      const points: Coordinate[] = [];
      const step = 4;
      for (let x = 0; x <= bounding.width; x += step) {
        const y = p0.y + amplitude * Math.sin((2 * Math.PI * (x - p0.x)) / wavelength);
        points.push({ x, y });
      }
      return [solidLine(points, color, 1.4)];
    },
  });
}
