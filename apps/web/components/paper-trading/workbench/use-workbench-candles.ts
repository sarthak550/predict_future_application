"use client";

/**
 * Charting Workbench (W2, T3 equity/index; W3, T5 optionPremium) — candle
 * data for the workbench's KLineChart.
 *
 * Equity/index sourced from W1's candles endpoints
 * (`/api/instruments/[symbol]/candles` / `/api/instruments/index/[symbol]/candles`,
 * both thin apps/web proxies to apps/api's Yahoo-backed fetcher — see
 * project_workbench_w1 memory for the exact response shape:
 * `{symbol, interval, prevClose, candles:[{timestamp,open,high,low,close,volume}], asOf}`).
 * Re-polls every 60s via `useVisiblePolling`.
 *
 * `optionPremium` (W3) is sourced differently: `/api/paper-trading/options/
 * premium-history` (apps/web, direct-prisma, SAME endpoint `terminal/
 * premium-chart.tsx` already uses) returns the full raw 5-minute snapshot
 * history for one contract — NOT interval-dependent server-side. Interval
 * (15m/30m) only changes the CLIENT-side bucket width fed to
 * `aggregatePremiumCandles` (`premium-candles.ts`), so switching between
 * 15m/30m never re-fetches, only re-aggregates already-held raw points.
 * `feed.livePremium` (the options terminal's own ~30s chain-poll price,
 * threaded in by the caller) is folded in as an in-memory "session tick"
 * appended to the raw points before aggregation — same
 * "changed-value-only, never a duplicate tick" contract `premium-chart.tsx`
 * already implements for its own SVG view, reproduced here so the
 * workbench's rightmost bar updates live instead of only appearing once its
 * 15/30-min window closes.
 *
 * **Founder-feedback pass (2026-08-06) — candle liveness audit.** "why does
 * not the candles move live during market timings" — the market has been
 * CLOSED since this workbench shipped, so the live path had never actually
 * run end-to-end. Full trace (client poll -> this hook's `candles` array ->
 * `kline-chart.tsx`'s data effect -> klinecharts' `subscribeBar` push ->
 * repaint) verified CORRECT at every link, including reading klinecharts
 * v10's own `dist/index.esm.js` `StoreImp.prototype._addData`/
 * `_processDataLoad` — `setPeriod`/`setSymbol` both route through
 * `resetData()`, which unsubscribes then re-subscribes the live-bar channel
 * on every call, and the single-bar `_addData` branch correctly append-or-
 * replaces by timestamp and always repaints. No gap found in that chain —
 * see `kline-chart.tsx`'s own data effect doc for the client-side half. The
 * one real, actionable change: `pollMsForInterval` below TIGHTENS the
 * equity/index poll cadence for 1m/5m charts from the previous flat 60s to
 * 30s (daily and 15m/30m/60m unchanged) — halving the worst-case gap
 * between a real Yahoo-side print and it reaching the browser on the
 * intervals traders watch most closely. Effective end-to-end freshness is
 * still bounded by Yahoo's own delayed-data latency (unknown, not
 * controlled here) PLUS `apps/api`'s 60s server-side TTL cache
 * (`lib/marketMoves/candles.ts`) PLUS this client poll — documented in the
 * heartbeat chip's own tooltip (`heartbeat-chip.tsx`) so the freshness bound
 * is visible to whoever's watching, not just asserted in a comment.
 * `lastUpdatedAt` (new) is set on every SUCCESSFUL fetch (both branches
 * below) and drives that chip.
 *
 * **Quote-driven intrabar ticks (founder complaint, live market open,
 * 2026-08-04)**: "The candles are stale and I dont see the live
 * fluctuations, for any trading platform live price change is necessary."
 * The 2026-08-06 pass above tightened the CANDLE poll cadence but never
 * closed the real gap — between polls the forming bar still didn't move.
 * `useLiveQuoteTick` (new, `use-live-quote-tick.ts`) adds a much faster
 * (~4-5s), market-hours-gated, visibility-gated last-price poll for the
 * equity/index branches only (never optionPremium — its own ~30s
 * `livePremium` chain poll is that feed's honest freshness ceiling, see
 * that hook's own doc). Every fresh tick is folded into the CURRENTLY
 * FORMING bar's close (extending high/low only if breached) by
 * `foldQuoteIntoCandles` below — a NEW `candles` array identity, same
 * mechanism the 60s/30s candle poll already relies on to reach
 * `kline-chart.tsx`'s data effect and the signals/rating pipeline
 * (`candlesKey` already includes last close/high/low, so nothing downstream
 * needed to change to pick this up). A tick that would land outside the
 * last bar's own [timestamp, timestamp+intervalMs) window is DROPPED, never
 * folded — the real bar has rolled over server-side and this client just
 * hasn't received the new one yet; only the next 30s/60s candle poll is
 * allowed to introduce a new bar or correct a rolled-over one. Closed bars
 * (every element before the last) are never touched. Deliberately skipped
 * for the "1d" interval — a daily bar's honest forming-window is "until
 * today's NSE close," not a fixed duration, and getting that boundary wrong
 * risks the one law this whole feature must never break (touching a closed
 * bar); nobody watches a daily candle "tick" bar-by-bar the way the
 * founder's complaint describes, so this scope cut costs nothing real.
 * `lastUpdatedAt`/`pollIntervalMs` below now reflect whichever cadence is
 * ACTUALLY in effect (the fast tick when live-ticking is active, the slower
 * candle poll otherwise) — see `liveTicksActive` in the return shape, which
 * `heartbeat-chip.tsx`'s caller uses to pick honest cadence copy.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { isNseWeekdayMarketHours } from "@predict-future/business-rules/papertrading/marketHours";

import { useVisiblePolling } from "@/components/paper-trading/use-visible-polling";
import { useLiveQuoteTick, LIVE_QUOTE_POLL_MS, type LiveQuoteTick } from "@/components/paper-trading/use-live-quote-tick";
import { aggregatePremiumCandles, type PremiumSnapshotPoint } from "./premium-candles";

export type CandleInterval = "1m" | "5m" | "15m" | "30m" | "60m" | "1d";

export const WORKBENCH_INTERVALS: CandleInterval[] = ["1m", "5m", "15m", "30m", "60m", "1d"];

/** W3, T5/T6 — premium mode restricts the timeframe selector to 15m/30m only (option premium snapshots are captured every 5 minutes; anything finer than 15m would be mostly empty/sub-3-snapshot buckets). */
export const PREMIUM_INTERVALS: CandleInterval[] = ["15m", "30m"];

