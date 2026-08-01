/**
 * Limit Orders (Sprint, 2026-07-26) — fill-check + day-expiry orchestration
 * for POST /api/cron/paper-trading-limit-fill (T4/T5).
 *
 * Two independently self-gated jobs live in this one file/cron/CRON_SECRET
 * entry (per the brief's own suggestion — "the former avoids a second
 * CRON_SECRET entry"):
 *
 *   - runLimitOrderFillCheck: evaluates every PENDING PaperPendingOrder
 *     against the latest available quote and fills the ones whose limit has
 *     crossed. Self-gates on isNseWeekdayMarketHours() — a no-op outside
 *     market hours regardless of when the crontab actually fires.
 *   - runPendingOrderExpirySweep: marks every still-PENDING row EXPIRED once
 *     the session is at/past close (15:20 IST, matching
 *     paper-trading-squareoff's cadence per the brief's "fold into the
 *     existing 15:20 IST family" guidance). Self-gates on IST clock time, so
 *     an early-day call (or a delayed/failed prior run) can never wipe out a
 *     still-live pending order. Its WHERE clause has never filtered on
 *     instrumentKind, so it already sweeps futures pending rows exactly like
 *     every other kind — confirmed, not assumed, during Sprint A.
 *
 * Cross-app note (read before "fixing" this to call apps/web's placeOrder/
 * placeOptionOrder/placeFuturesOrder): apps/web cannot be called from apps/api
 * except over HTTP, and apps/web's order routes are session-cookie-
 * authenticated (no service-to-service auth exists for them) — there is no
 * way for an unattended cron to invoke them on a user's behalf. This is NOT a
 * new constraint this feature introduces: EVERY existing apps/api cron in
 * this domain (paper-trading-squareoff, paper-trading-options-expiry,
 * paper-trading-stock-options-squareoff, the futures MTM/expiry crons)
 * already writes PaperOrder rows directly via Prisma, using the shared PURE
 * cost-engine functions from packages/business-rules — never by calling
 * apps/web's routes. "The exact same cost/fill orchestration a market order
 * uses" is satisfied at the level that actually matters and is
 * architecturally possible: the IDENTICAL shared computeOrderCosts/
 * computeOptionOrderCosts/planFuturesOrderFill call, writing a PaperOrder row
 * of the identical shape a market order writes — exactly the precedent every
 * prior cron in this file's sibling files already established.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * Chart Trading + Stop-Loss/Take-Profit (Sprint A, 2026-07-31) — extended this
 * file with:
 *
 *   1. Variant-aware crossing: a STOP row is checked with isStopTriggered
 *      instead of isLimitCrossed (mirror-shape, inverted — see that
 *      function's doc). A STOP row also gets one behaviorally NEW fill-time
 *      re-check (cash/margin/holdings, against the ACTUAL crossing price)
 *      that a LIMIT row deliberately does NOT get — see
 *      `reCheckStopFillFeasibility` below. This asymmetry is intentional and
 *      load-bearing: LIMIT fills must stay byte-identical to their
 *      pre-Sprint-A behavior (a hard requirement of this sprint), while STOP
 *      is a brand-new order shape this sprint introduces, so adding a
 *      defensive re-check to it changes nothing pre-existing.
 *   2. Fill price for a STOP row is the OBSERVED CROSSING QUOTE (the `quote`
 *      value this run just fetched), NEVER `row.triggerPrice`/`row.limitPrice`
 *      — the single most important honesty decision in this feature (design
 *      decision 2). A LIMIT row's fill price remains `row.limitPrice`,
 *      unchanged.
 *   3. A brand-new futures branch: `resolveLatestQuote` gains an INDEX_FUTURE
 *      case using `fetchIndexFuturesQuote` (apps/api/lib/marketMoves/
 *      futuresQuote.ts) — LIVE quotes only, NEVER PCP_DERIVED (too weak a
 *      signal to honestly prove a cross happened, decision 5) — and
 *      `fillPendingOrder` gains a futures leg-write path via the shared pure
 *      `planFuturesOrderFill` (packages/business-rules/src/papertrading/
 *      futuresOrderPlan.ts), the SAME function apps/web's market-order path
 *      and pending-order placement path both consume.
 *   4. A new terminal status, REJECTED: a crossed STOP (any instrument kind)
 *      or ANY futures pending fill (LIMIT or STOP — margin-checking is
 *      inherently new for futures, there is no pre-existing behavior to
 *      preserve) whose fill-time feasibility check fails lands here with a
 *      human-readable `resolutionNote`, account cash/margin left completely
 *      untouched. Never a silent drop, never a partial/negative-cash fill.
 */

