/**
 * Paper Trading Phase 2 — the India F&O (index options) retail cost stack,
 * FY2025-26, current as of 2026-07-23. Sibling module to costs.ts (equity cash
 * market) — deliberately NOT merged into that file because F&O and cash-equity
 * are governed by different rate schedules that will drift independently over
 * time (see the STT split below, which is the exact case this separation
 * anticipates).
 *
 * Long-only index options (BUY CE / BUY PE only — see the Phase 2 brief's scope
 * decision) means every position is fully prepaid: no margin, no leverage, no
 * short/writing cost lines at all. That is what makes this module smaller than
 * costs.ts, not an oversight.
 *
 * Pure module: zero I/O, zero Prisma — importable identically from apps/api (the
 * expiry-settlement cron) and apps/web (order placement + the client-side
 * pre-trade cost estimate), exactly like costs.ts.
 *
 * Same disclaimer requirement as costs.ts: every rate below is a representative
 * discount-broker figure (Zerodha-class pricing), not a live exchange quote —
 * ships with a visible "rates are indicative and may not match your real
 * broker" disclaimer wherever a cost breakdown renders.
 */

export type OptionOrderSide = "BUY" | "SELL";

// ─── Named rate constants (FY2025-26, F&O segment) ───────────────────────────

/**
 * Flat ₹20 per executed leg — NOT a min(₹20, %) formula like equity intraday
 * brokerage. Options brokerage at every discount broker is simply flat per
 * order regardless of premium size. Applies to a manual BUY and a manual SELL
 * identically; NEVER charged on a cron-driven expiry-settlement leg (no
 * discount broker bills an "order" fee for an automatic exchange-driven
 * settlement the user never placed) — callers must pass
 * `isExpirySettlement: true` to get the correct ₹0.
 *
 * Note for a future SHORT-options phase: Zerodha's April-2026 doubling of some
 * F&O brokerage to ₹40/order is conditioned on SEBI's 50%-cash-collateral rule
 * for option SELLERS (writers) — not applicable here, since Phase 2 has no
 * selling/writing and no margin/collateral at all. Flat ₹20 stands for
 * long-only. Do not silently inherit ₹40 if/when a short-options phase ships —
 * re-verify against the collateral-rule rationale, not just copy this constant.
 */
export const OPTIONS_BROKERAGE_FLAT = 20; // ₹20 per leg, flat

/**
 * STT (Securities Transaction Tax) — TWO distinct constants, same value today
 * (post 1-April-2026 Budget hike), different legal bases, and will diverge
 * again if either rate changes independently:
 *  - SELL_RATE: a manual SELL (closing) leg, on the premium (grossAmount).
 *    Never charged on a BUY.
 *  - EXERCISE_RATE: the cron-driven expiry-settlement leg only, on the
 *    INTRINSIC VALUE (not premium) — and only when intrinsic value > 0. An OTM
 *    expiry has intrinsic value 0, so this formula correctly yields ₹0 STT with
 *    no special-casing needed beyond the formula itself.
 */
export const OPTIONS_STT_SELL_RATE = 0.0015; // 0.15% of premium, manual SELL only
export const OPTIONS_STT_EXERCISE_RATE = 0.0015; // 0.15% of intrinsic value, expiry settlement only

/** NSE exchange transaction charge — flat blended approximation, both BUY and SELL/settlement legs, on premium (or intrinsic value for the settlement leg). */
export const OPTIONS_EXCHANGE_TXN_CHARGE_RATE = 0.0003553; // 0.03553%

/**
 * SEBI turnover fee ("₹10 per crore") and GST — both reuse costs.ts's constants
 * directly, NOT duplicated: the same SEBI rate applies to F&O per NSE's own
 * published SEBI-fee schedule, and GST's 18%-of-(brokerage+exchange+SEBI) base
 * rule is identical across cash-equity and F&O. Re-exported here so a consumer
 * that only imports optionsCosts.ts (e.g. the verify script) doesn't also need
 * a separate import from costs.ts for these two shared rates.
 */
import { GST_RATE, SEBI_TURNOVER_FEE_RATE } from "./costs";

export { GST_RATE, SEBI_TURNOVER_FEE_RATE };

