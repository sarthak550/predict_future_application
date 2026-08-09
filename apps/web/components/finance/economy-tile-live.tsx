"use client";

/**
 * Client-side live wrapper for one Indian Economy tile's price + badge +
 * sparkline (economy-section.tsx's `MarketSummaryTileCard`). Founder ask
 * 2026-08-09: make these look convincingly live, not just accurate.
 *
 * Only NIFTY 50 and BANK NIFTY have a per-symbol live-quote route today
 * (`/api/instruments/index/[symbol]/quote`, gated to the 5 F&O index
 * underlyings — see that route's own doc comment) — SENSEX (BSE, no NSE
 * index feed) and USD/INR (no FX quote route in this product) render the
 * same honest badge/timestamp but never claim "Live" (LiveStatusBadge
 * degrades to "Market open · delayed a few min" when `quoteUrl` is null).
 * This is presentation-only: the server-rendered `initial*` props are
 * ALWAYS the true value on first paint / no-JS; a live tick only ever
 * refines the number shown, never fabricates one.
 */
import { useEffect, useState } from "react";

import { isNseWeekdayMarketHours } from "@predict-future/business-rules/papertrading/marketHours";

import { InstrumentSparkline } from "@/components/finance/instrument-sparkline";
import { IndexChangeBadge, formatIndexLevel } from "@/components/finance/index-change-badge";
import { LiveStatusBadge } from "@/components/finance/live-status-badge";
import { foldTickIntoSparkline } from "@/components/finance/live-quote-fold";
import { useLiveQuoteTick } from "@/components/paper-trading/use-live-quote-tick";

function formatUsdInr(value: number): string {
  return `₹${value.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function EconomyTileLive({
  quoteUrl,
  isUsdInr,
  initialLast,
  initialChangeAbs,
  initialChangePercent,
  initialAsOfMs,
  spark,
}: {
  /** `/api/instruments/index/[symbol]/quote` for the 2 tickable tiles, `null` for SENSEX/USD-INR. */
  quoteUrl: string | null;
  isUsdInr: boolean;
  initialLast: number;
  initialChangeAbs: number | null;
  initialChangePercent: number | null;
  /** `marketSummary.asOf`, in ms — the server render's own fetch timestamp. */
  initialAsOfMs: number;
  spark: { sessionDate: Date; close: number }[];
}) {
  // Computed client-side on mount, not server-side: matches every other
  // client caller of isNseWeekdayMarketHours in this codebase
  // (options-page-client.tsx, docked-order-ticket.tsx) — avoids a
  // server/client hydration mismatch from the two environments' clocks
  // disagreeing by even a few ms around a market-hours boundary.
  const [marketOpen, setMarketOpen] = useState(false);
  useEffect(() => setMarketOpen(isNseWeekdayMarketHours()), []);

  const tick = useLiveQuoteTick(quoteUrl, marketOpen);
  const isLive = marketOpen && tick != null;

  const last = tick?.price ?? initialLast;
  const prevClose = initialChangeAbs != null ? initialLast - initialChangeAbs : null;
  const changeAbs = tick != null && prevClose != null ? tick.price - prevClose : initialChangeAbs;
  const changePercent =
    tick != null && prevClose != null && prevClose !== 0 ? ((tick.price - prevClose) / prevClose) * 100 : initialChangePercent;
  void changeAbs; // computed for clarity/symmetry with changePercent; IndexChangeBadge only needs the percent.

  const displaySpark = tick != null ? foldTickIntoSparkline(spark, tick.price) : spark;
  const asOfMs = tick?.asOf ?? initialAsOfMs;

  return (
    <>
      <div className="flex items-center justify-between gap-2">
        <p className="text-lg font-semibold tabular-nums text-ink-900">
          {isUsdInr ? formatUsdInr(last) : formatIndexLevel(last)}
        </p>
        <LiveStatusBadge marketOpen={marketOpen} isLive={isLive} asOfMs={asOfMs} />
      </div>
      <IndexChangeBadge changePercent={changePercent} />
      <InstrumentSparkline points={displaySpark} height={44} />
    </>
  );
}
