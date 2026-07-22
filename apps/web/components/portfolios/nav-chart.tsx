/**
 * Portfolio NAV trend line for app/portfolios/[slug] — an inline SVG polyline,
 * mirroring components/finance/instrument-sparkline.tsx's approach (no charting
 * library for one line). Adds a dashed reference line at `startingCapital`
 * (₹10,00,000) so a viewer can see at a glance whether the portfolio is
 * currently above or below its starting cash, not just its own min/max range.
 */
export function PortfolioNavChart({
  points,
  startingCapital,
  width = 640,
  height = 160
}: {
  points: { sessionDate: Date; totalValue: number }[];
  startingCapital: number;
  width?: number;
  height?: number;
}) {
  if (points.length < 2) {
    return (
      <div className="flex h-[160px] items-center justify-center text-xs text-ink-400">
        Not enough settled sessions yet for a trend line — check back after the first order fills.
      </div>
    );
  }

  const values = points.map((p) => p.totalValue);
  const min = Math.min(...values, startingCapital);
  const max = Math.max(...values, startingCapital);
  const range = max - min || 1; // guard a perfectly flat window (division by zero)

  const padding = 8;
  const plotWidth = width - padding * 2;
  const plotHeight = height - padding * 2;

  const yFor = (value: number) => padding + (1 - (value - min) / range) * plotHeight;

  const coords = points.map((p, i) => {
    const x = padding + (i / (points.length - 1)) * plotWidth;
    return `${x.toFixed(2)},${yFor(p.totalValue).toFixed(2)}`;
  });

  const isUp = values[values.length - 1] >= startingCapital;
  const stroke = isUp ? "#059669" /* emerald-600 */ : "#e11d48" /* rose-600 */;
  const referenceY = yFor(startingCapital);

  const areaPath = `M${padding},${height - padding} L${coords.join(" L")} L${width - padding},${height - padding} Z`;

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      className="h-[160px] w-full"
      preserveAspectRatio="none"
      role="img"
      aria-label={`Portfolio value trend across ${points.length} sessions`}
    >
      <line
        x1={padding}
        x2={width - padding}
        y1={referenceY}
        y2={referenceY}
        stroke="#94a3b8"
        strokeWidth={1}
        strokeDasharray="4 4"
      />
      <path d={areaPath} fill={stroke} fillOpacity={0.08} stroke="none" />
      <polyline
        points={coords.join(" ")}
        fill="none"
        stroke={stroke}
        strokeWidth={2}
        strokeLinejoin="round"
        strokeLinecap="round"
      />
    </svg>
  );
}
