/**
 * Paper Trading Phase 4 — the India F&O (index futures) retail cost stack,
 * FY2026-27, current as of 2026-07-25. Sibling module to costs.ts (equity cash
 * market) and optionsCosts.ts (index/stock options) — a separate file because
 * futures brokerage, STT basis, and the margin/collateral question below are
 * governed by rules distinct enough from both siblings to warrant their own
 * named constants rather than branching inside an existing file.
 *
 * Pure module: zero I/O, zero Prisma — importable identically from apps/api
 * (the daily MTM/margin-call cron, the expiry-settlement cron) and apps/web
 * (order placement + the client-side pre-trade cost estimate), exactly like
 * costs.ts/optionsCosts.ts.
 *
 * Same disclaimer requirement as costs.ts/optionsCosts.ts: every rate below is
 * a representative discount-broker figure (Zerodha-class pricing), not a live
 * exchange quote — ships with a visible "rates are indicative and may not
 * match your real broker" disclaimer wherever a cost breakdown renders.
 *
 * ─── THE COLLATERAL QUESTION, VERIFIED (not silently inherited) ───────────
 *
 * optionsCosts.ts's OPTIONS_BROKERAGE_FLAT doc comment flagged that Zerodha's
 * April-2026 F&O brokerage change is conditioned on SEBI's 50%-cash-collateral
 * rule for margin-backed F&O positions, and explicitly deferred re-verifying
 * it to "whichever phase first introduces real margin/collateral" — that
 * phase is this one. Verified 2026-07-25 against Zerodha's own published
 * clarification (z-connect "Clarification on additional brokerage for F&O
 * trades") and current charges page (zerodha.com/charges):
 *
 *   - The STANDARD futures brokerage is min(₹20, 0.03% of turnover) per
 *     executed order — SAME formula shape as this codebase's own
 *     INTRADAY_BROKERAGE_RATE/INTRADAY_BROKERAGE_CAP in costs.ts (not a flat
 *     ₹20-always like options, and NOT a flat ₹40 either).
 *   - An ADDITIONAL ₹20/order surcharge applies only when a trader (a) funds
 *     margin via PLEDGED non-cash collateral, (b) fails to maintain the
 *     SEBI-mandated 50% cash-or-cash-equivalent ratio, AND (c) the resulting
 *     cash shortfall exceeds ₹5 lakh. Zerodha's own disclosure: "fewer than
 *     10,000 of our tens of lakhs of active F&O traders are affected."
 *   - This simulator has NO pledged-collateral concept at all — every rupee
 *     of margin is virtual, unencumbered cash drawn from the account's own
 *     startingCapital/cash balance (see futuresMargin.ts; there is no
 *     PaperOrder/PaperTradingAccount field representing a pledged security).
 *     A fully-cash-funded account is, by construction, always at 100% cash
 *     collateral — the exact condition under which Zerodha's own disclosure
 *     confirms the surcharge never applies. The standard formula is therefore
 *     the CORRECT and ONLY applicable one for this product, not a
 *     simplification — there is no code path in this simulator that could
 *     ever trigger the surcharge condition, so it isn't modeled at all.
 */

export type FuturesOrderSide = "BUY" | "SELL";

// ─── Named rate constants (FY2026-27, F&O futures segment, verified 2026-07-25) ──

/**
 * Futures brokerage: min(₹20, 0.03% of turnover) per executed leg — same
 * formula shape as costs.ts's INTRADAY_BROKERAGE_RATE/CAP, deliberately a
 * SEPARATE named constant (not a re-export) since futures and equity-intraday
 * brokerage are governed by independent rate schedules that could diverge.
 * Applies to a manual open/close leg and a margin-call forced square-off leg
 * (both are real market orders); NEVER charged on an automatic
 * exchange-driven expiry cash-settlement (no discount broker bills an "order"
 * fee for a settlement the user never placed) — see the leg-type dispatch in
 * computeFuturesOrderCosts below.
 */
export const FUTURES_BROKERAGE_RATE = 0.0003; // 0.03%
export const FUTURES_BROKERAGE_CAP = 20; // ₹20 per leg

