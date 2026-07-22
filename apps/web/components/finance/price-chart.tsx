"use client";

/**
 * Interactive price chart for /instruments/[symbol].
 *
 * Timeframe selector (1D/1W/1M/3M/6M/1Y/MAX), pointer crosshair with
 * date-or-time+price readout, and the selected window's return (₹ and %) —
 * the interaction model users know from other market apps. Pure inline SVG,
 * no chart library; works for mouse and touch.
 *
 * Two distinct data sources feed this one chart:
 *   - 1W..MAX: daily EOD closes (StockEodQuote), passed in as `series` from
 *     the server component — one point per trading session, oldest first.
 *   - 1D: live 1-minute intraday ticks for the current (or last completed)
 *     NSE session, fetched client-side from /api/instruments/[symbol]/intraday
 *     ONLY when the user selects it (never prefetched) — a live NSE call is
 *     too expensive/volatile to run for every page view.
 */

import { Loader2 } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

export type PricePoint = { date: string; close: number }; // date = ISO yyyy-mm-dd label

/** One live intraday tick, as returned by the /intraday API's `points: [t, price][]`. */
type IntradayTick = { t: number; price: number };

type IntradayFetchState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "error" }
  | { status: "ready"; points: IntradayTick[]; prevClose: number | null; sessionLabel: string };

const TIMEFRAMES = [
  { key: "1D", sessions: 0 },
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

/** "14:32" — IST wall-clock time from an epoch-millis timestamp, regardless of the viewer's own timezone. */
function formatIstTime(epochMs: number): string {
  return new Intl.DateTimeFormat("en-IN", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: "Asia/Kolkata",
  }).format(new Date(epochMs));
}

/** A single renderable point, normalized from either the EOD `series` prop or a fetched intraday tick. */
type ChartPoint = {
  /** Position on the x-axis: session index for EOD modes (evenly spaced), epoch-millis for 1D (true time spacing). */
  xValue: number;
  y: number;
  /** Crosshair/axis label: the session's date label for EOD, IST HH:mm for 1D. */
  label: string;
};