import { computeOrderCosts } from "@predict-future/business-rules/papertrading/costs";
import { computeOptionOrderCosts } from "@predict-future/business-rules/papertrading/optionsCosts";
import { formatNseExpiryDate, isIndexOptionUnderlying } from "@predict-future/business-rules/papertrading/optionContract";
import { isLimitCrossed, isStopTriggered, derivePendingBlockedCash, derivePendingBlockedQuantity, type PendingEngineOrder } from "@predict-future/business-rules/papertrading/pendingOrders";
import { planFuturesOrderFill } from "@predict-future/business-rules/papertrading/futuresOrderPlan";
import {
  deriveCash,
  deriveDeliveryHoldings,
  deriveOpenFuturesPositions,
  deriveOptionPositions,
  isFirstDeliverySellOfScripToday,
  type PaperEngineOrder
} from "@predict-future/business-rules/papertrading/replay";
import { isNseWeekdayMarketHours } from "@predict-future/business-rules/papertrading/marketHours";
import type { PaperPendingOrder } from "@prisma/client";

import { fetchIntradaySeries } from "@/lib/marketMoves/intraday";
import { fetchOptionChain, type OptionChainSnapshot } from "@/lib/marketMoves/optionChain";
import { fetchIndexFuturesQuote, type IndexFuturesContractQuote, type IndexFuturesQuote } from "@/lib/marketMoves/futuresQuote";
import { prisma } from "@/lib/prisma";

const ENGINE_ORDER_SELECT = {
  symbol: true,
  side: true,
  productType: true,
  quantity: true,
  fillPrice: true,
  totalCosts: true,
  netAmount: true,
  createdAt: true,
  instrumentKind: true,
  underlyingSymbol: true,
  optionType: true,
  strikePrice: true,
  expiryDate: true,
  lotSize: true,
  isDailyMtm: true
} as const;

/** Selection shape mapping directly onto packages/business-rules' PendingEngineOrder — mirrors apps/web's pendingOrders.ts PENDING_ENGINE_SELECT (this file cannot import that apps/web module — cross-app constraint, see the module doc). */
const PENDING_ENGINE_SELECT = {
  instrumentKind: true,
  symbol: true,
  side: true,
  productType: true,
  quantity: true,
  status: true,
  blockedAmount: true
} as const;

/**
 * Every OTHER currently-PENDING order for an account (excluding `excludeId` —
 * always the row currently being fill-checked, which is either about to
 * transition out of PENDING or is itself the subject of the re-check and
 * must not double-count its own block against itself). Used by the STOP
 * fill-time re-check and the futures fill path's margin-headroom check.
 */
async function fetchOtherActivePendingOrders(accountId: string, excludeId: string): Promise<PendingEngineOrder[]> {
  const rows = await prisma.paperPendingOrder.findMany({
    where: { accountId, status: "PENDING", id: { not: excludeId } },
    select: PENDING_ENGINE_SELECT
  });
  return rows as unknown as PendingEngineOrder[];
}

const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;

/** IST minutes-since-midnight for an instant — reused by the expiry cutoff below. Duplicated (not imported) from marketHours.ts's identical private helper, per this domain's established "small pure math, duplicated per file" convention (see marketHours.ts's own module doc). */
function istMinutesSinceMidnight(now: Date): number {
  const ist = new Date(now.getTime() + IST_OFFSET_MS);
  return ist.getUTCHours() * 60 + ist.getUTCMinutes();
}

/** 15:20 IST — the same forced-close slot paper-trading-squareoff uses. A PENDING order is only ever expired once the session has reached this point, never earlier (see the module doc). */
const PENDING_ORDER_EXPIRY_CUTOFF_MINUTES = 15 * 60 + 20;

