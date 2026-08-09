"use client";

/**
 * Client-side live wrapper for one homepage Instrument Research card's
 * price + badge + sparkline (app/page.tsx's `InstrumentResearchSection`).
 * Founder ask 2026-08-09: make these look convincingly live, not just
 * accurate. Sibling of economy-tile-live.tsx — same LiveStatusBadge/
 * foldTickIntoSparkline building blocks — but every homepage instrument
 * (RELIANCE, HDFCBANK, TCS, SBIN) is a plain equity, so it always has a
 * real per-symbol quote route (`/api/instruments/[symbol]/quote`, the same
 * one use-workbench-candles.ts and price-chart.tsx already poll) — unlike
 * the Economy tiles, there's no "no live source" tile to degrade here.
 */
import { useEffect, useState } from "react";

import { isNseWeekdayMarketHours } from "@predict-future/business-rules/papertrading/marketHours";

import { InstrumentSparkline } from "@/components/finance/instrument-sparkline";
import { LiveStatusBadge } from "@/components/finance/live-status-badge";
import { foldTickIntoSparkline } from "@/components/finance/live-quote-fold";
import { useLiveQuoteTick } from "@/components/paper-trading/use-live-quote-tick";

function formatRupees(value: number): string {
  return `₹${value.toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;
}

export function InstrumentResearchTileLive({
  symbol,
  initialClose,
  initialPrevClose,
  initialChangePercent,
  initialAsOfMs,
  spark,
}: {
  symbol: string;
  initialClose: number;
  initialPrevClose: number;
  initialChangePercent: number;
  /** `instrument.quote.sessionDate`, in ms — the server render's own EOD timestamp. */
  initialAsOfMs: number;
  spark: { sessionDate: Date; close: number }[];
}) {
  const [marketOpen, setMarketOpen] = useState(false);
  useEffect(() => setMarketOpen(isNseWeekdayMarketHours()), []);

  const quoteUrl = `/api/instruments/${encodeURIComponent(symbol)}/quote`;
  const tick = useLiveQuoteTick(quoteUrl, marketOpen);
  const isLive = marketOpen && tick != null;

  const close = tick?.price ?? initialClose;
  const changePercent =
    tick != null && initialPrevClose !== 0 ? ((tick.price - initialPrevClose) / initialPrevClose) * 100 : initialChangePercent;
  const isUp = changePercent >= 0;

  const displaySpark = tick != null ? foldTickIntoSparkline(spark, tick.price) : spark;
  const asOfMs = tick?.asOf ?? initialAsOfMs;

  return (
    <div>
      <div className="flex items-center justify-between gap-2">
        <p className="text-xl font-semibold tabular-nums text-ink-900">{formatRupees(close)}</p>
        <LiveStatusBadge marketOpen={marketOpen} isLive={isLive} asOfMs={asOfMs} />
      </div>
      <p className={`text-sm font-medium tabular-nums ${isUp ? "text-emerald-600" : "text-rose-600"}`}>
        {changePercent >= 0 ? "+" : ""}
        {changePercent.toFixed(2)}%
      </p>
      <InstrumentSparkline points={displaySpark} height={64} />
    </div>
  );
}