/**
 * STT (Securities Transaction Tax) on futures — SELL side only, on turnover
 * (grossAmount). Futures have no premium/intrinsic-value duality the way
 * options do (see optionsCosts.ts's two-constant STT split), so a single rate
 * covers every sell-side leg type: a manual close, a margin-call forced
 * close, and an expiry cash-settlement all apply this same rate to their
 * respective turnover.
 *
 * Budget 2026-27 raised this from 0.02% to 0.05%, effective for trades
 * executed on/after 1 April 2026 — verified 2026-07-25 against Zerodha's
 * published STT explainer, which explicitly confirms the pre-hike rate was
 * 0.02% and the current rate is 0.05%. This mirrors the exact same-Budget
 * hike optionsCosts.ts's OPTIONS_STT_SELL_RATE doc comment already flags for
 * options — do not let this constant silently drift back to the stale 0.02%
 * candidate a naive read of the pre-Budget internet would suggest.
 */
export const FUTURES_STT_SELL_RATE = 0.0005; // 0.05% of turnover, sell-side only

/**
 * NSE exchange transaction charge for the futures (equity derivatives)
 * segment — flat blended figure, both BUY and SELL/settlement legs, on
 * turnover. Verified 2026-07-25 against Zerodha's current charges page:
 * 0.00183% (the post-March-2026 NSE transaction-charge revision figure — a
 * separate, more recent verification than optionsCosts.ts's own
 * OPTIONS_EXCHANGE_TXN_CHARGE_RATE, which is the options-segment rate and was
 * last checked 2026-07-23; the two segments' rates are independently set by
 * NSE and have never been assumed identical in this codebase).
 */
export const FUTURES_EXCHANGE_TXN_CHARGE_RATE = 0.0000183; // 0.00183%

/**
 * SEBI turnover fee ("₹10 per crore") and GST — both reuse costs.ts's
 * constants directly, NOT duplicated: SEBI's turnover-fee schedule and the
 * 18%-of-(brokerage+exchange+SEBI) GST base rule are both segment-agnostic
 * across cash-equity and every F&O product. Re-exported here so a consumer
 * that only imports futuresCosts.ts doesn't also need a separate import from
 * costs.ts for these two shared rates (same convention optionsCosts.ts
 * already established).
 */
import { GST_RATE, SEBI_TURNOVER_FEE_RATE } from "./costs";

export { GST_RATE, SEBI_TURNOVER_FEE_RATE };

/**
 * Stamp duty — BUY side only, on turnover. Never on SELL, never on an expiry-
 * settlement or margin-call-close leg (stamp duty is a buy-side instrument
 * tax in every segment this codebase models). Verified 2026-07-25 against
 * Zerodha's current charges page: 0.002% (₹200/crore) on the buy side —
 * confirms the founder's own candidate figure, no correction needed.
 */
export const FUTURES_STAMP_DUTY_RATE = 0.00002; // 0.002%

/**
 * DP (Depository Participant) charge — ALWAYS ₹0 for futures, same reasoning
 * as optionsCosts.ts's OPTIONS DP posture: an index future is cash-settled
 * and never enters demat, so there is never a scrip to debit. Hardcoded 0 in
 * computeFuturesOrderCosts below.
 */

export interface ComputeFuturesOrderCostsInput {
  side: FuturesOrderSide;
  /** Total contract quantity = lots * lotSize (the canonical unit costs.ts/optionsCosts.ts both use — never lots alone). */
  quantity: number;
  /** Futures price per unit for a manual open/close or margin-call-close leg. Ignored (in favor of settlementPrice) when isExpirySettlement is true. */
  price: number;
  /** True only for the cron-driven expiry cash-settlement leg. Zeroes brokerage — see path 2 in the module doc. */
  isExpirySettlement?: boolean;
  /** Required when isExpirySettlement is true: today's F&O bhavcopy SETTLE_PR for this contract. Ignored for a manual/margin-call leg. */
  settlementPrice?: number;
}

/** Same shape as costs.ts's/optionsCosts.ts's OrderCostBreakdown — reused, not forked, so every render surface (CostBreakdownTable etc.) works identically for an equity, option, or futures leg. */
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
  /** BUY: grossAmount + totalCosts (cash debited). SELL or expiry settlement: grossAmount - totalCosts (cash credited). */
  netAmount: number;
}