function isPastPendingOrderExpiryCutoff(now: Date): boolean {
  return istMinutesSinceMidnight(now) >= PENDING_ORDER_EXPIRY_CUTOFF_MINUTES;
}

/** IST midnight of "today" (server clock), expressed as a UTC instant — duplicated from squareoff.ts's identical private helper (same file-local convention this domain already established). Used to scope BOTH the fill-check (never fill a stale prior-day row) and the expiry sweep (always self-heal a stale prior-day row, regardless of the 15:20 cutoff). */
function todayIstMidnightUtc(now: Date): Date {
  const ist = new Date(now.getTime() + IST_OFFSET_MS);
  const y = ist.getUTCFullYear();
  const m = ist.getUTCMonth();
  const d = ist.getUTCDate();
  return new Date(Date.UTC(y, m, d) - IST_OFFSET_MS);
}

export interface LimitFillRunResult {
  ranFillCheck: boolean;
  pendingScanned: number;
  filled: number;
  /** Chart Trading + SL/TP (Sprint A) — a crossed STOP (or a futures LIMIT/STOP) whose fill-time feasibility re-check failed. See PendingOrderStatus.REJECTED. */
  rejected: number;
  skippedNoQuote: number;
  skippedNotCrossed: number;
  skippedAlreadyResolved: number;
  errors: number;
}

/**
 * Evaluates every PENDING PaperPendingOrder against the latest available
 * quote and fills (or, for a crossed STOP that fails its fill-time
 * feasibility check, rejects) the ones whose limit/trigger has crossed.
 * No-ops (returns `ranFillCheck: false`) outside NSE weekday market hours.
 */
export async function runLimitOrderFillCheck(now: Date = new Date()): Promise<LimitFillRunResult> {
  const result: LimitFillRunResult = {
    ranFillCheck: false,
    pendingScanned: 0,
    filled: 0,
    rejected: 0,
    skippedNoQuote: 0,
    skippedNotCrossed: 0,
    skippedAlreadyResolved: 0,
    errors: 0
  };

  if (!isNseWeekdayMarketHours(now)) return result;
  result.ranFillCheck = true;

  // DAY validity means a PENDING row is only ever eligible to fill on the
  // SAME IST calendar day it was placed — a stale row that somehow survived
  // past its own day's expiry sweep (an ops outage, a missed cron run) must
  // never fill against a LATER day's price. It's left for
  // runPendingOrderExpirySweep's self-healing branch below to clean up.
  const pendingRows = await prisma.paperPendingOrder.findMany({
    where: { status: "PENDING", createdAt: { gte: todayIstMidnightUtc(now) } }
  });
  result.pendingScanned = pendingRows.length;
  if (pendingRows.length === 0) return result;

  // Bounded, deduped quote fetching — one fetch per distinct symbol (equity),
  // (underlying, expiry) pair (options), or underlying (futures — a single
  // fetchIndexFuturesQuote call returns every contract month via
  // allContracts), shared across every pending row that needs it this run,
  // per the brief's "bounded work per run" mandate.
  const ltpCache = new Map<string, number | null>();
  const chainCache = new Map<string, OptionChainSnapshot | null>();
  const futuresCache = new Map<string, IndexFuturesQuote | null>();

  for (const row of pendingRows) {
    try {
      const quote = await resolveLatestQuote(row, ltpCache, chainCache, futuresCache);
      if (quote == null) {
        result.skippedNoQuote += 1;
        continue;
      }

      const crossed =
        row.variant === "STOP"
          ? isStopTriggered(row.side, row.triggerPrice ?? row.limitPrice, quote)
          : isLimitCrossed(row.side, row.limitPrice, quote);
      if (!crossed) {
        result.skippedNotCrossed += 1;
        continue;
      }

      const outcome = await fillPendingOrder(row, quote, now);
      if (outcome === "filled") result.filled += 1;
      else if (outcome === "rejected") result.rejected += 1;
      else result.skippedAlreadyResolved += 1;
    } catch (err) {
      result.errors += 1;
      console.error(`[cron/paper-trading-limit-fill] pending order ${row.id} failed:`, err);
    }
  }

  return result;
}

