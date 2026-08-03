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
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { useVisiblePolling } from "@/components/paper-trading/use-visible-polling";
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
  /** Founder-feedback pass (2026-08-06) — the cadence THIS hook is actually polling at right now, for the heartbeat chip's own "stale after 3x this" math and its cadence-note copy. Equity/index: `pollMsForInterval(interval)`; premium mode keeps its own fixed 60s (5-minute server-side snapshot cadence — see module doc). */
  pollIntervalMs: number;
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
  // source; the caller already has the authoritative live tick). ─────────
  const lastClose = !isPremium && state.status === "ready" ? state.candles[state.candles.length - 1]?.close : undefined;
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
    candles: state.status === "ready" ? state.candles : EMPTY_CANDLES,
    prevClose: state.status === "ready" ? state.prevClose : null,
    status: state.status,
    errorMessage: state.status === "error" ? state.message : state.status === "unsupported" ? state.note : null,
    sourceLabel: SOURCE_LABEL,
    title: feedTitle(feed),
    quote,
    premiumMeta: state.status === "ready" ? state.premiumMeta : null,
    lastUpdatedAt,
    pollIntervalMs: isPremium ? 60_000 : equityPollMs
  };
}

const EMPTY_CANDLES: Candle[] = [];
