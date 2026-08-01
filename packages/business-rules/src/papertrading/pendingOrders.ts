/**
 * Limit Orders (Sprint, 2026-07-26) — pure blocking + crossing math for
 * PaperPendingOrder, shared identically by apps/web (placement/cancel routes)
 * and apps/api (the fill-check cron). See the schema doc on model
 * PaperPendingOrder for the full design rationale — this file implements the
 * two load-bearing pieces of pure math that design depends on:
 *
 *   1. `isLimitCrossed` — the fill trigger (BUY: quote <= limit, SELL: quote
 *      >= limit).
 *   2. `computePendingBlockAmount` / `derivePendingBlockedCash` /
 *      `derivePendingBlockedQuantity` — the placement-time reservation that
 *      keeps a market order placed after a pending limit order from
 *      overspending the same funds/quantity (see orders.ts's and
 *      optionOrders.ts's T3 regression update, which subtract these from
 *      available cash/quantity in EVERY order-placement path, market and
 *      limit alike).
 *
 * Chart Trading + SL/TP (Sprint A, 2026-07-31) extended this file with:
 *
 *   3. `isStopTriggered` — the mirror-shape crossing rule for a STOP order
 *      (BUY: quote >= trigger, SELL: quote <= trigger — inverted from
 *      isLimitCrossed, since a stop triggers on the market moving THROUGH a
 *      level rather than reaching a favorable ceiling/floor).
 *   4. A futures-any-side rule in `derivePendingBlockedCash` and an optional
 *      `side` parameter on `derivePendingBlockedQuantity` — see each
 *      function's doc comment. `computePendingBlockAmount` itself needed NO
 *      changes for either STOP or futures: a STOP row denormalizes
 *      `limitPrice = triggerPrice` at write time (see the schema doc), so it
 *      is invisible to this file's math as anything other than "a pending
 *      order with a limitPrice" — and futures pending orders use a dedicated
 *      sibling, `computePendingFuturesBlockAmount` in ./futuresOrderPlan.ts,
 *      because a futures block is margin+costs, not a full-notional cash
 *      debit (see that file's module doc).
 *
 * Pure module: zero I/O, zero Prisma — importable identically from apps/api
 * and apps/web, exactly like replay.ts/costs.ts/optionsCosts.ts.
 */

import { computeOrderCosts, type PaperOrderSide, type PaperProductType } from "./costs";
import { computeOptionOrderCosts } from "./optionsCosts";

export type PendingOrderInstrumentKind = "EQUITY" | "INDEX_OPTION" | "STOCK_OPTION" | "INDEX_FUTURE";
export type PendingOrderStatus = "PENDING" | "FILLED" | "CANCELLED" | "EXPIRED" | "REJECTED";
export type PendingOrderVariant = "LIMIT" | "STOP";

/**
 * True when a resting limit order at `limitPrice` would fill against
 * `latestQuote` right now. BUY fills when the market has fallen TO OR BELOW
 * the limit (a buyer's limit is a ceiling); SELL fills when the market has
 * risen TO OR ABOVE the limit (a seller's limit is a floor). This is the
 * ONLY crossing rule for a LIMIT order — the fill-check cron calls this once
 * per (pending LIMIT order, latest quote) pair.
 */
export function isLimitCrossed(side: PaperOrderSide, limitPrice: number, latestQuote: number): boolean {
  return side === "BUY" ? latestQuote <= limitPrice : latestQuote >= limitPrice;
}

/**
 * Chart Trading + SL/TP (Sprint A) — true when a resting STOP order at
 * `triggerPrice` would trigger against `latestQuote` right now. Mirror-shape
 * of isLimitCrossed, INVERTED: a BUY stop (breakout entry, or the closing leg
 * of a short position's stop-loss) triggers when the market has risen TO OR
 * ABOVE the trigger; a SELL stop (stop-loss on a long, or a breakdown-entry
 * short) triggers when the market has fallen TO OR BELOW the trigger. Both
 * boundaries are inclusive, matching isLimitCrossed's own inclusive
 * convention. This is ONLY the trigger detector — it says nothing about fill
 * PRICE. Per the schema doc's design decision 2 (the single most important
 * honesty call in this feature), a triggered STOP fills at the actual
 * observed crossing quote passed to this function, never at `triggerPrice`
 * itself — see limitOrderFill.ts's fillPendingOrder for where that fill-price
 * selection happens.
 */
export function isStopTriggered(side: PaperOrderSide, triggerPrice: number, latestQuote: number): boolean {
  return side === "BUY" ? latestQuote >= triggerPrice : latestQuote <= triggerPrice;
}

export interface ComputePendingBlockAmountInput {
  instrumentKind: PendingOrderInstrumentKind;
  side: PaperOrderSide;
  quantity: number;
  limitPrice: number;
  /** Required (and only meaningful) when instrumentKind is EQUITY. */
  productType?: PaperProductType | null;
}

/**
 * The cash amount to block at placement for a BUY, or `null` for a SELL
 * (SELL blocks QUANTITY instead — see derivePendingBlockedQuantity below,
 * and the schema doc's design-decision-3 rationale). For a BUY, this calls
 * the EXACT SAME cost-engine function (computeOrderCosts for EQUITY,
 * computeOptionOrderCosts for INDEX_OPTION/STOCK_OPTION) a market order
 * would use, with `limitPrice` standing in for the fill price — because fill
 * price is deterministically the limit price (see the schema doc), this
 * value exactly equals what the eventual fill will debit. No reconciliation
 * step exists anywhere in this feature because none is needed.
 */
