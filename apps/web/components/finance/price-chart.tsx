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
 *
 * Quote-driven intrabar ticks (founder complaint, live market open,
 * 2026-08-04): between `pollIntervalMs` background refreshes of the FULL 1D
 * series, this chart used to sit still. `quoteSource` (optional — see its
 * own prop doc) now drives a fast (~4-5s) `useLiveQuoteTick` poll while
 * parked on 1D, appending each fresh tick as a new point rather than
 * overwriting anything — the same honest "session tick" pattern
 * `premium-chart.tsx`/the workbench's `optionPremium` branch already
 * established. The background `pollIntervalMs` full refetch stays the
 * correction authority: every time it lands, the locally-appended ticks are
 * discarded (see `fetchIntraday`'s success handler) since the server's own
 * fresh series has by then already absorbed whatever really happened.
 */

import { Loader2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  CANCEL_HIT_DIAMETER,
  DRAG_HIT_STROKE_WIDTH,
  clampLineY,
  priceAtFraction,
  snapToTick,
  type ChartOrderLine,
  type OrderSide,
  type OrderVariant
} from "@/components/finance/chart-order-lines";
import { ChartOrderIntentPopover } from "@/components/finance/chart-order-intent-popover";
import { ChartAxisPlusButton } from "@/components/finance/chart-axis-plus-button";
import { ChartContextMenu } from "@/components/finance/chart-context-menu";
import { ChartTradeHint, useTradeHintDismissed } from "@/components/finance/chart-trade-hint";
import { useLiveQuoteTick } from "@/components/paper-trading/use-live-quote-tick";

export type { ChartOrderLine } from "@/components/finance/chart-order-lines";

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

/** localStorage key for the last-picked timeframe — a device-wide viewing preference, not per-stock. */
const TIMEFRAME_STORAGE_KEY = "pf.chart.timeframe";

function isTimeframeKey(v: string | null): v is TimeframeKey {
  return TIMEFRAMES.some((t) => t.key === v);
}

export function PriceChart({
  series,
  symbol,
  intradaySource,
  defaultTimeframe,
  onQuoteChange,
  onOrderIntentConfirm,
  orderLines,
  onOrderLineDrag,
  onOrderLineCancel,
  pollIntervalMs,
  quoteSource,
}: {
  series: PricePoint[];
  symbol: string;
  /**
   * Trading Terminal UI Overhaul (Sprint A, T2) — additive, optional. Points
   * the 1D fetch at a different upstream instead of the default
   * `/api/instruments/${symbol}/intraday` (e.g.
   * `/api/instruments/index/NIFTY/intraday` for the options terminal's index
   * underlying chart). Omitted: zero behavior change for every existing
   * caller. The pointed-at endpoint MUST return the same
   * `{prevClose, points, sessionLabel}` shape as the default equity proxy.
   */
  intradaySource?: { url: string };
  /**
   * Trading Terminal UI Overhaul (Sprint A, T6) — additive, optional. Overrides
   * the initial timeframe (still overridable by the user's own
   * localStorage-remembered pick on subsequent visits, same as today). Used by
   * the options terminal's index underlying chart, which has no EOD `series`
   * to show on any timeframe but 1D. Omitted: default stays "3M", zero
   * behavior change for every existing caller.
   */
  defaultTimeframe?: TimeframeKey;
  /**
   * Trading Terminal UI Overhaul (Sprint A, T4) — additive, optional. Fires
   * whenever the chart's own last-price/prevClose/change figures change, so
   * terminal-header.tsx can source its spot + day-change stat from this one
   * chart fetch instead of a second network call. Omitted: zero behavior
   * change for every existing caller.
   */
  onQuoteChange?: (quote: { price: number; prevClose: number | null; changeAbs: number; changePct: number } | null) => void;
  /**
   * Chart Trading + SL/TP (Sprint C, C2) — additive, optional. REPLACES
   * Sprint B's `onPriceClick(price)` (which fired immediately on click with
   * a hardcoded LIMIT assumption).
   *
   * Interaction-model rework (2026-08-04) — founder complaint, verbatim:
   * "I cant have buy/sell popup on every click, thats irritating." A PLAIN
   * click on the chart no longer opens anything at all (the old `onClick`
   * on the `<svg>` below is gone outright, not just gated). This callback
   * now fires from exactly two deliberate summon points instead, mirroring
   * TradingView's own pattern: (1) hovering the price-axis band shows a
   * `ChartAxisPlusButton` at the crosshair price — clicking it opens the
   * SAME `ChartOrderIntentPopover` this sprint already built, prefilled
   * with that price; (2) right-clicking the chart opens a compact
   * `ChartContextMenu` ("Buy at ₹X / Sell at ₹X") that calls this callback
   * directly with a LIMIT order, no intermediate popover. Both paths — and
   * this callback itself — are still no-ops (nothing attached, nothing
   * rendered) when this prop is omitted, zero behavior change for the
   * three non-terminal PriceChart consumers.
   */
  onOrderIntentConfirm?: (input: { price: number; side: OrderSide; variant: OrderVariant }) => void;
  /**
   * Chart Trading + SL/TP (Sprint B, B1) — additive, optional. Resting
   * pending orders / an open position's cost basis, drawn as horizontal
   * lines. Rendered directly from this prop at render time — deliberately
   * NOT folded into any `useMemo` dependency array (see `geometry` below,
   * which stays keyed on `points` alone) so an order line far outside the
   * visible range can never trigger a re-scale: extending that memo's deps
   * to include `orderLines` would be exactly the object-identity trap this
   * file's `onQuoteChange` effect already had to be rewritten to avoid (see
   * that effect's comment). Omitted or empty: renders nothing extra.
   */
  orderLines?: ChartOrderLine[];
  /**
   * Chart Trading + SL/TP (Sprint B B1 / Sprint C C1) — additive, optional.
   * Sprint B accepted this prop (ref'd, unused). Sprint C wires it for real:
   * pointer-capture drag on any `line.draggable` line's widened invisible
   * hit-line, 0.05 tick-snapped, fires EXACTLY ONCE on pointerup with the
   * final price (never continuously during drag — the locked design is a
   * single commit per gesture, not a chattier per-pointermove protocol).
   * During the drag itself, the line's own on-screen position tracks the
   * pointer locally (see `dragState` below) WITHOUT touching the `orderLines`
   * prop or any parent state — the parent only learns the new price once,
   * on this callback, and owns the optimistic-UI/revert-on-4xx contract from
   * there (see paper-trading-dashboard.tsx's/futures-page-client.tsx's/
   * options-page-client.tsx's `usePriceOverrides` wiring).
   */
  onOrderLineDrag?: (id: string, newPrice: number) => void;
  /**
   * Chart Trading + SL/TP (Sprint B, B1) — additive, optional. Fires when a
   * `cancellable` order line's own cancel control is clicked — the click is
   * stopped from propagating to the chart's own `onPriceClick`, so cancelling
   * a line never also fires a stray click-to-prefill.
   */
  onOrderLineCancel?: (id: string) => void;
  /**
   * Chart Trading + SL/TP (Sprint B, B1) — additive, optional. Opt-in
   * background re-fetch of the 1D intraday series (terminals pass 60000).
   * Success-only state transitions: a failed background poll silently keeps
   * showing the last good series, never flips to the "loading"/"error"
   * states (those are reserved for the FIRST fetch) — no flicker on a
   * routine background refresh. No-op outside the 1D timeframe, and no-op
   * entirely when omitted (zero behavior change for every existing caller).
   */
  pollIntervalMs?: number;
  /**
   * Quote-driven intrabar ticks (founder complaint, live market open,
   * 2026-08-04) — additive, optional. Points a fast (~4-5s), market-hours-
   * gated last-price poll at a `{price, asOf}`-shaped endpoint (apps/web's
   * `/api/instruments/[symbol]/quote` or `/index/[symbol]/quote`), active
   * only while `timeframe === "1D"`. Each fresh tick is APPENDED as a new
   * point to the 1D series — the SAME "session tick" pattern
   * `use-workbench-candles.ts`'s `optionPremium` branch and
   * `premium-chart.tsx` already use for `livePremium` — never overwriting
   * an existing point, never fabricating one.
   *
   * Three states, not two:
   *   - `{ url }`: poll exactly that endpoint (futures/options-index
   *     underlyings pass their own `/index/[symbol]/quote`).
   *   - `false`: NEVER poll, full stop — required for any `symbol` that
   *     isn't a real NSE equity/index ticker (bonds, or any future non-
   *     equity consumer). REQUIRED, not optional-by-omission: QA caught a
   *     live regression (2026-08-04) where `app/bonds/[symbol]/page.tsx`
   *     omitted this prop entirely and silently inherited the bare-equity
   *     default below, turning what was previously a harmless ONE-SHOT
   *     `/intraday` 404 into a recurring real outbound Yahoo hit every
   *     ~4-5s for as long as a bond's "1D" chip stayed open during market
   *     hours — the exact "no background hammering" failure this whole
   *     feature was built to avoid. `intradaySource` being set is NOT a
   *     reliable proxy for "don't poll" (it correlates for the index
   *     callers that motivated the original design, but bonds omits BOTH
   *     props and still isn't equity) — every non-equity, non-index caller
   *     must say so explicitly.
   *   - omitted (`undefined`) AND `intradaySource` also omitted: defaults
   *     to this chart's own bare-equity quote endpoint
   *     (`/api/instruments/${symbol}/quote`) — the call-site audit behind
   *     the fix above (2026-08-04) confirmed this default is correct and
   *     wanted by every current caller in this shape (the equity dashboard,
   *     the options terminal's equity underlying branch, and the public
   *     `/instruments/[symbol]` page's equity branch — three real call
   *     sites, `symbol` is always a genuine NSE ticker in this shape).
   *     Omitted but `intradaySource` IS given (the indices page and the
   *     public instrument page's index branch): the live poll stays off
   *     rather than guessing a URL — zero behavior change for those.
   */
  quoteSource?: { url: string } | false;
}) {
  const [timeframe, setTimeframe] = useState<TimeframeKey>(defaultTimeframe ?? "3M");

  // Restore the last-picked timeframe AFTER hydration (reading localStorage
  // during render would mismatch the server-rendered default) — the caller's
  // defaultTimeframe only governs the FIRST render; a returning user's own
  // stored pick still wins, unchanged from pre-existing behavior. Skipped
  // entirely when `series` is empty (e.g. the options terminal's index
  // underlying chart, which has no EOD data on ANY timeframe but 1D) — a
  // device-wide "3M" preference restored onto a chart with zero EOD points
  // would just show "not enough price history" forever instead of the one
  // timeframe that actually has data.
  useEffect(() => {
    if (series.length === 0) return;
    try {
      const stored = window.localStorage.getItem(TIMEFRAME_STORAGE_KEY);
      if (isTimeframeKey(stored)) setTimeframe(stored);
    } catch {
      // Private mode / storage disabled — keep the default.
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const pickTimeframe = (key: TimeframeKey) => {
    setTimeframe(key);
    try {
      window.localStorage.setItem(TIMEFRAME_STORAGE_KEY, key);
    } catch {
      // Preference just won't survive the refresh.
    }
  };
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);
  const [intraday, setIntraday] = useState<IntradayFetchState>({ status: "idle" });
  const svgRef = useRef<SVGSVGElement | null>(null);
  // Sprint C, C1/C2 — the chart's own DOM wrapper, `position: relative` so
  // the order-intent popover (an absolutely-positioned sibling of the
  // `<svg>`, never a portal) can anchor to a click point in local
  // coordinates.
  const wrapperRef = useRef<HTMLDivElement | null>(null);

  // Sprint C, C1 — local, primitive-only drag state (render-loop law: this
  // must NEVER become a dependency of `geometry`/`points`/any effect that
  // also touches `orderLines` — see this file's own module doc on the
  // documented render-loop failure class, which the brief calls out as
  // "more dangerous during a drag than anywhere else in this program" since
  // a drag re-renders on every pointermove by nature). `price` is the LIVE,
  // un-snapped price tracking the pointer; only snapped (see `snapToTick`)
  // at pointerup, the single moment the parent is told about it.
  const [dragState, setDragState] = useState<{ id: string; price: number } | null>(null);
  // Set on pointerup, consumed (and reset) by the NEXT click — prevents the
  // native `click` event that follows a drag's pointerup from also opening
  // the order-intent popover at the drop point (decision: "click suppressed
  // after drag-end").
  const dragJustEndedRef = useRef(false);

  // Sprint C, C2 — the at-cursor order-intent popover's own state: null when
  // closed. Opened/repositioned by the price-axis "+" button (2026-08-04
  // rework — see that prop's own doc; NEVER by a plain chart click any
  // more), closed by a confirm, Escape, or an outside pointerdown (see
  // ChartOrderIntentPopover's own dismiss wiring).
  const [intentPopover, setIntentPopover] = useState<{ price: number; left: number; top: number } | null>(null);
  // Interaction-model rework (2026-08-04) — the price-axis "+" affordance's
  // own hover state (mouse-only; there is no hover on touch, so touch users
  // reach trading via the right-click/long-press context menu below
  // instead) and the right-click compact menu's state. See this file's own
  // `onOrderIntentConfirm` doc for the full rationale.
  const [axisHover, setAxisHover] = useState<{ top: number; price: number } | null>(null);
  const [contextMenu, setContextMenu] = useState<{ price: number; left: number; top: number } | null>(null);
  const [hintDismissed, dismissHint] = useTradeHintDismissed();

  // Quote-driven intrabar ticks (2026-08-04) — locally-appended live points,
  // reset every time a REAL server fetch lands (see fetchIntraday's success
  // handler below) since the fresh server series is always the correction
  // authority. `lastAppendedLiveTickPrice` skips a duplicate consecutive
  // point for an unchanged price, same dedupe convention as
  // use-workbench-candles.ts's optionPremium `sessionTicks`.
  const [liveTicks, setLiveTicks] = useState<IntradayTick[]>([]);
  const lastAppendedLiveTickPrice = useRef<number | null>(null);

  // Lazy-fetch: only hits the network the first time "1D" is selected, never
  // on mount and never for the EOD timeframes. Extracted into a `silent`-
  // aware callback (Sprint B, B1) so the SAME fetch logic backs both the
  // one-shot initial load below AND the opt-in `pollIntervalMs` background
  // refresh further down — never two hand-synced copies of the parsing/
  // validation logic.
  const fetchIntraday = useCallback(
    (opts: { silent: boolean }) => {
      if (!opts.silent) setIntraday({ status: "loading" });
      fetch(intradaySource?.url ?? `/api/instruments/${encodeURIComponent(symbol)}/intraday`)
        .then(async (res) => {
          if (!res.ok) throw new Error(`intraday fetch ${res.status}`);
          const body = await res.json();
          return body as { prevClose: number | null; points: [number, number][]; sessionLabel?: string };
        })
        .then((body) => {
          const points: IntradayTick[] = Array.isArray(body.points)
            ? body.points
                .filter((p) => Array.isArray(p) && Number.isFinite(p[0]) && Number.isFinite(p[1]) && p[1] > 0)
                .map(([t, price]) => ({ t, price }))
            : [];
          if (points.length < 2) {
            // A silent background poll that comes back thin keeps showing the
            // last good series — never regresses a working chart to "error"
            // over a transient upstream blip. Only the FIRST (non-silent)
            // fetch's thinness is a real "not enough data yet" state.
            if (!opts.silent) setIntraday({ status: "error" });
            return;
          }
          setIntraday({
            status: "ready",
            points,
            prevClose: typeof body.prevClose === "number" ? body.prevClose : null,
            sessionLabel: body.sessionLabel ?? "today",
          });
          // A real server fetch just landed (initial OR the background
          // pollIntervalMs refresh) — it's the correction authority, so any
          // locally-appended live ticks from before this point are now
          // superseded and must be dropped, never left dangling past a
          // real bar boundary the server itself has since captured.
          setLiveTicks([]);
          lastAppendedLiveTickPrice.current = null;
        })
        .catch(() => {
          if (!opts.silent) setIntraday({ status: "error" });
        });
    },
    [symbol, intradaySource?.url]
  );
  // Read through a ref so the polling effect below never has to list
  // `fetchIntraday` itself as a dependency — same self-cancellation-avoidance
  // discipline as every other callback in this file.
  const fetchIntradayRef = useRef(fetchIntraday);
  fetchIntradayRef.current = fetchIntraday;

  // Guards the initial fetch to once per symbol. A ref (not `intraday.status`
  // in the dep array) because setIntraday inside the effect would re-run it
  // and fire the previous run's cleanup — a self-cancellation that froze the
  // chart on "loading" forever. No mid-flight cancellation: settling state
  // while the user is on another timeframe is harmless (rendering is gated on
  // `timeframe === "1D"`), and React ignores setState after unmount.
  const intradayFetchedFor = useRef<string | null>(null);
  useEffect(() => {
    if (timeframe !== "1D" || intradayFetchedFor.current === symbol) return;
    intradayFetchedFor.current = symbol;
    fetchIntradayRef.current({ silent: false });
  }, [timeframe, symbol]);

  // Chart Trading + SL/TP (Sprint B, B1) — opt-in background re-fetch while
  // parked on 1D. Keyed ONLY on the primitive `pollIntervalMs`/`timeframe`
  // values (never on `fetchIntraday`'s own identity, which churns on every
  // `intradaySource?.url` object a caller might inline) — the exact render-
  // loop discipline this file's module doc calls out as its one documented
  // production incident.
  useEffect(() => {
    if (timeframe !== "1D" || !pollIntervalMs) return;
    const id = setInterval(() => fetchIntradayRef.current({ silent: true }), pollIntervalMs);
    return () => clearInterval(id);
  }, [timeframe, pollIntervalMs]);

  // Quote-driven intrabar ticks (2026-08-04) — see this file's own module
  // doc and `quoteSource`'s prop doc for the full 3-state default/override/
  // opt-out contract (the `=== false` check is a REQUIRED explicit opt-out
  // for non-equity symbols, not an incidental branch — see that doc for the
  // bonds-page regression this exists to prevent). Only ever active on 1D
  // (there's nothing to tick on an EOD timeframe).
  const effectiveQuoteUrl =
    quoteSource === false
      ? null
      : (quoteSource?.url ?? (intradaySource ? null : `/api/instruments/${encodeURIComponent(symbol)}/quote`));
  const liveTick = useLiveQuoteTick(effectiveQuoteUrl, timeframe === "1D");
  useEffect(() => {
    if (!liveTick || liveTick.price <= 0) return;
    if (lastAppendedLiveTickPrice.current === liveTick.price) return;
    lastAppendedLiveTickPrice.current = liveTick.price;
    // Callers that pass `pollIntervalMs` reset `liveTicks` to empty every
    // 60s (see fetchIntraday's success handler) — this array never grows
    // past ~13 points in practice for them. A caller WITHOUT a background
    // poll (e.g. the plain /instruments/[symbol] page, outside this pass's
    // explicit scope) has no such reset, so a very long single-page session
    // would otherwise accumulate indefinitely; a generous 500-point cap
    // (~35+ minutes of ticks at this cadence) bounds memory for that case
    // too without ever being reachable by the pollIntervalMs callers.
    setLiveTicks((prev) => [...prev, { t: liveTick.asOf, price: liveTick.price }].slice(-500));
  }, [liveTick]);

  const points = useMemo<ChartPoint[]>(() => {
    if (timeframe === "1D") {
      if (intraday.status !== "ready") return [];
      const allPoints = liveTicks.length > 0 ? [...intraday.points, ...liveTicks] : intraday.points;
      return allPoints.map((p) => ({ xValue: p.t, y: p.price, label: formatIstTime(p.t) }));
    }
    const tf = TIMEFRAMES.find((t) => t.key === timeframe)!;
    const windowed = tf.sessions === Infinity ? series : series.slice(-tf.sessions);
    return windowed.map((p, i) => ({ xValue: i, y: p.close, label: p.date }));
  }, [series, timeframe, intraday, liveTicks]);

  // Reports the chart's own last-price/prevClose/change figures out to the
  // caller (terminal-header.tsx) — computed unconditionally (before any early
  // `return` below) so this stays a plain hook call, not a conditionally-run
  // one. `onQuoteChange` is read via a ref, not a dependency, so a fresh
  // callback identity on the caller's own re-render never re-fires this
  // effect — same self-cancellation-avoidance pattern as this file's own 1D
  // fetch effect above.
  const computedQuote = useMemo(() => {
    if (points.length < 2) return null;
    const first = points[0];
    const last = points[points.length - 1];
    const referenceClose =
      timeframe === "1D" && intraday.status === "ready" && intraday.prevClose != null ? intraday.prevClose : first.y;
    const changeAbs = last.y - referenceClose;
    const changePct = referenceClose > 0 ? (changeAbs / referenceClose) * 100 : 0;
    return { price: last.y, prevClose: timeframe === "1D" && intraday.status === "ready" ? intraday.prevClose : null, changeAbs, changePct };
  }, [points, timeframe, intraday]);
  const onQuoteChangeRef = useRef(onQuoteChange);
  onQuoteChangeRef.current = onQuoteChange;
  // Sprint C, C1 — read through a ref (not a dependency anywhere), same
  // discipline as every other callback prop in this file.
  const onOrderLineDragRef = useRef(onOrderLineDrag);
  onOrderLineDragRef.current = onOrderLineDrag;
  const onOrderIntentConfirmRef = useRef(onOrderIntentConfirm);
  onOrderIntentConfirmRef.current = onOrderIntentConfirm;
  // Keyed on the quote's PRIMITIVE fields, never the memo object's identity:
  // an identity dep re-fires whenever any upstream memo recomputes — which a
  // caller can trigger every render with an inline `series={[]}` — and since
  // this effect's report causes that caller to re-render, an identity dep
  // turns one unstable prop into an infinite render loop (a frozen tab, found
  // the hard way on the options terminal's index chart).
  useEffect(() => {
    onQuoteChangeRef.current?.(computedQuote);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [computedQuote?.price, computedQuote?.prevClose, computedQuote?.changeAbs, computedQuote?.changePct]);

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
        <TimeframeChips timeframe={timeframe} setTimeframe={pickTimeframe} series={series} setHoverIdx={setHoverIdx} />
      </div>
    );
  }
  if (timeframe === "1D" && intraday.status === "error") {
    return (
      <div>
        <div className="rounded-xl border border-ink-100 bg-ink-50/40 p-6 text-sm text-ink-500">
          Intraday unavailable right now — try a daily timeframe below, or check back during market hours.
        </div>
        <TimeframeChips timeframe={timeframe} setTimeframe={pickTimeframe} series={series} setHoverIdx={setHoverIdx} />
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
        <TimeframeChips timeframe={timeframe} setTimeframe={pickTimeframe} series={series} setHoverIdx={setHoverIdx} />
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
    // Sprint C, C1 — crosshair suppressed during a drag: a dragged line's
    // pointermove events are handled entirely by that line's own hit-target
    // (see handleLinePointerMove below), but the SVG's own onMouseMove/
    // onTouchMove keep firing alongside them, and without this guard the
    // crosshair would visibly jitter/compete with the drag on every move.
    if (dragState) return;
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect) return;
    const frac = (clientX - rect.left) / rect.width;
    const idx = Math.round(frac * (points.length - 1));
    setHoverIdx(Math.max(0, Math.min(points.length - 1, idx)));
  };

  /** The pixel->price inverse for a given clientY, tick-snap NOT applied (callers snap where they need to — the live drag readout wants the raw value, only the final commit snaps). */
  const priceAtClientY = (clientY: number): number | null => {
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect || !rect.height) return null;
    const frac = (clientY - rect.top) / rect.height;
    return priceAtFraction(frac, H, PAD.top, PAD.bottom, geometry.min, geometry.max);
  };

  // Interaction-model rework (2026-08-04) — replaces the old "a plain click
  // opens the popover" handler entirely (removed outright, not just gated —
  // see this file's own `onOrderIntentConfirm` doc). Both the price-axis
  // "+" button and the right-click menu funnel through this ONE opener so
  // there's a single place that owns the popover's snap-to-tick + mutual-
  // exclusion with the OTHER new affordance (never both open at once).
  const openIntentPopoverAt = (price: number, left: number, top: number) => {
    if (!onOrderIntentConfirm) return;
    setContextMenu(null);
    setAxisHover(null);
    setIntentPopover({ price: snapToTick(price), left, top });
  };

  // Interaction-model rework (2026-08-04) — tracks the pointer against the
  // chart's own right-edge "price axis" band, screen-pixel-sized (NOT SVG
  // viewBox units — same discipline as DRAG_HIT_STROKE_WIDTH's own doc,
  // since a fixed viewBox-unit band would shrink/grow with the container).
  // Mouse-only: there's no hover on touch, so touch users reach trading via
  // the long-press-triggered context menu below instead (most mobile
  // browsers fire `contextmenu` on a long-press, giving touch users the
  // SAME summon point as a desktop right-click).
  const updateAxisHover = (clientX: number, clientY: number) => {
    if (!onOrderIntentConfirm || dragState || intentPopover || contextMenu) {
      setAxisHover(null);
      return;
    }
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect || !rect.width) {
      setAxisHover(null);
      return;
    }
    const axisBandWidth = Math.max(48, rect.width * 0.12);
    if (rect.right - clientX > axisBandWidth) {
      setAxisHover(null);
      return;
    }
    const price = priceAtClientY(clientY);
    const wrapperRect = wrapperRef.current?.getBoundingClientRect();
    if (price == null || !wrapperRect) {
      setAxisHover(null);
      return;
    }
    setAxisHover({ top: clientY - wrapperRect.top, price: snapToTick(price) });
  };

  // Interaction-model rework (2026-08-04) — right-click opens a compact
  // "Buy at ₹X / Sell at ₹X" menu (TradingView's own pattern), deriving the
  // price from the SAME pixel->price inverse the old click handler used.
  // Suppresses the browser's native context menu ONLY when this chart
  // actually has trading wired up (`onOrderIntentConfirm` present) — the
  // three non-terminal PriceChart consumers keep their normal browser menu,
  // zero behavior change (the `onContextMenu` prop below isn't even
  // attached when this prop is omitted).
  const handleContextMenu = (e: React.MouseEvent<SVGSVGElement>) => {
    e.preventDefault();
    const wrapperRect = wrapperRef.current?.getBoundingClientRect();
    const raw = priceAtClientY(e.clientY);
    if (!wrapperRect || raw == null) return;
    setIntentPopover(null);
    setAxisHover(null);
    setContextMenu({ price: snapToTick(raw), left: e.clientX - wrapperRect.left, top: e.clientY - wrapperRect.top });
  };

  // Sprint C, C1 — pointer-capture drag handlers for a `draggable` order
  // line's widened invisible hit-line. Pointer capture (set on pointerdown,
  // on the SAME element these handlers are attached to) is what lets the
  // drag keep tracking even once the pointer leaves the SVG's bounds
  // mid-drag — the spec retargets subsequent pointermove/pointerup events to
  // the capturing element regardless of where the pointer physically is.
  const handleLinePointerDown = (e: React.PointerEvent<SVGLineElement>, line: ChartOrderLine) => {
    if (!line.draggable || !onOrderLineDragRef.current) return;
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    setDragState({ id: line.id, price: line.price });
  };
  const handleLinePointerMove = (e: React.PointerEvent<SVGLineElement>) => {
    if (!dragState) return;
    e.stopPropagation();
    const raw = priceAtClientY(e.clientY);
    if (raw == null) return;
    setDragState((prev) => (prev ? { ...prev, price: raw } : prev));
  };
  const handleLinePointerUp = (e: React.PointerEvent<SVGLineElement>) => {
    if (!dragState) return;
    e.stopPropagation();
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
    const { id, price: originalPrice } = dragState;
    const finalPrice = snapToTick(dragState.price);
    setDragState(null);
    // `dragJustEndedRef` used to also suppress the native `click` that
    // follows a drag's pointerup from opening the order-intent popover;
    // that click path no longer exists at all (2026-08-04 interaction-model
    // rework — see this file's own `onOrderIntentConfirm` doc), so the flag
    // is now inert. Left set (harmless) rather than ripped out here — this
    // is drag-to-reprice's own code path, deliberately untouched by that
    // rework.
    dragJustEndedRef.current = true;
    // A tap-without-movement (pointerdown immediately followed by pointerup
    // at the same spot) snaps back to the SAME price — skip firing the
    // callback (and the resulting PATCH) for a no-op reprice.
    if (finalPrice === snapToTick(originalPrice)) return;
    onOrderLineDragRef.current?.(id, finalPrice);
  };
  const handleLinePointerCancel = (e: React.PointerEvent<SVGLineElement>) => {
    if (!dragState) return;
    e.stopPropagation();
    // A cancelled gesture (e.g. the OS intercepts the pointer sequence) is
    // NOT a commit — clear local state without ever calling
    // onOrderLineDrag, exactly like a revert with no network round trip.
    setDragState(null);
  };

  const footerNote =
    timeframe === "1D" && intraday.status === "ready"
      ? `1-minute ticks${effectiveQuoteUrl ? " + live" : ""} · ${intraday.sessionLabel}`
      : "Daily closes · updates after each session";

  return (
    <div ref={wrapperRef} className="relative">
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

      {/* Interaction-model rework (2026-08-04) — one-time discoverability hint, terminal-only (gated on onOrderIntentConfirm). */}
      {onOrderIntentConfirm && (
        <div className="mb-2">
          <ChartTradeHint dismissed={hintDismissed} onDismiss={dismissHint} />
        </div>
      )}

      {/* Chart */}
      <svg
        ref={svgRef}
        viewBox={`0 0 ${W} ${H}`}
        className="w-full cursor-crosshair touch-none select-none"
        onMouseMove={(e) => {
          onPointer(e.clientX);
          updateAxisHover(e.clientX, e.clientY);
        }}
        onMouseLeave={() => {
          setHoverIdx(null);
          setAxisHover(null);
        }}
        onTouchStart={(e) => onPointer(e.touches[0].clientX)}
        onTouchMove={(e) => onPointer(e.touches[0].clientX)}
        onTouchEnd={() => setHoverIdx(null)}
        onContextMenu={onOrderIntentConfirm ? handleContextMenu : undefined}
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
        {/*
          Chart Trading + SL/TP (Sprint B, B1 / Sprint C, C1) — order-line
          overlays. Rendered straight from the `orderLines` prop at render
          time, NOT via a memo keyed on it (see the prop's own doc comment
          above `geometry` stays keyed on `points` alone). Off-scale prices
          (outside [min,max]) clamp to the nearest edge via `clampLineY` and
          get a ▲/▼ badge instead of silently drawing at the wrong spot or
          widening the chart's own y-domain to fit them. A line currently
          being dragged (`dragState.id === line.id`) renders at the LOCAL
          drag price instead of `line.price` — the prop itself is never
          mutated, only this component's own render output during the drag.
        */}
        {orderLines && orderLines.length > 0 && (
          <g>
            {orderLines.map((line) => {
              const isDragging = dragState?.id === line.id;
              const renderPrice = isDragging ? dragState.price : line.price;
              const { y, offScale } = clampLineY(renderPrice, geometry.min, geometry.max, geometry.y);
              const color =
                line.kind === "pending-stop"
                  ? "#d97706"
                  : line.kind === "pending-limit"
                    ? "#0284c7"
                    : line.side === "SELL"
                      ? "#e11d48"
                      : "#059669";
              const dash = line.kind === "position" ? undefined : "4 3";
              const label = isDragging ? `${line.label.split(" @ ")[0]} @ ${formatRupees(snapToTick(dragState.price))}` : line.label;
              return (
                <g key={line.id}>
                  <line
                    x1={PAD.left}
                    x2={W - PAD.right}
                    y1={y}
                    y2={y}
                    stroke={color}
                    strokeWidth={isDragging ? 2.2 : 1.4}
                    strokeDasharray={dash}
                  />
                  {offScale ? (
                    <text x={W / 2} y={offScale === "above" ? y + 10 : y - 4} textAnchor="middle" fontSize="9" fontWeight={600} fill={color}>
                      {offScale === "above" ? "▲ " : "▼ "}
                      {label}
                    </text>
                  ) : (
                    <text x={W - PAD.right} y={y - 4} textAnchor="end" fontSize="9" fontWeight={600} fill={color}>
                      {label}
                    </text>
                  )}
                  {line.draggable && onOrderLineDrag && (
                    // Sprint C, C1/C3 — the widened invisible hit-line: 44
                    // screen-pixels tall regardless of viewBox scaling (see
                    // DRAG_HIT_STROKE_WIDTH's own doc), `pointerEvents: "all"`
                    // so a fully transparent stroke still hit-tests
                    // reliably on every browser (never relying on
                    // "visiblePainted" semantics).
                    <line
                      x1={PAD.left}
                      x2={W - PAD.right}
                      y1={y}
                      y2={y}
                      stroke="transparent"
                      strokeWidth={DRAG_HIT_STROKE_WIDTH}
                      vectorEffect="non-scaling-stroke"
                      style={{ pointerEvents: "all", cursor: "ns-resize" }}
                      onPointerDown={(e) => handleLinePointerDown(e, line)}
                      onPointerMove={handleLinePointerMove}
                      onPointerUp={handleLinePointerUp}
                      onPointerCancel={handleLinePointerCancel}
                    />
                  )}
                  {line.cancellable && onOrderLineCancel && (
                    <g
                      onClick={(e) => {
                        e.stopPropagation();
                        onOrderLineCancel(line.id);
                      }}
                      style={{ cursor: "pointer" }}
                    >
                      {/* Sprint C, C3 — screen-pixel-constant hit target (see CANCEL_HIT_DIAMETER's own doc), same non-scaling-stroke technique as the drag hit-line above. */}
                      <circle
                        cx={PAD.left + 8}
                        cy={y}
                        r={1}
                        stroke="transparent"
                        strokeWidth={CANCEL_HIT_DIAMETER}
                        vectorEffect="non-scaling-stroke"
                        style={{ pointerEvents: "all" }}
                      />
                      <circle cx={PAD.left + 8} cy={y} r={7} fill="#fff" stroke={color} strokeWidth={1.2} />
                      <text x={PAD.left + 8} y={y + 3} textAnchor="middle" fontSize="10" fontWeight={700} fill={color}>
                        ×
                      </text>
                    </g>
                  )}
                </g>
              );
            })}
          </g>
        )}
      </svg>

      {/* Interaction-model rework (2026-08-04) — the price-axis "+" affordance, shown only while hovering the axis band and nothing else is already open. */}
      {axisHover && !intentPopover && !contextMenu && onOrderIntentConfirm && (
        <ChartAxisPlusButton top={axisHover.top} onClick={() => openIntentPopoverAt(axisHover.price, (wrapperRef.current?.getBoundingClientRect().width ?? 0) - 24, axisHover.top)} />
      )}

      {/* Chart Trading + SL/TP (Sprint C, C2) — the order-intent popover, a plain absolutely-positioned sibling of the `<svg>` (never a portal — see chart-order-intent-popover.tsx's own doc). Opened by the "+" button above or the right-click menu below — never by a plain click any more (2026-08-04 rework). */}
      {intentPopover && onOrderIntentConfirm && (
        <ChartOrderIntentPopover
          price={intentPopover.price}
          currentPrice={last.y}
          left={intentPopover.left}
          top={intentPopover.top}
          onConfirm={(side, variant) => {
            onOrderIntentConfirmRef.current?.({ price: intentPopover.price, side, variant });
            setIntentPopover(null);
          }}
          onDismiss={() => setIntentPopover(null)}
        />
      )}

      {/* Interaction-model rework (2026-08-04) — right-click's compact "Buy at ₹X / Sell at ₹X" menu, firing onOrderIntentConfirm directly as a LIMIT order (no intermediate popover — a right-click is already an explicit "trade here"). */}
      {contextMenu && onOrderIntentConfirm && (
        <ChartContextMenu
          price={contextMenu.price}
          left={contextMenu.left}
          top={contextMenu.top}
          onBuy={() => {
            onOrderIntentConfirmRef.current?.({ price: contextMenu.price, side: "BUY", variant: "LIMIT" });
            setContextMenu(null);
          }}
          onSell={() => {
            onOrderIntentConfirmRef.current?.({ price: contextMenu.price, side: "SELL", variant: "LIMIT" });
            setContextMenu(null);
          }}
          onDismiss={() => setContextMenu(null)}
        />
      )}

      <TimeframeChips
        timeframe={timeframe}
        setTimeframe={pickTimeframe}
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
