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
 *
 * Price/change typography and sparkline sizing deliberately mirror
 * `InstrumentResearchTileLive` exactly (text-xl price, plain colored
 * change line with no icon/chip, 64px sparkline, matching card padding in
 * `economy-section.tsx`) — founder feedback 2026-08-09: the two sections
 * had visually drifted (this one used a smaller price, an icon+chip change
 * badge via `IndexChangeBadge`, and a shorter 44px sparkline) even though
 * both already rendered the same underlying `InstrumentSparkline`. The one
 * real, disclosed difference kept here: `changePercent` can be `null` for
 * a tile with no data (Instrument Research's stocks always have one), so
 * this file alone needs the "—" fallback branch.
 */
import { useEffect, useState } from "react";

import { isNseWeekdayMarketHours } from "@predict-future/business-rules/papertrading/marketHours";

import { InstrumentSparkline } from "@/components/finance/instrument-sparkline";
import { formatIndexLevel } from "@/components/finance/index-change-badge";
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
  const changePercent =
    tick != null && prevClose != null && prevClose !== 0 ? ((tick.price - prevClose) / prevClose) * 100 : initialChangePercent;

  const displaySpark = tick != null ? foldTickIntoSparkline(spark, tick.price) : spark;
  const asOfMs = tick?.asOf ?? initialAsOfMs;

  return (
    <>
      <div className="flex items-center justify-between gap-2">
        <p className="text-xl font-semibold tabular-nums text-ink-900">
          {isUsdInr ? formatUsdInr(last) : formatIndexLevel(last)}
        </p>
        <LiveStatusBadge marketOpen={marketOpen} isLive={isLive} asOfMs={asOfMs} />
      </div>
      {changePercent != null ? (
        <p className={`text-sm font-medium tabular-nums ${changePercent >= 0 ? "text-emerald-600" : "text-rose-600"}`}>
          {changePercent >= 0 ? "+" : ""}
          {changePercent.toFixed(2)}%
        </p>
      ) : (
        <p className="text-sm text-ink-400">—</p>
      )}
      <InstrumentSparkline points={displaySpark} height={64} isLive={isLive} />
    </>
  );
}
