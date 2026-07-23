/**
 * Paper Trading Phase 1 — the India cash-equity retail cost stack, FY2025-26.
 *
 * This is the product. Every rate below is a single named constant so it can be
 * revised in one place if a regulator/exchange changes it. Rates are representative
 * discount-broker figures (Zerodha-class pricing) — a simulator, not a live quote
 * engine — and MUST ship with a visible "rates are indicative and may not match
 * your real broker" disclaimer wherever a cost breakdown renders (see
 * apps/web/components/paper-trading/paper-trading-disclaimer-footer.tsx).
 *
 * Pure module: zero I/O, zero Prisma — importable identically from apps/api (the
 * square-off cron) and apps/web (order placement, and the client-side pre-trade
 * cost estimate — see the New Trade form, which calls computeOrderCosts() directly
 * in the browser against a client-fetched LTP so the estimate and the eventual
 * server-side fill are provably the same function, not two hand-synced copies).
 */

export type PaperOrderSide = "BUY" | "SELL";
export type PaperProductType = "DELIVERY" | "INTRADAY";

// ─── Named rate constants (FY2025-26) ────────────────────────────────────────────

/** INTRADAY brokerage: min(₹20, 0.03% of turnover) per executed leg — charged on BOTH the BUY and SELL leg independently. DELIVERY brokerage is always ₹0 (the discount-broker norm). */
export const INTRADAY_BROKERAGE_RATE = 0.0003; // 0.03%
export const INTRADAY_BROKERAGE_CAP = 20; // ₹20 per leg

/** STT (Securities Transaction Tax). DELIVERY: both legs. INTRADAY: SELL leg only. */
export const DELIVERY_STT_RATE = 0.001; // 0.1%
export const INTRADAY_STT_RATE = 0.00025; // 0.025%

/** NSE exchange transaction charge — flat blended approximation of NSE's real turnover-slab-tiered schedule (the right precision level for a simulator). Both legs, both product types. */
export const EXCHANGE_TXN_CHARGE_RATE = 0.0000297; // 0.00297%

/** SEBI turnover fee ("₹10 per crore"). Both legs, both product types. */
export const SEBI_TURNOVER_FEE_RATE = 0.000001; // 0.0001%

/**
 * Stamp duty (2020 national reform, collected via the exchange). BUY side only,
 * for BOTH product types — but the rate itself is PRODUCT-DIFFERENTIATED, not a
 * single flat rate: DELIVERY is 0.015% ("₹1,500 per crore"), INTRADAY is a lower
 * 0.003% ("₹300 per crore") per real discount-broker (Zerodha/Groww) contract
 * notes. Charging the DELIVERY rate on an INTRADAY buy overstates intraday costs
 * 5x — verified against real contract notes 2026-07-23.
 */
export const DELIVERY_STAMP_DUTY_RATE = 0.00015; // 0.015%
export const INTRADAY_STAMP_DUTY_RATE = 0.00003; // 0.003%

/**
 * GST applies to (brokerage + exchange transaction charge + SEBI turnover fee) —
 * these three are billable services/charges under GST; STT and stamp duty are
 * OUT of the base (they're taxes/statutory levies, not billable services, and are
 * commonly mis-implemented as GST-inclusive by naive builds). Verified against
 * real discount-broker (Zerodha/Groww) contract notes 2026-07-23 — the SEBI fee
 * is small enough (0.0001% of turnover) that omitting it from the base is an easy
 * mistake to miss in a spot-check, but real contract notes do include it.
 */
export const GST_RATE = 0.18;

/** DP (Depository Participant / CDSL-NSDL) charge: flat ₹15 + 18% GST = ₹17.70, rounded to ₹18. Charged ONCE PER SCRIP PER DAY, only when SELLING a DELIVERY holding. Never on BUY. Never on INTRADAY (no shares ever enter demat on an intraday trade). */
export const DP_CHARGE_FLAT = 15;
export const DP_CHARGE_ROUNDED = Math.round(DP_CHARGE_FLAT * (1 + GST_RATE)); // 18

export interface ComputeOrderCostsInput {
  side: PaperOrderSide;
  productType: PaperProductType;
  quantity: number;
  /** Fill price per share. */
  price: number;
  /**
   * Whether this SELL is the FIRST DELIVERY sell of this symbol, for this
   * account, on this calendar day — the DP charge is a once-per-scrip-per-day
   * debit, not a per-order one. Ignored (treated as false) for BUY orders and
   * for INTRADAY orders, neither of which can ever attract a DP charge. The
   * caller (apps/web/lib/paperTrading/orders.ts) determines this by checking
   * whether an earlier DELIVERY SELL of the same symbol already exists for the
   * account today, via replay.ts's order log.
   */
  isFirstDeliverySellOfScripToday?: boolean;
}

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
  /** BUY: grossAmount + totalCosts (cash debited). SELL: grossAmount - totalCosts (cash credited). */
  netAmount: number;
}

/**
 * Computes every itemized cost line for one order LEG (one BUY or one SELL —
 * a round trip is two independent calls, not one). Pure function, no rounding
 * applied beyond ordinary floating-point arithmetic except DP_CHARGE_ROUNDED
 * (which is pre-rounded as a constant, per the brief's exact spec) — callers
 * that need currency-display rounding do it at render time, not here, so the
 * arithmetic stays exact for verification/testing.
 */
export function computeOrderCosts(input: ComputeOrderCostsInput): OrderCostBreakdown {
  const { side, productType, quantity, price } = input;
  const grossAmount = quantity * price;

  const brokerage =
    productType === "INTRADAY" ? Math.min(INTRADAY_BROKERAGE_CAP, INTRADAY_BROKERAGE_RATE * grossAmount) : 0;

  const stt =
    productType === "DELIVERY"
      ? DELIVERY_STT_RATE * grossAmount
      : side === "SELL"
        ? INTRADAY_STT_RATE * grossAmount
        : 0;

  const exchangeCharge = EXCHANGE_TXN_CHARGE_RATE * grossAmount;
  const sebiFee = SEBI_TURNOVER_FEE_RATE * grossAmount;
  const stampDutyRate = productType === "DELIVERY" ? DELIVERY_STAMP_DUTY_RATE : INTRADAY_STAMP_DUTY_RATE;
  const stampDuty = side === "BUY" ? stampDutyRate * grossAmount : 0;
  const gst = GST_RATE * (brokerage + exchangeCharge + sebiFee);
  const dpCharge =
    productType === "DELIVERY" && side === "SELL" && input.isFirstDeliverySellOfScripToday === true
      ? DP_CHARGE_ROUNDED
      : 0;

  const totalCosts = brokerage + stt + exchangeCharge + sebiFee + stampDuty + gst + dpCharge;
  const netAmount = side === "BUY" ? grossAmount + totalCosts : grossAmount - totalCosts;

  return { grossAmount, brokerage, stt, exchangeCharge, sebiFee, stampDuty, gst, dpCharge, totalCosts, netAmount };
}
