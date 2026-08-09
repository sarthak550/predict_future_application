/**
 * Minimal 30-session close-price trend line for the homepage Indian Economy
 * tiles and Instrument Research cards (economy-tile-live.tsx /
 * instrument-research-tile-live.tsx) — a plain inline SVG polyline,
 * deliberately not a charting library (bundle-cost precedent, see those
 * files' own doc comments).
 *
 * Motion (founder ask 2026-08-09, verbatim: "charts should be moving like a
 * dynamic or GIF"; the earlier `LiveStatusBadge` text-badge pass was the
 * wrong read of that ask — this is the follow-up, real visual motion):
 *
 *   1. Mount-only "draw the line in" reveal, left to right. Pure CSS: the
 *      polyline sets `pathLength={1}` (SVG2, normalizes arc length to 1
 *      regardless of actual geometry) + `strokeDasharray="1"`, and a
 *      Tailwind keyframe animates `stroke-dashoffset` 1 -> 0 once on
 *      insertion (`animate-sparkline-draw`, `forwards` fill-mode). No JS
 *      measurement (`getTotalLength`), no useEffect, so there's no
 *      pre-hydration flash of an already-complete line snapping back to
 *      hidden — the animation is driven by the CSS engine from first paint,
 *      degrades to a plain static line if `pathLength` is ever unsupported
 *      is not a real risk (universal since ~2022) but even so never hides
 *      data behind JS. The area fill beneath it wipes in with the SAME
 *      duration via `clip-path: inset()` (`animate-sparkline-wipe`), not a
 *      plain opacity fade — an opacity fade reveals the fill's full
 *      silhouette almost instantly regardless of the line's own progress,
 *      which visually swallowed the line's left-to-right draw entirely
 *      (caught via a real slowed-down Playwright capture, not just code
 *      review — see the keyframe's own doc comment in tailwind.config.ts).
 *   2. Smooth endpoint marker instead of the line snapping on a live tick.
 *      Per-render `points`/`d` morphing is unreliable across browsers (not
 *      attempted) — instead only the LATEST-point marker's `cx`/`cy` carry
 *      a CSS transition, so a real tick eases the dot to its new position
 *      rather than teleporting.
 *   3. `isLive` pulse — a `animate-ping` halo behind the solid endpoint dot,
 *      shown ONLY when `isLive` is true (a genuine live tick has landed,
 *      passed down from `LiveStatusBadge`'s own state). Never pulses on a
 *      closed-market or delayed tile — that would fabricate liveness the
 *      data doesn't have.
 *
 * All three are presentational only: they reveal or ease real, already-
 * fetched values, never invent a data point or a movement that didn't
 * happen (see `live-quote-fold.ts`'s own honesty doc comment).
 */
export function InstrumentSparkline({
  points,
  width = 640,
  height = 120,
  isLive = false,
}: {
  points: { sessionDate: Date; close: number }[];
  width?: number;
  height?: number;
  /**
   * Pulses the endpoint marker. Reserve for tiles genuinely receiving a
   * live tick right now — a static/closed-market chart must never pulse.
   */
  isLive?: boolean;
}) {
  if (points.length < 2) {
    return (
      <div className="flex h-[120px] items-center justify-center text-xs text-ink-400">
        Not enough sessions yet for a trend line.
      </div>
    );
  }

  const closes = points.map((p) => p.close);
  const min = Math.min(...closes);
  const max = Math.max(...closes);
  const range = max - min || 1; // guard a perfectly flat window (division by zero)

  const padding = 6;
  const plotWidth = width - padding * 2;
  const plotHeight = height - padding * 2;

  const coords = points.map((p, i) => ({
    x: padding + (i / (points.length - 1)) * plotWidth,
    y: padding + (1 - (p.close - min) / range) * plotHeight
  }));

  const isUp = closes[closes.length - 1] >= closes[0];
  const stroke = isUp ? "#059669" /* emerald-600 */ : "#e11d48" /* rose-600 */;

  const pointsAttr = coords.map((c) => `${c.x.toFixed(2)},${c.y.toFixed(2)}`).join(" ");
  const areaPath = `M${padding},${height - padding} L${pointsAttr.split(" ").join(" L")} L${width - padding},${height - padding} Z`;
  const last = coords[coords.length - 1];

  // Endpoint dot/halo radii scale down for the compact Economy tiles
  // (height 44) vs. the larger Instrument Research cards (height 64) so the
  // marker never reads as oversized against a short sparkline.
  const dotRadius = height <= 48 ? 2.25 : 3;
  const haloRadius = dotRadius * 2.2;
  const markerTransition = { transition: "cx 500ms ease-out, cy 500ms ease-out" };
  // `animate-ping`'s `transform: scale()` otherwise pivots around the SVG
  // viewport's origin, not the circle's own cx/cy (CSS Transforms' default
  // `transform-box` for SVG shapes is the view box, not the shape's
  // bounding box) — without this the halo visibly drifts toward the
  // top-left as it scales instead of growing outward from the price point.
  const haloTransformStyle = { ...markerTransition, transformBox: "fill-box" as const, transformOrigin: "center" as const };

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      className="h-[120px] w-full overflow-visible"
      preserveAspectRatio="none"
      role="img"
      aria-label={`${points.length}-session closing price trend`}
    >
      <path d={areaPath} fill={stroke} fillOpacity={0.08} stroke="none" className="animate-sparkline-wipe" />
      <polyline
        pathLength={1}
        points={pointsAttr}
        fill="none"
        stroke={stroke}
        strokeWidth={2}
        strokeLinejoin="round"
        strokeLinecap="round"
        strokeDasharray={1}
        className="animate-sparkline-draw"
      />
      {isLive && (
        <circle cx={last.x} cy={last.y} r={haloRadius} fill={stroke} fillOpacity={0.35} className="animate-ping" style={haloTransformStyle} />
      )}
      <circle cx={last.x} cy={last.y} r={dotRadius} fill={stroke} stroke="white" strokeWidth={1} style={markerTransition} />
    </svg>
  );
}