export interface Candle {
  timestamp: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

/**
 * Charting Workbench (W2/W3) — which instrument/series the workbench is
 * charting. `optionPremium.livePremium` (W3) is the currently selected
 * contract's live premium, straight off the options terminal's own already-
 * running ~30s chain poll — the SAME value `PremiumChart`'s own
 * `livePremium` prop carries, passed through unmemoized at render time (the
 * caller rebuilds the `feed` object fresh every render, same "no memo, no
 * feedback loop" posture as every other `WorkbenchFeed`-consuming prop in
 * this program — see kline-chart.tsx's own module doc on the one render-
 * loop shape this whole program guards against).
 */
export type WorkbenchFeed =
  | { kind: "equity"; symbol: string }
  | { kind: "index"; symbol: string }
  | { kind: "optionPremium"; underlying: string; expiry: string; strikePrice: number; optionType: "CE" | "PE"; livePremium: number | null };

interface PremiumMeta {
  /** Raw (pre-aggregation) snapshot count for this contract — drives the zero-snapshot accrual-note contract (T5): fewer than 3 EVER shows the accrual note, regardless of how the buckets aggregate. */
  totalSnapshots: number;
  /** The real earliest snapshot's ISO timestamp — feeds the mandatory "since {date}" label. Never hardcoded. */
  earliestCapturedAt: string | null;
}

type CandleFetchState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "unsupported"; note: string }
  | { status: "ready"; candles: Candle[]; prevClose: number | null; premiumMeta: PremiumMeta | null };

