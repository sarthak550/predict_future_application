/**
 * Minimal 30-session close-price trend line for /instruments/[symbol] — a
 * plain inline SVG polyline, deliberately not a charting library (this is
 * the only chart on the page; pulling in a dependency for one polyline isn't
 * worth the bundle cost). Color follows the NET direction across the whole
 * window (first point vs. last point), not per-segment, matching the rest of
 * the page's single up/down accent per instrument.
 */
export function InstrumentSparkline({
  points,
  width = 640,
  height = 120,
}: {
  points: { sessionDate: Date; close: number }[];
  width?: number;
  height?: number;
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

  const coords = points.map((p, i) => {
    const x = padding + (i / (points.length - 1)) * plotWidth;
    const y = padding + (1 - (p.close - min) / range) * plotHeight;
    return `${x.toFixed(2)},${y.toFixed(2)}`;
  });

  const isUp = closes[closes.length - 1] >= closes[0];
  const stroke = isUp ? "#059669" /* emerald-600 */ : "#e11d48" /* rose-600 */;

  const areaPath = `M${padding},${height - padding} L${coords.join(" L")} L${width - padding},${height - padding} Z`;

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      className="h-[120px] w-full"
      preserveAspectRatio="none"
      role="img"
      aria-label={`${points.length}-session closing price trend`}
    >
      <path d={areaPath} fill={stroke} fillOpacity={0.08} stroke="none" />
      <polyline points={coords.join(" ")} fill="none" stroke={stroke} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}
