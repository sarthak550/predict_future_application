/**
 * Paper Trading Phase 1 — T2 acceptance script for the cost stack + replay engine.
 *
 * Pure functions only (packages/business-rules/src/papertrading/{costs,replay,
 * marketHours}.ts) — zero I/O, zero Prisma, so unlike verify-portfolios-engine.ts
 * this needs no database and no cleanup step. Every rupee assertion below is
 * hand-calculated against the exact FY2025-26 rate constants in costs.ts (see that
 * file's doc comments for the source rates) so a future rate change that silently
 * breaks the arithmetic gets caught here, not in production.
 *
 * Run: npx tsx scripts/verify-papertrading-engine.ts   (from apps/api)
 */

import {
  computeOrderCosts,
  DP_CHARGE_ROUNDED,
  DELIVERY_STAMP_DUTY_RATE,
  DELIVERY_STT_RATE,
  EXCHANGE_TXN_CHARGE_RATE,
  GST_RATE,
  INTRADAY_BROKERAGE_CAP,
  INTRADAY_BROKERAGE_RATE,
  INTRADAY_STAMP_DUTY_RATE,
  INTRADAY_STT_RATE,
  SEBI_TURNOVER_FEE_RATE,
  type PaperProductType
} from "@predict-future/business-rules/papertrading/costs";
import {
  computeIntrinsicValue,
  computeOptionOrderCosts,
  OPTIONS_BROKERAGE_FLAT,
  OPTIONS_EXCHANGE_TXN_CHARGE_RATE,
  OPTIONS_STAMP_DUTY_RATE,
  OPTIONS_STT_EXERCISE_RATE,
  OPTIONS_STT_SELL_RATE
} from "@predict-future/business-rules/papertrading/optionsCosts";
import {
  deriveAllDeliveryPositions,
  deriveAllOptionPositions,
  deriveCash,
  deriveDeliveryHoldings,
  deriveIntradayDailyPositions,
  deriveOptionPositions,
  isFirstDeliverySellOfScripToday,
  netPnl,
  openExpiringPositions,
  openIntradayPositions,
  replayPosition,
  unrealizedGrossPnl,
  type PaperEngineOrder
} from "@predict-future/business-rules/papertrading/replay";
import { isNseWeekdayMarketHours } from "@predict-future/business-rules/papertrading/marketHours";

let passCount = 0;
let failCount = 0;

function assertClose(actual: number, expected: number, message: string, epsilon = 1e-6) {
  const ok = Math.abs(actual - expected) < epsilon;
  if (ok) {
    passCount += 1;
    console.log(`  PASS: ${message} (${actual.toFixed(4)})`);
  } else {
    failCount += 1;
    console.error(`  FAIL: ${message}\n        expected=${expected} actual=${actual}`);
  }
}

function assertTrue(actual: boolean, message: string) {
  if (actual) {
    passCount += 1;
    console.log(`  PASS: ${message}`);
  } else {
    failCount += 1;
    console.error(`  FAIL: ${message} — expected true, got false`);
  }
}

function assertEqual<T>(actual: T, expected: T, message: string) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (ok) {
    passCount += 1;
    console.log(`  PASS: ${message}`);
  } else {
    failCount += 1;
    console.error(`  FAIL: ${message}\n        expected=${JSON.stringify(expected)} actual=${JSON.stringify(actual)}`);
  }
}

/** IST instant helper — `hour`/`minute` are IST clock time on a fixed date. */
function istInstant(y: number, m: number, d: number, hour: number, minute: number): Date {
  // IST = UTC+5:30, so UTC instant = IST wall clock - 5:30.
  return new Date(Date.UTC(y, m - 1, d, hour - 5, minute - 30));
}

type OrderInput = Omit<PaperEngineOrder, "totalCosts" | "netAmount" | "productType"> & {
  /** Equity test orders always carry a real (non-null) productType — the schema's nullable-for-options relaxation doesn't apply to this file's EQUITY test cases. */
  productType: PaperProductType;
  isFirstDeliverySellOfScripToday?: boolean;
};

/** Builds a PaperEngineOrder by running the real computeOrderCosts() over the given fill — every test order's cost fields are the SAME function under test, never hand-filled, so a case can't accidentally "pass" against a wrong totalCosts. */
function order(input: OrderInput): PaperEngineOrder {
  const { isFirstDeliverySellOfScripToday, ...rest } = input;
  const costs = computeOrderCosts({
    side: rest.side,
    productType: rest.productType,
    quantity: rest.quantity,
    price: rest.fillPrice,
    isFirstDeliverySellOfScripToday: isFirstDeliverySellOfScripToday ?? false
  });
  return { ...rest, totalCosts: costs.totalCosts, netAmount: costs.netAmount };
}