export function PriceChart({ series, symbol }: { series: PricePoint[]; symbol: string }) {
  const [timeframe, setTimeframe] = useState<TimeframeKey>("3M");
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);
  const [intraday, setIntraday] = useState<IntradayFetchState>({ status: "idle" });
  const svgRef = useRef<SVGSVGElement | null>(null);

  // Lazy-fetch: only hits the network the first time "1D" is selected, never
  // on mount and never for the EOD timeframes.
  useEffect(() => {
    if (timeframe !== "1D" || intraday.status !== "idle") return;

    let cancelled = false;
    setIntraday({ status: "loading" });

    fetch(`/api/instruments/${encodeURIComponent(symbol)}/intraday`)
      .then(async (res) => {
        if (!res.ok) throw new Error(`intraday fetch ${res.status}`);
        const body = await res.json();
        return body as { prevClose: number | null; points: [number, number][]; sessionLabel?: string };
      })
      .then((body) => {
        if (cancelled) return;
        const points: IntradayTick[] = Array.isArray(body.points)
          ? body.points
              .filter((p) => Array.isArray(p) && Number.isFinite(p[0]) && Number.isFinite(p[1]))
              .map(([t, price]) => ({ t, price }))
          : [];
        if (points.length < 2) {
          setIntraday({ status: "error" });
          return;
        }
        setIntraday({
          status: "ready",
          points,
          prevClose: typeof body.prevClose === "number" ? body.prevClose : null,
          sessionLabel: body.sessionLabel ?? "today",
        });
      })
      .catch(() => {
        if (!cancelled) setIntraday({ status: "error" });
      });

    return () => {
      cancelled = true;
    };
  }, [timeframe, intraday.status, symbol]);

  const points = useMemo<ChartPoint[]>(() => {
    if (timeframe === "1D") {
      if (intraday.status !== "ready") return [];
      return intraday.points.map((p) => ({ xValue: p.t, y: p.price, label: formatIstTime(p.t) }));
    }
    const tf = TIMEFRAMES.find((t) => t.key === timeframe)!;
    const windowed = tf.sessions === Infinity ? series : series.slice(-tf.sessions);
    return windowed.map((p, i) => ({ xValue: i, y: p.close, label: p.date }));
  }, [series, timeframe, intraday]);

  const geometry = useMemo(() => {
    if (points.length < 2) return null;
    const values = points.map((p) => p.y);
    const min = Math.min(...values);
    const max = Math.max(...values);
    const span = max - min || max * 0.01 || 1;
    const xValues = points.map((p) => p.xValue);
    const minX = Math.min(...xValues);
    const maxX = Math.max(...xValues);
    const spanX = maxX - minX || 1;
    const x = (i: number) => PAD.left + ((points[i].xValue - minX) / spanX) * (W - PAD.left - PAD.right);
    const y = (v: number) => PAD.top + (1 - (v - min) / span) * (H - PAD.top - PAD.bottom);
    const path = points.map((p, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(2)},${y(p.y).toFixed(2)}`).join(" ");
    const area = `${path} L${x(points.length - 1).toFixed(2)},${H - PAD.bottom} L${PAD.left},${H - PAD.bottom} Z`;
    return { min, max, x, y, path, area };
  }, [points]);

  // 1D loading / error states pre-empt the normal chart body entirely.
  if (timeframe === "1D" && intraday.status === "loading") {
    return (
      <div>
        <div className="flex h-[200px] items-center justify-center rounded-xl border border-ink-100 bg-ink-50/40 text-sm text-ink-400">
          <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />
          Loading intraday ticks…
        </div>
        <TimeframeChips timeframe={timeframe} setTimeframe={setTimeframe} series={series} setHoverIdx={setHoverIdx} />
      </div>
    );
  }
  if (timeframe === "1D" && intraday.status === "error") {
    return (
      <div>
        <div className="rounded-xl border border-ink-100 bg-ink-50/40 p-6 text-sm text-ink-500">
          Intraday unavailable right now — try a daily timeframe below, or check back during market hours.
        </div>
        <TimeframeChips timeframe={timeframe} setTimeframe={setTimeframe} series={series} setHoverIdx={setHoverIdx} />
      </div>
    );
  }

  if (!geometry || points.length < 2) {
    return (
      <div>
        <div className="rounded-xl border border-ink-100 bg-ink-50/40 p-6 text-sm text-ink-500">
          {timeframe === "1D"
            ? "Not enough intraday ticks yet — try again once trading is underway."
            : "Not enough price history for a chart yet — it builds daily as sessions close."}
        </div>
        <TimeframeChips timeframe={timeframe} setTimeframe={setTimeframe} series={series} setHoverIdx={setHoverIdx} />
      </div>
    );
  }

  const first = points[0];
  const last = points[points.length - 1];
  // Header return baseline: previous close for 1D when NSE/our EOD store gave
  // us one (a true "change on the day" reading), otherwise the window's own
  // first point — unchanged behavior for every EOD timeframe.
  const referenceClose = timeframe === "1D" && intraday.status === "ready" && intraday.prevClose != null
    ? intraday.prevClose
    : first.y;
  const changeAbs = last.y - referenceClose;
  const changePct = referenceClose > 0 ? (changeAbs / referenceClose) * 100 : 0;
  const up = changeAbs >= 0;
  const tone = up ? "#059669" : "#e11d48";
  const active = hoverIdx != null ? points[hoverIdx] : null;
  const activeReturnPct = active && referenceClose > 0 ? ((active.y - referenceClose) / referenceClose) * 100 : null;

  const onPointer = (clientX: number) => {
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect) return;
    const frac = (clientX - rect.left) / rect.width;
    const idx = Math.round(frac * (points.length - 1));
    setHoverIdx(Math.max(0, Math.min(points.length - 1, idx)));
  };

  const footerNote =
    timeframe === "1D" && intraday.status === "ready"
      ? `1-minute ticks · ${intraday.sessionLabel}`
      : "Daily closes · updates after each session";

  return (
    <div>
      {/* Header: window return + hover readout */}
      <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
        <div className="flex items-baseline gap-2">
          <span className="text-lg font-semibold text-ink-900">
            {formatRupees((active ?? last).y)}
          </span>
          <span className="text-sm font-medium" style={{ color: tone }}>
            {active
              ? `${(activeReturnPct ?? 0) >= 0 ? "+" : ""}${(activeReturnPct ?? 0).toFixed(2)}% since ${timeframe === "1D" ? (intraday.status === "ready" && intraday.prevClose != null ? "prev. close" : first.label) : first.label}`
              : `${up ? "+" : ""}${formatRupees(Math.abs(changeAbs)).replace("₹", up ? "₹" : "-₹")} (${up ? "+" : ""}${changePct.toFixed(2)}%) · ${timeframe}`}
          </span>
        </div>
        <span className="text-xs text-ink-400">{active ? active.label : `${first.label} → ${last.label}`}</span>
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
        aria-label={`Price chart, ${timeframe}: ${formatRupees(first.y)} to ${formatRupees(last.y)}`}
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
        <circle cx={geometry.x(points.length - 1)} cy={geometry.y(last.y)} r="3" fill={tone} />
        {/* crosshair */}
        {hoverIdx != null && (
          <g>
            <line x1={geometry.x(hoverIdx)} x2={geometry.x(hoverIdx)} y1={PAD.top} y2={H - PAD.bottom} stroke="#9aa1b2" strokeDasharray="2 3" />
            <circle cx={geometry.x(hoverIdx)} cy={geometry.y(points[hoverIdx].y)} r="4" fill="#fff" stroke={tone} strokeWidth="2" />
          </g>
        )}
      </svg>

      <TimeframeChips
        timeframe={timeframe}
        setTimeframe={setTimeframe}
        series={series}
        setHoverIdx={setHoverIdx}
        trailingNote={footerNote}
      />
    </div>
  );
}

/**
 * Timeframe chip row (+ trailing footer note, kept in the same row as the
 * original single-line layout). "1D" is always offered first — it's a live
 * fetch independent of `series`; the EOD chips are only offered when
 * `series` can actually fill their window (unchanged from the original
 * gating logic).
 */
function TimeframeChips({
  timeframe,
  setTimeframe,
  series,
  setHoverIdx,
  trailingNote,
}: {
  timeframe: TimeframeKey;
  setTimeframe: (key: TimeframeKey) => void;
  series: PricePoint[];
  setHoverIdx: (idx: number | null) => void;
  trailingNote?: string;
}) {
  return (
    <div className="mt-3 flex flex-wrap items-center gap-1.5">
      {TIMEFRAMES.filter(
        (t) => t.key === "1D" || t.sessions === Infinity || series.length >= Math.min(t.sessions, 5)
      ).map((t) => (
        <button
          key={t.key}
          type="button"
          onClick={() => {
            setTimeframe(t.key);
            setHoverIdx(null);
          }}
          className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
            timeframe === t.key
              ? "bg-ink-900 text-white"
              : "border border-ink-200 bg-white text-ink-500 hover:bg-ink-50"
          }`}
        >
          {t.key}
        </button>
      ))}
      {trailingNote && (
        <span className="ml-auto self-center text-[10px] uppercase tracking-wide text-ink-300">{trailingNote}</span>
      )}
    </div>
  );
}
