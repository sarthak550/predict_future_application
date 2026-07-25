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
  OPTIONS_STT_SELL_RATE,
  resolveSquareOffPrice
} from "@predict-future/business-rules/papertrading/optionsCosts";
import {
  deriveAllDeliveryPositions,
  deriveAllFuturesPositions,
  deriveAllOptionPositions,
  deriveCash,
  deriveDeliveryHoldings,
  deriveFuturesPositions,
  deriveIntradayDailyPositions,
  deriveOptionPositions,
  isFirstDeliverySellOfScripToday,
  netPnl,
  openExpiringFuturesPositions,
  openExpiringPositions,
  openIntradayPositions,
  replayPosition,
  unrealizedGrossPnl,
  type PaperEngineOrder
} from "@predict-future/business-rules/papertrading/replay";
import { isNseWeekdayMarketHours } from "@predict-future/business-rules/papertrading/marketHours";
import {
  computeFuturesOrderCosts,
  FUTURES_BROKERAGE_CAP,
  FUTURES_BROKERAGE_RATE,
  FUTURES_EXCHANGE_TXN_CHARGE_RATE,
  FUTURES_STAMP_DUTY_RATE,
  FUTURES_STT_SELL_RATE,
  zeroDailyMtmCosts
} from "@predict-future/business-rules/papertrading/futuresCosts";
import { computeFuturesMarginRequired, INDEX_FUTURES_MARGIN_RATE } from "@predict-future/business-rules/papertrading/futuresMargin";
import { INDEX_FUTURES_INSTRUMENT_TYPE } from "@/lib/marketMoves/foBhavcopy";
import {
  formatFuturesContractLabel,
  formatFuturesContractSymbol
} from "@predict-future/business-rules/papertrading/futuresContract";

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

type FuturesTradeLegInput = Omit<PaperEngineOrder, "totalCosts" | "netAmount" | "productType" | "isDailyMtm"> & {
  isExpirySettlement?: boolean;
  settlementPrice?: number;
};

/** Builds a REAL futures trade leg (open/add/close/flip, or a margin-call/expiry-settlement leg) via the real computeFuturesOrderCosts() — same "never hand-fill the cost fields" discipline as order() above. */
function futuresOrder(input: FuturesTradeLegInput): PaperEngineOrder {
  const { isExpirySettlement, settlementPrice, ...rest } = input;
  const costs = computeFuturesOrderCosts({
    side: rest.side,
    quantity: rest.quantity,
    price: rest.fillPrice,
    isExpirySettlement,
    settlementPrice
  });
  return { ...rest, productType: null, isDailyMtm: false, totalCosts: costs.totalCosts, netAmount: costs.netAmount };
}

type MtmLegInput = Pick<PaperEngineOrder, "symbol" | "underlyingSymbol" | "expiryDate" | "lotSize" | "createdAt" | "instrumentKind"> & {
  /** The position's signed quantity BEFORE this mark — the caller computes this from the prior leg(s), same as replayFuturesContract does internally, so the test's expected netAmount is independently hand-derivable from the (ltp - referencePrice) * quantity formula rather than calling the engine to compute its own test fixture. */
  precedingSignedQuantity: number;
  precedingReferencePrice: number;
  settlementPrice: number;
};

