/**
 * Chart Trading + Stop-Loss/Take-Profit (Sprint A, 2026-07-31) — pure futures
 * order-fill planning, extracted from apps/web/lib/paperTrading/
 * futuresOrders.ts's inline open/close classification + margin-headroom +
 * netAmount logic (Phase 4 Sprint 2, 2026-07-26) per this sprint's design
 * decision 5.
 *
 * WHY this extraction, and why now: futures pending orders (LIMIT and STOP)
 * didn't exist before this sprint — market orders were the only lifecycle.
 * Both the market-order placement route (futuresOrders.ts's placeFuturesOrder)
 * and the NEW pending-order paths (apps/web's placement route AND apps/api's
 * fill-check cron) need to run the IDENTICAL open/close classification,
 * margin-headroom check, and netAmount algebra — "don't fork the logic" is
 * the whole point of a pure, dependency-free module living in
 * packages/business-rules, importable unmodified from both apps.
 *
 * This extraction is a BEHAVIORAL NO-OP for the pre-existing market-order
 * path, with exactly one addition: `pendingBlockedMargin` (decision 6 — a
 * market futures order must see cash already reserved by OTHER resting
 * pending futures orders, exactly like the equity/options market paths
 * already subtract `derivePendingBlockedCash` from their own headroom checks
 * since the Limit Orders sprint). Passing `pendingBlockedMargin: 0` (or
 * omitting it) reproduces futuresOrders.ts's original inline formula exactly
 * — proven by the verify script's algebra-matrix section (see
 * apps/api/scripts/verify-papertrading-engine.ts, section 40).
 *
 * Pure module: zero I/O, zero Prisma — importable identically from apps/api
 * (the fill-check cron) and apps/web (order placement), exactly like every
 * other file in this directory.
 */

import {
  computeFuturesOrderCosts,
  type FuturesOrderSide,
  type OrderCostBreakdown
} from "./futuresCosts";
import { computeFuturesMarginRequired } from "./futuresMargin";
import type { FuturesContractPosition } from "./replay";

/**
 * `deriveCash`'s existing convention: `cash += side === "SELL" ? netAmount :
 * -netAmount`. Inverting that to solve for the netAmount value that produces
 * a DESIRED signed cash effect. Moved here from futuresOrders.ts (Sprint A,
 * decision 5) so both the market-order path and the new pending-order paths
 * share one implementation — apps/api's daily-MTM/expiry-settlement crons
 * keep their own private copies (a pre-existing, unrelated leg-type shape —
 * see futuresDailyMtm.ts/futuresExpiry.ts's module docs), unchanged by this
 * sprint.
 */
export function signedNetAmountForCashEffect(side: FuturesOrderSide, cashEffect: number): number {
  return side === "SELL" ? cashEffect : -cashEffect;
}

export interface ComputePendingFuturesBlockAmountInput {
  side: FuturesOrderSide;
  /** Total contract quantity = lots * lotSize (never lots alone — same convention as every other cost/margin function in this directory). */
  quantity: number;
  /** The hypothetical fill price — `limitPrice` for a LIMIT order, `triggerPrice` for a STOP order (the row's placement-time price, identically to how computePendingBlockAmount uses `limitPrice` for equity/options). */
  price: number;
}

/**
 * The cash amount to block/reserve at placement for a futures pending order
 * that is OPENING or ADDING to a position (either side — see design
 * decision 5): 15% margin of this order's own notional PLUS the order's own
 * cost stack (brokerage/STT/exchange/SEBI/stamp/GST), both computed at the
 * hypothetical fill price. This is deliberately NOT the same shape as
 * `computePendingBlockAmount` (which returns a market order's full netAmount
 * for equity/options) — a futures market order only ever debits cash by its
 * COSTS on open/add (margin is never a ledger entry, see futuresOrders.ts's
 * module doc), so blocking the full margin+costs figure is a strictly larger
 * reservation than the eventual fill's actual netAmount would debit. That is
 * intentional: the margin portion isn't a future cash debit, it's a
 * risk-capacity reservation that must be honestly counted against headroom
 * the instant the order rests, exactly mirroring how a real broker holds
 * margin the moment an order is accepted, not just when it fills.
 *
 * A CLOSING/REDUCING futures pending order never calls this function — it
 * blocks LOTS instead (see derivePendingBlockedQuantity in
 * ./pendingOrders.ts), the same shape as an options SELL block.
 */
