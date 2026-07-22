"use client";

/**
 * Interactive EOD price chart for /instruments/[symbol].
 *
 * Replaces the static sparkline: timeframe selector (1W/1M/3M/6M/1Y/MAX),
 * pointer crosshair with date+price readout, and the selected window's return
 * (₹ and %) — the interaction model users know from other market apps.
 * Pure inline SVG, no chart library; works for mouse and touch.
 *
 * Data: daily EOD closes (StockEodQuote), so intraday points don't exist —
 * the finest granularity is one point per session. Series arrives serialized
 * from the server component; the newest point is the latest session's close.
 */

import { useMemo, useRef, useState } from "react";

export type PricePoint = { date: string; close: number }; // date = ISO yyyy-mm-dd label

const TIMEFRAMES = [
  { key: "1W", sessions: 5 },
  { key: "1M", sessions: 22 },
  { key: "3M", sessions: 66 },
  { key: "6M", sessions: 132 },
  { key: "1Y", sessions: 250 },
  { key: "MAX", sessions: Infinity },
] as const;

type TimeframeKey = (typeof TIMEFRAMES)[number]["key"];

const W = 640;
const H = 200;
const PAD = { top: 12, right: 12, bottom: 22, left: 12 };

function formatRupees(v: number): string {
  return `₹${v.toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;
}

export function PriceChart({ series }: { series: PricePoint[] }) {
  const [timeframe, setTimeframe] = useState<TimeframeKey>("3M");
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);
  const svgRef = useRef<SVGSVGElement | null>(null);

  const points = useMemo(() => {
    const tf = TIMEFRAMES.find((t) => t.key === timeframe)!;
    return tf.sessions === Infinity ? series : series.slice(-tf.sessions);
  }, [series, timeframe]);

  const geometry = useMemo(() => {
    if (points.length < 2) return null;
    const closes = points.map((p) => p.close);
    const min = Math.min(...closes);
    const max = Math.max(...closes);
    const span = max - min || max * 0.01 || 1;
    const x = (i: number) => PAD.left + (i / (points.length - 1)) * (W - PAD.left - PAD.right);
    const y = (v: number) => PAD.top + (1 - (v - min) / span) * (H - PAD.top - PAD.bottom);
    const path = points.map((p, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(2)},${y(p.close).toFixed(2)}`).join(" ");
    const area = `${path} L${x(points.length - 1).toFixed(2)},${H - PAD.bottom} L${PAD.left},${H - PAD.bottom} Z`;
    return { min, max, x, y, path, area };
  }, [points]);

  if (!geometry || points.length < 2) {
    return (
      <div className="rounded-xl border border-ink-100 bg-ink-50/40 p-6 text-sm text-ink-500">
        Not enough price history for a chart yet — it builds daily as sessions close.
      </div>
    );
  }

  const first = points[0];
  const last = points[points.length - 1];
  const changeAbs = last.close - first.close;
  const changePct = (changeAbs / first.close) * 100;
  const up = changeAbs >= 0;
  const tone = up ? "#059669" : "#e11d48";
  const active = hoverIdx != null ? points[hoverIdx] : null;
  const activeReturnPct = active && first.close > 0 ? ((active.close - first.close) / first.close) * 100 : null;

  const onPointer = (clientX: number) => {
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect) return;
    const frac = (clientX - rect.left) / rect.width;
    const idx = Math.round(frac * (points.length - 1));
    setHoverIdx(Math.max(0, Math.min(points.length - 1, idx)));
  };

  return (
    <div>
      {/* Header: window return + hover readout */}
      <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
        <div className="flex items-baseline gap-2">
          <span className="text-lg font-semibold text-ink-900">
            {formatRupees((active ?? last).close)}
          </span>
          <span className="text-sm font-medium" style={{ color: tone }}>
            {active
              ? `${(activeReturnPct ?? 0) >= 0 ? "+" : ""}${(activeReturnPct ?? 0).toFixed(2)}% since ${first.date}`
              : `${up ? "+" : ""}${formatRupees(Math.abs(changeAbs)).replace("₹", up ? "₹" : "-₹")} (${up ? "+" : ""}${changePct.toFixed(2)}%) · ${timeframe}`}
          </span>
        </div>
        <span className="text-xs text-ink-400">{active ? active.date : `${first.date} → ${last.date}`}</span>
      </div>

      {/* Chart */}
      <svg
        ref={svgRef}
        viewBox={`0 0 ${W} ${H}`}
        className="w-full cursor-crosshair touch-none select-none"
        onMouseMove={(e) => onPointer(e.clientX)}
        onMouseLeave={() => setHoverIdx(null)}
        onTouchStart={(e) => onPointer(e.touches[0].clientX)}
        onTouchMove={(e) => onPointer(e.touches[0].clientX)}
        onTouchEnd={() => setHoverIdx(null)}
        role="img"
        aria-label={`Price chart, ${timeframe}: ${formatRupees(first.close)} to ${formatRupees(last.close)}`}
      >
        <defs>
          <linearGradient id="pc-fill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={tone} stopOpacity="0.18" />
            <stop offset="100%" stopColor={tone} stopOpacity="0.01" />
          </linearGradient>
        </defs>
        {/* min/max gridlines */}
        <line x1={PAD.left} x2={W - PAD.right} y1={geometry.y(geometry.max)} y2={geometry.y(geometry.max)} stroke="#e7e8ee" strokeDasharray="3 4" />
        <line x1={PAD.left} x2={W - PAD.right} y1={geometry.y(geometry.min)} y2={geometry.y(geometry.min)} stroke="#e7e8ee" strokeDasharray="3 4" />
        <text x={W - PAD.right} y={geometry.y(geometry.max) - 4} textAnchor="end" fontSize="10" fill="#9aa1b2">{formatRupees(geometry.max)}</text>
        <text x={W - PAD.right} y={geometry.y(geometry.min) + 12} textAnchor="end" fontSize="10" fill="#9aa1b2">{formatRupees(geometry.min)}</text>
        {/* area + line */}
        <path d={geometry.area} fill="url(#pc-fill)" />
        <path d={geometry.path} fill="none" stroke={tone} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
        {/* endpoint dot */}
        <circle cx={geometry.x(points.length - 1)} cy={geometry.y(last.close)} r="3" fill={tone} />
        {/* crosshair */}
        {hoverIdx != null && (
          <g>
            <line x1={geometry.x(hoverIdx)} x2={geometry.x(hoverIdx)} y1={PAD.top} y2={H - PAD.bottom} stroke="#9aa1b2" strokeDasharray="2 3" />
            <circle cx={geometry.x(hoverIdx)} cy={geometry.y(points[hoverIdx].close)} r="4" fill="#fff" stroke={tone} strokeWidth="2" />
          </g>
        )}
      </svg>

      {/* Timeframe chips — only offer windows the data can actually fill (+MAX) */}
      <div className="mt-3 flex flex-wrap gap-1.5">
        {TIMEFRAMES.filter((t) => t.sessions === Infinity || series.length >= Math.min(t.sessions, 5)).map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => { setTimeframe(t.key); setHoverIdx(null); }}
            className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
              timeframe === t.key
                ? "bg-ink-900 text-white"
                : "border border-ink-200 bg-white text-ink-500 hover:bg-ink-50"
            }`}
          >
            {t.key}
          </button>
        ))}
        <span className="ml-auto self-center text-[10px] uppercase tracking-wide text-ink-300">
          Daily closes · updates after each session
        </span>
      </div>
    </div>
  );
}