/** Finds a specific contract month's quote within an IndexFuturesQuote — checks allContracts first, falling back to the top-level near-month fields when the requested expiry matches the quote's own near-month expiry. Null if unresolvable. Mirrors apps/web/lib/paperTrading/futuresQuote.ts's identical helper (this file cannot import apps/web code — cross-app constraint, see the module doc). */
function findFuturesContractQuote(quote: IndexFuturesQuote, expiry: string): IndexFuturesContractQuote | null {
  const fromAllContracts = quote.allContracts.find((c) => c.expiry === expiry);
  if (fromAllContracts) return fromAllContracts;
  if (quote.expiry === expiry) {
    return { expiry: quote.expiry, price: quote.price, openInterest: quote.openInterest, changePercent: quote.changePercent, lotSize: quote.lotSize };
  }
  return null;
}

async function resolveLatestQuote(
  row: PaperPendingOrder,
  ltpCache: Map<string, number | null>,
  chainCache: Map<string, OptionChainSnapshot | null>,
  futuresCache: Map<string, IndexFuturesQuote | null>
): Promise<number | null> {
  if (row.instrumentKind === "EQUITY") {
    if (!ltpCache.has(row.symbol)) {
      const series = await fetchIntradaySeries(row.symbol);
      const lastTick = series?.points.at(-1);
      ltpCache.set(row.symbol, lastTick ? lastTick.price : null);
    }
    return ltpCache.get(row.symbol) ?? null;
  }

  if (row.instrumentKind === "INDEX_FUTURE") {
    if (!row.underlyingSymbol || !row.expiryDate || !isIndexOptionUnderlying(row.underlyingSymbol)) return null;
    if (!futuresCache.has(row.underlyingSymbol)) {
      const quote = await fetchIndexFuturesQuote(row.underlyingSymbol);
      futuresCache.set(row.underlyingSymbol, quote);
    }
    const quote = futuresCache.get(row.underlyingSymbol);
    // Decision 5 — futures fills use LIVE contract quotes only, NEVER
    // PCP_DERIVED synthetic pricing (too weak a signal to honestly prove a
    // cross happened against a specific trigger/limit).
    if (!quote || quote.source !== "LIVE") return null;
    const contract = findFuturesContractQuote(quote, formatNseExpiryDate(row.expiryDate));
    return contract?.price ?? null;
  }

  // INDEX_OPTION | STOCK_OPTION
  if (!row.underlyingSymbol || !row.expiryDate || row.strikePrice == null || !row.optionType) return null;
  const expiryStr = formatNseExpiryDate(row.expiryDate);
  const chainKey = `${row.underlyingSymbol}::${expiryStr}`;
  if (!chainCache.has(chainKey)) {
    const chain = await fetchOptionChain(row.underlyingSymbol, expiryStr);
    chainCache.set(chainKey, chain);
  }
  const chain = chainCache.get(chainKey);
  if (!chain) return null;

  const strikeRow = chain.strikes.find((s) => s.strikePrice === row.strikePrice);
  const quote = row.optionType === "CE" ? strikeRow?.CE : strikeRow?.PE;
  return quote?.lastPrice ?? null;
}

/**
 * Chart Trading + SL/TP (Sprint A) — REJECTS a crossed PENDING row: sets
 * `status: REJECTED` and a human-readable `resolutionNote`, and writes
 * NOTHING else — no PaperOrder row, no cash/margin change. Re-verifies the
 * row is still PENDING immediately before writing (the same idempotency
 * guard `fillPendingOrder`/`fillFuturesPendingOrder` already use), so a
 * concurrent cancellation racing this same tick is a harmless no-op, not a
 * corrupted double-write.
 */
async function rejectPendingOrder(id: string, resolutionNote: string): Promise<boolean> {
  const updated = await prisma.paperPendingOrder.updateMany({
    where: { id, status: "PENDING" },
    data: { status: "REJECTED", resolutionNote }
  });
  return updated.count > 0;
}

/**
 * Chart Trading + SL/TP (Sprint A) — fill-time feasibility re-check for a
 * crossed STOP row (EQUITY or option), against the ACTUAL crossing price
 * (never `triggerPrice`/`limitPrice` — the block at placement was computed
 * against the trigger, and a slipped crossing price can legitimately cost
 * more, per decision 2/3). LIMIT rows never call this — see the module doc's
 * "byte-identical LIMIT behavior" note.
 */
