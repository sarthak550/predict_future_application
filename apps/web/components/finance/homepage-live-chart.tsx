"use client";

/**
 * Homepage Charting Workbench section (2026-08-09 founder feedback: "the
 * charts... to be dynamic instead of just image") — a genuinely live,
 * real-data candlestick strip for one liquid symbol, replacing the static
 * `public/homepage/workbench-screenshot.png` capture the section used to
 * show.
 *
 * Deliberately NOT the full klinecharts workbench bundle (that would blow
 * the homepage's bundle-size budget and break the "heavy chart engine
 * stays lazy-loaded inside the workbench only" discipline this codebase
 * has held all week) — a small, self-contained SVG candlestick renderer,
 * same "real data, no heavy library" precedent as
 * `components/finance/instrument-sparkline.tsx`.
 *
 * Data path is the exact same one the real workbench charts run on:
 *  - `/api/instruments/[symbol]/candles?interval=5m` (proxy to apps/api's
 *    `fetchYahooCandles`) for the initial bar series, refetched every 60s
 *    while NSE market hours are open (matches that route's own 60s
 *    Cache-Control for intraday intervals — polling faster would be
 *    wasted).
 *  - `/api/instruments/[symbol]/quote` via `useLiveQuoteTick` (the SAME
 *    ~4.5s fast-tick hook `use-workbench-candles.ts` uses) for intrabar
 *    movement — folded into the LAST bar's close only (extending high/low
 *    if breached), never a closed bar, never a fabricated new one. This is
 *    a deliberately simplified sibling of the real workbench's
 *    `foldQuoteIntoCandles`: no interval-rollover/provisional-bar handling
 *    (that complexity exists there to keep a trader's actual chart alive
 *    across a bar boundary uninterrupted; here, the next 60s poll simply
 *    catches up, which is an acceptable trade for a decorative homepage
 *    preview, not a trading surface).
 *
 * Honesty: an explicit "Live · delayed a few seconds" / "Market closed"
 * badge, matching this product's delayed-data-disclosure convention
 * everywhere else (see `option-chain-browser.tsx`, `premium-chart.tsx`).
 * Outside market hours (or on a fetch failure) this renders the last real
 * candles it has with a "Market closed" badge — never a fabricated tick,
 * never a blank chart when real data exists.
 */
import { useEffect, useRef, useState } from "react";

import { isNseWeekdayMarketHours } from "@predict-future/business-rules/papertrading/marketHours";

import { useVisiblePolling } from "@/components/paper-trading/use-visible-polling";
import { useLiveQuoteTick, LIVE_QUOTE_POLL_MS } from "@/components/paper-trading/use-live-quote-tick";

const CANDLE_POLL_MS = 60_000;
const MAX_BARS_SHOWN = 60;

type Candle = { timestamp: number; open: number; high: number; low: number; close: number };

type FetchState =
  | { status: "loading" }
  | { status: "error" }
  | { status: "ready"; candles: Candle[] };

/** Folds a fast quote tick into the current LAST bar's close, extending high/low if breached. Every earlier (closed) bar is untouched. New array identity so React/consumers see the change. */
function foldTickIntoLastCandle(candles: Candle[], price: number): Candle[] {
  if (candles.length === 0) return candles;
  const next = candles.slice();
  const last = next[next.length - 1];
  next[next.length - 1] = {
    ...last,
    close: price,
    high: Math.max(last.high, price),
    low: Math.min(last.low, price),
  };
  return next;
}

