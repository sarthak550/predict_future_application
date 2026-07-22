/**
 * Shadow portfolios (P3.3) — pure derivation of an analyst's auto-generated,
 * backtest-style paper portfolio from their graded ExpertOpinion calls.
 *
 * Shadow rule (CEO-locked, see the P3.3 assignment brief):
 *   - One SHADOW Portfolio per Expert with >=1 eligible call.
 *   - Eligible call = direction BULLISH + resolutionStatus in (RESOLVED_HIT,
 *     RESOLVED_MISS) + not suppressed + a mappable NSE symbol + quotes
 *     available for both the entry and exit sessions. The first four
 *     conditions are STATIC (checkable with no I/O) and are enforced by
 *     `filterShadowEligibleCalls` below; "quotes available" is DYNAMIC (needs
 *     StockEodQuote/bhavcopy data) and is therefore NOT checked here — the
 *     caller (apps/api/lib/portfolios/shadowGenerator.ts) resolves quote
 *     availability and only then decides whether a call is truly eligible.
 *   - Per call: BUY floor(50,000 / entryClose) shares (skip if qty < 1) at
 *     the publishedAt session's close; SELL the same quantity at the
 *     resolvedAt session's close.
 *   - Cash-capped, long-only, no partial fills: calls are processed
 *     chronologically (by publishedAt) against a simulated starting cash
 *     balance; a BUY whose cost exceeds the simulated cash on hand is
 *     skipped ENTIRELY (nothing is recorded for that call — see
 *     `planShadowTransactions`).
 *
 * Everything in this file is a pure function over plain DTOs — no Prisma, no
 * I/O, no `fetch` — exactly like ./engine.ts, so it's independently testable
 * and safe to call from both the one-time backfill script and the nightly
 * incremental cron without duplicating the simulation/session-mapping logic.
 */

// ─── Constants ───────────────────────────────────────────────────────────────

/** Simulated rupee position size per call, before flooring to a whole-share quantity. */
export const SHADOW_POSITION_SIZE = 50_000;

/**
 * How many calendar days forward of the target IST calendar date a session
 * mapping will search for a quote before giving up on that leg (BUY or SELL)
 * of a call. Covers ordinary weekends (2 days) and short holiday clusters
 * (e.g. a Friday + following Monday holiday pair) without unbounded lookahead.
 */
export const SESSION_SEARCH_FORWARD_CAP = 5;

const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;

// ─── Symbol mapping ──────────────────────────────────────────────────────────

/**
 * Maps an ExpertOpinion.instrumentTicker to the NSE symbol used by
 * StockEodQuote.symbol, or null when the ticker isn't shadow-portfolio-
 * mappable: index tickers (leading "^", e.g. "^NSEI", "^NSEBANK"), non-NSE
 * tickers (e.g. "GC=F" gold futures), or anything not ending in ".NS"/".BO".
 * BSE-suffixed tickers (".BO") map to the same bare symbol as NSE ones would
 * — StockEodQuote is NSE-only (bhavcopy-sourced), so a ".BO" call is only
 * resolvable if the same company also trades under that symbol on NSE, which
 * is the common case for BSE-primary-listed names quoted via a ".BO" ticker
 * in extraction but whose bhavcopy row is keyed by the bare NSE symbol.
 */
export function mapTickerToNseSymbol(instrumentTicker: string | null | undefined): string | null {
  if (!instrumentTicker) return null;
  if (instrumentTicker.startsWith("^")) return null;
  const match = /^(.+)\.(NS|BO)$/.exec(instrumentTicker);
  return match ? match[1] : null;
}

// ─── IST calendar-date <-> StockEodQuote.sessionDate mapping ────────────────

export interface IstCalendarDate {
  year: number;
  /** 1-12. */
  month: number;
  day: number;
}

/**
 * The IST calendar date an arbitrary UTC instant falls on (date-only; no
 * time-of-day). Mirrors `istDateParts` in apps/api/lib/marketMoves/bhavcopy.ts,
 * duplicated here (not imported) to keep this package free of apps/api
 * dependencies — bhavcopy.ts isn't exported for cross-app import.
 */
export function istCalendarDateOfInstant(instant: Date): IstCalendarDate {
  const ist = new Date(instant.getTime() + IST_OFFSET_MS);
  return { year: ist.getUTCFullYear(), month: ist.getUTCMonth() + 1, day: ist.getUTCDate() };
}