export function computePendingFuturesBlockAmount(input: ComputePendingFuturesBlockAmountInput): number {
  const margin = computeFuturesMarginRequired(input.quantity * input.price);
  const costs = computeFuturesOrderCosts({ side: input.side, quantity: input.quantity, price: input.price });
  return margin + costs.totalCosts;
}

export interface PlanFuturesOrderFillInput {
  underlyingSymbol: string;
  /** The specific contract's expiry date (a resolved Date, not the NSE string — callers parse via parseNseExpiryDate before calling in). */
  expiryDate: Date;
  side: FuturesOrderSide;
  lots: number;
  lotSize: number;
  /** The price this leg fills/would-fill at: the live/PCP quote for a market order, `limitPrice` for a LIMIT pending order, or the OBSERVED CROSSING QUOTE (never `triggerPrice`) for a STOP pending order — see design decision 2. This function is price-source-agnostic; the caller is responsible for passing the honest figure. */
  contractPrice: number;
  /** The account's current cash (deriveCash's output), BEFORE this order. */
  cash: number;
  /** Every OPEN futures position for this account (deriveOpenFuturesPositions' output), BEFORE this order. */
  openFuturesPositions: FuturesContractPosition[];
  /**
   * Sprint A (decision 6) — cash/margin already reserved by OTHER resting
   * pending futures orders on this account (derivePendingBlockedCash's
   * output, with THIS order's own row excluded if it already exists — e.g.
   * a Sprint C reprice). Subtracted from headroom on the OPENING path
   * exactly like the equity/options market paths already subtract
   * derivePendingBlockedCash from their own cash checks. Defaults to 0,
   * which reproduces futuresOrders.ts's pre-Sprint-A inline formula exactly
   * — the market-order call site passes the live total; a fresh
   * (never-pending-anything) account naturally has 0 here regardless.
   */
  pendingBlockedMargin?: number;
}

export interface FuturesOrderFillPlan {
  /** Whether this leg is opening a new position / adding to an existing one in the same direction (margin-headroom gated) vs. closing/reducing an existing one (capped to held lots, no flip-through). */
  isOpeningOrAdding: boolean;
  /** The existing position's signed quantity for this exact (underlyingSymbol, expiryDate) contract, BEFORE this order — 0 if none. */
  currentSignedQty: number;
  /** The existing position's lots, BEFORE this order — 0 if none. Exposed so callers (the pending-order placement path) can validate a closing order's lots against pending-blocked closing quantity without re-deriving this lookup themselves (decision 6's regression requirement — see pendingOrders.ts's futures branch). */
  heldLots: number;
  /** = lots * lotSize. */
  quantity: number;
  /** Full itemized cost stack for this leg, at `contractPrice` — every field except `.netAmount` is reused verbatim by the caller (see the module doc on why `.netAmount` itself is discarded and replaced below). */
  costs: OrderCostBreakdown;
  /** The value to store as PaperOrder.netAmount for this leg — see signedNetAmountForCashEffect and futuresOrders.ts's original module doc for the full sign-algebra rationale. NOT the same as `costs.netAmount`. */
  netAmount: number;
  /** This order's own notional-based margin requirement (computeFuturesMarginRequired(quantity * contractPrice)) — computed unconditionally (open or close), matching PlacedFuturesOrder.marginRequired's original semantics exactly. */
  marginRequired: number;
  /** OPENING/ADDING only — the account-wide margin figure (this contract's new total + every other open position's) that had to fit within headroom for this order to be accepted. Undefined for a closing leg (no margin gate applies). */
  totalMarginNeeded?: number;
  /** OPENING/ADDING only — cash - pendingBlockedMargin - costs.totalCosts - totalMarginNeeded. Undefined for a closing leg. */
  headroom?: number;
}

export type PlanFuturesOrderFillResult =
  | { ok: true; plan: FuturesOrderFillPlan }
  | { ok: false; status: 422; reason: string };

/**
 * Plans one futures order leg's fill — open/close classification, margin-
 * headroom gate (opening/adding) or held-lots cap (closing/reducing), cost
 * stack, and the signed netAmount to persist. Returns `ok: false` with a
 * human-readable 422 reason on either failure mode; never throws.
 *
 * Pulled out of apps/web/lib/paperTrading/futuresOrders.ts's placeFuturesOrder
 * (Phase 4 Sprint 2) verbatim except for the `pendingBlockedMargin` addition
 * — see the module doc's "behavioral no-op" note and
 * verify-papertrading-engine.ts's section 40 for the algebra-matrix proof.
 */
