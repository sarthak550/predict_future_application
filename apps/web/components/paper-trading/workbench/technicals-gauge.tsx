"use client";

/**
 * Founder-feedback pass (2026-08-03) PART B — TradingView's "Technicals
 * Rating" dial, honestly labeled. Purely presentational (no internal
 * state) — `rating` is `lib/ta/technicals.ts`'s `computeTechnicalRating()`
 * output, computed by `chart-workbench.tsx` in a `useMemo` keyed on the
 * loaded candles' own last timestamp (see that file's own doc). Renders in
 * the Strategy tab, above the strategy select — this IS analysis, the same
 * panel, not a separate top-bar affordance (keeps the top bar clean, per
 * the brief).
 */
import type { Rating, RatingGroup, TechnicalRating } from "@/lib/ta/technicals";

const RATING_LABEL: Record<Rating, string> = {
  strongSell: "Strong Sell",
  sell: "Sell",
  neutral: "Neutral",
  buy: "Buy",
  strongBuy: "Strong Buy"
};

const RATING_TEXT_CLASS: Record<Rating, string> = {
  strongSell: "text-rose-700",
  sell: "text-rose-500",
  neutral: "text-ink-500",
  buy: "text-emerald-500",
  strongBuy: "text-emerald-700"
};

/** Strong Sell → Strong Buy, left to right — same ordering as the dial's own left-to-right sweep. */
const ZONE_COLORS = ["#be123c", "#fb7185", "#94a3b8", "#6ee7b7", "#059669"];
const ZONE_BOUNDS: ReadonlyArray<readonly [number, number]> = [
  [-90, -54],
  [-54, -18],
  [-18, 18],
  [18, 54],
  [54, 90]
];
/** Needle rest angle per rating — the midpoint of that rating's own zone above, `0` = straight up (Neutral). */
const NEEDLE_ANGLE: Record<Rating, number> = { strongSell: -72, sell: -36, neutral: 0, buy: 36, strongBuy: 72 };

const CX = 100;
const CY = 92;
const BAND_RADIUS = 78;
const BAND_WIDTH = 14;
const NEEDLE_LENGTH = 64;

/** `theta = 0` points straight up (Neutral), `-90` leftmost (Strong Sell), `+90` rightmost (Strong Buy) — the standard "gauge needle" parametrization (matches the well-known `M left A r r 0 0 1 right` top-semicircle recipe when swept start-to-end left-to-right). */
function pointAt(thetaDeg: number, radius: number): { x: number; y: number } {
  const rad = (thetaDeg * Math.PI) / 180;
  return { x: CX + radius * Math.sin(rad), y: CY - radius * Math.cos(rad) };
}

function zoneArcPath(startTheta: number, endTheta: number): string {
  const start = pointAt(startTheta, BAND_RADIUS);
  const end = pointAt(endTheta, BAND_RADIUS);
  return `M ${start.x} ${start.y} A ${BAND_RADIUS} ${BAND_RADIUS} 0 0 1 ${end.x} ${end.y}`;
}

function GroupCounts({ label, group }: { label: string; group: RatingGroup }) {
  return (
    <p className="text-[11px] text-ink-500">
      <span className="font-semibold text-ink-700">{label}:</span>{" "}
      <span className="tabular-nums">
        {group.buy} Buy · {group.sell} Sell · {group.neutral} Neutral
      </span>
    </p>
  );
}

export function TechnicalsGauge({ rating }: { rating: TechnicalRating }) {
  if (rating.computedAtIndex < 0) return null; // no candles loaded yet — nothing honest to show.

  const needleTip = pointAt(NEEDLE_ANGLE[rating.overall], NEEDLE_LENGTH);

  return (
    <div className="mb-3 rounded-xl border border-ink-100 p-3">
      <svg viewBox="0 0 200 108" className="mx-auto block w-full max-w-[220px]" role="img" aria-label={`Technicals rating: ${RATING_LABEL[rating.overall]}`}>
        {ZONE_BOUNDS.map(([start, end], i) => (
          <path key={i} d={zoneArcPath(start, end)} stroke={ZONE_COLORS[i]} strokeWidth={BAND_WIDTH} strokeLinecap="butt" fill="none" />
        ))}
        <line x1={CX} y1={CY} x2={needleTip.x} y2={needleTip.y} stroke="#1e293b" strokeWidth={2.5} strokeLinecap="round" />
        <circle cx={CX} cy={CY} r={4} fill="#1e293b" />
      </svg>
      <p className={`-mt-2 text-center text-sm font-bold ${RATING_TEXT_CLASS[rating.overall]}`}>{RATING_LABEL[rating.overall]}</p>
      <div className="mt-2 space-y-0.5">
        <GroupCounts label="MA" group={rating.ma} />
        <GroupCounts label="Oscillators" group={rating.oscillators} />
      </div>
      <p className="mt-2 text-[10px] leading-4 text-ink-400">
        Rule-based summary of standard indicator readings on the loaded delayed bars — not a recommendation.
      </p>
    </div>
  );
}
