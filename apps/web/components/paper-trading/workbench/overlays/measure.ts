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
  pathFigure,
  labelFigure,
  formatRupeesLabel,
  formatPercentLabel,
  resolveLineColor,
  resolvePolygonColor,
  pixelXToDataIndex,
  EMERALD,
  EMERALD_FILL,
  ROSE,
  ROSE_FILL,
  INK_600,
  AMBER,
  SKY_FILL,
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

  // ── sector — 3pt: pie-slice. Center P0, radius = |P0P1|, arc sweeps ─────
  // from P1's angle to P2's angle at that radius. Two `path` figures share
  // the same SVG path string — one filled (translucent body), one stroked
  // (opaque border) — since a pie slice's curved edge can't be expressed by
  // `fillPolygon` (straight edges only).
  //
  // **Deliberate divergence from `shapes.ts`'s `ellipse` convention**:
  // `ellipse` passes `x=0, y=0` and embeds ABSOLUTE canvas coordinates in
  // the path string. `path`'s own `checkEventOn` is `checkCoordinateOnRect`
  // (verified against `dist/index.esm.js`), which hit-tests literally
  // against `{x, y, width, height}` — with `x=0,y=0` that rect is always
  // pinned to the CANVAS ORIGIN, regardless of where the shape is actually
  // drawn (an inherited S1 characteristic of `ellipse`, out of this pass's
  // scope to touch). For a NEW tool, `pathFigure`'s other documented usage
  // — real anchor as `x,y`, small ORIGIN-RELATIVE coordinates in the path
  // string (the same convention `annotations.ts`'s `flagMark` uses) — keeps
  // the hit-test rect positioned at the shape's true on-screen location
  // instead, so a drawn sector stays clickable/selectable (needed for the
  // T7 style editor to attach) no matter where on the pane it's drawn.
  registerOverlay({
    name: "sector",
    totalStep: 4,
    needDefaultPointFigure: true,
    needDefaultXAxisFigure: true,
    needDefaultYAxisFigure: true,
    createPointFigures: ({ coordinates, overlay }: OverlayCreateFiguresCallbackParams<unknown>): OverlayFigure[] => {
      if (coordinates.length < 2) return [dashedLine(coordinates)];
      const color = resolveLineColor(overlay.styles, AMBER);
      const fill = resolvePolygonColor(overlay.styles, SKY_FILL);
      const [center, p1, p2] = coordinates;
      const radius = Math.hypot(p1.x - center.x, p1.y - center.y) || 1;
      if (!p2) return [solidLine([center, p1], color, 1.2)];
      const angle1 = Math.atan2(p1.y - center.y, p1.x - center.x);
      const angle2 = Math.atan2(p2.y - center.y, p2.x - center.x);
      let delta = angle2 - angle1;
      // Normalize to (-π, π] so the slice always sweeps the SHORTER way
      // from P1's angle to P2's angle (the intuitive "pie slice between the
      // two rays" reading, not the reflex/long-way-round slice).
      while (delta > Math.PI) delta -= 2 * Math.PI;
      while (delta <= -Math.PI) delta += 2 * Math.PI;
      const sweepFlag = delta >= 0 ? 1 : 0;
      const largeArcFlag = Math.abs(delta) > Math.PI ? 1 : 0;
      // Origin-relative (relative to `center`, which becomes the figure's own x/y).
      const edge1Rel = { x: radius * Math.cos(angle1), y: radius * Math.sin(angle1) };
      const edge2Rel = { x: radius * Math.cos(angle1 + delta), y: radius * Math.sin(angle1 + delta) };
      const path = `M 0 0 L ${edge1Rel.x} ${edge1Rel.y} A ${radius} ${radius} 0 ${largeArcFlag} ${sweepFlag} ${edge2Rel.x} ${edge2Rel.y} Z`;
      const hitOpts = { width: radius, height: radius };
      return [
        pathFigure(center.x, center.y, path, fill, { fill: true, ...hitOpts }),
        pathFigure(center.x, center.y, path, color, { lineWidth: 1.4, ...hitOpts }),
      ];
    },
  });

  // ── anchoredVWAP — 1pt: cumulative Σ(typicalPrice·vol)/Σvol from the ────
  // anchor bar forward, over `chart.getDataList()`. Volume-gated in the
  // toolbar (`tool-registry.ts`'s `premiumDisabled: true`, same field name
  // as `indicator-registry.ts`'s `VWAP`) — never drawable while charting
  // option-premium pseudo-candles. NOT session-reset (unlike the `VWAP`
  // indicator in `custom-indicators/pack-a.ts`) — that's the entire point
  // of "anchored": one continuous cumulative sum from the user's chosen bar
  // onward, matching every other charting platform's Anchored VWAP tool.
  // Bars with zero cumulative volume so far (e.g. a genuinely volume-less
  // index feed) are simply not plotted — same "skip, don't divide by zero"
  // convention the `VWAP` indicator itself uses.
  registerOverlay({
    name: "anchoredVWAP",
    totalStep: 2,
    needDefaultPointFigure: true,
    needDefaultXAxisFigure: true,
    needDefaultYAxisFigure: true,
    createPointFigures: ({ coordinates, overlay, xAxis, yAxis, chart }: OverlayCreateFiguresCallbackParams<unknown>): OverlayFigure[] => {
      if (coordinates.length < 1) return [];
      const [anchor] = coordinates;
      const color = resolveLineColor(overlay.styles, EMERALD);
      const dataList = chart.getDataList();
      if (dataList.length === 0 || !xAxis || !yAxis) return [];
      const anchorDataIndex = Math.max(0, Math.round(pixelXToDataIndex(xAxis, anchor.x)));
      if (anchorDataIndex >= dataList.length) return [];

      let cumPv = 0;
      let cumVol = 0;
      const points: Coordinate[] = [];
      for (let i = anchorDataIndex; i < dataList.length; i++) {
        const bar = dataList[i];
        const vol = bar.volume ?? 0;
        const typicalPrice = (bar.high + bar.low + bar.close) / 3;
        cumPv += typicalPrice * vol;
        cumVol += vol;
        if (cumVol <= 0) continue;
        const vwapPrice = cumPv / cumVol;
        points.push({ x: xAxis.convertToPixel(i), y: yAxis.convertToPixel(vwapPrice) });
      }
      if (points.length === 0) return [labelFigure(anchor, "AVWAP — no volume yet", { background: color })];

      const anchorDate = new Date(dataList[anchorDataIndex].timestamp);
      const dateLabel = anchorDate.toLocaleDateString("en-IN", { day: "2-digit", month: "short" });
      return [solidLine(points, color, 1.6), labelFigure(points[0], `AVWAP from ${dateLabel}`, { background: color, align: "left" })];
    },
  });
}