/**
 * The canonical StockEodQuote.sessionDate value for a given IST calendar
 * date: IST midnight of that date, expressed as a UTC instant (e.g. IST
 * calendar date 2026-07-20 -> 2026-07-19T18:30:00.000Z). Matches the storage
 * convention documented in apps/api/lib/marketMoves/bhavcopy.ts.
 */
export function istCalendarDateToSessionDate(date: IstCalendarDate): Date {
  return new Date(Date.UTC(date.year, date.month - 1, date.day, 0, 0, 0) - IST_OFFSET_MS);
}

/** Adds `deltaDays` calendar days to an IST calendar date (UTC-noon-anchored arithmetic — no DST in IST, so this is exact). */
export function shiftIstCalendarDate(date: IstCalendarDate, deltaDays: number): IstCalendarDate {
  const shifted = new Date(Date.UTC(date.year, date.month - 1, date.day + deltaDays, 12, 0, 0));
  return { year: shifted.getUTCFullYear(), month: shifted.getUTCMonth() + 1, day: shifted.getUTCDate() };
}

/**
 * The ordered sequence of candidate StockEodQuote.sessionDate values to try
 * when resolving a fill for `instant`: that instant's own IST calendar date,
 * then each of the next `forwardCap` calendar days, in order. Callers (the
 * orchestrator's quote-coverage step and its `ShadowPriceLookup`
 * implementation) probe these in order and use the first one with an actual
 * quote for the symbol in question — this function only enumerates the
 * candidates, it does not know which ones have data.
 */
export function candidateSessionDates(instant: Date, forwardCap: number = SESSION_SEARCH_FORWARD_CAP): Date[] {
  const base = istCalendarDateOfInstant(instant);
  const dates: Date[] = [];
  for (let offset = 0; offset <= forwardCap; offset++) {
    dates.push(istCalendarDateToSessionDate(shiftIstCalendarDate(base, offset)));
  }
  return dates;
}

// ─── Eligibility (static — no I/O) ──────────────────────────────────────────

/** Minimal ExpertOpinion shape the static eligibility filter needs. */
export interface ShadowOpinionInput {
  id: string;
  expertId: string;
  direction: "BULLISH" | "BEARISH" | "NEUTRAL";
  resolutionStatus: "PENDING" | "RESOLVED_HIT" | "RESOLVED_MISS" | "NOT_GRADED";
  instrumentTicker: string | null;
  publishedAt: Date;
  resolvedAt: Date | null;
  suppressedAt: Date | null;
}

/** A call that has passed every STATIC eligibility check (symbol mapped, but quotes not yet confirmed). */
export interface ShadowEligibleCall {
  opinionId: string;
  expertId: string;
  symbol: string;
  publishedAt: Date;
  /** Guaranteed non-null — RESOLVED_HIT/RESOLVED_MISS rows always carry a resolvedAt in this codebase, but a defensive null-check still drops any row that doesn't. */
  resolvedAt: Date;
}

/**
 * Applies the static (no-I/O) portion of the shadow eligibility rule:
 * BULLISH + resolutionStatus in (RESOLVED_HIT, RESOLVED_MISS) + not
 * suppressed + resolvedAt present + a mappable NSE symbol. Quote
 * availability (the dynamic portion) is NOT checked here — see the module
 * doc comment.
 */
export function filterShadowEligibleCalls(opinions: ShadowOpinionInput[]): ShadowEligibleCall[] {
  const eligible: ShadowEligibleCall[] = [];
  for (const opinion of opinions) {
    if (opinion.direction !== "BULLISH") continue;
    if (opinion.resolutionStatus !== "RESOLVED_HIT" && opinion.resolutionStatus !== "RESOLVED_MISS") continue;
    if (opinion.suppressedAt) continue;
    if (!opinion.resolvedAt) continue;
    const symbol = mapTickerToNseSymbol(opinion.instrumentTicker);
    if (!symbol) continue;
    eligible.push({
      opinionId: opinion.id,
      expertId: opinion.expertId,
      symbol,
      publishedAt: opinion.publishedAt,
      resolvedAt: opinion.resolvedAt
    });
  }
  return eligible;
}

// ─── Chronological cash-simulated transaction planning ──────────────────────

