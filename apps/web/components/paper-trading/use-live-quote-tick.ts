"use client";

/**
 * Quote-driven intrabar ticks — founder complaint (live market open,
 * 2026-08-04): "The candles are stale and I dont see the live fluctuations,
 * for any trading platform live price change is necessary." Diagnosis
 * (already done, not re-litigated here): the existing candle/intraday polls
 * (30s/60s — see use-workbench-candles.ts's own module doc) only refresh the
 * FULL bar/point series; between polls the current bar never visibly moves.
 *
 * This hook adds a much faster (~4-5s), lightweight last-price poll for
 * exactly the symbol a caller is actively displaying. It fetches nothing
 * else and holds no chart state of its own — a bare "what's the latest
 * traded price" ticker. Callers fold the result into their OWN series
 * honestly:
 *   - `use-workbench-candles.ts`: updates the CURRENT bar's close (extending
 *     high/low only if breached), never a closed bar, never a fabricated
 *     new one — see that file's `foldQuoteIntoCandles`.
 *   - `price-chart.tsx`: appends a new point to the 1D tick series, same
 *     "session tick" pattern `premium-chart.tsx`/the workbench's
 *     `optionPremium` branch already established for `livePremium`.
 *
 * Never used for option premium — the options chain's own ~30s
 * `livePremium` poll is that feed's honest freshness ceiling (a 5-minute
 * server-side snapshot cadence sits underneath it); faking a faster tick
 * for premium would violate the honest-simulation law. Callers simply never
 * enable this hook for that feed.
 *
 * Gating — "no background hammering" per the brief, all three real:
 *   - Visibility: `useVisiblePolling` already pauses entirely on a hidden
 *     tab and catches up once the tab is visible again.
 *   - Market hours: `isNseWeekdayMarketHours` (the SAME pure IST-clock rule
 *     order placement itself gates on — packages/business-rules, not
 *     duplicated) is checked in the `enabled` flag passed to
 *     `useVisiblePolling` AND, belt-and-braces, again inside the fetch
 *     callback itself — so even if nothing else re-renders this component
 *     at the exact instant the market closes, the very next timer tick
 *     still no-ops before touching the network, regardless of how stale the
 *     `enabled` boolean's own last render is.
 *   - Active-only: this hook only ever runs inside a component instance
 *     mounted for the ONE symbol currently on screen (the maximized
 *     workbench chart, or a single terminal's 1D chart) — there is no
 *     "poll every watchlist symbol" caller anywhere in this program.
 */
import { useEffect, useState } from "react";

import { isNseWeekdayMarketHours } from "@predict-future/business-rules/papertrading/marketHours";

import { useVisiblePolling } from "@/components/paper-trading/use-visible-polling";

/**
 * ~4-5s per the founder brief — fast enough to read as genuinely live,
 * slow enough that apps/api's own ~4s server-side cache
 * (lib/marketMoves/liveQuote.ts) absorbs the actual upstream Yahoo load
 * regardless of how many browser tabs are watching the same symbol.
 * Exported so any caller reporting effective freshness (e.g. the
 * workbench's heartbeat chip) uses this SAME number rather than a
 * second, driftable copy.
 */
export const LIVE_QUOTE_POLL_MS = 4500;

export interface LiveQuoteTick {
  price: number;
  /**
   * The CLIENT's own receipt clock (`Date.now()` at fetch success) — NOT
   * the upstream `asOf` the response body also carries. Bar-boundary
   * decisions (is the current bar still open?) are fundamentally a
   * real-world-clock question; using one consistent local clock for both
   * the tick and the candle timestamps it's compared against avoids any
   * cross-source skew with an upstream field this hook has no way to
   * independently verify. A tick this hook drops as "too old" because of
   * clock imprecision is always the SAFE failure mode — it just waits for
   * the next real candle poll, never fabricates or misattributes data.
   */
  asOf: number;
}

/**
 * Polls `url` (a `{price, asOf}`-shaped quote endpoint — apps/web's
 * `/api/instruments/[symbol]/quote` or `/index/[symbol]/quote`) every
 * `LIVE_QUOTE_POLL_MS` while `enabled`, the tab is visible, and NSE market
 * hours are open. `url === null` or `enabled === false` fully disables
 * polling (e.g. a "1d" interval chart, or the optionPremium feed kind,
 * which never enables this at all).
 */
export function useLiveQuoteTick(url: string | null, enabled: boolean): LiveQuoteTick | null {
  const [tick, setTick] = useState<LiveQuoteTick | null>(null);

  // A symbol/URL change starts fresh — never show a stale price under a
  // newly-selected symbol's chart, even for one tick.
  useEffect(() => {
    setTick(null);
  }, [url]);

  const fetchOnce = () => {
    if (!url || !isNseWeekdayMarketHours()) return;
    fetch(url, { cache: "no-store" })
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error(String(res.status)))))
      .then((body: { price?: unknown }) => {
        const price = typeof body.price === "number" ? body.price : NaN;
        if (!Number.isFinite(price) || price <= 0) return;
        setTick({ price, asOf: Date.now() });
      })
      .catch(() => {
        // A transient blip on a 4-5s poll must never regress anything
        // visible — same silent-poll posture as every other background
        // refresh in this program (use-workbench-candles.ts's fetchOnce,
        // price-chart.tsx's fetchIntraday). The last good tick (or none)
        // just keeps showing until the next successful one.
      });
  };

  useVisiblePolling(fetchOnce, LIVE_QUOTE_POLL_MS, enabled && url != null && isNseWeekdayMarketHours());

  return tick;
}