export interface WorkbenchQuote {
  price: number;
  prevClose: number | null;
  changeAbs: number;
  changePct: number;
}

function feedUrl(feed: WorkbenchFeed, interval: CandleInterval): string | null {
  if (feed.kind === "equity") return `/api/instruments/${encodeURIComponent(feed.symbol)}/candles?interval=${interval}`;
  if (feed.kind === "index") return `/api/instruments/index/${encodeURIComponent(feed.symbol)}/candles?interval=${interval}`;
  return null; // optionPremium — fetched separately below, not via this generic single-URL path.
}

/** Quote-driven intrabar ticks — the fast (~4-5s) sibling of `feedUrl`, equity/index only (see module doc). `null` for optionPremium, which never enables `useLiveQuoteTick` at all. */
function feedQuoteUrl(feed: WorkbenchFeed): string | null {
  if (feed.kind === "equity") return `/api/instruments/${encodeURIComponent(feed.symbol)}/quote`;
  if (feed.kind === "index") return `/api/instruments/index/${encodeURIComponent(feed.symbol)}/quote`;
  return null;
}

/** Fixed bar duration per INTRADAY interval, in ms — used only to decide whether a fresh quote tick still falls inside the last fetched bar's own window. Deliberately has NO "1d" entry (see module doc's "why 1d is skipped" note); a `foldQuoteIntoCandles` caller for "1d" always gets `undefined` here and must treat that as "never fold." */
const INTRADAY_INTERVAL_MS: Partial<Record<CandleInterval, number>> = {
  "1m": 60_000,
  "5m": 5 * 60_000,
  "15m": 15 * 60_000,
  "30m": 30 * 60_000,
  "60m": 60 * 60_000
};

/**
 * Folds one fresh last-traded-price tick into the CURRENTLY FORMING bar,
 * honestly: only the LAST bar's `close`/`high`/`low` ever change, and only
 * while `tick.asOf` still falls inside that bar's own
 * `[timestamp, timestamp + intervalMs)` window — the exact bar the exchange
 * itself hasn't closed yet. A tick landing at or after that window means
 * the real current bar has already rolled over server-side and this client
 * just hasn't received it yet; the honest response is to drop the tick and
 * wait for the next 30s/60s candle poll (the only thing allowed to
 * introduce a new bar or correct a rolled-over one), never to touch the
 * now-stale last bar or fabricate a new one client-side. Every bar before
 * the last is never touched.
 *
 * `runningHigh`/`runningLow` are the caller's own running extremes for THIS
 * bar (see `runningExtremesRef` in `useWorkbenchCandles` below) —
 * deliberately NOT read off `last.high`/`last.low` directly. A bar's true
 * intrabar high/low must be monotonic across successive ticks: folding
 * every tick against only the base fetch's own high/low would let a LATER,
 * smaller tick silently ERASE an EARLIER, larger tick's already-recorded
 * high (or the mirror case for a low) — a real, visible dishonesty (a
 * candle's wick shrinking mid-formation, which no real bar ever does).
 *
 * Returns the SAME array reference when no fold happens (no candle
 * history, tick outside the window, or a genuine no-op tick) so callers
 * keyed on array identity never re-render for nothing.
 */
function foldQuoteIntoCandles(candles: Candle[], tick: LiveQuoteTick, intervalMs: number, runningHigh: number, runningLow: number): Candle[] {
  if (candles.length === 0) return candles;
  const last = candles[candles.length - 1];
  const bucketEnd = last.timestamp + intervalMs;
  if (tick.asOf < last.timestamp || tick.asOf >= bucketEnd) return candles;

  const high = Math.max(runningHigh, tick.price);
  const low = Math.min(runningLow, tick.price);
  if (tick.price === last.close && high === last.high && low === last.low) return candles;

  const merged: Candle = { ...last, close: tick.price, high, low };
  return [...candles.slice(0, -1), merged];
}