/**
 * Resolves the historical fill (session + close price) a shadow order for
 * `symbol` would have filled at, searching forward from `instant`'s IST
 * calendar date up to SESSION_SEARCH_FORWARD_CAP days. Returns null if no
 * quote is found anywhere in that window (the caller must skip the call —
 * see planShadowTransactions). Implemented by the orchestrator against
 * StockEodQuote/bhavcopy data; this file only defines the contract, keeping
 * planShadowTransactions I/O-free and unit-testable with a stub.
 */
export interface ShadowPriceLookup {
  resolve(symbol: string, instant: Date): { sessionDate: Date; close: number } | null;
}

export interface ShadowTransactionPlan {
  opinionId: string;
  symbol: string;
  side: "BUY" | "SELL";
  quantity: number;
  /** The historical instant this order represents — publishedAt for the BUY leg, resolvedAt for the SELL leg. */
  requestedAt: Date;
  executionSessionDate: Date;
  priceAtTx: number;
}

export interface ShadowSkippedCall {
  opinionId: string;
  reason: string;
}

export interface ShadowPlanResult {
  /** Every planned BUY/SELL, in true chronological EVENT order (oldest instant first — a later call's BUY can interleave before an earlier call's SELL), ready to be diffed against existing PortfolioTransaction rows and written as EXECUTED. */
  transactions: ShadowTransactionPlan[];
  /** Calls that passed static eligibility but produced no transactions, with a human-readable reason (quote unavailable, sub-1-share position, or cash-capped). */
  skipped: ShadowSkippedCall[];
  /** Simulated cash remaining after replaying every planned transaction — informational only (the real portfolio's cash is always re-derived from EXECUTED rows by ./engine.ts, never trusted from this simulation). */
  endingSimulatedCash: number;
}

/**
 * Replays one expert's eligible calls against a simulated cash balance
 * (starting at `startingCapital`) in TRUE chronological EVENT order — every
 * call's BUY (at publishedAt) and SELL (at resolvedAt) are two independent
 * events on a single shared timeline, sorted together and applied in real
 * time order, not processed one whole call at a time. This matters: a real
 * cash-constrained trader cannot spend a position's future sale proceeds
 * before that sale actually happens, even if the position is a near-certain
 * winner. Grouping BUY+SELL per call and moving to the next call would let a
 * later call "borrow" cash from an earlier call's not-yet-realized SELL —
 * which is exactly the bug an earlier version of this function had (a call's
 * SELL was applied immediately after its own BUY regardless of how far in
 * the future resolvedAt actually was, effectively giving every call access
 * to un-realized future proceeds).
 *
 * Deterministic and side-effect-free: calling this twice with the same
 * inputs (including the same `priceLookup` answers) always produces the
 * identical plan — the orchestrator relies on this to make re-runs
 * idempotent by diffing this plan against what's already been written.
 *
 * Per call: resolves BOTH legs' fills up front — if either the BUY
 * (publishedAt) or SELL (resolvedAt) leg has no resolvable quote within the
 * search window, the ENTIRE call is skipped before it ever enters the event
 * timeline (no orphan BUY-without-SELL is ever produced). A call that clears
 * quote resolution but is cash-capped AT ITS BUY EVENT (i.e. cash on hand at
 * that point in simulated time is less than the cost) is also skipped in
 * full ("record nothing" per the shadow rule) — its paired SELL event is
 * simply never applied.
 */