export function planFuturesOrderFill(input: PlanFuturesOrderFillInput): PlanFuturesOrderFillResult {
  const { underlyingSymbol, expiryDate, side, lots, lotSize, contractPrice, cash, openFuturesPositions } = input;
  const pendingBlockedMargin = input.pendingBlockedMargin ?? 0;

  const quantity = lots * lotSize;

  const matching = openFuturesPositions.find(
    (p) => p.underlyingSymbol === underlyingSymbol && p.expiryDate.getTime() === expiryDate.getTime()
  );
  const currentSignedQty = matching?.quantity ?? 0;
  const heldLots = matching?.lots ?? 0;
  const orderSignedDelta = side === "BUY" ? quantity : -quantity;
  const isOpeningOrAdding = currentSignedQty === 0 || Math.sign(currentSignedQty) === Math.sign(orderSignedDelta);

  // Cost stack — every field EXCEPT `.netAmount` is reused verbatim (see the
  // module doc, and futuresOrders.ts's original doc for the full rationale).
  const costs = computeFuturesOrderCosts({ side, quantity, price: contractPrice });
  const marginRequired = computeFuturesMarginRequired(quantity * contractPrice);

  let netAmount: number;
  let totalMarginNeeded: number | undefined;
  let headroom: number | undefined;

  if (isOpeningOrAdding) {
    // Margin-headroom gate. Existing OTHER open positions' notional is valued
    // at each position's own `referencePrice` (last daily-MTM mark, or entry
    // price if never marked) rather than a fresh live fetch per position —
    // see futuresOrders.ts's original doc for the full "avoid an unbounded
    // number of extra NSE calls per order" rationale, unchanged by this
    // extraction. The contract actually being traded always uses
    // `contractPrice`, the most accurate figure available for it (live quote
    // for a market order, the user's own limit/trigger for a pending one).
    const otherPositionsMargin = openFuturesPositions
      .filter((p) => !(p.underlyingSymbol === underlyingSymbol && p.expiryDate.getTime() === expiryDate.getTime()))
      .reduce((sum, p) => sum + computeFuturesMarginRequired(Math.abs(p.quantity) * p.referencePrice), 0);

    const newTotalQtyThisContract = currentSignedQty + orderSignedDelta;
    const thisContractMargin = computeFuturesMarginRequired(Math.abs(newTotalQtyThisContract) * contractPrice);
    totalMarginNeeded = otherPositionsMargin + thisContractMargin;
    headroom = cash - pendingBlockedMargin - costs.totalCosts - totalMarginNeeded;

    if (headroom < 0) {
      const availableCash = cash - pendingBlockedMargin;
      return {
        ok: false,
        status: 422,
        reason: `Insufficient margin: this position needs ~₹${totalMarginNeeded.toLocaleString("en-IN", { maximumFractionDigits: 0 })} margin (15% of notional, conservative estimate) plus ₹${costs.totalCosts.toFixed(2)} in costs, but only ₹${availableCash.toLocaleString("en-IN", { maximumFractionDigits: 0 })} cash is available${
          pendingBlockedMargin > 0
            ? ` (₹${pendingBlockedMargin.toLocaleString("en-IN", { maximumFractionDigits: 0 })} already reserved by other pending futures orders)`
            : ""
        }.`
      };
    }

    netAmount = signedNetAmountForCashEffect(side, -costs.totalCosts);
  } else {
    // Closing/reducing an existing position. Capped to held lots in ONE
    // order — no flip-through — mirrors optionOrders.ts's identical SELL-cap
    // precedent, unchanged by this extraction.
    if (lots > heldLots) {
      return {
        ok: false,
        status: 422,
        reason: `You hold ${heldLots} lot(s) of this contract — can't close ${lots} in one order. Close your position fully, then place a new order if you want to flip direction.`
      };
    }

    const directionSign = Math.sign(currentSignedQty); // +1 closing a long, -1 closing a short — matching is non-null here
    const realizedPnlThisLeg = quantity * (contractPrice - matching!.referencePrice) * directionSign;
    netAmount = signedNetAmountForCashEffect(side, realizedPnlThisLeg - costs.totalCosts);
  }

  return {
    ok: true,
    plan: {
      isOpeningOrAdding,
      currentSignedQty,
      heldLots,
      quantity,
      costs,
      netAmount,
      marginRequired,
      totalMarginNeeded,
      headroom
    }
  };
}