/** Stamp duty — BUY side only, on premium. Never on SELL, never on the expiry-settlement leg (stamp duty is a buy-side instrument tax, never a sell/settlement tax — same convention as costs.ts's equity treatment). */
export const OPTIONS_STAMP_DUTY_RATE = 0.00003; // 0.003%

/**
 * DP (Depository Participant) charge — ALWAYS ₹0 for options. Cash-settled
 * index options never enter demat, so there is never a scrip to debit.
 * Hardcoded 0 in computeOptionOrderCosts below, not conditionally computed —
 * unlike costs.ts's DP_CHARGE_ROUNDED, there is no "first sell of the day"
 * branch to even evaluate here.
 */

export interface ComputeOptionOrderCostsInput {
  side: OptionOrderSide;
  /** Total contract quantity = lots * lotSize (the same canonical unit costs.ts's `quantity` uses — never lots alone). */
  quantity: number;
  /** Premium per unit for a manual BUY/SELL leg. Ignored (in favor of intrinsicValue) when isExpirySettlement is true. */
  price: number;
  /** True only for the cron-driven expiry-settlement leg. Changes which STT constant applies, which base STT is computed against, and zeroes brokerage. */
  isExpirySettlement?: boolean;
  /** Required when isExpirySettlement is true: max(0, spot-strike) for CE / max(0, strike-spot) for PE, per unit. Ignored for a manual BUY/SELL. */
  intrinsicValue?: number;
}

/** Same shape as costs.ts's OrderCostBreakdown — reused, not forked, so every render surface (CostBreakdownTable etc.) works identically for an equity leg or an option leg. */
export interface OrderCostBreakdown {
  grossAmount: number;
  brokerage: number;
  stt: number;
  exchangeCharge: number;
  sebiFee: number;
  stampDuty: number;
  gst: number;
  dpCharge: number;
  totalCosts: number;
  /** BUY: grossAmount + totalCosts (cash debited). SELL or expiry settlement: grossAmount - totalCosts (cash credited — a worthless OTM expiry credits ₹0, correctly reflecting 100% loss of the original premium paid). */
  netAmount: number;
}

/**
 * Computes every itemized cost line for one option order LEG — a manual BUY, a
 * manual SELL (closing an existing long), or a cron-driven expiry settlement.
 * Pure function, no rounding beyond ordinary floating-point arithmetic (currency
 * display rounding happens at render time, not here, so verification stays exact).
 */
export function computeOptionOrderCosts(input: ComputeOptionOrderCostsInput): OrderCostBreakdown {
  const { side, quantity, isExpirySettlement = false } = input;

  // grossAmount is always premium * quantity for a manual leg. For the expiry
  // settlement leg it's intrinsicValue * quantity — the settlement "fill price"
  // IS the intrinsic value (see the schema doc on PaperOrder.fillPrice).
  const unitPrice = isExpirySettlement ? (input.intrinsicValue ?? 0) : input.price;
  const grossAmount = quantity * unitPrice;

  // Brokerage: flat ₹20/leg for a manual order, ₹0 for an automatic
  // exchange-driven expiry settlement the user never placed.
  const brokerage = isExpirySettlement ? 0 : OPTIONS_BROKERAGE_FLAT;

  // STT: SELL_RATE on premium for a manual close, EXERCISE_RATE on intrinsic
  // value for a settlement (naturally 0 when intrinsic value is 0 — an OTM
  // expiry — with no special-casing needed). Never charged on a manual BUY.
  const stt = isExpirySettlement
    ? OPTIONS_STT_EXERCISE_RATE * grossAmount
    : side === "SELL"
      ? OPTIONS_STT_SELL_RATE * grossAmount
      : 0;

  const exchangeCharge = OPTIONS_EXCHANGE_TXN_CHARGE_RATE * grossAmount;
  const sebiFee = SEBI_TURNOVER_FEE_RATE * grossAmount;
  const stampDuty = !isExpirySettlement && side === "BUY" ? OPTIONS_STAMP_DUTY_RATE * grossAmount : 0;
  const gst = GST_RATE * (brokerage + exchangeCharge + sebiFee);
  const dpCharge = 0; // always zero for options — cash-settled, never enters demat

  const totalCosts = brokerage + stt + exchangeCharge + sebiFee + stampDuty + gst + dpCharge;
  const isDebit = !isExpirySettlement && side === "BUY";
  const netAmount = isDebit ? grossAmount + totalCosts : grossAmount - totalCosts;

  return { grossAmount, brokerage, stt, exchangeCharge, sebiFee, stampDuty, gst, dpCharge, totalCosts, netAmount };
}