/**
 * Computes every itemized cost line for one REAL futures order LEG — a
 * manual open/close (side dispatches BUY-to-open-long/close-short vs
 * SELL-to-open-short/close-long, cost formula is side-symmetric either way),
 * a margin-call forced square-off (same cost shape as a manual close — see
 * the module doc's "leg-type dispatch" note, this is where P3's cost-trap
 * precedent repeats: full brokerage + full sell-side STT, NOT the
 * zero-brokerage settlement path), or a cron-driven expiry cash-settlement
 * (brokerage forced to ₹0 via isExpirySettlement).
 *
 * Deliberately NOT used for a daily mark-to-market leg — that leg type is a
 * pure cash movement with an all-zero cost object by construction, hardcoded
 * at the call site (the daily-MTM cron), never routed through this function
 * at all. See the module doc's leg-type-4 note.
 *
 * Pure function, no rounding beyond ordinary floating-point arithmetic —
 * currency display rounding happens at render time, not here, so
 * verification stays exact.
 */
export function computeFuturesOrderCosts(input: ComputeFuturesOrderCostsInput): OrderCostBreakdown {
  const { side, quantity, isExpirySettlement = false } = input;

  // grossAmount is always price * quantity for a manual/margin-call leg. For
  // the expiry-settlement leg it's settlementPrice * quantity — the
  // settlement "fill price" IS the bhavcopy settlement price (see the schema
  // doc on PaperOrder.fillPrice).
  const unitPrice = isExpirySettlement ? (input.settlementPrice ?? 0) : input.price;
  const grossAmount = quantity * unitPrice;

  // Brokerage: min(₹20, 0.03% of turnover) for a manual open/close or a
  // margin-call forced close (both are real orders), ₹0 for an automatic
  // exchange-driven expiry settlement the user never placed.
  const brokerage = isExpirySettlement ? 0 : Math.min(FUTURES_BROKERAGE_CAP, FUTURES_BROKERAGE_RATE * grossAmount);

  // STT: sell-side only, on turnover, for EVERY leg type that credits a sell
  // (manual close-via-SELL, margin-call close-via-SELL, and expiry
  // settlement, which is always priced/treated as a sell-side turnover event
  // regardless of whether the closed position was long or short — the
  // exchange-computed settlement itself is the taxable event, not a
  // buy/sell direction).
  const stt = isExpirySettlement
    ? FUTURES_STT_SELL_RATE * grossAmount
    : side === "SELL"
      ? FUTURES_STT_SELL_RATE * grossAmount
      : 0;

  const exchangeCharge = FUTURES_EXCHANGE_TXN_CHARGE_RATE * grossAmount;
  const sebiFee = SEBI_TURNOVER_FEE_RATE * grossAmount;
  const stampDuty = !isExpirySettlement && side === "BUY" ? FUTURES_STAMP_DUTY_RATE * grossAmount : 0;
  const gst = GST_RATE * (brokerage + exchangeCharge + sebiFee);
  const dpCharge = 0; // always zero for futures — cash-settled, never enters demat

  const totalCosts = brokerage + stt + exchangeCharge + sebiFee + stampDuty + gst + dpCharge;
  const isDebit = !isExpirySettlement && side === "BUY";
  const netAmount = isDebit ? grossAmount + totalCosts : grossAmount - totalCosts;

  return { grossAmount, brokerage, stt, exchangeCharge, sebiFee, stampDuty, gst, dpCharge, totalCosts, netAmount };
}

/**
 * The all-zero cost object for a daily mark-to-market leg (Phase 4 leg-type
 * 4 — see the module doc). NOT computed by calling computeFuturesOrderCosts
 * with a synthetic zero-price order (which would coincidentally also yield
 * zero for every percentage-based line, but ₹0 flat-capped brokerage would
 * NOT naturally be zero — min(₹20, 0.03% * 0) = ₹0 only because turnover is
 * zero, which is the WRONG reason; a real MTM leg's "turnover" is
 * conceptually undefined, not zero, so hardcoding this object makes the
 * all-zero-ness a deliberate leg-type property, not an arithmetic
 * coincidence of a zero price). `grossAmount` is 0 by construction (the MTM
 * leg has quantity: 0 — see the schema doc on PaperOrder.isDailyMtm);
 * `netAmount` is deliberately NOT included here — the caller (the daily-MTM
 * cron, via replay.ts's deriveFuturesPositions formula) computes the signed
 * variation-margin cash flow separately and assigns it to the order's
 * `netAmount` field directly.
 */
export function zeroDailyMtmCosts(): Omit<OrderCostBreakdown, "netAmount"> {
  return { grossAmount: 0, brokerage: 0, stt: 0, exchangeCharge: 0, sebiFee: 0, stampDuty: 0, gst: 0, dpCharge: 0, totalCosts: 0 };
}