function premiumHistoryUrl(underlying: string, expiry: string, strikePrice: number, optionType: "CE" | "PE"): string {
  return `/api/paper-trading/options/premium-history?underlying=${encodeURIComponent(underlying)}&expiry=${encodeURIComponent(expiry)}&strike=${strikePrice}&type=${optionType}`;
}

function feedTitle(feed: WorkbenchFeed): string {
  if (feed.kind === "equity") return feed.symbol;
  if (feed.kind === "index") return feed.symbol;
  return `${feed.underlying} ${feed.strikePrice} ${feed.optionType}`;
}

function bucketMsForInterval(interval: CandleInterval): number {
  return interval === "30m" ? 30 * 60_000 : 15 * 60_000; // premium mode only ever passes 15m/30m — anything else defaults to the 15m bucket rather than throwing.
}

/** Honest-data chip label — a single, reused source string rather than each caller inventing its own wording (see the founder plan's "honest-data chip" requirement). */
const SOURCE_LABEL = "Delayed market data (Yahoo)";

/**
 * Founder-feedback pass (2026-08-06) — client poll cadence for the
 * equity/index branch, tightened for the two intervals traders watch bar-
 * by-bar. `apps/api`'s own server-side cache TTL (`lib/marketMoves/
 * candles.ts`) stays 60s regardless — this only changes how often the
 * BROWSER asks. Exported so `heartbeat-chip.tsx` can compute the SAME
 * "stale after 3x this" threshold the poll itself actually uses (single
 * source, no drift between the poll timer and the staleness check).
 */
export function pollMsForInterval(interval: CandleInterval): number {
  return interval === "1m" || interval === "5m" ? 30_000 : 60_000;
}