/** Builds a daily-MTM leg exactly as the (Sprint-2) daily-MTM cron will: quantity 0, all-zero costs via zeroDailyMtmCosts(), side stored "SELL" by the documented convention (deriveCash's isDailyMtm carve-out ignores it), netAmount = the signed variation-margin cash flow = (settlementPrice - referencePrice) * signedQuantity. */
function mtmLeg(input: MtmLegInput): PaperEngineOrder {
  const { precedingSignedQuantity, precedingReferencePrice, settlementPrice, ...rest } = input;
  const zero = zeroDailyMtmCosts();
  const netAmount = (settlementPrice - precedingReferencePrice) * precedingSignedQuantity;
  return {
    ...rest,
    side: "SELL",
    quantity: 0,
    fillPrice: settlementPrice,
    productType: null,
    isDailyMtm: true,
    totalCosts: zero.totalCosts,
    netAmount
  };
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

  /** Builds an option PaperEngineOrder fixture (INDEX_OPTION by default, STOCK_OPTION when specified), running the real computeOptionOrderCosts() over the given fill — same "never hand-filled" discipline as order() above. */
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
    instrumentKind?: "INDEX_OPTION" | "STOCK_OPTION";
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
      instrumentKind: input.instrumentKind ?? "INDEX_OPTION",
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

  // ═══════════════════════════════════════════════════════════════════════════
  // Paper Trading Phase 3 — Stock Options (replay.ts widening + stockOptionSquareOff.ts)
  // ═══════════════════════════════════════════════════════════════════════════

  // ── 19. deriveOptionPositions groups INDEX_OPTION and STOCK_OPTION independently, both correctly tagged ──
  console.log("\n19. replay.ts widening — an INDEX_OPTION and a STOCK_OPTION position on the same account both appear, correctly tagged");
  {
    const orders: PaperEngineOrder[] = [
      optionOrder({
        underlyingSymbol: "NIFTY",
        optionType: "CE",
        strikePrice: 24700,
        expiryDate: utcDate(2026, 8, 28),
        lotSize: 75,
        side: "BUY",
        quantity: 75,
        fillPrice: 100,
        createdAt: istInstant(2026, 8, 1, 10, 0),
        instrumentKind: "INDEX_OPTION"
      }),
      optionOrder({
        underlyingSymbol: "RELIANCE",
        optionType: "CE",
        strikePrice: 1300,
        expiryDate: utcDate(2026, 8, 27),
        lotSize: 500,
        side: "BUY",
        quantity: 500,
        fillPrice: 20,
        createdAt: istInstant(2026, 8, 1, 10, 0),
        instrumentKind: "STOCK_OPTION"
      })
    ];
    const open = deriveOptionPositions(orders);
    assertEqual(open.length, 2, "Both contracts appear — INDEX_OPTION and STOCK_OPTION are independent groups, never merged");
    const niftyPos = open.find((p) => p.underlyingSymbol === "NIFTY");
    const reliancePos = open.find((p) => p.underlyingSymbol === "RELIANCE");
    assertTrue(niftyPos !== undefined, "NIFTY index-option position found");
    assertEqual(niftyPos?.instrumentKind, "INDEX_OPTION", "NIFTY position is correctly tagged INDEX_OPTION");
    assertTrue(reliancePos !== undefined, "RELIANCE stock-option position found");
    assertEqual(reliancePos?.instrumentKind, "STOCK_OPTION", "RELIANCE position is correctly tagged STOCK_OPTION");
    assertClose(reliancePos!.lots, 1, "RELIANCE lots = 500 / 500 = 1");
  }

  // ── 20. Stock-option square-off cost trap — full manual-SELL costs, NOT the index isExpirySettlement path ──
  console.log("\n20. Stock-option square-off cost contrast — full brokerage+STT-on-premium vs. index's ₹0-brokerage/STT-on-intrinsic settlement");
  {
    // The stock square-off leg: computeOptionOrderCosts({ side: "SELL", ... })
    // with isExpirySettlement OMITTED — literally the same call shape as a
    // manual close, per the brief's cost-trap section. This is what
    // stockOptionSquareOff.ts must call.
    const stockSquareOff = computeOptionOrderCosts({ side: "SELL", quantity: 500, price: 35 });
    assertClose(stockSquareOff.grossAmount, 17500, "Stock square-off grossAmount = 500 * ₹35 traded premium (a real market SELL, not an intrinsic-value settlement)");
    assertClose(stockSquareOff.brokerage, OPTIONS_BROKERAGE_FLAT, "Stock square-off brokerage = full flat ₹20 — a real broker-forced market SELL, not a ₹0 exchange settlement");
    assertClose(stockSquareOff.stt, OPTIONS_STT_SELL_RATE * 17500, "Stock square-off STT = 0.15% of the TRADED PREMIUM (grossAmount) — the SELL_RATE/premium basis, not EXERCISE_RATE/intrinsic-value");
    assertClose(stockSquareOff.stampDuty, 0, "Stock square-off stamp duty = 0 (SELL side, buy-side-only tax)");
    assertClose(stockSquareOff.dpCharge, 0, "Stock square-off DP charge = 0 — squared off before physical delivery, never enters demat");

    // The index cash-settlement leg for an IDENTICAL notional (same quantity,
    // fill price standing in for intrinsic value) — computeOptionOrderCosts
    // called the OTHER way, isExpirySettlement: true. Same underlying economics,
    // deliberately different cost treatment — this is the exact contrast the
    // brief calls out as the ticket most likely to get miscopied.
    const indexSettlement = computeOptionOrderCosts({ side: "SELL", quantity: 500, price: 35, isExpirySettlement: true, intrinsicValue: 35 });
    assertClose(indexSettlement.brokerage, 0, "Index cash-settlement brokerage = ₹0 — no broker order was ever placed for an automatic exchange settlement");
    assertClose(indexSettlement.stt, OPTIONS_STT_EXERCISE_RATE * 17500, "Index cash-settlement STT uses EXERCISE_RATE on intrinsic value (same rate value today, but a different constant/basis than the stock square-off's SELL_RATE/premium — see optionsCosts.ts's doc comment on why these are two distinct constants)");
    assertTrue(
      stockSquareOff.brokerage !== indexSettlement.brokerage,
      "THE TRAP: at identical quantity/price, stock square-off brokerage (₹20) must differ from index settlement brokerage (₹0) — a stockOptionSquareOff.ts that accidentally copies optionsExpiry.ts's isExpirySettlement:true call would silently collapse this to equal and undercharge every stock square-off"
    );
    assertClose(
      stockSquareOff.totalCosts - indexSettlement.totalCosts,
      23.6,
      "At identical notional, the stock square-off costs ₹23.60 more than the index settlement: the ₹20 brokerage line the isExpirySettlement flag zeroes out, PLUS the 18% GST cascading off that same ₹20 (GST_RATE * 20 = ₹3.60) — GST is computed on brokerage+exchangeCharge+sebiFee, so zeroing brokerage doesn't just save ₹20, it also shrinks the GST base"
    );
  }

  // ── 21. Stock-option square-off 3-tier pricing fallback (lastPrice -> bid/ask mid -> intrinsic estimate) ──
  console.log("\n21. Stock-option square-off pricing fallback tiers (pure selection logic, mirrors stockOptionSquareOff.ts's resolveSquareOffPrice)");
  {
    // Tier 1: live lastPrice always wins when present, regardless of bid/ask or intrinsic.
    const tier1 = resolveSquareOffPrice({ lastPrice: 42, bidPrice: 40, askPrice: 44, optionType: "CE", spot: 1300, strikePrice: 1250 });
    assertClose(tier1.price, 42, "Tier 1: lastPrice used when present");
    assertEqual(tier1.source, "LAST_PRICE", "Tier 1 tagged LAST_PRICE");

    // Tier 2: lastPrice null/zero, both quotes present -> midpoint.
    const tier2 = resolveSquareOffPrice({ lastPrice: null, bidPrice: 38, askPrice: 42, optionType: "CE", spot: 1300, strikePrice: 1250 });
    assertClose(tier2.price, 40, "Tier 2: bid/ask midpoint = (38+42)/2 = 40 when lastPrice is null");
    assertEqual(tier2.source, "BID_ASK_MID", "Tier 2 tagged BID_ASK_MID");

    const tier2Zero = resolveSquareOffPrice({ lastPrice: 0, bidPrice: 10, askPrice: 12, optionType: "PE", spot: 1300, strikePrice: 1250 });
    assertClose(tier2Zero.price, 11, "Tier 2 also triggers on lastPrice === 0, not just null");
    assertEqual(tier2Zero.source, "BID_ASK_MID", "lastPrice=0 case tagged BID_ASK_MID");

    // Tier 3: neither a trade price nor a two-sided quote -> intrinsic-value estimate.
    const tier3Itm = resolveSquareOffPrice({ lastPrice: null, bidPrice: null, askPrice: null, optionType: "CE", spot: 1300, strikePrice: 1250 });
    assertClose(tier3Itm.price, 50, "Tier 3 CE: intrinsic estimate = max(0, spot-strike) = max(0, 1300-1250) = 50");
    assertEqual(tier3Itm.source, "INTRINSIC_ESTIMATE", "Tier 3 tagged INTRINSIC_ESTIMATE");

    const tier3OneSidedQuote = resolveSquareOffPrice({ lastPrice: null, bidPrice: 5, askPrice: null, optionType: "PE", spot: 1300, strikePrice: 1250 });
    assertClose(tier3OneSidedQuote.price, 0, "Tier 3 PE: a ONE-sided quote (bid only, no ask) is not a two-sided quote — falls through to intrinsic estimate = max(0, 1250-1300) = 0 (OTM)");
    assertEqual(tier3OneSidedQuote.source, "INTRINSIC_ESTIMATE", "One-sided-quote case correctly falls to tier 3, not treated as tier 2");

    const tier3Pe = resolveSquareOffPrice({ lastPrice: null, bidPrice: null, askPrice: null, optionType: "PE", spot: 1200, strikePrice: 1250 });
    assertClose(tier3Pe.price, 50, "Tier 3 PE: intrinsic estimate = max(0, strike-spot) = max(0, 1250-1200) = 50");
  }

  // ── 22. Phase 4 — Futures costs: manual open/close (long round trip, real market orders) ──
  console.log("\n22. Futures manual round trip — LONG 130 units (2 lots x 65) NIFTY, entry ₹24,000, exit ₹24,200");
  {
    const open = computeFuturesOrderCosts({ side: "BUY", quantity: 130, price: 24000 });
    assertClose(open.grossAmount, 3120000, "Open (BUY) grossAmount = ₹31,20,000");
    assertClose(open.brokerage, Math.min(FUTURES_BROKERAGE_CAP, FUTURES_BROKERAGE_RATE * 3120000), "Open brokerage = min(₹20, 0.03% of turnover) = ₹20 (0.03% of turnover is ₹936, capped)");
    assertClose(open.stt, 0, "Futures STT is 0 on the BUY leg (sell-side only, same posture as every other segment in this codebase)");
    assertClose(open.exchangeCharge, FUTURES_EXCHANGE_TXN_CHARGE_RATE * 3120000, "Open exchange charge = 0.00183% of turnover");
    assertClose(open.stampDuty, FUTURES_STAMP_DUTY_RATE * 3120000, "Open stamp duty = 0.002% of turnover, BUY side only");
    assertClose(open.totalCosts, 157.05488, "Open totalCosts (hand-calculated)");
    assertClose(open.netAmount, 3120157.05488, "Open netAmount = gross + totalCosts (cash debited)");

    const close = computeFuturesOrderCosts({ side: "SELL", quantity: 130, price: 24200 });
    assertClose(close.stt, FUTURES_STT_SELL_RATE * (130 * 24200), "Close STT = 0.05% of turnover, SELL leg only (Budget 2026-27 hike from 0.02% — verified 2026-07-25)");
    assertClose(close.stampDuty, 0, "No stamp duty on the SELL leg");
    assertClose(close.dpCharge, 0, "Futures never attract a DP charge — cash-settled, never enters demat");
    assertClose(close.totalCosts, 1668.247004, "Close totalCosts (hand-calculated)");
    assertClose(close.netAmount, 3144331.752996, "Close netAmount = gross - totalCosts (cash credited)");

    const roundTripCost = open.totalCosts + close.totalCosts;
    assertClose(roundTripCost, 1825.301884, "Futures LONG round-trip total cost");
  }

  // ── 23. Phase 4 — Futures costs: manual open/close (SHORT round trip) ──
  console.log("\n23. Futures manual round trip — SHORT 30 units (1 lot x 30) BANKNIFTY, entry ₹50,000, cover ₹49,200");
  {
    const open = computeFuturesOrderCosts({ side: "SELL", quantity: 30, price: 50000 });
    assertClose(open.grossAmount, 1500000, "Short-open grossAmount = ₹15,00,000");
    assertClose(open.stt, FUTURES_STT_SELL_RATE * 1500000, "Short-open (SELL) STT applies — opening via SELL is still a sell-side turnover event");
    assertClose(open.totalCosts, 807.761, "Short-open totalCosts (hand-calculated)");
    assertClose(open.netAmount, 1499192.239, "Short-open credits cash (SELL proceeds net of costs)");

    const cover = computeFuturesOrderCosts({ side: "BUY", quantity: 30, price: 49200 });
    assertClose(cover.stt, 0, "Cover (BUY) STT is 0");
    assertClose(cover.stampDuty, FUTURES_STAMP_DUTY_RATE * 1476000, "Cover stamp duty applies (BUY side)");
    assertClose(cover.totalCosts, 86.734424, "Cover totalCosts (hand-calculated)");
    assertClose(cover.netAmount, 1476086.734424, "Cover debits cash to buy back the shorted contract");

    const netCashEffect = open.netAmount - cover.netAmount;
    assertClose(netCashEffect, 1499192.239 - 1476086.734424, "Net cash effect of the short round trip = proceeds minus buy-back cost, matching the two netAmounts computed above");
  }

  // ── 24. Phase 4 — THE TRAP: margin-call forced close vs. expiry cash-settlement, identical notional ──
  console.log("\n24. Futures leg-type dispatch trap — margin-call close (full cost) vs. expiry settlement (₹0 brokerage), same ₹31,20,000 notional");
  {
    // Margin-call forced square-off is a real RMS-placed market order — same
    // cost shape as a manual close (computeFuturesOrderCosts called WITHOUT
    // isExpirySettlement), per the Phase 4 brief's leg-type-3 spec.
    const marginCallClose = computeFuturesOrderCosts({ side: "SELL", quantity: 130, price: 24000 });
    assertClose(marginCallClose.brokerage, 20, "Margin-call forced close brokerage = full ₹20 — a real order was placed by the RMS, not an automatic settlement");

    // Expiry cash-settlement: automatic, exchange-computed, brokerage forced to ₹0.
    const expirySettlement = computeFuturesOrderCosts({
      side: "SELL",
      quantity: 130,
      price: 0, // ignored — isExpirySettlement routes pricing through settlementPrice instead
      isExpirySettlement: true,
      settlementPrice: 24000
    });
    assertClose(expirySettlement.brokerage, 0, "Expiry cash-settlement brokerage = ₹0 — no broker order was ever placed for an automatic exchange settlement");
    assertClose(expirySettlement.stt, FUTURES_STT_SELL_RATE * (130 * 24000), "Expiry settlement STT applies sell-side rate to settlement-value turnover — no premium/intrinsic split exists for futures the way options need one");
    assertTrue(
      marginCallClose.brokerage !== expirySettlement.brokerage,
      "THE TRAP: at identical quantity/price, a margin-call forced close (₹20 brokerage) must differ from an expiry cash-settlement (₹0 brokerage) — a daily-MTM cron that accidentally routes its margin-call leg through the isExpirySettlement:true path would silently undercharge every forced square-off"
    );
    assertClose(
      marginCallClose.totalCosts - expirySettlement.totalCosts,
      23.6,
      "At identical notional, the margin-call close costs ₹23.60 more than the expiry settlement: the ₹20 brokerage line isExpirySettlement zeroes out, plus the 18% GST cascading off that same ₹20 (GST_RATE * 20 = ₹3.60) — the same compounding P3's stock-option-vs-index-settlement trap (test 20) already demonstrated in a different leg-type pair"
    );
  }

  // ── 25. Phase 4 — the all-zero daily-MTM cost object, by construction not coincidence ──
  console.log("\n25. Daily-MTM leg cost object is all-zero BY CONSTRUCTION, never computed via computeFuturesOrderCosts");
  {
    const mtmCosts = zeroDailyMtmCosts();
    assertClose(mtmCosts.grossAmount, 0, "MTM leg grossAmount = 0 (quantity is always 0 for this leg type)");
    assertClose(mtmCosts.brokerage, 0, "MTM leg brokerage = 0");
    assertClose(mtmCosts.stt, 0, "MTM leg STT = 0");
    assertClose(mtmCosts.exchangeCharge, 0, "MTM leg exchange charge = 0");
    assertClose(mtmCosts.sebiFee, 0, "MTM leg SEBI fee = 0");
    assertClose(mtmCosts.stampDuty, 0, "MTM leg stamp duty = 0");
    assertClose(mtmCosts.gst, 0, "MTM leg GST = 0");
    assertClose(mtmCosts.dpCharge, 0, "MTM leg DP charge = 0");
    assertClose(mtmCosts.totalCosts, 0, "MTM leg totalCosts = 0");

    // Contrast: calling computeFuturesOrderCosts with a synthetic zero-price
    // order coincidentally ALSO yields zero brokerage (min(₹20, 0.03%*0)=₹0)
    // — but for the WRONG reason (zero turnover, not "no order was placed").
    // zeroDailyMtmCosts() is a deliberate leg-type property, not this
    // arithmetic coincidence — proving both paths currently agree numerically
    // is exactly why the module doc insists on the hardcoded function instead
    // of relying on the coincidence holding forever.
    const syntheticZeroPriceOrder = computeFuturesOrderCosts({ side: "SELL", quantity: 0, price: 100 });
    assertClose(syntheticZeroPriceOrder.totalCosts, 0, "A synthetic zero-QUANTITY manual order also totals ₹0 — the coincidence the module doc warns against relying on");
  }

  // ── 26. Phase 4 — Margin engine ──
  console.log("\n26. computeFuturesMarginRequired — flat 15% of notional, symmetric long/short");
  {
    assertClose(INDEX_FUTURES_MARGIN_RATE, 0.15, "Founder-locked flat rate = 15%");
    assertClose(computeFuturesMarginRequired(3120000), 468000, "Margin on a ₹31,20,000 long notional = 15% = ₹4,68,000");
    assertClose(computeFuturesMarginRequired(-3120000), 468000, "Margin is direction-symmetric — a SHORT position's negative notional yields the identical margin requirement via Math.abs, not a signed (and wrong) result");
    assertClose(computeFuturesMarginRequired(0), 0, "Flat/closed position requires zero margin");
  }

  // ── 27. Phase 4 — Contract identity ──
  console.log("\n27. Futures contract symbol/label formatters");
  {
    const expiry = new Date(Date.UTC(2026, 7, 28)); // 28-Aug-2026
    assertEqual(formatFuturesContractSymbol("NIFTY", expiry), "NIFTYFUT28AUG2026", "Canonical symbol format");
    assertEqual(formatFuturesContractLabel("NIFTY", expiry), "NIFTY FUT, 28-Aug-26", "Human-readable label format");
  }

  // ── 28. Phase 4 — deriveFuturesPositions: LONG lifecycle with daily MTM, telescoping realized P&L ──
  console.log("\n28. deriveFuturesPositions — LONG NIFTY, open -> 2 days of MTM -> manual close, realized P&L telescopes to (exit-entry)*qty");
  {
    const entry = futuresOrder({
      symbol: "NIFTYFUT28AUG2026",
      side: "BUY",
      quantity: 130,
      fillPrice: 24000,
      underlyingSymbol: "NIFTY",
      expiryDate: new Date(Date.UTC(2026, 7, 28)),
      lotSize: 65,
      instrumentKind: "INDEX_FUTURE",
      createdAt: istInstant(2026, 8, 3, 9, 30)
    });
    const day1Mtm = mtmLeg({
      symbol: "NIFTYFUT28AUG2026",
      underlyingSymbol: "NIFTY",
      expiryDate: new Date(Date.UTC(2026, 7, 28)),
      lotSize: 65,
      instrumentKind: "INDEX_FUTURE",
      createdAt: istInstant(2026, 8, 3, 18, 0),
      precedingSignedQuantity: 130,
      precedingReferencePrice: 24000,
      settlementPrice: 24100
    });
    const day2Mtm = mtmLeg({
      symbol: "NIFTYFUT28AUG2026",
      underlyingSymbol: "NIFTY",
      expiryDate: new Date(Date.UTC(2026, 7, 28)),
      lotSize: 65,
      instrumentKind: "INDEX_FUTURE",
      createdAt: istInstant(2026, 8, 4, 18, 0),
      precedingSignedQuantity: 130,
      precedingReferencePrice: 24100,
      settlementPrice: 23950
    });
    const close = futuresOrder({
      symbol: "NIFTYFUT28AUG2026",
      side: "SELL",
      quantity: 130,
      fillPrice: 24200,
      underlyingSymbol: "NIFTY",
      expiryDate: new Date(Date.UTC(2026, 7, 28)),
      lotSize: 65,
      instrumentKind: "INDEX_FUTURE",
      createdAt: istInstant(2026, 8, 5, 11, 0)
    });

    assertClose(day1Mtm.netAmount, 13000, "Day 1 MTM: (24100-24000)*130 = +₹13,000 credit (price rose, long position marks up)");
    assertClose(day2Mtm.netAmount, -19500, "Day 2 MTM: (23950-24100)*130 = -₹19,500 debit (price fell)");
    assertClose(day1Mtm.totalCosts, 0, "MTM legs carry zero costs");
    assertClose(day2Mtm.totalCosts, 0, "MTM legs carry zero costs");

    const orders = [entry, day1Mtm, day2Mtm, close];
    // deriveFuturesPositions (open-only) correctly returns nothing once this
    // position is fully closed — deriveAllFuturesPositions is the lifetime-
    // rollup view that still surfaces a closed contract's realized P&L/costs,
    // same "closed positions still count" posture as deriveAllOptionPositions
    // (test 16/17 above).
    assertEqual(deriveFuturesPositions(orders).length, 0, "deriveFuturesPositions (open-only) correctly excludes this now-fully-closed contract");
    const [position] = deriveAllFuturesPositions(orders);
    assertEqual(orders.some((o) => o.instrumentKind !== "INDEX_FUTURE"), false, "sanity: every fixture order in this scenario is INDEX_FUTURE");
    assertTrue(!!position, "Exactly one futures contract position derived");
    assertClose(position.quantity, 0, "Position fully closed after the final SELL");
    assertTrue(!position.isOpen, "isOpen is false once fully closed");
    assertClose(
      position.realizedGrossPnl,
      (24200 - 24000) * 130,
      "Realized P&L telescopes: sum of every MTM delta (+13,000 -19,500) plus the close leg's own delta (against day2's referencePrice, 23950) exactly equals (exit - entry) * qty = 200*130 = 26,000"
    );
    assertClose(
      position.totalCosts,
      entry.totalCosts + close.totalCosts,
      "Position totalCosts = entry + close totalCosts only — both MTM legs contributed ₹0"
    );
    assertClose(position.lotSize as number, 65, "lotSize snapshotted from the fixture orders");

    const cashOrders = orders;
    const startingCapital = 5000000;
    const cash = deriveCash(startingCapital, cashOrders);
    const expectedCash = startingCapital - entry.netAmount + day1Mtm.netAmount + day2Mtm.netAmount + close.netAmount;
    assertClose(
      cash,
      expectedCash,
      "deriveCash correctly includes both zero-quantity MTM legs via the isDailyMtm carve-out — entry debits, each MTM leg applies its signed netAmount directly (not gated on side), close credits"
    );
  }

  // ── 29. Phase 4 — deriveFuturesPositions: SHORT lifecycle, telescoping realized P&L ──
  console.log("\n29. deriveFuturesPositions — SHORT BANKNIFTY, open -> 1 day of MTM -> cover, realized P&L telescopes for a short too");
  {
    const entry = futuresOrder({
      symbol: "BANKNIFTYFUT25AUG2026",
      side: "SELL",
      quantity: 30,
      fillPrice: 50000,
      underlyingSymbol: "BANKNIFTY",
      expiryDate: new Date(Date.UTC(2026, 7, 25)),
      lotSize: 30,
      instrumentKind: "INDEX_FUTURE",
      createdAt: istInstant(2026, 8, 3, 9, 30)
    });
    const mtm = mtmLeg({
      symbol: "BANKNIFTYFUT25AUG2026",
      underlyingSymbol: "BANKNIFTY",
      expiryDate: new Date(Date.UTC(2026, 7, 25)),
      lotSize: 30,
      instrumentKind: "INDEX_FUTURE",
      createdAt: istInstant(2026, 8, 3, 18, 0),
      precedingSignedQuantity: -30,
      precedingReferencePrice: 50000,
      settlementPrice: 49500
    });
    const cover = futuresOrder({
      symbol: "BANKNIFTYFUT25AUG2026",
      side: "BUY",
      quantity: 30,
      fillPrice: 49200,
      underlyingSymbol: "BANKNIFTY",
      expiryDate: new Date(Date.UTC(2026, 7, 25)),
      lotSize: 30,
      instrumentKind: "INDEX_FUTURE",
      createdAt: istInstant(2026, 8, 4, 11, 0)
    });

    assertClose(mtm.netAmount, 15000, "MTM: (49500-50000)*(-30) = +₹15,000 credit — a short profits when price falls, sign falls out of the formula automatically");

    const [position] = deriveAllFuturesPositions([entry, mtm, cover]);
    assertClose(position.quantity, 0, "Position fully covered");
    assertEqual(position.side, "FLAT", "side reads FLAT once fully closed");
    assertClose(
      position.realizedGrossPnl,
      (49200 - 50000) * -30,
      "Realized P&L telescopes for a SHORT too: (exit-entry)*signedQty = (49200-50000)*(-30) = 24,000 — matches MTM delta (+15,000) plus the cover leg's own delta against the marked referencePrice (49500), (49200-49500)*(-1 direction)*30 = +9,000"
    );
  }

  // ── 30. Phase 4 — openExpiringFuturesPositions ──
  console.log("\n30. openExpiringFuturesPositions — day-scoped detection for the (Sprint 2) expiry-settlement cron");
  {
    const today = istInstant(2026, 8, 28, 9, 0);
    const expiringToday = futuresOrder({
      symbol: "NIFTYFUT28AUG2026",
      side: "BUY",
      quantity: 65,
      fillPrice: 24000,
      underlyingSymbol: "NIFTY",
      expiryDate: new Date(Date.UTC(2026, 7, 28)),
      lotSize: 65,
      instrumentKind: "INDEX_FUTURE",
      createdAt: istInstant(2026, 8, 1, 9, 30)
    });
    const notExpiringToday = futuresOrder({
      symbol: "NIFTYFUT25SEP2026",
      side: "BUY",
      quantity: 65,
      fillPrice: 24100,
      underlyingSymbol: "NIFTY",
      expiryDate: new Date(Date.UTC(2026, 8, 25)),
      lotSize: 65,
      instrumentKind: "INDEX_FUTURE",
      createdAt: istInstant(2026, 8, 1, 9, 31)
    });

    const expiringPositions = openExpiringFuturesPositions([expiringToday, notExpiringToday], today);
    assertEqual(expiringPositions.length, 1, "Exactly one position expires today");
    assertEqual(expiringPositions[0].underlyingSymbol, "NIFTY", "The expiring position is the 28-Aug contract");
    assertClose(expiringPositions[0].quantity, 65, "Expiring position quantity carried through");
  }

  // ── 31. Phase 4 — EC2-verified F&O bhavcopy FinInstrmTp code, pinned ──
  console.log("\n31. foBhavcopy.ts's INDEX_FUTURES_INSTRUMENT_TYPE pinned to the EC2-verified real code");
  {
    // This is the exact constant a first pass got wrong (FUTIDX, matching
    // NSE's UDiFF documentation prose but not the real file, which uses the
    // newer ISO code) — pinned here so a future edit to foBhavcopy.ts can't
    // silently regress it back to a documentation-plausible-but-wrong value
    // without this assertion catching it.
    assertEqual(INDEX_FUTURES_INSTRUMENT_TYPE, "IDF", "Index-futures FinInstrmTp code, EC2-verified 2026-07-25 against the real 24-Jul-2026 bhavcopy (distinct values: STO=33020, STF=625, IDO=5140, IDF=15)");
  }

  console.log(`\n${passCount} passed, ${failCount} failed.`);
  if (failCount > 0) process.exit(1);
}

main().catch((err) => {
  console.error("Unexpected failure:", err);
  process.exit(1);
});