export function planShadowTransactions(
  calls: ShadowEligibleCall[],
  startingCapital: number,
  priceLookup: ShadowPriceLookup
): ShadowPlanResult {
  const skipped: ShadowSkippedCall[] = [];

  interface ResolvedCall {
    call: ShadowEligibleCall;
    quantity: number;
    buyFill: { sessionDate: Date; close: number };
    sellFill: { sessionDate: Date; close: number };
  }
  const resolvedCalls: ResolvedCall[] = [];

  // Chronological-by-publishedAt is only used here to make quote-resolution
  // order (and therefore skip-reason ordering) deterministic and readable —
  // it has no bearing on the cash simulation itself, which is event-ordered below.
  const byPublishedAt = [...calls].sort((a, b) => a.publishedAt.getTime() - b.publishedAt.getTime());

  for (const call of byPublishedAt) {
    const buyFill = priceLookup.resolve(call.symbol, call.publishedAt);
    if (!buyFill) {
      skipped.push({ opinionId: call.opinionId, reason: `No entry-session quote for ${call.symbol} within ${SESSION_SEARCH_FORWARD_CAP} sessions of publishedAt.` });
      continue;
    }

    const sellFill = priceLookup.resolve(call.symbol, call.resolvedAt);
    if (!sellFill) {
      skipped.push({ opinionId: call.opinionId, reason: `No exit-session quote for ${call.symbol} within ${SESSION_SEARCH_FORWARD_CAP} sessions of resolvedAt.` });
      continue;
    }

    const quantity = Math.floor(SHADOW_POSITION_SIZE / buyFill.close);
    if (quantity < 1) {
      skipped.push({ opinionId: call.opinionId, reason: `Position size too small: floor(${SHADOW_POSITION_SIZE} / ${buyFill.close}) = 0 shares.` });
      continue;
    }

    resolvedCalls.push({ call, quantity, buyFill, sellFill });
  }

  // Build the shared BUY/SELL event timeline and sort by real instant. Ties
  // (same instant) put SELLs before BUYs — frees cash before it's needed —
  // which only matters for same-instant edge cases; the day-granularity
  // session mapping makes same-instant collisions between different calls
  // vanishingly rare in practice.
  type Event = { instant: Date; type: "BUY" | "SELL"; resolved: ResolvedCall };
  const events: Event[] = [];
  for (const resolved of resolvedCalls) {
    events.push({ instant: resolved.call.publishedAt, type: "BUY", resolved });
    events.push({ instant: resolved.call.resolvedAt, type: "SELL", resolved });
  }
  events.sort((a, b) => {
    const diff = a.instant.getTime() - b.instant.getTime();
    if (diff !== 0) return diff;
    return a.type === b.type ? 0 : a.type === "SELL" ? -1 : 1;
  });

  let cash = startingCapital;
  const transactions: ShadowTransactionPlan[] = [];
  const cashCappedOpinionIds = new Set<string>();

  for (const event of events) {
    const { call, quantity, buyFill, sellFill } = event.resolved;

    if (event.type === "BUY") {
      const cost = quantity * buyFill.close;
      if (cost > cash) {
        cashCappedOpinionIds.add(call.opinionId);
        skipped.push({ opinionId: call.opinionId, reason: `Cash-capped: BUY needs ₹${cost.toFixed(2)}, simulated cash on hand at ${call.publishedAt.toISOString()} is ₹${cash.toFixed(2)}.` });
        continue;
      }
      cash -= cost;
      transactions.push({
        opinionId: call.opinionId,
        symbol: call.symbol,
        side: "BUY",
        quantity,
        requestedAt: call.publishedAt,
        executionSessionDate: buyFill.sessionDate,
        priceAtTx: buyFill.close
      });
    } else {
      if (cashCappedOpinionIds.has(call.opinionId)) continue; // the BUY never happened — nothing to sell
      const proceeds = quantity * sellFill.close;
      cash += proceeds;
      transactions.push({
        opinionId: call.opinionId,
        symbol: call.symbol,
        side: "SELL",
        quantity,
        requestedAt: call.resolvedAt,
        executionSessionDate: sellFill.sessionDate,
        priceAtTx: sellFill.close
      });
    }
  }

  return { transactions, skipped, endingSimulatedCash: cash };
}

// ─── Portfolio identity helpers ──────────────────────────────────────────────

/** Slug prefix for a shadow portfolio, combined with the owning Expert's slug (e.g. "shadow-rupak-de-lkp-securities"). */
export const SHADOW_PORTFOLIO_SLUG_PREFIX = "shadow-";

export function shadowPortfolioSlugBase(expertSlug: string): string {
  return `${SHADOW_PORTFOLIO_SLUG_PREFIX}${expertSlug}`;
}

export function shadowPortfolioName(expertName: string): string {
  return `${expertName} — Call Tracker`;
}

export function shadowPortfolioDescription(expertName: string): string {
  return (
    `Auto-generated paper portfolio that mirrors every graded bullish call ${expertName} has made public. ` +
    `Each call is simulated as a ₹${SHADOW_POSITION_SIZE.toLocaleString("en-IN")} buy at the call's publish-day close, ` +
    `sold at the call's resolution-day close. Not investment advice — for track-record illustration only.`
  );
}