/** CE intrinsic value at expiry: max(0, spot - strike). */
export function computeCallIntrinsicValue(spot: number, strike: number): number {
  return Math.max(0, spot - strike);
}

/** PE intrinsic value at expiry: max(0, strike - spot). */
export function computePutIntrinsicValue(spot: number, strike: number): number {
  return Math.max(0, strike - spot);
}

/** Dispatches to computeCallIntrinsicValue/computePutIntrinsicValue by option type — the single entry point the expiry-settlement cron should call. */
export function computeIntrinsicValue(optionType: "CE" | "PE", spot: number, strike: number): number {
  return optionType === "CE" ? computeCallIntrinsicValue(spot, strike) : computePutIntrinsicValue(spot, strike);
}

// ─── Phase 3 — stock-option square-off pricing fallback ──────────────────────

/**
 * Phase 3 stock-option square-off cron (T6): which tier resolved the fill
 * price, threaded through to the order-confirmation/position UI so a
 * thin-liquidity fill is visibly flagged rather than presented as a clean
 * market execution — mirrors how Phase 2's cron surfaces `usedSpotFallback`.
 * Not a DB column — a transient value on the cron's per-position result.
 */
export type SquareOffPricingSource = "LAST_PRICE" | "BID_ASK_MID" | "INTRINSIC_ESTIMATE";

export interface ResolveSquareOffPriceInput {
  /** Live last-traded premium from the option-chain snapshot, if any. */
  lastPrice: number | null;
  bidPrice: number | null;
  askPrice: number | null;
  optionType: "CE" | "PE";
  /** Live underlying spot value — only consulted for the tier-3 intrinsic-value estimate. */
  spot: number;
  strikePrice: number;
}

export interface ResolveSquareOffPriceResult {
  price: number;
  source: SquareOffPricingSource;
}

/**
 * The 3-tier fallback the Phase 3 stock-option square-off cron uses to price
 * a forced-close fill, because single-stock strikes frequently go quote-dark
 * (unlike NIFTY/BANKNIFTY, which always have a live lastPrice near spot):
 *
 *   1. Live lastPrice, when present and > 0 (a real traded price always wins).
 *   2. Bid/ask midpoint, when lastPrice is null/zero but BOTH quotes exist
 *      (a one-sided quote — bid with no ask, or vice versa — does NOT count
 *      as "both exist" and falls through to tier 3; a lone quote isn't a
 *      reliable two-sided market).
 *   3. Intrinsic-value estimate (computeIntrinsicValue), when neither a
 *      trade price nor a two-sided quote exists at all — used purely as a
 *      PRICE ESTIMATOR here, not as a settlement mechanism (the settlement
 *      mechanism is still "square off as a normal SELL", see
 *      computeOptionOrderCosts's cost-trap doc comment).
 *
 * Pure function — the cron (apps/api/lib/paperTrading/stockOptionSquareOff.ts)
 * is the only I/O-performing caller; this is independently unit-testable
 * without a live chain fetch, which is what the verify script's tier-selection
 * assertions exercise.
 */
export function resolveSquareOffPrice(input: ResolveSquareOffPriceInput): ResolveSquareOffPriceResult {
  const { lastPrice, bidPrice, askPrice, optionType, spot, strikePrice } = input;

  if (lastPrice != null && lastPrice > 0) {
    return { price: lastPrice, source: "LAST_PRICE" };
  }
  if (bidPrice != null && askPrice != null) {
    return { price: (bidPrice + askPrice) / 2, source: "BID_ASK_MID" };
  }
  return { price: computeIntrinsicValue(optionType, spot, strikePrice), source: "INTRINSIC_ESTIMATE" };
}