export function useWorkbenchCandles(
  feed: WorkbenchFeed,
  interval: CandleInterval
): {
  candles: Candle[];
  prevClose: number | null;
  status: "loading" | "ready" | "error" | "unsupported";
  errorMessage: string | null;
  sourceLabel: string;
  title: string;
  quote: WorkbenchQuote | null;
  /** null for equity/index feeds; populated for optionPremium — see PremiumMeta doc. */
  premiumMeta: PremiumMeta | null;
  /** Founder-feedback pass (2026-08-06) — epoch ms of the last SUCCESSFUL candles fetch (either branch), `null` before the first one resolves. Drives `heartbeat-chip.tsx`. Deliberately set only at a real network-fetch success point, never on a pure client-side re-aggregation (e.g. premium mode's interval/bucket-width switch) — see module doc. */
  lastUpdatedAt: number | null;
  /** Founder-feedback pass (2026-08-06) — the cadence THIS hook is actually polling at right now, for the heartbeat chip's own "stale after 3x this" math and its cadence-note copy. Equity/index: `pollMsForInterval(interval)` normally, or `LIVE_QUOTE_POLL_MS` while quote-driven ticking is active (see `liveTicksActive`) — always the FASTEST cadence genuinely in effect, never just the slower candle-refetch number. Premium mode keeps its own fixed 60s (5-minute server-side snapshot cadence — see module doc). */
  pollIntervalMs: number;
  /** Quote-driven intrabar ticks (2026-08-04) — true while the fast last-price poll is genuinely running for this feed right now (equity/index, intraday interval, NSE market hours open). `heartbeat-chip.tsx`'s caller uses this to choose honest cadence copy — "price ticks every ~5s, full bars every 30-60s" only makes sense to say while this is true. */
  liveTicksActive: boolean;
} {
  const [state, setState] = useState<CandleFetchState>({ status: "loading" });
  const [quote, setQuote] = useState<WorkbenchQuote | null>(null);
  const [lastUpdatedAt, setLastUpdatedAt] = useState<number | null>(null);

  const isPremium = feed.kind === "optionPremium";
  const url = feedUrl(feed, interval);

  // ── Equity/index branch (W2, unchanged). ────────────────────────────────
  const fetchOnce = useCallback(
    (opts: { silent: boolean }) => {
      if (!url) return; // optionPremium — handled by the separate effect below.
      if (!opts.silent) setState({ status: "loading" });
      fetch(url, { cache: "no-store" })
        .then(async (res) => {
          if (!res.ok) throw new Error(`candles fetch ${res.status}`);
          return (await res.json()) as { candles?: unknown; prevClose?: number | null };
        })
        .then((body) => {
          const rawCandles = Array.isArray(body.candles) ? body.candles : [];
          const candles: Candle[] = rawCandles
            .filter(
              (c): c is Candle =>
                typeof c === "object" &&
                c !== null &&
                Number.isFinite((c as Candle).timestamp) &&
                Number.isFinite((c as Candle).open) &&
                Number.isFinite((c as Candle).high) &&
                Number.isFinite((c as Candle).low) &&
                Number.isFinite((c as Candle).close)
            )
            .map((c) => ({ ...c, volume: Number.isFinite(c.volume) ? c.volume : 0 }));
          if (candles.length === 0) {
            if (!opts.silent) setState({ status: "error", message: "No candle data available for this instrument right now." });
            return;
          }
          const prevClose = typeof body.prevClose === "number" ? body.prevClose : null;
          setState({ status: "ready", candles, prevClose, premiumMeta: null });
          setLastUpdatedAt(Date.now());
        })
        .catch(() => {
          // Same "silent poll never regresses a working chart" posture as
          // price-chart.tsx's fetchIntraday — a transient background blip
          // keeps showing the last good series.
          if (!opts.silent) setState({ status: "error", message: "Candle data temporarily unavailable — try again shortly." });
        });
    },
    [url]
  );
  const fetchOnceRef = useRef(fetchOnce);
  fetchOnceRef.current = fetchOnce;

  useEffect(() => {
    if (isPremium) return;
    fetchOnceRef.current({ silent: false });
  }, [url, isPremium]);

  const equityPollMs = pollMsForInterval(interval);
  useVisiblePolling(() => fetchOnceRef.current({ silent: true }), equityPollMs, !isPremium && url != null);

  // ── Quote-driven intrabar ticks (2026-08-04) — equity/index only, and ──
  // only for intraday intervals (see INTRADAY_INTERVAL_MS's own doc on why
  // "1d" is deliberately excluded). `useLiveQuoteTick` itself owns the
  // market-hours/visibility gating; `intervalMs` being `undefined` for "1d"
  // is what actually disables folding below regardless of this flag.
  const quoteUrl = feedQuoteUrl(feed);
  const intervalMs = INTRADAY_INTERVAL_MS[interval];
  const liveTicksEnabled = !isPremium && intervalMs != null;
  const liveQuote = useLiveQuoteTick(quoteUrl, liveTicksEnabled);
  const liveTicksActive = liveTicksEnabled && isNseWeekdayMarketHours();

  // A successful tick is itself a real freshness signal — bump the SAME
  // `lastUpdatedAt` the candle poll drives, so the heartbeat chip reflects
  // whichever cadence is actually the fresher one right now.
  useEffect(() => {
    if (liveQuote) setLastUpdatedAt(Date.now());
  }, [liveQuote]);

  // Running intrabar high/low for the bar `runningExtremesRef.current
  // .barTimestamp` belongs to — see `foldQuoteIntoCandles`'s own doc for
  // why a running value (not the base fetch's own high/low, read fresh on
  // every fold) is required for a monotonic wick. Updated in a COMMIT-phase
  // effect below (never mutated during the render/memo below itself — this
  // hook must stay pure during render).
  const runningExtremesRef = useRef<{ barTimestamp: number; high: number; low: number } | null>(null);

  // The array the rest of this hook (and its caller) actually reads: the
  // base fetched candles with the live quote folded into the forming bar,
  // when applicable. A fresh identity here is exactly what
  // kline-chart.tsx's data effect and the signals/rating pipeline
  // (`candlesKey`) are already built to react to — see module doc.
  const displayCandles = useMemo(() => {
    if (state.status !== "ready") return EMPTY_CANDLES;
    if (isPremium || intervalMs == null) return state.candles;

    const last = state.candles[state.candles.length - 1];
    if (!last) return state.candles;

    // Absorb the server's own fresh high/low for this SAME bar (its 30s/60s
    // fetch is still the correction authority) without discarding anything
    // an earlier tick this render-cycle already recorded. A bar timestamp
    // that doesn't match what's tracked means a genuinely NEW bar (rollover,
    // interval switch, or first load) — starts fresh from the server's own
    // reported extremes, never carrying a prior bar's high/low forward.
    const running = runningExtremesRef.current;
    const sameBar = running != null && running.barTimestamp === last.timestamp;
    const high = sameBar ? Math.max(running.high, last.high) : last.high;
    const low = sameBar ? Math.min(running.low, last.low) : last.low;

    if (!liveQuote) return state.candles;
    return foldQuoteIntoCandles(state.candles, liveQuote, intervalMs, high, low);
  }, [state, isPremium, liveQuote, intervalMs]);

  // Commit-phase bookkeeping for the running-extremes ref above — reads
  // back whatever `displayCandles` just rendered (which already folded this
  // tick in, if any) so the NEXT tick's fold starts from a true "everything
  // seen so far" high/low instead of the memo re-deriving it during render.
  useEffect(() => {
    if (displayCandles.length === 0) return;
    const last = displayCandles[displayCandles.length - 1];
    runningExtremesRef.current = { barTimestamp: last.timestamp, high: last.high, low: last.low };
  }, [displayCandles]);

  // ── optionPremium branch (W3, T5). ──────────────────────────────────────
  // Raw snapshot points are fetched once per CONTRACT identity (never on an
  // interval change — the endpoint's own data doesn't vary by interval,
  // only the client-side bucket width does) and re-aggregated locally on
  // every interval switch. `livePremium` folds into the current forming
  // bucket via an in-memory "session tick" array, same pattern as
  // `premium-chart.tsx`'s own `sessionTicks`.
  const premiumUnderlying = isPremium ? feed.underlying : null;
  const premiumExpiry = isPremium ? feed.expiry : null;
  const premiumStrike = isPremium ? feed.strikePrice : null;
  const premiumType = isPremium ? feed.optionType : null;
  const livePremium = isPremium ? feed.livePremium : null;

  const [rawPoints, setRawPoints] = useState<PremiumSnapshotPoint[]>([]);
  const [sessionTicks, setSessionTicks] = useState<PremiumSnapshotPoint[]>([]);
  const [premiumLoadState, setPremiumLoadState] = useState<"loading" | "ready" | "error">("loading");

  const fetchPremiumOnce = useCallback(
    (opts: { silent: boolean }) => {
      if (!isPremium || premiumUnderlying == null || premiumExpiry == null || premiumStrike == null || premiumType == null) return;
      if (!opts.silent) setPremiumLoadState("loading");
      const url2 = premiumHistoryUrl(premiumUnderlying, premiumExpiry, premiumStrike, premiumType);
      fetch(url2, { cache: "no-store" })
        .then((res) => (res.ok ? res.json() : Promise.reject(new Error(String(res.status)))))
        .then((data: { points?: unknown }) => {
          const points: PremiumSnapshotPoint[] = Array.isArray(data.points)
            ? data.points
                .filter((p: { capturedAt?: string; lastPrice?: number }) => typeof p.capturedAt === "string" && Number.isFinite(p.lastPrice) && (p.lastPrice ?? 0) > 0)
                .map((p: { capturedAt: string; lastPrice: number }) => ({ capturedAt: p.capturedAt, lastPrice: p.lastPrice }))
            : [];
          setRawPoints(points);
          setPremiumLoadState("ready");
          setLastUpdatedAt(Date.now());
        })
        .catch(() => {
          if (!opts.silent) setPremiumLoadState("error");
        });
    },
    [isPremium, premiumUnderlying, premiumExpiry, premiumStrike, premiumType]
  );
  const fetchPremiumOnceRef = useRef(fetchPremiumOnce);
  fetchPremiumOnceRef.current = fetchPremiumOnce;

  useEffect(() => {
    if (!isPremium) return;
    setSessionTicks([]);
    fetchPremiumOnceRef.current({ silent: false });
  }, [isPremium, premiumUnderlying, premiumExpiry, premiumStrike, premiumType]);

  useVisiblePolling(() => fetchPremiumOnceRef.current({ silent: true }), 60_000, isPremium);

  const lastAppendedLivePrice = useRef<number | null>(null);
  useEffect(() => {
    lastAppendedLivePrice.current = null;
  }, [premiumUnderlying, premiumExpiry, premiumStrike, premiumType]);
  useEffect(() => {
    if (!isPremium || livePremium == null || livePremium <= 0) return;
    if (lastAppendedLivePrice.current === livePremium) return;
    lastAppendedLivePrice.current = livePremium;
    setSessionTicks((prev) => [...prev, { capturedAt: new Date().toISOString(), lastPrice: livePremium }]);
  }, [isPremium, livePremium]);

  const allPremiumPoints = useMemo(() => [...rawPoints, ...sessionTicks], [rawPoints, sessionTicks]);

  useEffect(() => {
    if (!isPremium) return;
    if (premiumLoadState === "error") {
      setState({ status: "error", message: "Premium history temporarily unavailable — try again shortly." });
      return;
    }
    if (premiumLoadState === "loading" && rawPoints.length === 0) {
      setState({ status: "loading" });
      return;
    }
    const bucketMs = bucketMsForInterval(interval);
    const candles = aggregatePremiumCandles(allPremiumPoints, bucketMs);
    const earliestCapturedAt = allPremiumPoints.length > 0 ? allPremiumPoints[0].capturedAt : null;
    setState({
      status: "ready",
      candles: candles.map((c) => ({ ...c })),
      prevClose: null,
      premiumMeta: { totalSnapshots: allPremiumPoints.length, earliestCapturedAt }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isPremium, premiumLoadState, allPremiumPoints, interval]);

  // ── Derived quote (equity/index only — premium mode's header uses the ──
  // caller's own `livePremium`, not a derived quote from candles, since a
  // sparse/skipped-bucket pseudo-candle series is a poor "last price"
  // source; the caller already has the authoritative live tick). Reads
  // `displayCandles` (not `state.candles`) so the header price/change ticks
  // in step with the same folded-in live quote the chart itself renders —
  // one source of truth, not two clocks. ──────────────────────────────────
  const lastClose = !isPremium && state.status === "ready" ? displayCandles[displayCandles.length - 1]?.close : undefined;
  const prevCloseValue = !isPremium && state.status === "ready" ? state.prevClose : undefined;
  useEffect(() => {
    if (isPremium || lastClose == null) {
      setQuote(null);
      return;
    }
    const reference = prevCloseValue ?? lastClose;
    const changeAbs = lastClose - reference;
    const changePct = reference > 0 ? (changeAbs / reference) * 100 : 0;
    setQuote({ price: lastClose, prevClose: prevCloseValue ?? null, changeAbs, changePct });
  }, [isPremium, lastClose, prevCloseValue]);

  return {
    candles: displayCandles,
    prevClose: state.status === "ready" ? state.prevClose : null,
    status: state.status,
    errorMessage: state.status === "error" ? state.message : state.status === "unsupported" ? state.note : null,
    sourceLabel: SOURCE_LABEL,
    title: feedTitle(feed),
    quote,
    premiumMeta: state.status === "ready" ? state.premiumMeta : null,
    lastUpdatedAt,
    pollIntervalMs: isPremium ? 60_000 : liveTicksActive ? LIVE_QUOTE_POLL_MS : equityPollMs,
    liveTicksActive
  };
}

const EMPTY_CANDLES: Candle[] = [];