function reCheckStopFillFeasibility(
  row: PaperPendingOrder,
  fillPrice: number,
  costs: { netAmount: number },
  existingOrders: PaperEngineOrder[],
  otherPending: PendingEngineOrder[],
  startingCapital: number
): { ok: true } | { ok: false; reason: string } {
  if (row.side === "BUY") {
    const cash = deriveCash(startingCapital, existingOrders);
    const blockedCash = derivePendingBlockedCash(otherPending);
    const availableCash = cash - blockedCash;
    if (costs.netAmount > availableCash) {
      return {
        ok: false,
        reason: `STOP crossed at ₹${fillPrice.toFixed(2)} (worse than the ₹${(row.triggerPrice ?? row.limitPrice).toFixed(2)} trigger), which would need ₹${costs.netAmount.toFixed(2)} including costs — but only ₹${availableCash.toFixed(2)} cash is available. The order was rejected, not filled at a loss the account can't cover.`
      };
    }
    return { ok: true };
  }

  // SELL — holdings check. Equity INTRADAY short-open is never blocked
  // (decision 3 of the Limit Orders brief) and has no holdings constraint to
  // re-check here; DELIVERY and both option kinds close an existing position.
  if (row.instrumentKind === "EQUITY" && row.productType === "INTRADAY") {
    return { ok: true };
  }

  const heldQuantity =
    row.instrumentKind === "EQUITY"
      ? (deriveDeliveryHoldings(existingOrders).find((h) => h.symbol === row.symbol)?.quantity ?? 0)
      : (deriveOptionPositions(existingOrders).find(
          (p) =>
            p.underlyingSymbol === row.underlyingSymbol &&
            p.strikePrice === row.strikePrice &&
            p.optionType === row.optionType &&
            p.expiryDate.getTime() === (row.expiryDate as Date).getTime()
        )?.quantity ?? 0);
  const blockedQuantity = derivePendingBlockedQuantity(otherPending, row.symbol);
  const availableQuantity = heldQuantity - blockedQuantity;

  if (row.quantity > availableQuantity) {
    return {
      ok: false,
      reason: `STOP crossed at ₹${fillPrice.toFixed(2)}, but only ${availableQuantity} unit(s) are available to sell right now (${heldQuantity} held, ${blockedQuantity} reserved by other pending orders) — ${row.quantity} requested. The order was rejected, not partially filled.`
    };
  }
  return { ok: true };
}

/**
 * Converts one crossed pending order into a real PaperOrder fill (or, for a
 * crossed STOP/futures row that fails its fill-time feasibility check, a
 * REJECTED row — see the module doc). `quote` is the observed crossing price
 * this run's resolveLatestQuote just fetched. Returns:
 *   - "filled" — a PaperOrder was written and the pending row transitioned FILLED.
 *   - "rejected" — the pending row transitioned REJECTED, nothing else written.
 *   - "skipped" — the row was already resolved by a concurrent cancellation/
 *     fill between the initial read and here (the standard "re-verify
 *     immediately before writing" idempotency guard every other cron in this
 *     domain already uses).
 */