async function main() {
  console.log("Paper Trading Phase 1 — costs + replay engine acceptance run\n");

  // ── 1. DELIVERY round trip: BUY 100 @ ₹1,000, SELL 100 @ ₹1,000 (flat price) ──
  console.log("1. DELIVERY round trip — 100 shares @ ₹1,000, flat price");
  {
    const buy = computeOrderCosts({ side: "BUY", productType: "DELIVERY", quantity: 100, price: 1000 });
    assertClose(buy.grossAmount, 100000, "BUY grossAmount = ₹1,00,000");
    assertClose(buy.brokerage, 0, "DELIVERY brokerage is always ₹0");
    assertClose(buy.stt, DELIVERY_STT_RATE * 100000, "BUY STT = 0.1% of turnover");
    assertClose(buy.exchangeCharge, EXCHANGE_TXN_CHARGE_RATE * 100000, "BUY exchange charge = 0.00297% of turnover");
    assertClose(buy.sebiFee, SEBI_TURNOVER_FEE_RATE * 100000, "BUY SEBI fee = 0.0001% of turnover");
    assertClose(buy.stampDuty, DELIVERY_STAMP_DUTY_RATE * 100000, "BUY stamp duty = 0.015% of turnover (DELIVERY rate, BUY side only)");
    assertClose(
      buy.gst,
      GST_RATE * (0 + EXCHANGE_TXN_CHARGE_RATE * 100000 + SEBI_TURNOVER_FEE_RATE * 100000),
      "BUY GST = 18% of (brokerage + exchange charge + SEBI fee) — STT and stamp duty stay OUT of the base"
    );
    assertClose(buy.dpCharge, 0, "DP charge never applies to a BUY");
    assertClose(buy.totalCosts, 118.6226, "BUY totalCosts (hand-calculated)");
    assertClose(buy.netAmount, 100118.6226, "BUY netAmount = gross + totalCosts (cash debited)");

    const sell = computeOrderCosts({ side: "SELL", productType: "DELIVERY", quantity: 100, price: 1000, isFirstDeliverySellOfScripToday: true });
    assertClose(sell.stt, DELIVERY_STT_RATE * 100000, "SELL STT = 0.1% of turnover (DELIVERY charges STT on BOTH legs)");
    assertClose(sell.stampDuty, 0, "SELL stamp duty = 0 (BUY side only)");
    assertClose(sell.dpCharge, DP_CHARGE_ROUNDED, "First DELIVERY sell of the day charges the ₹18 DP fee");
    assertClose(sell.totalCosts, 121.6226, "SELL totalCosts (hand-calculated)");
    assertClose(sell.netAmount, 99878.3774, "SELL netAmount = gross - totalCosts (cash credited)");

    const roundTripCost = buy.totalCosts + sell.totalCosts;
    assertClose(roundTripCost, 240.2452, "DELIVERY round-trip total cost at a flat price");
  }

  // ── 2. INTRADAY round trip: BUY 100 @ ₹1,000, SELL 100 @ ₹1,000 (flat price) ──
  console.log("\n2. INTRADAY round trip — 100 shares @ ₹1,000, flat price");
  {
    const buy = computeOrderCosts({ side: "BUY", productType: "INTRADAY", quantity: 100, price: 1000 });
    assertClose(buy.brokerage, Math.min(INTRADAY_BROKERAGE_CAP, INTRADAY_BROKERAGE_RATE * 100000), "BUY brokerage = min(₹20, 0.03% of turnover) = ₹20 (0.03% of 1L is ₹30, capped)");
    assertClose(buy.stt, 0, "INTRADAY STT is 0 on the BUY leg (SELL only)");
    assertClose(
      buy.stampDuty,
      INTRADAY_STAMP_DUTY_RATE * 100000,
      "Stamp duty still applies to INTRADAY BUY (BUY side, both product types) — but at INTRADAY's lower 0.003% rate, NOT DELIVERY's 0.015%"
    );
    assertClose(buy.totalCosts, 30.2226, "INTRADAY BUY totalCosts (hand-calculated)");

    const sell = computeOrderCosts({ side: "SELL", productType: "INTRADAY", quantity: 100, price: 1000 });
    assertClose(sell.brokerage, 20, "SELL brokerage also charged independently = ₹20");
    assertClose(sell.stt, INTRADAY_STT_RATE * 100000, "INTRADAY STT = 0.025% of turnover, SELL leg only");
    assertClose(sell.stampDuty, 0, "No stamp duty on the SELL leg");
    assertClose(sell.dpCharge, 0, "INTRADAY never attracts a DP charge, even on SELL");
    assertClose(sell.totalCosts, 52.2226, "INTRADAY SELL totalCosts (hand-calculated)");

    const roundTripCost = buy.totalCosts + sell.totalCosts;
    assertClose(
      roundTripCost,
      82.4452,
      "INTRADAY round-trip cost — roughly a third of DELIVERY's here (₹240.2452): DELIVERY's STT applies on BOTH legs and dominates, even though INTRADAY pays brokerage on both legs and DELIVERY pays none"
    );
  }

  // ── 3. INTRADAY short (sell-first) round trip: SELL 50 @ ₹2,000, BUY 50 @ ₹2,000 ──
  console.log("\n3. INTRADAY short (sell-first) round trip — 50 shares @ ₹2,000, flat price");
  {
    const open = computeOrderCosts({ side: "SELL", productType: "INTRADAY", quantity: 50, price: 2000 });
    assertClose(open.grossAmount, 100000, "Short-open grossAmount = ₹1,00,000");
    assertClose(open.totalCosts, 52.2226, "Short-open (SELL) totalCosts — identical shape to case 2's SELL leg");
    assertClose(open.netAmount, 99947.7774, "Short-open credits cash (SELL proceeds net of costs)");

    const cover = computeOrderCosts({ side: "BUY", productType: "INTRADAY", quantity: 50, price: 2000 });
    assertClose(cover.totalCosts, 30.2226, "Cover (BUY) totalCosts — identical shape to case 2's BUY leg");
    assertClose(cover.netAmount, 100030.2226, "Cover debits cash to buy back the shorted shares");

    const netCashEffect = open.netAmount - cover.netAmount;
    assertClose(netCashEffect, -82.4452, "Net cash effect of a flat-price short round trip = -totalCosts only (no price P&L)");
  }

  // ── 4. Replay engine: weighted-average DELIVERY holdings across a partial sell ──
  console.log("\n4. deriveDeliveryHoldings — weighted-average cost across a partial sell");
  {
    const orders: PaperEngineOrder[] = [
      order({ symbol: "TCS", side: "BUY", productType: "DELIVERY", quantity: 10, fillPrice: 3000, createdAt: istInstant(2026, 7, 20, 11, 0) }),
      order({ symbol: "TCS", side: "BUY", productType: "DELIVERY", quantity: 10, fillPrice: 3200, createdAt: istInstant(2026, 7, 21, 11, 0) }),
      order({ symbol: "TCS", side: "SELL", productType: "DELIVERY", quantity: 5, fillPrice: 3400, createdAt: istInstant(2026, 7, 22, 11, 0) })
    ];
    const holdings = deriveDeliveryHoldings(orders);
    assertEqual(holdings.length, 1, "Exactly one symbol held after these three fills");
    const tcs = holdings[0];
    assertClose(tcs.quantity, 15, "15 shares remain after buying 20 and selling 5");
    assertClose(tcs.avgCost, 3100, "Weighted-average cost of the 20 bought shares = (10*3000 + 10*3200)/20 = 3,100 (unaffected by the later sell)");
    assertClose(tcs.realizedGrossPnl, 5 * (3400 - 3100), "Realized gross P&L on the 5 sold shares = qty * (exit - avgCost at time of sell)");
  }

  // ── 5. openIntradayPositions — detects only TODAY's open INTRADAY net position ──
  console.log("\n5. openIntradayPositions — day-scoped detection for the square-off cron");
  {
    const today = istInstant(2026, 7, 22, 12, 0);
    const orders: PaperEngineOrder[] = [
      // Yesterday's intraday trade, fully closed — must NOT appear even though same symbol.
      order({ symbol: "INFY", side: "BUY", productType: "INTRADAY", quantity: 10, fillPrice: 1500, createdAt: istInstant(2026, 7, 21, 10, 0) }),
      order({ symbol: "INFY", side: "SELL", productType: "INTRADAY", quantity: 10, fillPrice: 1510, createdAt: istInstant(2026, 7, 21, 14, 0) }),
      // Today's open long — should appear.
      order({ symbol: "INFY", side: "BUY", productType: "INTRADAY", quantity: 20, fillPrice: 1520, createdAt: istInstant(2026, 7, 22, 10, 0) }),
      // Today's open short on a different symbol — should also appear.
      order({ symbol: "WIPRO", side: "SELL", productType: "INTRADAY", quantity: 30, fillPrice: 400, createdAt: istInstant(2026, 7, 22, 10, 30) }),
      // Today's DELIVERY buy — must NOT appear, wrong product type.
      order({ symbol: "HDFCBANK", side: "BUY", productType: "DELIVERY", quantity: 5, fillPrice: 1600, createdAt: istInstant(2026, 7, 22, 11, 0) })
    ];
    const open = openIntradayPositions(orders, today);
    assertEqual(open.length, 2, "Exactly two symbols have an open intraday position today");
    const infy = open.find((p) => p.symbol === "INFY");
    const wipro = open.find((p) => p.symbol === "WIPRO");
    assertTrue(infy !== undefined, "INFY's open long is detected");
    assertClose(infy!.quantity, 20, "INFY open quantity = 20 (long)");
    assertTrue(wipro !== undefined, "WIPRO's open short is detected");
    assertClose(wipro!.quantity, -30, "WIPRO open quantity = -30 (short)");
  }

  // ── 6. Realized P&L on an intraday short + unrealized/net P&L helpers ──────────
  console.log("\n6. Realized P&L on a profitable short, plus unrealizedGrossPnl/netPnl");
  {
    const orders: PaperEngineOrder[] = [
      order({ symbol: "WIPRO", side: "SELL", productType: "INTRADAY", quantity: 100, fillPrice: 400, createdAt: istInstant(2026, 7, 22, 10, 0) }),
      order({ symbol: "WIPRO", side: "BUY", productType: "INTRADAY", quantity: 100, fillPrice: 380, createdAt: istInstant(2026, 7, 22, 14, 0) })
    ];
    const position = replayPosition(orders);
    assertTrue(!position.isOpen, "Position is fully closed after the cover");
    assertClose(position.realizedGrossPnl, 100 * (400 - 380), "Short profits when covered below the entry price: qty * (avgCost - coverPrice)");

    const net = netPnl(position.realizedGrossPnl, 0, position.totalCosts);
    assertClose(net, position.realizedGrossPnl - position.totalCosts, "netPnl on a fully closed position = realized - totalCosts (no unrealized component)");

    const openLong = replayPosition([order({ symbol: "RELIANCE", side: "BUY", productType: "DELIVERY", quantity: 10, fillPrice: 2500, createdAt: istInstant(2026, 7, 22, 10, 0) })]);
    assertClose(unrealizedGrossPnl(openLong.quantity, openLong.avgCost, 2600), 10 * (2600 - 2500), "Unrealized P&L on an open long = (ltp - avgCost) * quantity");
  }

  // ── 7. deriveCash across a mixed BUY/SELL log ──────────────────────────────────
  console.log("\n7. deriveCash — full account cash replay");
  {
    const startingCapital = 100000;
    const buy = order({ symbol: "TCS", side: "BUY", productType: "DELIVERY", quantity: 10, fillPrice: 3000, createdAt: istInstant(2026, 7, 22, 10, 0) });
    const sell = order({ symbol: "TCS", side: "SELL", productType: "DELIVERY", quantity: 10, fillPrice: 3100, createdAt: istInstant(2026, 7, 22, 14, 0) });
    const cash = deriveCash(startingCapital, [buy, sell]);
    assertClose(cash, startingCapital - buy.netAmount + sell.netAmount, "Cash after a full round trip = starting - buy.netAmount + sell.netAmount");
  }

  // ── 8. isFirstDeliverySellOfScripToday — once-per-scrip-per-day DP gating ──────
  console.log("\n8. isFirstDeliverySellOfScripToday");
  {
    const firstSell = order({ symbol: "TCS", side: "SELL", productType: "DELIVERY", quantity: 5, fillPrice: 3100, createdAt: istInstant(2026, 7, 22, 11, 0) });
    assertTrue(isFirstDeliverySellOfScripToday([], "TCS", istInstant(2026, 7, 22, 11, 0)), "No prior orders at all -> first sell of the day");
    assertTrue(
      !isFirstDeliverySellOfScripToday([firstSell], "TCS", istInstant(2026, 7, 22, 15, 0)),
      "A second DELIVERY sell of TCS later the same day is NOT the first -> no second DP charge"
    );
    assertTrue(
      isFirstDeliverySellOfScripToday([firstSell], "TCS", istInstant(2026, 7, 23, 11, 0)),
      "The next calendar day resets the once-per-day gate"
    );
    assertTrue(
      isFirstDeliverySellOfScripToday([firstSell], "INFY", istInstant(2026, 7, 22, 11, 0)),
      "A different symbol is unaffected by another symbol's sell"
    );
  }

  // ── 9. isNseWeekdayMarketHours sanity ───────────────────────────────────────────
  console.log("\n9. isNseWeekdayMarketHours");
  {
    assertTrue(isNseWeekdayMarketHours(istInstant(2026, 7, 20, 11, 0)), "Monday 11:00 IST is within market hours");
    assertTrue(!isNseWeekdayMarketHours(istInstant(2026, 7, 20, 8, 0)), "Monday 08:00 IST is before market open");
    assertTrue(!isNseWeekdayMarketHours(istInstant(2026, 7, 20, 16, 0)), "Monday 16:00 IST is after market close");
    assertTrue(!isNseWeekdayMarketHours(istInstant(2026, 7, 25, 11, 0)), "Saturday 11:00 IST is a weekend, market closed");
  }

  // ── 10. Lifetime rollups: closed positions still count (deriveAllDeliveryPositions / deriveIntradayDailyPositions) ──
  console.log("\n10. Lifetime rollup functions include already-closed positions");
  {
    const closedDelivery: PaperEngineOrder[] = [
      order({ symbol: "ITC", side: "BUY", productType: "DELIVERY", quantity: 100, fillPrice: 400, createdAt: istInstant(2026, 7, 10, 10, 0) }),
      order({ symbol: "ITC", side: "SELL", productType: "DELIVERY", quantity: 100, fillPrice: 420, createdAt: istInstant(2026, 7, 15, 10, 0), isFirstDeliverySellOfScripToday: true })
    ];
    assertEqual(deriveDeliveryHoldings(closedDelivery).length, 0, "A fully-closed DELIVERY position is excluded from deriveDeliveryHoldings (nothing currently held)");
    const allDelivery = deriveAllDeliveryPositions(closedDelivery);
    assertEqual(allDelivery.length, 1, "...but deriveAllDeliveryPositions still returns it (lifetime rollup needs closed history)");
    assertClose(allDelivery[0].realizedGrossPnl, 100 * (420 - 400), "Closed DELIVERY position's realized P&L is preserved for the lifetime rollup");

    const twoDayIntraday: PaperEngineOrder[] = [
      order({ symbol: "SBIN", side: "BUY", productType: "INTRADAY", quantity: 50, fillPrice: 600, createdAt: istInstant(2026, 7, 20, 10, 0) }),
      order({ symbol: "SBIN", side: "SELL", productType: "INTRADAY", quantity: 50, fillPrice: 610, createdAt: istInstant(2026, 7, 20, 15, 15) }),
      order({ symbol: "SBIN", side: "SELL", productType: "INTRADAY", quantity: 20, fillPrice: 605, createdAt: istInstant(2026, 7, 21, 10, 0) }),
      order({ symbol: "SBIN", side: "BUY", productType: "INTRADAY", quantity: 20, fillPrice: 600, createdAt: istInstant(2026, 7, 21, 15, 15) })
    ];
    const daily = deriveIntradayDailyPositions(twoDayIntraday);
    assertEqual(daily.length, 2, "Two calendar days of INTRADAY activity in the same symbol are two independent positions, never merged");
    const day1 = daily.find((d) => d.dayKey === 20260720);
    const day2 = daily.find((d) => d.dayKey === 20260721);
    assertClose(day1!.realizedGrossPnl, 50 * (610 - 600), "Day 1's long round trip realized P&L computed independently");
    assertClose(day2!.realizedGrossPnl, 20 * (605 - 600), "Day 2's short round trip realized P&L computed independently, unaffected by day 1's entry price");
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Paper Trading Phase 2 — Index Options (optionsCosts.ts + replay.ts extension)
  // ═══════════════════════════════════════════════════════════════════════════

  /** Builds an INDEX_OPTION PaperEngineOrder fixture, running the real computeOptionOrderCosts() over the given fill — same "never hand-filled" discipline as order() above. */
  function optionOrder(input: {
    underlyingSymbol: string;
    optionType: "CE" | "PE";
    strikePrice: number;
    expiryDate: Date;
    lotSize: number;
    side: "BUY" | "SELL";
    quantity: number;
    fillPrice: number;
    createdAt: Date;
    isExpirySettlement?: boolean;
    intrinsicValue?: number;
  }): PaperEngineOrder {
    const isExpirySettlement = input.isExpirySettlement ?? false;
    const costs = computeOptionOrderCosts({
      side: input.side,
      quantity: input.quantity,
      price: input.fillPrice,
      isExpirySettlement,
      intrinsicValue: input.intrinsicValue
    });
    return {
      symbol: `${input.underlyingSymbol}${input.strikePrice}${input.optionType}`,
      side: input.side,
      productType: null,
      quantity: input.quantity,
      fillPrice: isExpirySettlement ? (input.intrinsicValue ?? 0) : input.fillPrice,
      totalCosts: costs.totalCosts,
      netAmount: costs.netAmount,
      createdAt: input.createdAt,
      instrumentKind: "INDEX_OPTION",
      underlyingSymbol: input.underlyingSymbol,
      optionType: input.optionType,
      strikePrice: input.strikePrice,
      expiryDate: input.expiryDate,
      lotSize: input.lotSize
    };
  }

  const utcDate = (y: number, m: number, d: number) => new Date(Date.UTC(y, m - 1, d));

  // ── 11. Options costs — BUY + manual SELL round trip (75 units @ ₹100 -> ₹150) ──
  console.log("\n11. Options costs — BUY + manual SELL round trip");
  {
    const buy = computeOptionOrderCosts({ side: "BUY", quantity: 75, price: 100 });
    assertClose(buy.grossAmount, 7500, "BUY grossAmount = 75 * ₹100");
    assertClose(buy.brokerage, OPTIONS_BROKERAGE_FLAT, "BUY brokerage = flat ₹20/leg (not a min(20,%) formula)");
    assertClose(buy.stt, 0, "BUY STT is 0 (STT applies only on SELL/exercise)");
    assertClose(buy.exchangeCharge, OPTIONS_EXCHANGE_TXN_CHARGE_RATE * 7500, "BUY exchange charge = 0.03553% of premium");
    assertClose(buy.stampDuty, OPTIONS_STAMP_DUTY_RATE * 7500, "BUY stamp duty = 0.003% of premium, BUY side only");
    assertClose(buy.dpCharge, 0, "DP charge is always 0 for options");
    assertClose(buy.totalCosts, 26.978255, "BUY totalCosts (hand-calculated)");
    assertClose(buy.netAmount, 7526.978255, "BUY netAmount = gross + totalCosts (cash debited)");

    const sell = computeOptionOrderCosts({ side: "SELL", quantity: 75, price: 150 });
    assertClose(sell.stt, OPTIONS_STT_SELL_RATE * 11250, "Manual SELL STT = 0.15% of premium (grossAmount)");
    assertClose(sell.stampDuty, 0, "SELL stamp duty = 0 (BUY side only)");
    assertClose(sell.dpCharge, 0, "DP charge is always 0 for options, even on SELL");
    assertClose(sell.totalCosts, 45.2048825, "SELL totalCosts (hand-calculated)");
    assertClose(sell.netAmount, 11204.7951175, "SELL netAmount = gross - totalCosts (cash credited)");
  }

  // ── 12. OTM expiry settlement — ₹0 fill, ₹0 STT, ₹0 net proceeds (total loss) ──
  console.log("\n12. Options costs — OTM expiry settlement (total premium loss)");
  {
    const otm = computeOptionOrderCosts({ side: "SELL", quantity: 75, price: 0, isExpirySettlement: true, intrinsicValue: 0 });
    assertClose(otm.grossAmount, 0, "OTM settlement grossAmount = 0 (intrinsic value is 0)");
    assertClose(otm.brokerage, 0, "OTM settlement brokerage = 0 (never charged on a cron-driven settlement leg)");
    assertClose(otm.stt, 0, "OTM settlement STT = 0 (0.15% of an intrinsic value of 0)");
    assertClose(otm.exchangeCharge, 0, "OTM settlement exchange charge = 0");
    assertClose(otm.totalCosts, 0, "OTM settlement totalCosts = 0");
    assertClose(otm.netAmount, 0, "OTM settlement netAmount = 0 — the full premium paid on entry is lost, correctly reflected as ₹0 proceeds");
  }

  // ── 13. ITM expiry settlement — exercise STT on INTRINSIC VALUE, not premium ──
  console.log("\n13. Options costs — ITM expiry settlement (exercise STT on intrinsic value)");
  {
    const itm = computeOptionOrderCosts({ side: "SELL", quantity: 75, price: 0, isExpirySettlement: true, intrinsicValue: 50 });
    assertClose(itm.grossAmount, 3750, "ITM settlement grossAmount = 75 * ₹50 intrinsic value (NOT the original premium paid)");
    assertClose(itm.brokerage, 0, "ITM settlement brokerage = 0, same as OTM — never charged on a settlement leg");
    assertClose(itm.stt, OPTIONS_STT_EXERCISE_RATE * 3750, "Exercise STT = 0.15% of intrinsic value (₹3,750), not premium");
    assertClose(itm.exchangeCharge, OPTIONS_EXCHANGE_TXN_CHARGE_RATE * 3750, "Exchange charge on the settlement leg is on intrinsic value too");
    assertClose(itm.stampDuty, 0, "No stamp duty on a settlement leg");
    assertClose(itm.totalCosts, 7.2016275, "ITM settlement totalCosts (hand-calculated)");
    assertClose(itm.netAmount, 3742.7983725, "ITM settlement netAmount = intrinsic value - totalCosts (cash credited)");
  }

  // ── 14. Brokerage is correctly 0 on EVERY isExpirySettlement:true leg, BUY or SELL side value ──
  console.log("\n14. Brokerage is 0 on isExpirySettlement legs regardless of the side field");
  {
    const settlementAsBuySide = computeOptionOrderCosts({ side: "BUY", quantity: 75, price: 0, isExpirySettlement: true, intrinsicValue: 30 });
    assertClose(settlementAsBuySide.brokerage, 0, "isExpirySettlement forces brokerage to 0 regardless of the side field passed in");
    assertClose(
      settlementAsBuySide.netAmount,
      settlementAsBuySide.grossAmount - settlementAsBuySide.totalCosts,
      "A settlement leg is always a credit (grossAmount - totalCosts), never a debit, even if side happened to be BUY"
    );
  }

  // ── 15. Option replay — open position's unrealized P&L ──────────────────────
  console.log("\n15. deriveOptionPositions — open position, unrealized P&L via the shared unrealizedGrossPnl helper");
  {
    const expiry = utcDate(2026, 8, 28);
    const orders: PaperEngineOrder[] = [
      optionOrder({
        underlyingSymbol: "NIFTY",
        optionType: "CE",
        strikePrice: 24700,
        expiryDate: expiry,
        lotSize: 75,
        side: "BUY",
        quantity: 75,
        fillPrice: 100,
        createdAt: istInstant(2026, 7, 20, 10, 0)
      })
    ];
    const open = deriveOptionPositions(orders);
    assertEqual(open.length, 1, "Exactly one open option contract");
    const position = open[0];
    assertClose(position.quantity, 75, "Open long quantity = 75 units (1 lot of 75)");
    assertClose(position.lots, 1, "lots = quantity / lotSize = 75 / 75 = 1");
    assertClose(position.avgCost, 100, "avgCost = the single BUY fill's premium");
    assertClose(
      unrealizedGrossPnl(position.quantity, position.avgCost, 130),
      75 * (130 - 100),
      "Unrealized P&L at a live premium of ₹130 = (ltp - avgCost) * quantity"
    );
  }

  // ── 16. Option replay — closed (manually sold) position's realized P&L ──────
  console.log("\n16. deriveOptionPositions / deriveAllOptionPositions — closed position's realized P&L");
  {
    const expiry = utcDate(2026, 8, 28);
    const orders: PaperEngineOrder[] = [
      optionOrder({
        underlyingSymbol: "NIFTY",
        optionType: "CE",
        strikePrice: 24700,
        expiryDate: expiry,
        lotSize: 75,
        side: "BUY",
        quantity: 75,
        fillPrice: 100,
        createdAt: istInstant(2026, 7, 20, 10, 0)
      }),
      optionOrder({
        underlyingSymbol: "NIFTY",
        optionType: "CE",
        strikePrice: 24700,
        expiryDate: expiry,
        lotSize: 75,
        side: "SELL",
        quantity: 75,
        fillPrice: 150,
        createdAt: istInstant(2026, 7, 25, 11, 0)
      })
    ];
    assertEqual(deriveOptionPositions(orders).length, 0, "A fully-closed contract is excluded from deriveOptionPositions (nothing currently held)");
    const all = deriveAllOptionPositions(orders);
    assertEqual(all.length, 1, "...but deriveAllOptionPositions still returns it (lifetime rollup needs closed history)");
    assertClose(all[0].realizedGrossPnl, 75 * (150 - 100), "Realized P&L on the manual close = qty * (exitPremium - avgCost)");
  }

  // ── 17. Option replay — OTM-expired position shows a full realized loss of the premium paid ──
  console.log("\n17. An OTM-expired option position's realized P&L is a full loss of the original premium");
  {
    const expiry = utcDate(2026, 8, 28);
    const orders: PaperEngineOrder[] = [
      optionOrder({
        underlyingSymbol: "NIFTY",
        optionType: "PE",
        strikePrice: 24000,
        expiryDate: expiry,
        lotSize: 75,
        side: "BUY",
        quantity: 75,
        fillPrice: 80,
        createdAt: istInstant(2026, 8, 1, 10, 0)
      }),
      optionOrder({
        underlyingSymbol: "NIFTY",
        optionType: "PE",
        strikePrice: 24000,
        expiryDate: expiry,
        lotSize: 75,
        side: "SELL", // expiry settlement's closing leg is always a SELL of the long, whether ITM or OTM
        quantity: 75,
        fillPrice: 0,
        createdAt: istInstant(2026, 8, 28, 15, 40),
        isExpirySettlement: true,
        intrinsicValue: 0
      })
    ];
    const all = deriveAllOptionPositions(orders);
    assertEqual(all.length, 1, "One contract, now fully settled");
    assertClose(all[0].quantity, 0, "Position is flat after expiry settlement");
    assertClose(
      all[0].realizedGrossPnl,
      75 * (0 - 80),
      "Realized P&L = qty * (settlementPrice(0) - avgCost) = -6,000 — a full loss of the ₹80/unit premium originally paid, exactly the 'expired worthless' outcome"
    );
  }

  // ── 18. openExpiringPositions — day-scoped detection for the expiry-settlement cron ──
  console.log("\n18. openExpiringPositions — finds only today's expiring, still-open contracts");
  {
    const today = istInstant(2026, 8, 28, 15, 40);
    const orders: PaperEngineOrder[] = [
      // Expires today, still open — should appear.
      optionOrder({
        underlyingSymbol: "NIFTY",
        optionType: "CE",
        strikePrice: 24700,
        expiryDate: utcDate(2026, 8, 28),
        lotSize: 75,
        side: "BUY",
        quantity: 75,
        fillPrice: 100,
        createdAt: istInstant(2026, 8, 1, 10, 0)
      }),
      // Expires next week, still open — must NOT appear (wrong expiry).
      optionOrder({
        underlyingSymbol: "NIFTY",
        optionType: "CE",
        strikePrice: 24800,
        expiryDate: utcDate(2026, 9, 4),
        lotSize: 75,
        side: "BUY",
        quantity: 75,
        fillPrice: 90,
        createdAt: istInstant(2026, 8, 1, 10, 0)
      }),
      // Expires today but already manually closed — must NOT appear (flat).
      optionOrder({
        underlyingSymbol: "NIFTY",
        optionType: "PE",
        strikePrice: 24600,
        expiryDate: utcDate(2026, 8, 28),
        lotSize: 75,
        side: "BUY",
        quantity: 75,
        fillPrice: 60,
        createdAt: istInstant(2026, 8, 1, 10, 0)
      }),
      optionOrder({
        underlyingSymbol: "NIFTY",
        optionType: "PE",
        strikePrice: 24600,
        expiryDate: utcDate(2026, 8, 28),
        lotSize: 75,
        side: "SELL",
        quantity: 75,
        fillPrice: 70,
        createdAt: istInstant(2026, 8, 20, 10, 0)
      })
    ];
    const expiringToday = openExpiringPositions(orders, today);
    assertEqual(expiringToday.length, 1, "Exactly one contract is open AND expiring today");
    assertClose(expiringToday[0].strikePrice, 24700, "The 24700 CE (open, expiring today) is the one found");
  }

  console.log(`\n${passCount} passed, ${failCount} failed.`);
  if (failCount > 0) process.exit(1);
}

main().catch((err) => {
  console.error("Unexpected failure:", err);
  process.exit(1);
});
