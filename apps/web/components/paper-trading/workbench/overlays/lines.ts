/**
 * Founder-feedback pass (2026-08-03), Part 2 — the 6 new "Lines" family
 * tools (`infoLine`/`trendAngle`/`crossLine` plus the brief's "Channels"
 * group `regressionTrend`/`flatTopBottom`/`disjointChannel`, folded into
 * Lines rather than spun out as its own family per `tool-registry.ts`'s
 * module doc).
 *
 * **`trendAngle`'s angle is PIXEL-space `atan2`, not a true price/time
 * angle** — the brief's own explicit instruction ("angle from PIXEL-space
 * atan2 so it matches what the eye sees"). This means the displayed degrees
 * change if the user zooms or pans (bar width / price-axis scale changes
 * the pixel geometry of the SAME two anchor prices/timestamps) — a real,
 * documented limitation, not a bug: there is no zoom-invariant "true angle"
 * for a chart whose two axes (price, time) have unrelated, independently-
 * rescalable units, so every charting platform's "trend angle" tool is
 * fundamentally a pixel-space measurement dressed up as degrees. `dy` is
 * negated because canvas pixel-y grows DOWNWARD; without the negation an
 * upward-sloping (visually rising) line would report a NEGATIVE angle,
 * which reads as backwards to a human looking at the chart.
 *
 * **`regressionTrend` reads `chart.getDataList()`** (verified against
 * `dist/index.d.ts`'s `OverlayCreateFiguresCallbackParams<E>.chart: Chart`
 * and `Store.getDataList: () => KLineData[]`, the same `Chart` object
 * `ChartImp` exposes) — the ONE new tool in this pass that needs real bar
 * data, not just anchor-point pixel geometry. The bar RANGE is bounded by
 * the two anchors themselves (`pixelXToDataIndex` on each anchor's pixel x,
 * clamped to the loaded array), so this stays O(bars between the two
 * clicks), never O(all loaded history) — a user drawing a 2000-bar-wide
 * regression channel would still scan 2000 bars, same as dragging any other
 * multi-bar tool this wide; there is no unbounded/background work.
 * `linearRegression` below is a plain OLS fit (hand-verified against three
 * fixtures — an exact line, a symmetric-noise line, and a constant series —
 * via a throwaway `/tmp` script before shipping, same discipline as S2's
 * `lib/ta/math.ts` verification). The regression line and its ±2σ bands are
 * all mathematically straight lines over the anchored range, so each is
 * rendered as exactly ONE 2-point `solidLine`/`dashedLine` (endpoints at the
 * range's first/last bar) — no per-bar segment loop, O(1) figures for O(n)
 * math, recomputed fresh every render per the house perf law.
 */
import { registerOverlay, type Coordinate, type OverlayFigure, type OverlayCreateFiguresCallbackParams } from "klinecharts";
import {
  solidLine,
  dashedLine,
  fillPolygon,
  labelFigure,
  formatRupeesLabel,
  formatPercentLabel,
  resolveLineColor,
  pixelXToDataIndex,
  midpoint,
  SKY,
  SKY_FILL,
  VIOLET,
  INK_600,
} from "./figure-kit";

/** Plain ordinary-least-squares fit of `ys` against `x = 0..ys.length-1`, plus the residual standard deviation (population, ÷n — a descriptive "how wide is the scatter around this line" band, not an inferential/sample estimate). Returns all-zero for an empty input (never called that way in practice — `createPointFigures` always guards `coordinates.length` first — but total, never `NaN`, if it somehow were). */
function linearRegression(ys: number[]): { slope: number; intercept: number; sigma: number } {
  const n = ys.length;
  if (n === 0) return { slope: 0, intercept: 0, sigma: 0 };
  let sumX = 0;
  let sumY = 0;
  let sumXY = 0;
  let sumXX = 0;
  for (let i = 0; i < n; i++) {
    sumX += i;
    sumY += ys[i];
    sumXY += i * ys[i];
    sumXX += i * i;
  }
  const denom = n * sumXX - sumX * sumX;
  const slope = denom !== 0 ? (n * sumXY - sumX * sumY) / denom : 0;
  const intercept = (sumY - slope * sumX) / n;
  let sumSqResid = 0;
  for (let i = 0; i < n; i++) {
    const resid = ys[i] - (slope * i + intercept);
    sumSqResid += resid * resid;
  }
  return { slope, intercept, sigma: Math.sqrt(sumSqResid / n) };
}