async function fillPendingOrder(row: PaperPendingOrder, quote: number, now: Date): Promise<"filled" | "rejected" | "skipped"> {
  const fresh = await prisma.paperPendingOrder.findUnique({ where: { id: row.id } });
  if (!fresh || fresh.status !== "PENDING") return "skipped";

  // Decision 2 (the honesty law): a STOP fills at the ACTUAL crossing quote,
  // never at triggerPrice/limitPrice. A LIMIT fills at limitPrice, unchanged
  // since the Limit Orders sprint.
  const fillPrice = row.variant === "STOP" ? quote : row.limitPrice;

  const existingOrderRows = await prisma.paperOrder.findMany({
    where: { accountId: row.accountId },
    orderBy: { createdAt: "asc" },
    select: ENGINE_ORDER_SELECT
  });
  const existingOrders = existingOrderRows as unknown as PaperEngineOrder[];

  if (row.instrumentKind === "INDEX_FUTURE") {
    return fillFuturesPendingOrder(row, fillPrice, existingOrders, now);
  }

  const costs =
    row.instrumentKind === "EQUITY"
      ? computeOrderCosts({
          side: row.side,
          productType: row.productType ?? "DELIVERY",
          quantity: row.quantity,
          price: fillPrice,
          isFirstDeliverySellOfScripToday:
            row.productType === "DELIVERY" && row.side === "SELL"
              ? isFirstDeliverySellOfScripToday(existingOrders, row.symbol, now)
              : false
        })
      : computeOptionOrderCosts({ side: row.side, quantity: row.quantity, price: fillPrice });

  if (row.variant === "STOP") {
    const account = await prisma.paperTradingAccount.findUnique({ where: { id: row.accountId }, select: { startingCapital: true } });
    if (!account) return "skipped"; // defensive — should be unreachable, the row's own accountId FK guarantees this row exists
    const otherPending = await fetchOtherActivePendingOrders(row.accountId, row.id);
    const feasibility = reCheckStopFillFeasibility(row, fillPrice, costs, existingOrders, otherPending, account.startingCapital);
    if (!feasibility.ok) {
      const rejected = await rejectPendingOrder(row.id, feasibility.reason);
      return rejected ? "rejected" : "skipped";
    }
  }

  // Interactive transaction (not the array form) — the pending row's update
  // needs the newly-created PaperOrder's id, which only exists after the
  // create resolves.
  await prisma.$transaction(async (tx) => {
    const createdOrder = await tx.paperOrder.create({
      data: {
        accountId: row.accountId,
        symbol: row.symbol,
        side: row.side,
        productType: row.instrumentKind === "EQUITY" ? row.productType : null,
        quantity: row.quantity,
        fillPrice,
        fillTickAt: now,
        grossAmount: costs.grossAmount,
        brokerage: costs.brokerage,
        sttAmount: costs.stt,
        exchangeCharge: costs.exchangeCharge,
        sebiFee: costs.sebiFee,
        stampDuty: costs.stampDuty,
        gstAmount: costs.gst,
        dpCharge: costs.dpCharge,
        totalCosts: costs.totalCosts,
        netAmount: costs.netAmount,
        linkedOpinionId: row.linkedOpinionId,
        instrumentKind: row.instrumentKind,
        underlyingSymbol: row.underlyingSymbol,
        optionType: row.optionType,
        strikePrice: row.strikePrice,
        expiryDate: row.expiryDate,
        lotSize: row.lotSize,
        lots: row.lots
      },
      select: { id: true }
    });

    await tx.paperPendingOrder.update({
      where: { id: row.id },
      data: { status: "FILLED", filledAt: now, filledOrderId: createdOrder.id }
    });
  });

  return "filled";
}

/**
 * Chart Trading + SL/TP (Sprint A) — futures fill path (LIMIT and STOP
 * alike; futures pending orders are wholly new this sprint, so there is no
 * pre-existing behavior to preserve here — every futures pending fill runs
 * this fill-time margin/costs re-check, unlike equity/option LIMIT rows).
 * Delegates classification/margin/netAmount to `planFuturesOrderFill`, the
 * SAME pure function the market-order path and the pending-order placement
 * path both consume — no forked logic.
 */