export function computePendingBlockAmount(input: ComputePendingBlockAmountInput): number | null {
  if (input.side === "SELL") return null;

  if (input.instrumentKind === "EQUITY") {
    const productType = input.productType;
    if (!productType) {
      throw new Error("computePendingBlockAmount: productType is required for an EQUITY order.");
    }
    return computeOrderCosts({
      side: "BUY",
      productType,
      quantity: input.quantity,
      price: input.limitPrice
      // isFirstDeliverySellOfScripToday intentionally omitted — irrelevant to
      // a BUY (that flag only ever changes a SELL's dpCharge).
    }).netAmount;
  }

  // INDEX_OPTION | STOCK_OPTION
  return computeOptionOrderCosts({ side: "BUY", quantity: input.quantity, price: input.limitPrice }).netAmount;
}

/** Minimal PaperPendingOrder shape the engine needs — callers map their Prisma rows to this. */
export interface PendingEngineOrder {
  instrumentKind: PendingOrderInstrumentKind;
  /** Bare NSE symbol (EQUITY) or the synthetic option-contract symbol (INDEX_OPTION/STOCK_OPTION) — same convention as PaperEngineOrder.symbol. */
  symbol: string;
  side: PaperOrderSide;
  /** EQUITY only — null for options. */
  productType?: PaperProductType | null;
  quantity: number;
  status: PendingOrderStatus;
  /** Null for a SELL (quantity-blocked instead) — see computePendingBlockAmount. */
  blockedAmount: number | null;
}

/**
 * Sums `blockedAmount` across every currently-PENDING row for an account that
 * should count toward "cash already spoken for" — the amount a subsequent
 * order-placement path (market OR limit/stop, per T3's regression
 * requirement) must treat as already spent. For EQUITY/INDEX_OPTION/
 * STOCK_OPTION this is BUY rows only (unchanged since the Limit Orders
 * sprint — non-BUY and non-PENDING rows never carry a blockedAmount for
 * these kinds, but the status/side filter is explicit here anyway rather
 * than relying solely on `blockedAmount != null`, so a future bug that
 * mis-sets blockedAmount on the wrong row type can't silently corrupt this
 * total).
 *
 * Chart Trading + SL/TP (Sprint A) — INDEX_FUTURE gets a dedicated rule
 * instead: EITHER side can carry a non-null blockedAmount (margin + costs,
 * via computePendingFuturesBlockAmount) when the order is OPENING/ADDING to
 * a position — a SELL-to-open (short) futures order blocks margin exactly
 * like a BUY-to-open does, unlike equity intraday shorting (which Phase 1
 * deliberately never margin-blocked, a still-unchanged posture for equity
 * here). A futures row that's CLOSING/REDUCING a position instead carries
 * `blockedAmount: null` (lots-blocked via derivePendingBlockedQuantity
 * below, the same shape as an options SELL block) — so, for INDEX_FUTURE,
 * the `blockedAmount != null` check alone is the correct and sufficient
 * discriminator, with no side filter needed (both sides legitimately
 * contribute here).
 */
export function derivePendingBlockedCash(pendingOrders: PendingEngineOrder[]): number {
  let blocked = 0;
  for (const order of pendingOrders) {
    if (order.status !== "PENDING") continue;
    if (order.instrumentKind === "INDEX_FUTURE") {
      if (order.blockedAmount != null) blocked += order.blockedAmount;
      continue;
    }
    if (order.side !== "BUY") continue;
    if (order.blockedAmount != null) blocked += order.blockedAmount;
  }
  return blocked;
}

/**
 * Sums quantity across every currently-PENDING SELL row for `symbol`
 * (bare NSE symbol for EQUITY, synthetic contract symbol for an option) —
 * the quantity/lots a subsequent order-placement path must treat as already
 * reserved. Callers are responsible for passing the right `symbol` shape for
 * the instrument they're checking (equity: the bare symbol; options: the
 * synthetic contract symbol via formatOptionContractSymbol) — this function
 * itself is asset-class-agnostic, matching against symbol equality alone.
 *
 * Per the schema's design decision 3, EQUITY INTRADAY SELL (short-open) is
 * NEVER blocked — Phase 1 never modeled margin for intraday shorting, so a
 * pending short-open limit order introduces no new risk surface. Callers for
 * EQUITY must therefore only invoke this for a DELIVERY SELL check; passing
 * an INTRADAY symbol here would (harmlessly, since INTRADAY pending SELLs
 * are never written with a block in mind) still sum any matching rows, so
 * this function itself does NOT filter productType — that's the caller's
 * responsibility, exactly mirroring how blockedAmount is never set for an
 * INTRADAY SELL in the first place (see the placement route).
 *
 * Chart Trading + SL/TP (Sprint A) — added the optional `side` parameter,
 * defaulting to "SELL" so every pre-Sprint-A call site (equity DELIVERY
 * SELL, options SELL) is byte-identical with zero argument changes. Futures
 * is the one instrument kind where a CLOSING pending order can be either
 * side — SELL closes a long, BUY closes a short (unlike equity/options,
 * which are never short via this table) — so a futures caller must pass the
 * specific closing side it's checking (e.g. "BUY" to find pending orders
 * that would close an existing short) rather than relying on the SELL
 * default.
 */
export function derivePendingBlockedQuantity(
  pendingOrders: PendingEngineOrder[],
  symbol: string,
  side: PaperOrderSide = "SELL"
): number {
  let blocked = 0;
  for (const order of pendingOrders) {
    if (order.status !== "PENDING" || order.side !== side || order.symbol !== symbol) continue;
    blocked += order.quantity;
  }
  return blocked;
}