function CandlestickStrip({ candles, height = 200 }: { candles: Candle[]; height?: number }) {
  if (candles.length < 2) {
    return (
      <div className="flex items-center justify-center text-xs text-ink-400" style={{ height }}>
        Not enough bars yet for a chart.
      </div>
    );
  }

  const shown = candles.slice(-MAX_BARS_SHOWN);
  const highs = shown.map((c) => c.high);
  const lows = shown.map((c) => c.low);
  const max = Math.max(...highs);
  const min = Math.min(...lows);
  const range = max - min || 1;

  const padding = 8;
  const plotHeight = height - padding * 2;
  const unitWidth = 10;
  const width = shown.length * unitWidth;
  const bodyWidth = Math.max(unitWidth * 0.55, 1.5);

  const yFor = (price: number) => padding + (1 - (price - min) / range) * plotHeight;

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      className="h-full w-full"
      preserveAspectRatio="none"
      role="img"
      aria-label={`Last ${shown.length} 5-minute candles`}
    >
      {shown.map((c, i) => {
        const isUp = c.close >= c.open;
        const color = isUp ? "#059669" /* emerald-600 */ : "#e11d48" /* rose-600 */;
        const x = i * unitWidth + unitWidth / 2;
        const yHigh = yFor(c.high);
        const yLow = yFor(c.low);
        const yOpen = yFor(c.open);
        const yClose = yFor(c.close);
        const bodyTop = Math.min(yOpen, yClose);
        const bodyHeight = Math.max(Math.abs(yClose - yOpen), 1);
        return (
          <g key={c.timestamp}>
            <line x1={x} x2={x} y1={yHigh} y2={yLow} stroke={color} strokeWidth={1} />
            <rect x={x - bodyWidth / 2} y={bodyTop} width={bodyWidth} height={bodyHeight} fill={color} />
          </g>
        );
      })}
    </svg>
  );
}

export function HomepageLiveChart({ symbol = "RELIANCE", height = 220 }: { symbol?: string; height?: number }) {
  const [state, setState] = useState<FetchState>({ status: "loading" });
  const marketOpenRef = useRef(false);

  const fetchCandles = () => {
    fetch(`/api/instruments/${encodeURIComponent(symbol)}/candles?interval=5m`, { cache: "no-store" })
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error(String(res.status)))))
      .then((body: { candles?: Candle[] }) => {
        if (!Array.isArray(body.candles) || body.candles.length === 0) {
          setState((prev) => (prev.status === "ready" ? prev : { status: "error" }));
          return;
        }
        setState({ status: "ready", candles: body.candles });
      })
      .catch(() => {
        // A transient blip must never regress an already-showing chart —
        // same silent-poll posture as use-workbench-candles.ts's fetchOnce.
        setState((prev) => (prev.status === "ready" ? prev : { status: "error" }));
      });
  };

  // Initial fetch on mount (and if the symbol ever changed, which it never
  // does today — fixed prop — but this keeps the effect honest).
  useEffect(() => {
    setState({ status: "loading" });
    fetchCandles();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [symbol]);

  const marketOpen = isNseWeekdayMarketHours();
  marketOpenRef.current = marketOpen;

  // Background 60s refetch of the full bar series while the market is open.
  useVisiblePolling(fetchCandles, CANDLE_POLL_MS, marketOpen);

  // ~4.5s fast last-price tick, folded into the current bar only.
  const tick = useLiveQuoteTick(`/api/instruments/${encodeURIComponent(symbol)}/quote`, marketOpen);
  useEffect(() => {
    if (!tick) return;
    setState((prev) => (prev.status === "ready" ? { status: "ready", candles: foldTickIntoLastCandle(prev.candles, tick.price) } : prev));
  }, [tick]);

  const isLive = marketOpen && tick != null;

  return (
    <div>
      <div className="flex items-center justify-between border-b border-ink-100 px-5 py-3">
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold text-ink-900">{symbol}</span>
          <span className="text-xs text-ink-400">· 5m candles</span>
        </div>
        <span className={`inline-flex items-center gap-1.5 text-xs font-medium ${isLive ? "text-emerald-600" : "text-ink-400"}`}>
          <span className={`h-1.5 w-1.5 rounded-full ${isLive ? "animate-pulse bg-emerald-500" : "bg-ink-300"}`} />
          {isLive ? "Live · delayed a few seconds" : marketOpen ? "Connecting…" : "Market closed · last session"}
        </span>
      </div>

      <div className="px-3 py-3" style={{ height }}>
        {state.status === "loading" ? (
          <div className="flex h-full items-center justify-center text-xs text-ink-400">Loading live candles…</div>
        ) : state.status === "error" ? (
          <div className="flex h-full items-center justify-center text-xs text-ink-400">
            Chart temporarily unavailable.
          </div>
        ) : (
          <CandlestickStrip candles={state.candles} height={height - 24} />
        )}
      </div>
    </div>
  );
}

// Re-exported so a future caller (or a test) can reuse the exact poll
// cadence this component ticks on without a second, driftable constant.
export { LIVE_QUOTE_POLL_MS };