async function fillFuturesPendingOrder(
  row: PaperPendingOrder,
  fillPrice: number,
  existingOrders: PaperEngineOrder[],
  now: Date
): Promise<"filled" | "rejected" | "skipped"> {
  if (!row.underlyingSymbol || !row.expiryDate || !row.lotSize || !row.lots) return "skipped"; // defensive — every futures pending row always carries these, see the placement route

  const account = await prisma.paperTradingAccount.findUnique({ where: { id: row.accountId }, select: { startingCapital: true } });
  if (!account) return "skipped";

  const cash = deriveCash(account.startingCapital, existingOrders);
  const openFuturesPositions = deriveOpenFuturesPositions(existingOrders);
  const otherPending = await fetchOtherActivePendingOrders(row.accountId, row.id);
  const pendingBlockedMargin = derivePendingBlockedCash(otherPending);

  const planResult = planFuturesOrderFill({
    underlyingSymbol: row.underlyingSymbol,
    expiryDate: row.expiryDate,
    side: row.side,
    lots: row.lots,
    lotSize: row.lotSize,
    contractPrice: fillPrice,
    cash,
    openFuturesPositions,
    pendingBlockedMargin
  });

  if (!planResult.ok) {
    const rejected = await rejectPendingOrder(
      row.id,
      `${row.variant === "STOP" ? `STOP crossed at ₹${fillPrice.toFixed(2)}` : "LIMIT crossed"} but the fill-time margin check failed: ${planResult.reason}`
    );
    return rejected ? "rejected" : "skipped";
  }

  const { plan } = planResult;

  await prisma.$transaction(async (tx) => {
    const createdOrder = await tx.paperOrder.create({
      data: {
        accountId: row.accountId,
        symbol: row.symbol,
        side: row.side,
        productType: null,
        quantity: plan.quantity,
        fillPrice,
        fillTickAt: now,
        grossAmount: plan.costs.grossAmount,
        brokerage: plan.costs.brokerage,
        sttAmount: plan.costs.stt,
        exchangeCharge: plan.costs.exchangeCharge,
        sebiFee: plan.costs.sebiFee,
        stampDuty: plan.costs.stampDuty,
        gstAmount: plan.costs.gst,
        dpCharge: plan.costs.dpCharge,
        totalCosts: plan.costs.totalCosts,
        netAmount: plan.netAmount,
        linkedOpinionId: row.linkedOpinionId,
        instrumentKind: "INDEX_FUTURE",
        underlyingSymbol: row.underlyingSymbol,
        optionType: null,
        strikePrice: null,
        expiryDate: row.expiryDate,
        lotSize: row.lotSize,
        lots: row.lots,
        isSquareOff: !plan.isOpeningOrAdding,
        autoSquaredOff: false,
        isDailyMtm: false
      },
      select: { id: true }
    });

    await tx.paperPendingOrder.update({
      where: { id: row.id },
      data: { status: "FILLED", filledAt: now, filledOrderId: createdOrder.id }
    });
  });

  return "filled";
}

export interface PendingOrderExpiryRunResult {
  ranExpirySweep: boolean;
  expiredToday: number;
  /** A PENDING row created on an EARLIER IST day than `now` — should never exist under normal operation (every prior day's sweep should have caught it), but is always swept regardless of the 15:20 cutoff as a self-healing catch-up (e.g. after a cron outage) — see the module doc. */
  expiredStale: number;
}

/**
 * Marks every still-PENDING order EXPIRED. Two independent clauses:
 *  - Rows from TODAY (IST) only expire once the session is at/past the 15:20
 *    IST cutoff — DAY validity's honest definition of "session close".
 *  - Rows from an EARLIER day are ALWAYS expired immediately, any time this
 *    runs, regardless of clock time — a stale leftover is a self-healing
 *    catch-up, not something to wait for another 15:20 slot to clean up.
 * Neither clause filters on instrumentKind — futures pending rows (new this
 * sprint) are swept identically to equity/options, confirmed by inspection
 * during Sprint A, not a change made this sprint.
 * Idempotent — an empty PENDING set after the first run of the day is a
 * cheap no-op on every subsequent call — safe to invoke on every fill-check
 * cron tick rather than needing a dedicated crontab entry.
 */
export async function runPendingOrderExpirySweep(now: Date = new Date()): Promise<PendingOrderExpiryRunResult> {
  const todayStart = todayIstMidnightUtc(now);

  const stale = await prisma.paperPendingOrder.updateMany({
    where: { status: "PENDING", createdAt: { lt: todayStart } },
    data: { status: "EXPIRED", expiredAt: now }
  });

  if (!isPastPendingOrderExpiryCutoff(now)) {
    return { ranExpirySweep: stale.count > 0, expiredToday: 0, expiredStale: stale.count };
  }

  const today = await prisma.paperPendingOrder.updateMany({
    where: { status: "PENDING", createdAt: { gte: todayStart } },
    data: { status: "EXPIRED", expiredAt: now }
  });

  return { ranExpirySweep: true, expiredToday: today.count, expiredStale: stale.count };
}