export function registerLineOverlays(): void {
  // ── infoLine — 2pt: Δ₹, %, and bar count in one mid-line label. ────────
  registerOverlay({
    name: "infoLine",
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
      const mid = midpoint(p0, p1);
      return [
        solidLine([p0, p1], color, 1.4),
        labelFigure(mid, `${formatRupeesLabel(delta)} (${formatPercentLabel(pct)}) · ${bars} bar${bars === 1 ? "" : "s"}`, {
          background: delta >= 0 ? "#059669" : "#e11d48",
        }),
      ];
    },
  });

  // ── trendAngle — 2pt: line + PIXEL-space angle° label. See module doc ──
  // for why this is pixel-space (zoom-dependent), not a true price/time
  // angle, and why `dy` is negated.
  registerOverlay({
    name: "trendAngle",
    totalStep: 3,
    needDefaultPointFigure: true,
    needDefaultXAxisFigure: true,
    needDefaultYAxisFigure: true,
    createPointFigures: ({ coordinates, overlay }: OverlayCreateFiguresCallbackParams<unknown>): OverlayFigure[] => {
      if (coordinates.length < 2) return [];
      const color = resolveLineColor(overlay.styles, SKY);
      const [p0, p1] = coordinates;
      const angleDeg = (Math.atan2(-(p1.y - p0.y), p1.x - p0.x) * 180) / Math.PI;
      const mid = midpoint(p0, p1);
      return [solidLine([p0, p1], color, 1.4), labelFigure(mid, `${angleDeg.toFixed(1)}°`, { background: color })];
    },
  });

  // ── crossLine — 1pt: full-width horizontal + full-height vertical. ─────
  registerOverlay({
    name: "crossLine",
    totalStep: 2,
    needDefaultPointFigure: true,
    needDefaultXAxisFigure: true,
    needDefaultYAxisFigure: true,
    createPointFigures: ({ coordinates, bounding, overlay }: OverlayCreateFiguresCallbackParams<unknown>): OverlayFigure[] => {
      if (coordinates.length < 1) return [];
      const color = resolveLineColor(overlay.styles, INK_600);
      const [p0] = coordinates;
      return [
        dashedLine(
          [
            { x: 0, y: p0.y },
            { x: bounding.width, y: p0.y },
          ],
          color,
          1.2,
        ),
        dashedLine(
          [
            { x: p0.x, y: 0 },
            { x: p0.x, y: bounding.height },
          ],
          color,
          1.2,
        ),
      ];
    },
  });

  // ── regressionTrend — 2pt: OLS trend + ±2σ residual bands over the ─────
  // anchored bar range. See module doc for the `chart.getDataList()` usage
  // and the O(bars-between-anchors) perf note.
  registerOverlay({
    name: "regressionTrend",
    totalStep: 3,
    needDefaultPointFigure: true,
    needDefaultXAxisFigure: true,
    needDefaultYAxisFigure: true,
    createPointFigures: ({ coordinates, overlay, xAxis, yAxis, chart }: OverlayCreateFiguresCallbackParams<unknown>): OverlayFigure[] => {
      if (coordinates.length < 2) return [];
      const color = resolveLineColor(overlay.styles, VIOLET);
      const [p0, p1] = coordinates;
      const dataList = chart.getDataList();
      if (dataList.length === 0 || !xAxis || !yAxis) return [dashedLine([p0, p1], color, 1.2)];

      const rawLo = Math.round(pixelXToDataIndex(xAxis, p0.x));
      const rawHi = Math.round(pixelXToDataIndex(xAxis, p1.x));
      const lo = Math.max(0, Math.min(rawLo, rawHi));
      const hi = Math.min(dataList.length - 1, Math.max(rawLo, rawHi));
      if (hi <= lo) return [dashedLine([p0, p1], color, 1.2)];

      const closes = dataList.slice(lo, hi + 1).map((c) => c.close);
      const { slope, intercept, sigma } = linearRegression(closes);
      const n = closes.length;
      const startPrice = intercept;
      const endPrice = slope * (n - 1) + intercept;
      const startX = xAxis.convertToPixel(lo);
      const endX = xAxis.convertToPixel(hi);
      const mid = { x: (startX + endX) / 2, y: yAxis.convertToPixel((startPrice + endPrice) / 2) };

      const band = 2 * sigma;
      const upperStart = { x: startX, y: yAxis.convertToPixel(startPrice + band) };
      const upperEnd = { x: endX, y: yAxis.convertToPixel(endPrice + band) };
      const lowerStart = { x: startX, y: yAxis.convertToPixel(startPrice - band) };
      const lowerEnd = { x: endX, y: yAxis.convertToPixel(endPrice - band) };
      const trendStart = { x: startX, y: yAxis.convertToPixel(startPrice) };
      const trendEnd = { x: endX, y: yAxis.convertToPixel(endPrice) };

      return [
        fillPolygon([upperStart, upperEnd, lowerEnd, lowerStart], SKY_FILL, color, 1),
        dashedLine([upperStart, upperEnd], color, 1),
        solidLine([trendStart, trendEnd], color, 1.6),
        dashedLine([lowerStart, lowerEnd], color, 1),
        labelFigure(mid, `slope ${formatRupeesLabel(slope)}/bar · ±2σ`, { background: color }),
      ];
    },
  });

  // ── flatTopBottom — 3pt: trendline p0→p1 + horizontal at p2.value ──────
  // spanning the same x-range, filled between.
  registerOverlay({
    name: "flatTopBottom",
    totalStep: 4,
    needDefaultPointFigure: true,
    needDefaultXAxisFigure: true,
    needDefaultYAxisFigure: true,
    createPointFigures: ({ coordinates, overlay }: OverlayCreateFiguresCallbackParams<unknown>): OverlayFigure[] => {
      if (coordinates.length < 2) return [dashedLine(coordinates)];
      const color = resolveLineColor(overlay.styles, INK_600);
      const fill = SKY_FILL;
      const [p0, p1, p2] = coordinates;
      if (!p2) return [solidLine([p0, p1], color, 1.4)];
      const x0 = Math.min(p0.x, p1.x);
      const x1 = Math.max(p0.x, p1.x);
      const flatLeft: Coordinate = { x: x0, y: p2.y };
      const flatRight: Coordinate = { x: x1, y: p2.y };
      return [
        fillPolygon([p0, p1, flatRight, flatLeft], fill, color, 1),
        solidLine([p0, p1], color, 1.4),
        solidLine([flatLeft, flatRight], color, 1.4),
      ];
    },
  });

  // ── disjointChannel — 4pt: two independent segments p0→p1, p2→p3, ──────
  // filled between.
  registerOverlay({
    name: "disjointChannel",
    totalStep: 5,
    needDefaultPointFigure: true,
    needDefaultXAxisFigure: true,
    needDefaultYAxisFigure: true,
    createPointFigures: ({ coordinates, overlay }: OverlayCreateFiguresCallbackParams<unknown>): OverlayFigure[] => {
      if (coordinates.length < 2) return [dashedLine(coordinates)];
      const color = resolveLineColor(overlay.styles, INK_600);
      const fill = SKY_FILL;
      const [p0, p1, p2, p3] = coordinates;
      const figures: OverlayFigure[] = [solidLine([p0, p1], color, 1.4)];
      if (!p2 || !p3) return figures; // second segment not yet fully placed — show only the first.
      figures.push(solidLine([p2, p3], color, 1.4));
      figures.push(fillPolygon([p0, p1, p3, p2], fill, color, 1));
      return figures;
    },
  });
}
