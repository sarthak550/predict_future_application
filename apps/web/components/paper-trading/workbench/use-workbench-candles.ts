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
 * premium-chart.tsx` already uses) returns the full raw snapshot history for
 * one contract — NOT interval-dependent server-side. Interval only changes
 * the CLIENT-side bucket width fed to `aggregatePremiumCandles`
 * (`premium-candles.ts`), so switching intervals never re-fetches, only
 * re-aggregates already-held raw points — a plain, synchronous `useMemo`
 * (2026-08-11 architecture-simplification pass; see that pass's own doc
 * further down for why this used to be a `useEffect` + `setState`, and the
 * real interval-switch race that caused). `feed.livePremium` (the options
 * terminal's own chain-derived price — ~15s during NSE trading hours as of
 * the 2026-08-07b poll/TTL fix, 30-60s off-hours, see
 * options-page-client.tsx's dedicated selected-contract poll and
 * optionChain.ts's `chainQuoteCacheTtlMs` — threaded in by the caller) now
 * folds into the forming bar through the EXACT SAME `foldQuoteIntoCandles`/
 * `extendProvisionalBar` mechanism the equity/index branch's `liveQuote`
 * uses below, not a parallel "session tick" implementation — one shared
 * mechanism for both feed kinds.
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
 * equity/index branches only (never optionPremium — its own chain-derived
 * `livePremium` is that feed's honest freshness ceiling, ~15s during market
 * hours as of 2026-08-07b, see this file's own doc above). Every fresh tick
 * is folded into the CURRENTLY FORMING bar's close (extending high/low only
 * if breached) by
 * `foldQuoteIntoCandles` below — a NEW `candles` array identity, same
 * mechanism the 60s/30s candle poll already relies on to reach
 * `kline-chart.tsx`'s data effect and the signals/rating pipeline
 * (`candlesKey` already includes last close/high/low, so nothing downstream
 * needed to change to pick this up). A tick landing outside the last bar's
 * own [timestamp, timestamp+intervalMs) window is handled by the rollover
 * fix below (2026-08-04) rather than always dropped outright. Closed bars
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
 *
 * **QA-round fixes, same day (2026-08-04), both founder-reported from live
 * prod (0d1d38e).**
 *
 * (1) INTERVAL RACE: chart-workbench.tsx initializes its interval state to
 * a hardcoded default, then timeframe-selector.tsx's mount effect restores
 * the PERSISTED interval via `onChange` one render later — two `url`s (old
 * default, then restored pick) fire in quick succession, and without a
 * guard whichever response resolved LAST painted, regardless of which one
 * the chip was actually showing. Fixed with `latestUrlRef`/
 * `latestPremiumKeyRef` below: every fetch path (the equity/index branch's
 * `fetchOnce` — which the 30s/60s background poll also calls, so this one
 * guard covers both — and the premium branch's `fetchPremiumOnce`, keyed on
 * contract identity since interval doesn't affect ITS fetch) drops its own
 * response unless it's still the most-recently-STARTED request when it
 * resolves. The quote-tick fold needed no separate guard for this: once
 * `state.candles` can never be stale, the existing per-bar timestamp-
 * identity checks (`sameBar`, `sameProvisional`) already self-heal any
 * cross-interval tick naturally (a stale tick almost never matches a new
 * interval's bar boundaries) — verified by tracing, not just assumed. The
 * actual ROOT CAUSE (the double-fetch itself) lives in chart-workbench.tsx,
 * out of scope for this file (concurrent edit by another engineer) — see
 * this pass's own report for the 1-line follow-up.
 *
 * (2) ROLLOVER STALL: `foldQuoteIntoCandles` dropping every out-of-window
 * tick meant the forming bar went visually dead at every interval boundary
 * until the next 30s/60s refetch — up to ~30s of freeze per bar, reading as
 * lag. Fixed with `extendProvisionalBar` + `provisionalBarRef`: a tick
 * landing in EXACTLY the next bucket after the real last bar creates (or
 * extends) one provisional bar client-side from that real price, capped at
 * one bar ahead (never chain-fabricated through a real outage) — see that
 * function's own doc for the full honesty/cap reasoning.
 *
 * **Architecture-simplification pass (2026-08-11), founder-directed —
 * premium now shares this EXACT forming-bar mechanism instead of a parallel
 * one.** Before this pass, the `optionPremium` branch built its own
 * "session tick" array (a `PremiumSnapshotPoint[]` of live chain ticks,
 * concatenated with the server-captured points and fed BACK INTO
 * `aggregatePremiumCandles` on every tick) and recomputed `state.candles`
 * for the whole series inside a `useEffect` + `setState`. Two problems,
 * found by live-reproducing the founder's exact complaint ("1min is not
 * working... I don't see candles", "5 min sometime shows it and sometimes
 * does not"):
 *
 * 1. A real, load-bearing RACE: `interval` (a primitive prop) flows straight
 *    through to `kline-chart.tsx` the SAME render it changes. `candles`
 *    (sourced from `state`, updated by `setState` inside a `useEffect`) only
 *    catches up ONE RENDER LATER. `kline-chart.tsx`'s own reload-decision
 *    effect is keyed on `interval` — so on an interval switch it fires
 *    IMMEDIATELY, calls `chart.setPeriod()`, and its DataLoader answers from
 *    `candlesRef.current`, which at that exact instant still holds the
 *    OLD interval's candles (this render hasn't received the new
 *    aggregation yet). That alone would just be one stale paint — except
 *    `kline-chart.tsx` also stamps `lastIntervalRef`/`lastFirstTsRef` from
 *    THIS (stale) run. One render later, when the CORRECT candles finally
 *    arrive via the aggregation effect's `setState`, `interval` hasn't
 *    changed again — so `intervalChanged` reads false. If the new
 *    interval's first bucket timestamp also happens to equal the stale
 *    one's (routine for premium: every interval's history starts at the
 *    same first captured snapshot, and bucket-flooring a timestamp that's
 *    already minute-aligned to a common boundary — e.g. 09:15 market
 *    open — often lands on the SAME epoch ms regardless of bucket width),
 *    `windowShifted` also reads false — so the correct data is
 *    misclassified as a mere "tail advance" (one bar pushed through the
 *    live-bar channel) instead of a full reload, and the chart is left
 *    showing the PRIOR interval's bars under the new interval's own label
 *    and active button state. Reproduced live, real dense 1-minute NIFTY
 *    history: switching 5m -> 1m left the canvas showing the 5m-shaped
 *    candle set while every other signal (active pill, axis banner,
 *    `interval` prop) correctly said "1m." This is the actual mechanism
 *    behind "5 min sometime shows it and sometimes does not" — it depends
 *    on whether the two intervals' first-bucket timestamps happen to
 *    coincide, which varies by time of day and capture history depth.
 *    Equity/index never hit this because a NEW interval there means a NEW
 *    NETWORK FETCH — `interval` and `candles` only ever change together,
 *    in the SAME commit, once the fetch resolves.
 * 2. A parallel, independent implementation of the exact same "fold a live
 *    tick into the forming bar" job `foldQuoteIntoCandles`/
 *    `extendProvisionalBar` already do correctly for equity/index — twice
 *    the surface area for the same bug class, and a chart that behaves
 *    differently under the hood for no honest reason.
 *
 * Fixed by DELETING the premium aggregation effect/state entirely.
 * `premiumCandles` below is now a plain `useMemo` over `[rawPoints,
 * interval]` — pure, synchronous, computed in the SAME render `interval`
 * changes in, so there is no lagging commit for the race to exploit.
 * `premiumTick` (a `LiveQuoteTick`-shaped value built from `feed.livePremium`
 * changes) now flows through the SAME `foldQuoteIntoCandles`/
 * `extendProvisionalBar` path — and the SAME `runningExtremesRef`/
 * `provisionalBarRef` — the equity/index branch uses; `displayCandles`
 * below is one shared memo for both feed kinds, not two.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { isNseWeekdayMarketHours } from "@predict-future/business-rules/papertrading/marketHours";
import { isIndexOptionUnderlying } from "@predict-future/business-rules/papertrading/optionContract";

import { useVisiblePolling } from "@/components/paper-trading/use-visible-polling";
import { useLiveQuoteTick, LIVE_QUOTE_POLL_MS, type LiveQuoteTick } from "@/components/paper-trading/use-live-quote-tick";
import { aggregatePremiumCandles, type PremiumSnapshotPoint } from "./premium-candles";

/** Raw fetched shape from `/api/paper-trading/options/premium-history` — carries `captureIntervalSec` for `premiumMeta`'s own disclosure label only (see that field's doc below); `aggregatePremiumCandles` itself no longer reads it (see premium-candles.ts's own module doc on the architecture-simplification pass). */
interface RawPremiumPoint extends PremiumSnapshotPoint {
  captureIntervalSec?: number;
}

export type CandleInterval = "1m" | "5m" | "15m" | "30m" | "60m" | "1d";

export const WORKBENCH_INTERVALS: CandleInterval[] = ["1m", "5m", "15m", "30m", "60m", "1d"];

/**
 * W3, T5/T6 — premium mode's offered timeframe set.
 *
 * **Interval-parity cadence project (2026-08-07)** — founder, verbatim:
 * "why the fuck we do have onli 15m and 30 min sticks, why cant we have same
 * as stocks." Widened from a flat 15m/30m-only set (built around a uniform
 * 5-minute capture cadence) now that `apps/api`'s premiumCapture.ts captures
 * INDEX underlyings every 1 minute and STOCK underlyings every 5 minutes
 * (see that file's own module doc for the full cadence-split reasoning —
 * the short version: full 1m-1d parity for every underlying would have
 * meant either an unbounded write-volume risk or capturing data we can't
 * honestly aggregate). `premiumIntervalsFor` below returns the set that's
 * actually TRUE for a given contract's own native cadence — an index
 * contract offers full 1m-1d parity; a stock contract offers 5m-1d (1m is
 * deliberately withheld for stocks — offering it would either always
 * resolve to `premium-candles.ts`'s native-granularity 1-sample-per-bar path
 * misleadingly implying 1-minute PRECISION when the underlying capture is
 * still only every 5 minutes, or render mostly-empty buckets; neither is
 * honest).
 */
export const PREMIUM_INTERVALS_INDEX: CandleInterval[] = ["1m", "5m", "15m", "30m", "60m", "1d"];
export const PREMIUM_INTERVALS_STOCK: CandleInterval[] = ["5m", "15m", "30m", "60m", "1d"];

/** The offered timeframe set for a premium-mode contract, keyed on the SAME index/stock membership premiumCapture.ts uses server-side to decide capture cadence — see that constant's own doc. */
export function premiumIntervalsFor(underlying: string): CandleInterval[] {
  return isIndexOptionUnderlying(underlying) ? PREMIUM_INTERVALS_INDEX : PREMIUM_INTERVALS_STOCK;
}

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
 * contract's live premium, straight off the options terminal's own
 * chain-derived price — ~15s during NSE trading hours as of the 2026-08-07b
 * dedicated poll/TTL fix — the SAME value `PremiumChart`'s own
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
  /** Raw (pre-aggregation) snapshot count for this contract (server-captured rows + in-session live ticks). */
  totalSnapshots: number;
  /** The real earliest snapshot's ISO timestamp — feeds the "since {date}" label. Never hardcoded. */
  earliestCapturedAt: string | null;
  /**
   * Interval-parity cadence project (2026-08-07) — the real earliest point
   * whose OWN `captureIntervalSec` is native-granularity for the currently
   * selected interval (`<=60s`, i.e. the 1-minute index track or a
   * finer in-session tick) — never a hardcoded ship date. `null` when no
   * such point exists yet (every captured row so far is coarser than 1
   * minute — normal for a stock contract, or for an index contract before
   * this project's first 1-minute sample). Drives the honesty disclosure:
   * "fine-grained history begins {date}," never implying continuity
   * further back than what was genuinely captured at that cadence.
   */
  earliestFineGrainedCapturedAt: string | null;
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
 * itself hasn't closed yet. A tick landing at or after that window is NOT
 * this function's concern any more (2026-08-04 rollover fix — see
 * `extendProvisionalBar` below for what happens then); callers only reach
 * this function once they've already confirmed the tick is in-window.
 * Every bar before the last is never touched.
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

/**
 * Rollover fix (2026-08-04, founder-reported: "candles are changing but
 * still laggy"). Before this, a tick landing AFTER the real last bar's own
 * window was simply dropped — meaning the forming bar went visually DEAD at
 * every interval boundary until the next 30s/60s candle poll delivered the
 * real new bar (up to ~30s of freeze per bar, which reads as lag even
 * though ticks are still arriving underneath).
 *
 * This creates (or extends) a PROVISIONAL next bar client-side instead —
 * exactly what TradingView itself does at every boundary, and still
 * honest: the provisional bar's `open`/`high`/`low`/`close` are built
 * ENTIRELY from real traded prices (this hook's own quote ticks, the same
 * ones `foldQuoteIntoCandles` uses), its `timestamp` is the real, exact
 * next interval boundary (`realLast.timestamp + intervalMs` — never a
 * guessed or rounded value), and `volume: 0` (a genuinely unknown volume is
 * never invented). The very next successful candle refetch is still the
 * sole correction authority: once `state.candles`'s own real last bar
 * reaches or passes this timestamp, `useWorkbenchCandles`' commit-phase
 * effect discards the provisional outright — the real bar (same timestamp,
 * so klinecharts replaces in place rather than removing+re-adding — no
 * flicker) or a later real bar simply takes over.
 *
 * Only ONE bar is ever fabricated ahead of the real last one: `tick.asOf`
 * must fall inside `[nextBarStart, nextBarStart + intervalMs)` — exactly
 * the next bucket. If a SECOND boundary has already passed with still no
 * refetch (`tick.asOf >= nextBarStart + intervalMs`), this returns `null`
 * and the tick is dropped — chain-fabricating bar after bar through a real
 * data outage would stop being "the next honest bar" and start being
 * invented history. The heartbeat chip is left to go stale in that case,
 * on purpose: an honest signal that something is actually wrong, rather
 * than a chart that keeps looking alive through a genuine outage.
 *
 * `existingProvisional` (the caller's own `provisionalBarRef`) lets a
 * SECOND tick within the same still-open provisional bucket EXTEND it
 * (open stays fixed at the first tick's price, high/low accumulate, close
 * tracks the latest) rather than each tick starting a fresh single-point
 * bar — same "running extremes, not re-derived from scratch" discipline
 * `foldQuoteIntoCandles`'s own `runningHigh`/`runningLow` params apply to
 * the real-bar case.
 */
function extendProvisionalBar(realLast: Candle, intervalMs: number, tick: LiveQuoteTick, existingProvisional: Candle | null): Candle | null {
  const nextBarStart = realLast.timestamp + intervalMs;
  const nextBarEnd = nextBarStart + intervalMs;
  if (tick.asOf < nextBarStart || tick.asOf >= nextBarEnd) return null;

  const sameProvisional = existingProvisional != null && existingProvisional.timestamp === nextBarStart;
  const open = sameProvisional ? existingProvisional.open : tick.price;
  const high = sameProvisional ? Math.max(existingProvisional.high, tick.price) : tick.price;
  const low = sameProvisional ? Math.min(existingProvisional.low, tick.price) : tick.price;
  return { timestamp: nextBarStart, open, high, low, close: tick.price, volume: 0 };
}

function premiumHistoryUrl(underlying: string, expiry: string, strikePrice: number, optionType: "CE" | "PE"): string {
  return `/api/paper-trading/options/premium-history?underlying=${encodeURIComponent(underlying)}&expiry=${encodeURIComponent(expiry)}&strike=${strikePrice}&type=${optionType}`;
}

function feedTitle(feed: WorkbenchFeed): string {
  if (feed.kind === "equity") return feed.symbol;
  if (feed.kind === "index") return feed.symbol;
  return `${feed.underlying} ${feed.strikePrice} ${feed.optionType}`;
}

/** Bucket width for every premium-mode interval — widened 2026-08-07 from a 15m/30m-only mapping to the full set (see `PREMIUM_INTERVALS_INDEX`/`PREMIUM_INTERVALS_STOCK`'s own doc). */
const PREMIUM_BUCKET_MS: Record<CandleInterval, number> = {
  "1m": 60_000,
  "5m": 5 * 60_000,
  "15m": 15 * 60_000,
  "30m": 30 * 60_000,
  "60m": 60 * 60_000,
  "1d": 24 * 60 * 60_000
};

function bucketMsForInterval(interval: CandleInterval): number {
  return PREMIUM_BUCKET_MS[interval];
}

/** Threshold for `premiumMeta.earliestFineGrainedCapturedAt`'s own disclosure label — matches premiumCapture.ts's FAST_TRACK_CAPTURE_INTERVAL_SEC (60s, the index track) exactly. Copy-label purpose only now (see premium-candles.ts's own module doc) — no longer read by aggregation itself. */
const FINE_GRAINED_MAX_INTERVAL_SEC = 60;

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
  const [equityState, setEquityState] = useState<CandleFetchState>({ status: "loading" });
  const [quote, setQuote] = useState<WorkbenchQuote | null>(null);
  const [lastUpdatedAt, setLastUpdatedAt] = useState<number | null>(null);

  const isPremium = feed.kind === "optionPremium";
  const url = feedUrl(feed, interval);

  // Interval-race fix (2026-08-04, QA-caught: "select 1m, refresh -> chip
  // shows 1m but bars are 5m"). Root cause traced to chart-workbench.tsx
  // initializing chartInterval to a hardcoded default, then
  // timeframe-selector.tsx's mount effect restoring the PERSISTED interval
  // via onChange one render later — two `url`s fire in quick succession
  // (e.g. the 5m candles URL, then the 1m one), and without a guard here
  // whichever response resolves LAST paints, regardless of which one is
  // still wanted. `latestUrlRef` is a plain "which request is currently
  // authoritative" ref (an effect-local cancelled-flag idiom, not an
  // AbortController — nothing here needs to actually cancel the underlying
  // network request, only to ignore a superseded one's result): set
  // synchronously the instant a NEW `fetchOnce` call starts, checked again
  // inside every one of that SAME call's own `.then`/`.catch` — a response
  // is applied to `state` ONLY if `url` (captured by this call's own
  // closure) still equals `latestUrlRef.current` when it resolves. This
  // also transitively fixes the SAME hole in the 30s/60s background poll
  // below, since it calls this identical `fetchOnce` — one guard, two
  // call sites, no separate code needed for the poll path.
  const latestUrlRef = useRef<string | null>(null);

  // ── Equity/index branch (W2, unchanged). ────────────────────────────────
  const fetchOnce = useCallback(
    (opts: { silent: boolean }) => {
      if (!url) return; // optionPremium — handled by the separate effect below.
      latestUrlRef.current = url;
      if (!opts.silent) setEquityState({ status: "loading" });
      fetch(url, { cache: "no-store" })
        .then(async (res) => {
          if (!res.ok) throw new Error(`candles fetch ${res.status}`);
          return (await res.json()) as { candles?: unknown; prevClose?: number | null };
        })
        .then((body) => {
          if (latestUrlRef.current !== url) return; // superseded by a newer interval/symbol request — drop silently, never paint stale data under the wrong chip.
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
            if (!opts.silent) setEquityState({ status: "error", message: "No candle data available for this instrument right now." });
            return;
          }
          const prevClose = typeof body.prevClose === "number" ? body.prevClose : null;
          setEquityState({ status: "ready", candles, prevClose, premiumMeta: null });
          setLastUpdatedAt(Date.now());
        })
        .catch(() => {
          if (latestUrlRef.current !== url) return; // superseded — don't show a stale error for a request nobody's waiting on any more either.
          // Same "silent poll never regresses a working chart" posture as
          // price-chart.tsx's fetchIntraday — a transient background blip
          // keeps showing the last good series.
          if (!opts.silent) setEquityState({ status: "error", message: "Candle data temporarily unavailable — try again shortly." });
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

  // ── optionPremium branch (W3, T5) — raw fetch only. Raw snapshot points
  // are fetched once per CONTRACT identity (never on an interval change —
  // the endpoint's own data doesn't vary by interval, only the client-side
  // bucket width does). Aggregation into candles happens below, as a plain
  // `useMemo` over these raw points — see this file's own module doc
  // (2026-08-11 pass) for why that's now a `useMemo`, not a `useEffect` +
  // `setState`.
  const premiumUnderlying = isPremium ? feed.underlying : null;
  const premiumExpiry = isPremium ? feed.expiry : null;
  const premiumStrike = isPremium ? feed.strikePrice : null;
  const premiumType = isPremium ? feed.optionType : null;
  const livePremium = isPremium ? feed.livePremium : null;

  const [rawPoints, setRawPoints] = useState<RawPremiumPoint[]>([]);
  const [premiumLoadState, setPremiumLoadState] = useState<"loading" | "ready" | "error">("loading");

  // Same interval-race class of bug applies here too: rapidly switching the
  // SELECTED CONTRACT (strike/expiry/type) can fire two premium-history
  // fetches in quick succession — this key (not `url2`, which doesn't
  // include `interval`/isn't affected by it, but IS the actual fetch
  // identity: contract identity, not interval) is the one that must match
  // at resolution time. Same "ignore a superseded response, never cancel
  // the underlying request" posture as `latestUrlRef` above.
  const latestPremiumKeyRef = useRef<string | null>(null);

  const fetchPremiumOnce = useCallback(
    (opts: { silent: boolean }) => {
      if (!isPremium || premiumUnderlying == null || premiumExpiry == null || premiumStrike == null || premiumType == null) return;
      const key = `${premiumUnderlying}|${premiumExpiry}|${premiumStrike}|${premiumType}`;
      latestPremiumKeyRef.current = key;
      if (!opts.silent) setPremiumLoadState("loading");
      const url2 = premiumHistoryUrl(premiumUnderlying, premiumExpiry, premiumStrike, premiumType);
      fetch(url2, { cache: "no-store" })
        .then((res) => (res.ok ? res.json() : Promise.reject(new Error(String(res.status)))))
        .then((data: { points?: unknown }) => {
          if (latestPremiumKeyRef.current !== key) return; // superseded by a newer contract selection — drop silently.
          const points: RawPremiumPoint[] = Array.isArray(data.points)
            ? data.points
                .filter(
                  (p: { capturedAt?: string; lastPrice?: number }) =>
                    typeof p.capturedAt === "string" && Number.isFinite(p.lastPrice) && (p.lastPrice ?? 0) > 0
                )
                .map((p: { capturedAt: string; lastPrice: number; captureIntervalSec?: number }) => ({
                  capturedAt: p.capturedAt,
                  lastPrice: p.lastPrice,
                  captureIntervalSec: p.captureIntervalSec
                }))
            : [];
          setRawPoints(points);
          setPremiumLoadState("ready");
          setLastUpdatedAt(Date.now());
        })
        .catch(() => {
          if (latestPremiumKeyRef.current !== key) return; // superseded — don't show a stale error for a contract nobody's viewing any more either.
          if (!opts.silent) setPremiumLoadState("error");
        });
    },
    [isPremium, premiumUnderlying, premiumExpiry, premiumStrike, premiumType]
  );
  const fetchPremiumOnceRef = useRef(fetchPremiumOnce);
  fetchPremiumOnceRef.current = fetchPremiumOnce;

  useEffect(() => {
    if (!isPremium) return;
    fetchPremiumOnceRef.current({ silent: false });
  }, [isPremium, premiumUnderlying, premiumExpiry, premiumStrike, premiumType]);

  useVisiblePolling(() => fetchPremiumOnceRef.current({ silent: true }), 60_000, isPremium);

  // Aggregation is now a plain, synchronous `useMemo` over the raw points —
  // no `useEffect`/`setState` round-trip, so `interval` and the candles it
  // produces always land in the SAME render/commit (see this file's own
  // module doc, 2026-08-11 pass, for the race this closes). Switching
  // 15m/30m/etc still never re-fetches — only re-derives from the SAME
  // `rawPoints` already held in state.
  const premiumBucketMs = bucketMsForInterval(interval);
  const premiumCandles = useMemo(() => aggregatePremiumCandles(rawPoints, premiumBucketMs), [rawPoints, premiumBucketMs]);
  const premiumMeta = useMemo<PremiumMeta | null>(() => {
    if (rawPoints.length === 0) return null;
    const earliestFineGrained = rawPoints.find((p) => (p.captureIntervalSec ?? 300) <= FINE_GRAINED_MAX_INTERVAL_SEC);
    return { totalSnapshots: rawPoints.length, earliestCapturedAt: rawPoints[0].capturedAt, earliestFineGrainedCapturedAt: earliestFineGrained?.capturedAt ?? null };
  }, [rawPoints]);
  const premiumState = useMemo<CandleFetchState>(() => {
    if (premiumLoadState === "error") return { status: "error", message: "Premium history temporarily unavailable — try again shortly." };
    if (premiumLoadState === "loading" && rawPoints.length === 0) return { status: "loading" };
    return { status: "ready", candles: premiumCandles, prevClose: null, premiumMeta };
  }, [premiumLoadState, rawPoints.length, premiumCandles, premiumMeta]);

  // The one `state` the rest of this hook reads from here on, whichever
  // feed kind is active — see module doc for why this union (rather than
  // two parallel code paths) is exactly what closes the interval race.
  const state = isPremium ? premiumState : equityState;

  // Premium's own live tick — `feed.livePremium`, the options chain's
  // ~15s-during-market-hours poll (owned by the caller, not fetched here;
  // see `WorkbenchFeed`'s own doc) — now flows through the EXACT SAME
  // forming-bar mechanism as equity/index's `liveQuote` below, instead of a
  // parallel "session tick" array that used to feed back into aggregation.
  // Deduped the same way `useLiveQuoteTick` dedupes real polls: only a
  // genuinely CHANGED price becomes a new tick, and `asOf` is stamped at
  // the moment it's noticed here (this hook's own receipt clock), matching
  // `LiveQuoteTick.asOf`'s own "local clock, not upstream" contract.
  const [premiumTick, setPremiumTick] = useState<LiveQuoteTick | null>(null);
  const lastPremiumTickPrice = useRef<number | null>(null);
  useEffect(() => {
    lastPremiumTickPrice.current = null;
    setPremiumTick(null);
  }, [premiumUnderlying, premiumExpiry, premiumStrike, premiumType]);
  useEffect(() => {
    if (!isPremium || livePremium == null || livePremium <= 0) return;
    if (lastPremiumTickPrice.current === livePremium) return;
    lastPremiumTickPrice.current = livePremium;
    setPremiumTick({ price: livePremium, asOf: Date.now() });
  }, [isPremium, livePremium]);

  // Running intrabar high/low for the REAL (server-fetched or aggregated)
  // last bar — `runningExtremesRef.current.barTimestamp` identifies which
  // bar it belongs to. See `foldQuoteIntoCandles`'s own doc for why a
  // running value (not the base data's own high/low, read fresh on every
  // fold) is required for a monotonic wick. Updated in a COMMIT-phase
  // effect below, read purely from `state.candles` (never from
  // `displayCandles`, which can also hold a provisional bar past the real
  // one — this ref is strictly about the real bar's own accumulation,
  // decoupled from the rollover mechanism below). Shared by both feed
  // kinds now — one mechanism, not two.
  const runningExtremesRef = useRef<{ barTimestamp: number; high: number; low: number } | null>(null);

  // Rollover fix (2026-08-04) — the currently-held PROVISIONAL bar, if any
  // (see `extendProvisionalBar`'s own doc). `null` whenever there isn't
  // one. Also updated only in the commit-phase effect below. Shared by both
  // feed kinds.
  const provisionalBarRef = useRef<Candle | null>(null);

  // The array the rest of this hook (and its caller) actually reads: the
  // base candles with the live tick folded into the forming bar (or, past
  // its window, a provisional next bar appended), when applicable. One
  // shared memo for equity/index (`liveQuote`) and optionPremium
  // (`premiumTick`) — see module doc for why unifying this was the actual
  // fix, not just a tidy-up. A fresh identity here is exactly what
  // kline-chart.tsx's data effect and the signals/rating pipeline
  // (`candlesKey`) are already built to react to.
  const displayCandles = useMemo(() => {
    if (state.status !== "ready") return EMPTY_CANDLES;
    if (intervalMs == null) return state.candles; // "1d" — both feed kinds skip live-fold identically, see INTRADAY_INTERVAL_MS's own doc.

    const tick = isPremium ? premiumTick : liveQuote;
    if (!tick) return state.candles;

    const last = state.candles[state.candles.length - 1];
    if (!last) return state.candles;

    const bucketEnd = last.timestamp + intervalMs;
    if (tick.asOf >= last.timestamp && tick.asOf < bucketEnd) {
      // Still inside the real last bar's own window — absorb the base
      // data's own fresh high/low for this SAME bar without discarding
      // anything an earlier tick this render-cycle already recorded. A bar
      // timestamp that doesn't match what's tracked means a genuinely NEW
      // bar (rollover, interval switch, or first load) — starts fresh from
      // the base data's own reported extremes, never carrying a prior
      // bar's high/low forward.
      const running = runningExtremesRef.current;
      const sameBar = running != null && running.barTimestamp === last.timestamp;
      const high = sameBar ? Math.max(running.high, last.high) : last.high;
      const low = sameBar ? Math.min(running.low, last.low) : last.low;
      return foldQuoteIntoCandles(state.candles, tick, intervalMs, high, low);
    }

    // Past the real last bar's window — the rollover case. Either extends
    // the already-held provisional bar or starts a fresh one; `null` means
    // the tick doesn't belong to exactly the next bucket, so it's dropped
    // and `state.candles` is returned unchanged.
    const provisional = extendProvisionalBar(last, intervalMs, tick, provisionalBarRef.current);
    if (!provisional) return state.candles;
    return [...state.candles, provisional];
  }, [state, isPremium, premiumTick, liveQuote, intervalMs]);

  // Commit-phase bookkeeping for both refs above — reads back whatever
  // `state`/`displayCandles` this render actually settled on. Never
  // mutated during the render/memo itself (this hook must stay pure during
  // render); a ref written here is only ever READ by the NEXT render's
  // memo, never by this one. Shared by both feed kinds.
  useEffect(() => {
    if (state.status !== "ready") return;
    const realLast = state.candles[state.candles.length - 1];
    if (!realLast) return;

    const running = runningExtremesRef.current;
    runningExtremesRef.current =
      running != null && running.barTimestamp === realLast.timestamp
        ? { barTimestamp: realLast.timestamp, high: Math.max(running.high, realLast.high), low: Math.min(running.low, realLast.low) }
        : { barTimestamp: realLast.timestamp, high: realLast.high, low: realLast.low };

    const displayLast = displayCandles[displayCandles.length - 1];
    const stillProvisional = displayLast != null && displayLast.timestamp > realLast.timestamp;
    if (provisionalBarRef.current != null && realLast.timestamp >= provisionalBarRef.current.timestamp) {
      provisionalBarRef.current = null;
    }
    if (stillProvisional) provisionalBarRef.current = displayLast;
  }, [state, displayCandles]);

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
