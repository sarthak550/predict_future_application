/**
 * TA Suite Sprint S3, T1 — `npm run ta:check` (`apps/web/package.json`'s
 * `"tsx lib/ta/selfcheck.ts"`, `tsx` already an installed devDependency —
 * see `cto_assignment_brief_ta_suite_s3.md`'s own Verified Ground Truth
 * note, no sign-off needed). Node-runnable (no klinecharts/DOM dependency —
 * `lib/ta/` is plain arithmetic, see `math.ts`'s own module doc), so this
 * runs identically in a dev shell and any future CI step with zero browser.
 *
 * Two fixture families, per the brief's exact spec:
 *  1. A known `maCross` series with HAND-COMPUTED expected signal indices/
 *     sides/prices (traced by hand below, not just "it produced something").
 *  2. That SAME fixture's `runBacktest()` output, with gross/net PnL and
 *     total costs cross-checked directly against REAL `computeOrderCosts()`
 *     calls made HERE (not a reimplemented cost formula — a future change
 *     to the cost engine that breaks this assumption fails `ta:check`
 *     immediately, per the brief's explicit intent) — plus an
 *     INDEPENDENTLY reconstructed equity curve (a second, brute-force
 *     implementation of "mark every bar to market, track running peak")
 *     cross-checked against `runBacktest`'s own `maxDrawdownPct`, since a
 *     hand-typed magic decimal for a cost-inclusive drawdown number would
 *     itself be an easy place to introduce a hand-arithmetic mistake.
 *
 * Exits non-zero (via `process.exitCode = 1`, checked by the runner
 * process's own exit code — `tsx` propagates it) the moment any assertion
 * fails, after printing every failure (not just the first) so a broken run
 * shows its full blast radius in one pass.
 */
import { computeOrderCosts } from "@predict-future/business-rules/papertrading/costs";
import { USER_SCRIPT_MAX_SIGNALS } from "@predict-future/validation/userScripts";

import {
  formatElapsedLabel,
  computeCypherRatios,
  computeAdjacentLegRatios,
  formatGannRangeRatioLabel
} from "../../components/paper-trading/workbench/overlays/figure-kit";

import { runBacktest, intervalToProductType, type BacktestTrade } from "./backtest";
import { maCross, finalizeSignals, resolveStrategyParams, STRATEGY_REGISTRY, type StrategyCandle, type StrategySignal } from "./strategies";
import { EXAMPLE_SCRIPTS } from "./example-scripts";
import { combineRatingWithCustoms, computeTechnicalRating, computeTechnicalDetail, evaluateCustomSignal, CUSTOMIZABLE_RULES, type DetailRow } from "./technicals";
import { computeIndicatorSignal } from "./indicator-signals";
import {
  runScriptSync,
  resolveSignalsAgainstBars,
  buildWrappedSource,
  WRAP_LINE_OFFSET,
  DENYLIST_KEYS,
  SCRIPT_SENTINEL,
  MISSING_RUN_FUNCTION_MESSAGE,
  INVALID_SCRIPT_RESULT_MESSAGE,
  signalCapMessage
} from "./user-scripts";

// ── Tiny assertion harness ───────────────────────────────────────────────

let passCount = 0;
let failCount = 0;

function report(label: string, ok: boolean, detail?: string): void {
  if (ok) {
    passCount += 1;
  } else {
    failCount += 1;
    // eslint-disable-next-line no-console
    console.error(`FAIL: ${label}${detail ? ` — ${detail}` : ""}`);
  }
}

function assert(label: string, condition: boolean, detail?: string): void {
  report(label, condition, detail);
}

function assertClose(label: string, actual: number, expected: number, epsilon = 1e-6): void {
  const ok = Number.isFinite(actual) && Math.abs(actual - expected) <= epsilon;
  report(label, ok, `expected ${expected}, got ${actual}`);
}

function assertFinite(label: string, value: number): void {
  report(label, Number.isFinite(value), `got ${value}`);
}

// ── Fixture builder ──────────────────────────────────────────────────────

/** Builds a minimal `StrategyCandle[]` from a bare close-price series — `open === high === low === close` for every bar, which is sufficient for `maCross` (close-only) and keeps `buyHoldReturnPct`'s hand-check trivial (`(lastClose - firstOpen) / firstOpen`). One synthetic day per bar. */
function closesToCandles(closes: readonly number[]): StrategyCandle[] {
  const baseTs = Date.UTC(2026, 0, 1);
  const dayMs = 24 * 60 * 60 * 1000;
  return closes.map((c, i) => ({ timestamp: baseTs + i * dayMs, open: c, high: c, low: c, close: c, volume: 1000 }));
}

// ── Fixture 1: maCross[2,3] hand-traced signals ──────────────────────────
//
// closes:   [10,   11,   12,    9,    8,    7,   12,   13,   14,   15]
// index:      0     1     2     3     4     5     6     7     8     9
//
// sma(2): idx1=10.5, idx2=11.5, idx3=10.5, idx4=8.5, idx5=7.5, idx6=9.5, idx7=12.5, idx8=13.5, idx9=14.5
// sma(3): idx2=11,   idx3=10.6667, idx4=9.6667, idx5=8, idx6=9, idx7=10.6667, idx8=13, idx9=14
//
// per-bar state (fast vs slow, first defined at idx2):
//   idx2: 11.5 > 11      -> BUY
//   idx3: 10.5 < 10.6667 -> SELL
//   idx4:  8.5 < 9.6667  -> SELL
//   idx5:  7.5 < 8       -> SELL
//   idx6:  9.5 > 9       -> BUY
//   idx7: 12.5 > 10.6667 -> BUY
//   idx8: 13.5 > 13      -> BUY
//   idx9: 14.5 > 14      -> BUY
//
// finalizeSignals collapses each run to its first bar:
//   BUY-run  [2]        -> keep idx2
//   SELL-run [3,4,5]    -> keep idx3
//   BUY-run  [6,7,8,9]  -> keep idx6 (STILL OPEN at the end of the window — no SELL after it)
const FIXTURE_CLOSES = [10, 11, 12, 9, 8, 7, 12, 13, 14, 15];
const fixtureCandles = closesToCandles(FIXTURE_CLOSES);

function checkMaCrossSignals(): StrategySignal[] {
  const signals = maCross.compute(fixtureCandles, { fast: 2, slow: 3 });
  assert("maCross: exactly 3 signals", signals.length === 3, `got ${signals.length}`);
  const expected: Array<{ index: number; side: "BUY" | "SELL"; price: number }> = [
    { index: 2, side: "BUY", price: 12 },
    { index: 3, side: "SELL", price: 9 },
    { index: 6, side: "BUY", price: 12 }
  ];
  expected.forEach((exp, i) => {
    const got = signals[i];
    assert(`maCross: signal[${i}].index`, got?.index === exp.index, `expected ${exp.index}, got ${got?.index}`);
    assert(`maCross: signal[${i}].side`, got?.side === exp.side, `expected ${exp.side}, got ${got?.side}`);
    assert(`maCross: signal[${i}].price`, got?.price === exp.price, `expected ${exp.price}, got ${got?.price}`);
  });
  return signals;
}

// ── Fixture 1 continued: backtest gross/net cross-checked against the
// REAL computeOrderCosts() (not reimplemented) — see module doc. ─────────

function checkBacktestCostCrossCheck(signals: StrategySignal[]): void {
  const notional = 100000;
  const productType = "DELIVERY" as const;
  const stats = runBacktest(fixtureCandles, signals, { notional, productType });

  // Trade 1: BUY@idx2 price 12, SELL@idx3 price 9 — a closed loss.
  const entryPrice1 = 12;
  const exitPrice1 = 9;
  const qty1 = Math.floor(notional / entryPrice1); // 8333
  const entryCosts1 = computeOrderCosts({ side: "BUY", productType, quantity: qty1, price: entryPrice1 }).totalCosts;
  const exitCosts1 = computeOrderCosts({ side: "SELL", productType, quantity: qty1, price: exitPrice1, isFirstDeliverySellOfScripToday: true }).totalCosts;
  const grossPnl1 = (exitPrice1 - entryPrice1) * qty1;
  const netPnl1 = grossPnl1 - entryCosts1 - exitCosts1;

  // Trade 2: BUY@idx6 price 12, STILL OPEN at idx9 (close 15) — unrealised, entry leg only.
  const entryPrice2 = 12;
  const qty2 = Math.floor(notional / entryPrice2); // 8333, identical sizing to trade 1 (same price/notional).
  const entryCosts2 = computeOrderCosts({ side: "BUY", productType, quantity: qty2, price: entryPrice2 }).totalCosts;
  const lastClose = FIXTURE_CLOSES[FIXTURE_CLOSES.length - 1]; // 15
  const grossPnl2 = (lastClose - entryPrice2) * qty2;
  const netPnl2 = grossPnl2 - entryCosts2;

  assert("backtest: trades count is 2 (1 closed + 1 open)", stats.trades === 2, `got ${stats.trades}`);
  assert("backtest: openAtEnd true", stats.openAtEnd === true);
  assert("backtest: wins is 0 (trade 1 is a loss, trade 2 is open and excluded)", stats.wins === 0, `got ${stats.wins}`);
  assertClose("backtest: winRatePct is 0 (1 closed trade, 0 wins)", stats.winRatePct ?? NaN, 0);

  assertClose("backtest: grossPnl matches hand sum", stats.grossPnl, grossPnl1 + grossPnl2);
  assertClose("backtest: netPnl matches real computeOrderCosts() cross-check", stats.netPnl, netPnl1 + netPnl2);
  assertClose("backtest: totalCosts matches real computeOrderCosts() cross-check", stats.totalCosts, entryCosts1 + exitCosts1 + entryCosts2);

  assertClose("backtest: grossReturnPct matches grossPnl/notional", stats.grossReturnPct, ((grossPnl1 + grossPnl2) / notional) * 100);
  assertClose("backtest: netReturnPct matches netPnl/notional", stats.netReturnPct, ((netPnl1 + netPnl2) / notional) * 100);

  // buyHoldReturnPct MUST be independent of the strategy's own signals — first open (10) to last close (15).
  assertClose("backtest: buyHoldReturnPct independent of signals", stats.buyHoldReturnPct, ((15 - 10) / 10) * 100);

  // Independent equity-curve reconstruction (a second, brute-force implementation) cross-checked against
  // runBacktest's own maxDrawdownPct — see module doc for why this is stronger than a hand-typed magic number.
  const independentEquity = independentEquityCurve(fixtureCandles, stats.tradesDetail, notional);
  const independentDrawdown = independentMaxDrawdownPct(independentEquity, notional);
  assertClose("backtest: maxDrawdownPct matches an independent equity-curve reconstruction", stats.maxDrawdownPct, independentDrawdown, 1e-6);
  assertFinite("backtest: maxDrawdownPct is finite", stats.maxDrawdownPct);
  assert("backtest: maxDrawdownPct is non-negative", stats.maxDrawdownPct >= 0, `got ${stats.maxDrawdownPct}`);

  // D7 mapping sanity: 1d -> DELIVERY, everything else -> INTRADAY.
  assert("intervalToProductType: 1d -> DELIVERY", intervalToProductType("1d") === "DELIVERY");
  assert("intervalToProductType: 5m -> INTRADAY", intervalToProductType("5m") === "INTRADAY");
  assert("intervalToProductType: 60m -> INTRADAY", intervalToProductType("60m") === "INTRADAY");

  // ── Metrics-engine extension: SAME fixture (1 closed loss + 1 open unrealised win), cross-checked BY HAND
  // against every new gross/net aggregate from trade1/trade2 above — see backtest.ts module doc's SIGN LAW
  // (loss-side aggregates stay SIGNED negative) and OPEN-TRADE LAW (win/loss-classified aggregates are
  // CLOSED-only; trade2 is excluded from all of them). ──────────────────────────────────────────────────────
  // Only trade1 is closed; trade2 is the open-at-end position (closedCount === 1 throughout this block).
  assert("backtest: grossWins is 0 (trade1 is the only closed trade, and it's a gross loss)", stats.grossWins === 0, `got ${stats.grossWins}`);
  assertClose("backtest: grossWinRatePct is 0", stats.grossWinRatePct ?? NaN, 0);

  assertClose("backtest: grossProfit is 0 (no gross-winning closed trades)", stats.grossProfit, 0);
  assertClose("backtest: grossLoss equals trade1's grossPnl, SIGNED negative", stats.grossLoss, grossPnl1);
  assertClose("backtest: netProfit is 0 (no net-winning closed trades)", stats.netProfit, 0);
  assertClose("backtest: netLoss equals trade1's netPnl, SIGNED negative", stats.netLoss, netPnl1);

  // A loss EXISTS but zero wins -> profit factor is a real 0, not null (null is reserved for "no losses at
  // all" — see checkNoLossSeries below for that branch).
  assertClose("backtest: profitFactorGross is 0 (a loss exists, but zero gross wins)", stats.profitFactorGross ?? NaN, 0);
  assertClose("backtest: profitFactorNet is 0 (a loss exists, but zero net wins)", stats.profitFactorNet ?? NaN, 0);

  assert("backtest: avgWinGross is null (zero gross-winning closed trades)", stats.avgWinGross === null, `got ${stats.avgWinGross}`);
  assertClose("backtest: avgLossGross equals trade1's grossPnl", stats.avgLossGross ?? NaN, grossPnl1);
  assert("backtest: avgWinNet is null", stats.avgWinNet === null, `got ${stats.avgWinNet}`);
  assertClose("backtest: avgLossNet equals trade1's netPnl", stats.avgLossNet ?? NaN, netPnl1);
  assert("backtest: avgWinLossRatioGross is null (avgWinGross is null)", stats.avgWinLossRatioGross === null, `got ${stats.avgWinLossRatioGross}`);
  assert("backtest: avgWinLossRatioNet is null", stats.avgWinLossRatioNet === null, `got ${stats.avgWinLossRatioNet}`);

  assert("backtest: largestWinGross is null", stats.largestWinGross === null, `got ${stats.largestWinGross}`);
  assertClose("backtest: largestLossGross equals trade1's grossPnl", stats.largestLossGross ?? NaN, grossPnl1);
  assert("backtest: largestWinNet is null", stats.largestWinNet === null, `got ${stats.largestWinNet}`);
  assertClose("backtest: largestLossNet equals trade1's netPnl", stats.largestLossNet ?? NaN, netPnl1);

  assertClose("backtest: expectancyGross equals trade1's grossPnl (the only closed trade)", stats.expectancyGross ?? NaN, grossPnl1);
  assertClose("backtest: expectancyNet equals trade1's netPnl", stats.expectancyNet ?? NaN, netPnl1);
  // avgTrade includes the OPEN trade too (2 trades total) — deliberately differs from expectancy (1 closed
  // trade only) here; see module doc's OPEN-TRADE LAW.
  assertClose("backtest: avgTradeGrossPnl averages BOTH trades (closed + open)", stats.avgTradeGrossPnl ?? NaN, (grossPnl1 + grossPnl2) / 2);
  assertClose("backtest: avgTradeNetPnl averages BOTH trades", stats.avgTradeNetPnl ?? NaN, (netPnl1 + netPnl2) / 2);
  assert(
    "backtest: expectancyNet != avgTradeNetPnl here (an open trade is excluded from expectancy but included in avgTrade)",
    stats.expectancyNet !== stats.avgTradeNetPnl
  );

  assert("backtest: maxConsecutiveWins is 0", stats.maxConsecutiveWins === 0, `got ${stats.maxConsecutiveWins}`);
  assert("backtest: maxConsecutiveLosses is 1", stats.maxConsecutiveLosses === 1, `got ${stats.maxConsecutiveLosses}`);

  // Time-in-market: trade1 barsHeld = exitIndex(3)-entryIndex(2) = 1; trade2 (open) barsHeld = lastIndex(9)-entryIndex(6) = 3.
  const trade1Detail = stats.tradesDetail[0];
  const trade2Detail = stats.tradesDetail[1];
  assert("backtest: trade1.barsHeld is 1", trade1Detail?.barsHeld === 1, `got ${trade1Detail?.barsHeld}`);
  assert("backtest: trade2 (open).barsHeld is 3", trade2Detail?.barsHeld === 3, `got ${trade2Detail?.barsHeld}`);
  assert("backtest: totalBarsInTrades is 4", stats.totalBarsInTrades === 4, `got ${stats.totalBarsInTrades}`);
  assertClose("backtest: avgBarsInTrades is 2", stats.avgBarsInTrades ?? NaN, 2);
  assertClose("backtest: pctTimeInMarket is 4/9 * 100", stats.pctTimeInMarket ?? NaN, (4 / 9) * 100);

  // MAE/MFE (fixtureCandles are flat OHLC = close per bar, from closesToCandles — see its own doc):
  // trade1 (entry idx2@12, exit idx3@9) scans idx3 only (close 9): MAE = 12-9 = 3/share, MFE = 0 (floored, price never rose above entry).
  assertClose("backtest: trade1.mae is 3/share * qty1", trade1Detail?.mae ?? NaN, 3 * qty1);
  assertClose("backtest: trade1.mfe is 0 (price never exceeded entry)", trade1Detail?.mfe ?? NaN, 0);
  assertClose("backtest: trade1.maePct is 25%", trade1Detail?.maePct ?? NaN, 25);
  assertClose("backtest: trade1.mfePct is 0", trade1Detail?.mfePct ?? NaN, 0);
  // trade2 (entry idx6@12, open through idx9) scans idx7/8/9 (closes 13,14,15): MAE = 0 (never dipped below entry), MFE = 15-12 = 3/share.
  assertClose("backtest: trade2 (open).mae is 0 (price never dipped below entry)", trade2Detail?.mae ?? NaN, 0);
  assertClose("backtest: trade2 (open).mfe is 3/share * qty2", trade2Detail?.mfe ?? NaN, 3 * qty2);
  assertClose("backtest: trade2.maePct is 0", trade2Detail?.maePct ?? NaN, 0);
  assertClose("backtest: trade2.mfePct is 25%", trade2Detail?.mfePct ?? NaN, 25);

  // Per-trade convenience fields.
  assertClose("backtest: trade1.totalCosts is entryCosts1+exitCosts1", trade1Detail?.totalCosts ?? NaN, entryCosts1 + exitCosts1);
  assertClose("backtest: trade1.grossPnlPct is (9-12)/12*100", trade1Detail?.grossPnlPct ?? NaN, ((exitPrice1 - entryPrice1) / entryPrice1) * 100);
  assertClose("backtest: trade1.netPnlPct matches netPnl1/(entryPrice1*qty1)*100", trade1Detail?.netPnlPct ?? NaN, (netPnl1 / (entryPrice1 * qty1)) * 100);
  assertClose("backtest: trade2.grossPnlPct is (15-12)/12*100", trade2Detail?.grossPnlPct ?? NaN, ((lastClose - entryPrice2) / entryPrice2) * 100);
  assertClose("backtest: trade2.netPnlPct matches netPnl2/(entryPrice2*qty2)*100", trade2Detail?.netPnlPct ?? NaN, (netPnl2 / (entryPrice2 * qty2)) * 100);
  assertClose("backtest: trade1.cumulativeNetEquity is notional+netPnl1", trade1Detail?.cumulativeNetEquity ?? NaN, notional + netPnl1);
  assertClose(
    "backtest: trade2 (last).cumulativeNetEquity is notional+stats.netPnl, matching the final equity-curve bar",
    trade2Detail?.cumulativeNetEquity ?? NaN,
    notional + stats.netPnl
  );

  // Annualization honesty gate: this fixture spans only 9 calendar days (idx0..idx9, 1 day/bar) — well under
  // the 90-day floor — both gross and net MUST be null, never a fabricated CAGR off a 9-day window.
  assert(
    "backtest: annualizedReturnPctGross is null (9-day window, under the 90-day honesty floor)",
    stats.annualizedReturnPctGross === null,
    `got ${stats.annualizedReturnPctGross}`
  );
  assert("backtest: annualizedReturnPctNet is null (same 9-day window)", stats.annualizedReturnPctNet === null, `got ${stats.annualizedReturnPctNet}`);

  // Equity curve: 10 points (1 per candle), final point matches the final realized+unrealized total, buy-hold overlay matches buyHoldReturnPct's own first-open-to-last-close convention.
  assert("backtest: equityCurve has 10 points (1 per candle)", stats.equityCurve.length === 10, `got ${stats.equityCurve.length}`);
  assertClose("backtest: equityCurve's final equity matches notional+stats.netPnl", stats.equityCurve[9]?.equity ?? NaN, notional + stats.netPnl);
  assertClose("backtest: equityCurve's final buyHoldEquity is notional*15/10", stats.equityCurve[9]?.buyHoldEquity ?? NaN, notional * (15 / 10));

  // Independent max-drawdown-₹ and max-run-up reconstructions (mirrors the existing maxDrawdownPct cross-check
  // above) — a second, brute-force implementation, not a hand-typed magic decimal.
  const independentDrawdownAmount = independentMaxDrawdownAmount(independentEquity, notional);
  assertClose("backtest: maxDrawdownAmount matches an independent equity-curve reconstruction", stats.maxDrawdownAmount, independentDrawdownAmount, 1e-6);
  assertFinite("backtest: maxDrawdownAmount is finite", stats.maxDrawdownAmount);
  assert("backtest: maxDrawdownAmount is non-negative", stats.maxDrawdownAmount >= 0, `got ${stats.maxDrawdownAmount}`);
  assertClose(
    "backtest: maxDrawdownAmount equals the max drawdownAmount across the equity curve's own points",
    stats.maxDrawdownAmount,
    Math.max(...stats.equityCurve.map((p) => p.drawdownAmount)),
    1e-6
  );

  const independentRunUp = independentMaxEquityRunUp(independentEquity, notional);
  assertClose("backtest: maxEquityRunUpPct matches an independent reconstruction", stats.maxEquityRunUpPct, independentRunUp.pct, 1e-6);
  assertClose("backtest: maxEquityRunUpAmount matches an independent reconstruction", stats.maxEquityRunUpAmount, independentRunUp.amount, 1e-6);
  assertFinite("backtest: maxEquityRunUpPct is finite", stats.maxEquityRunUpPct);
  assertFinite("backtest: maxEquityRunUpAmount is finite", stats.maxEquityRunUpAmount);

  // Generic finiteness sweep over every numeric stat (incl. every new field) — the "NULL, NEVER
  // INFINITY/NaN" law from the module doc, checked mechanically rather than per-field.
  for (const [label, value] of Object.entries(stats)) {
    if (typeof value === "number") assertFinite(`backtest (fixture 1): stats.${label} is finite`, value);
  }
}

/** A brute-force, INDEPENDENT reconstruction of the net equity curve from an already-built `tradesDetail` array — deliberately NOT `runBacktest`'s own single-pass sweep (a different code path testing the same invariant: "equity = starting capital + realized net PnL of every trade closed by this bar + unrealized mark-to-market of whichever trade is open at this bar"). O(bars * trades), fine for a selfcheck fixture. */
function independentEquityCurve(candles: readonly StrategyCandle[], trades: readonly BacktestTrade[], notional: number): number[] {
  const equity = new Array(candles.length).fill(notional);
  for (let i = 0; i < candles.length; i++) {
    let realized = 0;
    let unrealized = 0;
    for (const t of trades) {
      if (t.entryIndex > i) continue;
      if (!t.isOpen && t.exitIndex !== null && t.exitIndex <= i) {
        realized += t.netPnl;
      } else {
        unrealized += (candles[i].close - t.entryPrice) * t.qty - t.entryCosts;
      }
    }
    equity[i] = notional + realized + unrealized;
  }
  return equity;
}

function independentMaxDrawdownPct(equity: readonly number[], startingCapital: number): number {
  let peak = startingCapital;
  let maxDrawdown = 0;
  for (const e of equity) {
    if (e > peak) peak = e;
    if (peak > 0) maxDrawdown = Math.max(maxDrawdown, ((peak - e) / peak) * 100);
  }
  return maxDrawdown;
}

/** ₹ mirror of `independentMaxDrawdownPct` — same running-peak reconstruction, tracking the ₹ gap instead of the % gap. */
function independentMaxDrawdownAmount(equity: readonly number[], startingCapital: number): number {
  let peak = startingCapital;
  let maxDrawdownAmount = 0;
  for (const e of equity) {
    if (e > peak) peak = e;
    maxDrawdownAmount = Math.max(maxDrawdownAmount, peak - e);
  }
  return maxDrawdownAmount;
}

/** Mirror-image reconstruction of `independentMaxDrawdownPct`/`independentMaxDrawdownAmount`: a running TROUGH (instead of peak) tracks the largest subsequent gain, in both ₹ and %. */
function independentMaxEquityRunUp(equity: readonly number[], startingCapital: number): { pct: number; amount: number } {
  let trough = startingCapital;
  let maxAmount = 0;
  let maxPct = 0;
  for (const e of equity) {
    if (e < trough) trough = e;
    const amount = e - trough;
    if (amount > maxAmount) maxAmount = amount;
    if (trough > 0) maxPct = Math.max(maxPct, (amount / trough) * 100);
  }
  return { pct: maxPct, amount: maxAmount };
}

// ── Metrics-engine extension fixtures — 4 dedicated series per the ticket's
// exact spec: (a) a 3-trade known series with profit factor/expectancy/avg
// win-loss/consecutives/equity-curve points verified by hand, (b) a no-loss
// series (profit factor null), (c) an annualization POSITIVE-case series
// (every OTHER fixture in this file only exercises the null/honesty-gate
// path — this one proves the real formula works too), (d) a drawdown-shape
// series where max DD ₹ and max DD % are engineered to peak on DIFFERENT
// bars. All bypass `strategy.compute()` with synthetic `StrategySignal[]`,
// same pattern `checkSingleOpenTradeEdgeCase` already established. ────────

/**
 * WIN, WIN, LOSS chronologically (a real 2-streak, not just alternating
 * 1s), all CLOSED (no open-at-end — that's fixture 1's/annualize+'s job),
 * with REAL (non-flat) intrabar high/low ranges so MAE/MFE gets a
 * non-degenerate hand-check too (fixture 1's flat-OHLC candles make
 * MAE/MFE trivial). notional=10000, DELIVERY.
 *
 * Trade 1: entry idx1@100, exit idx3@120 (WIN, gross +2000, qty=100).
 * Trade 2: entry idx4@120, exit idx6@125 (WIN, gross +415, qty=83).
 * Trade 3: entry idx7@125, exit idx11@100 (LOSS, gross -2000, qty=80).
 * idx12 is a flat trailing bar after the last exit (proves no phantom
 * position / equity drift once flat).
 */
function buildThreeTradeCandles(): StrategyCandle[] {
  const baseTs = Date.UTC(2026, 0, 1);
  const dayMs = 24 * 60 * 60 * 1000;
  const bar = (i: number, high: number, low: number, close: number): StrategyCandle => ({
    timestamp: baseTs + i * dayMs,
    open: close,
    high,
    low,
    close,
    volume: 1000
  });
  return [
    bar(0, 100, 100, 100), // pre-entry
    bar(1, 100, 100, 100), // ENTRY trade1 BUY@100 (entry bar excluded from MAE/MFE scan)
    bar(2, 115, 95, 110), // scanned (trade1)
    bar(3, 122, 118, 120), // EXIT trade1 SELL@120 (scanned)
    bar(4, 120, 120, 120), // ENTRY trade2 BUY@120
    bar(5, 124, 112, 118), // scanned (trade2)
    bar(6, 127, 123, 125), // EXIT trade2 SELL@125 (scanned)
    bar(7, 125, 125, 125), // ENTRY trade3 BUY@125
    bar(8, 126, 108, 115), // scanned (trade3)
    bar(9, 118, 95, 105), // scanned (trade3)
    bar(10, 108, 88, 95), // scanned (trade3)
    bar(11, 105, 98, 100), // EXIT trade3 SELL@100 (scanned)
    bar(12, 100, 100, 100) // trailing flat bar, no open position
  ];
}

function checkThreeTradeKnownSeries(): void {
  const candles = buildThreeTradeCandles();
  const notional = 10000;
  const productType = "DELIVERY" as const;
  const mkSignal = (index: number, side: "BUY" | "SELL"): StrategySignal => ({
    index,
    timestamp: candles[index].timestamp,
    side,
    price: candles[index].close
  });
  const signals: StrategySignal[] = [
    mkSignal(1, "BUY"),
    mkSignal(3, "SELL"),
    mkSignal(4, "BUY"),
    mkSignal(6, "SELL"),
    mkSignal(7, "BUY"),
    mkSignal(11, "SELL")
  ];
  const stats = runBacktest(candles, signals, { notional, productType });

  assert("3-trade: exactly 3 closed trades, none open", stats.trades === 3 && stats.openAtEnd === false, `got ${stats.trades} trades, openAtEnd=${stats.openAtEnd}`);

  const qty1 = Math.floor(notional / 100); // 100
  const qty2 = Math.floor(notional / 120); // 83
  const qty3 = Math.floor(notional / 125); // 80
  const grossPnl1 = (120 - 100) * qty1; // 2000
  const grossPnl2 = (125 - 120) * qty2; // 415
  const grossPnl3 = (100 - 125) * qty3; // -2000
  assertClose("3-trade: trade1 grossPnl is 2000", stats.tradesDetail[0]?.grossPnl ?? NaN, grossPnl1);
  assertClose("3-trade: trade2 grossPnl is 415", stats.tradesDetail[1]?.grossPnl ?? NaN, grossPnl2);
  assertClose("3-trade: trade3 grossPnl is -2000", stats.tradesDetail[2]?.grossPnl ?? NaN, grossPnl3);

  // Real cost cross-check (not reimplemented) — same pattern as fixture 1.
  const entryCosts1 = computeOrderCosts({ side: "BUY", productType, quantity: qty1, price: 100 }).totalCosts;
  const exitCosts1 = computeOrderCosts({ side: "SELL", productType, quantity: qty1, price: 120, isFirstDeliverySellOfScripToday: true }).totalCosts;
  const entryCosts2 = computeOrderCosts({ side: "BUY", productType, quantity: qty2, price: 120 }).totalCosts;
  const exitCosts2 = computeOrderCosts({ side: "SELL", productType, quantity: qty2, price: 125, isFirstDeliverySellOfScripToday: true }).totalCosts;
  const entryCosts3 = computeOrderCosts({ side: "BUY", productType, quantity: qty3, price: 125 }).totalCosts;
  const exitCosts3 = computeOrderCosts({ side: "SELL", productType, quantity: qty3, price: 100, isFirstDeliverySellOfScripToday: true }).totalCosts;
  const netPnl1 = grossPnl1 - entryCosts1 - exitCosts1;
  const netPnl2 = grossPnl2 - entryCosts2 - exitCosts2;
  const netPnl3 = grossPnl3 - entryCosts3 - exitCosts3;

  // Sign sanity — costs must not flip the classification this fixture was designed around (trade2's small
  // ~415 gross win must comfortably survive its round-trip cost; verified here, not assumed).
  assert("3-trade: trade2's net win survives costs (fixture design margin)", netPnl2 > 0, `netPnl2=${netPnl2}, costs=${entryCosts2 + exitCosts2}`);

  assertClose("3-trade: trade1 netPnl matches real computeOrderCosts()", stats.tradesDetail[0]?.netPnl ?? NaN, netPnl1);
  assertClose("3-trade: trade2 netPnl matches real computeOrderCosts()", stats.tradesDetail[1]?.netPnl ?? NaN, netPnl2);
  assertClose("3-trade: trade3 netPnl matches real computeOrderCosts()", stats.tradesDetail[2]?.netPnl ?? NaN, netPnl3);

  // WIN, WIN, LOSS chronologically -> a streak of 2 wins, then 1 loss.
  assert("3-trade: wins is 2", stats.wins === 2, `got ${stats.wins}`);
  assertClose("3-trade: winRatePct is 66.6667", stats.winRatePct ?? NaN, (2 / 3) * 100);
  assert("3-trade: maxConsecutiveWins is 2", stats.maxConsecutiveWins === 2, `got ${stats.maxConsecutiveWins}`);
  assert("3-trade: maxConsecutiveLosses is 1", stats.maxConsecutiveLosses === 1, `got ${stats.maxConsecutiveLosses}`);

  // Profit factor: grossProfit = 2000+415 = 2415, grossLoss = -2000 (SIGNED) -> profitFactorGross = 2415/2000 = 1.2075.
  assertClose("3-trade: grossProfit is 2415", stats.grossProfit, grossPnl1 + grossPnl2);
  assertClose("3-trade: grossLoss is -2000 (SIGNED)", stats.grossLoss, grossPnl3);
  assertClose("3-trade: profitFactorGross is 2415/2000", stats.profitFactorGross ?? NaN, (grossPnl1 + grossPnl2) / Math.abs(grossPnl3));
  const netProfit = netPnl1 + netPnl2;
  assertClose("3-trade: netProfit matches netPnl1+netPnl2", stats.netProfit, netProfit);
  assertClose("3-trade: netLoss matches netPnl3 (SIGNED)", stats.netLoss, netPnl3);
  assertClose("3-trade: profitFactorNet matches netProfit/|netLoss|", stats.profitFactorNet ?? NaN, netProfit / Math.abs(netPnl3));

  assertClose("3-trade: avgWinGross is 2415/2", stats.avgWinGross ?? NaN, (grossPnl1 + grossPnl2) / 2);
  assertClose("3-trade: avgLossGross is -2000 (only 1 losing trade)", stats.avgLossGross ?? NaN, grossPnl3);
  assertClose("3-trade: avgWinLossRatioGross is (2415/2)/2000", stats.avgWinLossRatioGross ?? NaN, Math.abs((grossPnl1 + grossPnl2) / 2) / Math.abs(grossPnl3));
  assertClose("3-trade: largestWinGross is 2000 (trade1, bigger than trade2's 415)", stats.largestWinGross ?? NaN, grossPnl1);
  assertClose("3-trade: largestLossGross is -2000 (only losing trade)", stats.largestLossGross ?? NaN, grossPnl3);

  // Expectancy over the 3 CLOSED trades vs. avg trade P&L over ALL trades — both independently hand-checked
  // against the SAME expected value, which simultaneously proves they equal EACH OTHER (they must, since
  // there's no open trade here — same underlying set; see module doc's OPEN-TRADE LAW).
  const expectedExpectancyGross = (grossPnl1 + grossPnl2 + grossPnl3) / 3;
  const expectedExpectancyNet = (netPnl1 + netPnl2 + netPnl3) / 3;
  assertClose("3-trade: expectancyGross is (2000+415-2000)/3", stats.expectancyGross ?? NaN, expectedExpectancyGross);
  assertClose("3-trade: expectancyNet matches real-cost sum / 3", stats.expectancyNet ?? NaN, expectedExpectancyNet);
  assertClose("3-trade: avgTradeGrossPnl equals the SAME value as expectancyGross (no open trade — identical closed set)", stats.avgTradeGrossPnl ?? NaN, expectedExpectancyGross);
  assertClose("3-trade: avgTradeNetPnl equals the SAME value as expectancyNet", stats.avgTradeNetPnl ?? NaN, expectedExpectancyNet);

  // Bars held: trade1 = 3-1=2, trade2 = 6-4=2, trade3 = 11-7=4 -> total 8, avg 8/3, %-time = 8/(13-1)*100.
  assert("3-trade: trade1.barsHeld is 2", stats.tradesDetail[0]?.barsHeld === 2, `got ${stats.tradesDetail[0]?.barsHeld}`);
  assert("3-trade: trade2.barsHeld is 2", stats.tradesDetail[1]?.barsHeld === 2, `got ${stats.tradesDetail[1]?.barsHeld}`);
  assert("3-trade: trade3.barsHeld is 4", stats.tradesDetail[2]?.barsHeld === 4, `got ${stats.tradesDetail[2]?.barsHeld}`);
  assert("3-trade: totalBarsInTrades is 8", stats.totalBarsInTrades === 8, `got ${stats.totalBarsInTrades}`);
  assertClose("3-trade: avgBarsInTrades is 8/3", stats.avgBarsInTrades ?? NaN, 8 / 3);
  assertClose("3-trade: pctTimeInMarket is 8/12*100", stats.pctTimeInMarket ?? NaN, (8 / 12) * 100);

  // MAE/MFE, hand-traced from the candle high/low ranges above (entry bar excluded from every scan):
  // trade1 scans idx2..idx3: minLow=95, maxHigh=122, entry=100 -> mae/share=5, mfe/share=22.
  assertClose("3-trade: trade1.mae is 5/share * qty1", stats.tradesDetail[0]?.mae ?? NaN, 5 * qty1);
  assertClose("3-trade: trade1.mfe is 22/share * qty1", stats.tradesDetail[0]?.mfe ?? NaN, 22 * qty1);
  // trade2 scans idx5..idx6: minLow=112, maxHigh=127, entry=120 -> mae/share=8, mfe/share=7.
  assertClose("3-trade: trade2.mae is 8/share * qty2", stats.tradesDetail[1]?.mae ?? NaN, 8 * qty2);
  assertClose("3-trade: trade2.mfe is 7/share * qty2", stats.tradesDetail[1]?.mfe ?? NaN, 7 * qty2);
  // trade3 scans idx8..idx11: minLow=88, maxHigh=126, entry=125 -> mae/share=37, mfe/share=1.
  assertClose("3-trade: trade3.mae is 37/share * qty3", stats.tradesDetail[2]?.mae ?? NaN, 37 * qty3);
  assertClose("3-trade: trade3.mfe is 1/share * qty3", stats.tradesDetail[2]?.mfe ?? NaN, 1 * qty3);

  // Annualization: 12-day window, well under the 90-day floor -> null on both sides.
  assert("3-trade: annualizedReturnPctGross is null (12-day window)", stats.annualizedReturnPctGross === null, `got ${stats.annualizedReturnPctGross}`);
  assert("3-trade: annualizedReturnPctNet is null (12-day window)", stats.annualizedReturnPctNet === null, `got ${stats.annualizedReturnPctNet}`);

  // Equity curve: cumulative net equity after trade3 (last trade) equals notional + full net P&L, and the
  // trailing flat bar (idx12) carries that exact equity forward — no phantom drift once flat.
  const finalNet = netPnl1 + netPnl2 + netPnl3;
  assertClose("3-trade: trade3.cumulativeNetEquity is notional+netPnl total", stats.tradesDetail[2]?.cumulativeNetEquity ?? NaN, notional + finalNet);
  assertClose("3-trade: equityCurve's last bar matches final cumulative equity", stats.equityCurve[12]?.equity ?? NaN, notional + finalNet);
  assertClose(
    "3-trade: equityCurve is flat between the last exit (idx11) and the trailing bar (idx12) — no open position",
    stats.equityCurve[12]?.equity ?? NaN,
    stats.equityCurve[11]?.equity ?? NaN
  );

  // grossEquity ("Ideal — no costs") mirror: the last bar equals notional + total grossPnl exactly, matching the
  // documented `grossEquity === notional*(1+grossReturnPct/100)` invariant.
  const finalGross = grossPnl1 + grossPnl2 + grossPnl3;
  assertClose("3-trade: equityCurve's last bar grossEquity is notional+total grossPnl (Ideal view)", stats.equityCurve[12]?.grossEquity ?? NaN, notional + finalGross);
  assertClose("3-trade: grossEquity === notional*(1+grossReturnPct/100) invariant", stats.equityCurve[12]?.grossEquity ?? NaN, notional * (1 + stats.grossReturnPct / 100));

  // Capital efficiency + margin (hand-traced): deployed1=entryPrice1*qty1=100*100=10000, deployed2=120*83=9960,
  // deployed3=125*80=10000 -> peak is 10000 (tied trade1/trade3, both exactly notional since qty floors close to
  // it at these prices). Bar spans (entry..through INCLUSIVE): trade1 idx1..3 = 3 bars, trade2 idx4..6 = 3 bars,
  // trade3 idx7..11 = 5 bars, over candleCount=13.
  const deployed1 = 100 * qty1;
  const deployed2 = 120 * qty2;
  const deployed3 = 125 * qty3;
  const expectedPeakDeployed = Math.max(deployed1, deployed2, deployed3);
  assertClose("3-trade: peakDeployedCapital is max(10000, 9960, 10000) = 10000", stats.peakDeployedCapital, expectedPeakDeployed);
  const expectedAvgDeployedPct = ((3 * deployed1 + 3 * deployed2 + 5 * deployed3) / 13 / notional) * 100;
  assertClose("3-trade: avgDeployedCapitalPct matches the hand bar-weighted sum", stats.avgDeployedCapitalPct ?? NaN, expectedAvgDeployedPct);
  assertClose(
    "3-trade: returnOnPeakCapitalPctGross is grossPnl/peakDeployedCapital*100",
    stats.returnOnPeakCapitalPctGross ?? NaN,
    (stats.grossPnl / expectedPeakDeployed) * 100
  );
  assertClose(
    "3-trade: returnOnPeakCapitalPctNet is (netPnl1+netPnl2+netPnl3)/peakDeployedCapital*100 (real-cost sum)",
    stats.returnOnPeakCapitalPctNet ?? NaN,
    (finalNet / expectedPeakDeployed) * 100
  );
  assert("3-trade: marginModel is DELIVERY_FULL_NOTIONAL (fixture's own productType)", stats.marginModel === "DELIVERY_FULL_NOTIONAL", stats.marginModel);
  assertClose("3-trade: avgMarginUsedPct equals avgDeployedCapitalPct (no leverage model applies to DELIVERY either)", stats.avgMarginUsedPct ?? NaN, expectedAvgDeployedPct);
  assertClose("3-trade: peakMarginUsedPct is peakDeployedCapital/notional*100 = 100%", stats.peakMarginUsedPct, 100);

  for (const [label, value] of Object.entries(stats)) {
    if (typeof value === "number") assertFinite(`3-trade: stats.${label} is finite`, value);
  }
}

/** No-loss series — every closed trade is a WIN. Profit factor and every loss-side aggregate MUST be `null` (never `Infinity`/`NaN`), the exact acceptance criterion the ticket names. notional=10000, DELIVERY, 2 closed wins, no open trade. */
function checkNoLossSeries(): void {
  const baseTs = Date.UTC(2026, 0, 1);
  const dayMs = 24 * 60 * 60 * 1000;
  const bar = (i: number, high: number, low: number, close: number): StrategyCandle => ({
    timestamp: baseTs + i * dayMs,
    open: close,
    high,
    low,
    close,
    volume: 1000
  });
  const candles: StrategyCandle[] = [
    bar(0, 100, 100, 100),
    bar(1, 100, 100, 100), // ENTRY trade1 BUY@100
    bar(2, 108, 98, 105), // scanned
    bar(3, 121, 115, 120), // EXIT trade1 SELL@120
    bar(4, 100, 100, 100), // ENTRY trade2 BUY@100
    bar(5, 112, 99, 105), // scanned
    bar(6, 113, 104, 110) // EXIT trade2 SELL@110
  ];
  const notional = 10000;
  const productType = "DELIVERY" as const;
  const mkSignal = (index: number, side: "BUY" | "SELL"): StrategySignal => ({
    index,
    timestamp: candles[index].timestamp,
    side,
    price: candles[index].close
  });
  const signals: StrategySignal[] = [mkSignal(1, "BUY"), mkSignal(3, "SELL"), mkSignal(4, "BUY"), mkSignal(6, "SELL")];
  const stats = runBacktest(candles, signals, { notional, productType });

  const qty = Math.floor(notional / 100); // 100, identical sizing both trades
  const grossPnl1 = (120 - 100) * qty; // 2000
  const grossPnl2 = (110 - 100) * qty; // 1000

  assert("no-loss: 2 closed trades, both wins", stats.trades === 2 && stats.wins === 2, `trades=${stats.trades}, wins=${stats.wins}`);
  assertClose("no-loss: winRatePct is 100", stats.winRatePct ?? NaN, 100);
  assertClose("no-loss: grossProfit is 3000", stats.grossProfit, grossPnl1 + grossPnl2);
  assertClose("no-loss: grossLoss is 0 (no losing closed trades)", stats.grossLoss, 0);
  assert("no-loss: profitFactorGross is null, NEVER Infinity", stats.profitFactorGross === null, `got ${stats.profitFactorGross}`);
  assert("no-loss: profitFactorNet is null, NEVER Infinity", stats.profitFactorNet === null, `got ${stats.profitFactorNet}`);
  assert("no-loss: avgLossGross is null (no losing closed trades)", stats.avgLossGross === null, `got ${stats.avgLossGross}`);
  assert("no-loss: avgLossNet is null", stats.avgLossNet === null, `got ${stats.avgLossNet}`);
  assert("no-loss: avgWinLossRatioGross is null (undefined without a loss to divide by)", stats.avgWinLossRatioGross === null, `got ${stats.avgWinLossRatioGross}`);
  assert("no-loss: avgWinLossRatioNet is null", stats.avgWinLossRatioNet === null, `got ${stats.avgWinLossRatioNet}`);
  assert("no-loss: largestLossGross is null", stats.largestLossGross === null, `got ${stats.largestLossGross}`);
  assert("no-loss: largestLossNet is null", stats.largestLossNet === null, `got ${stats.largestLossNet}`);
  assert("no-loss: maxConsecutiveLosses is 0", stats.maxConsecutiveLosses === 0, `got ${stats.maxConsecutiveLosses}`);
  assert("no-loss: maxConsecutiveWins is 2", stats.maxConsecutiveWins === 2, `got ${stats.maxConsecutiveWins}`);
  assertClose("no-loss: largestWinGross is 2000 (trade1)", stats.largestWinGross ?? NaN, grossPnl1);
  assertClose("no-loss: expectancyGross is (2000+1000)/2", stats.expectancyGross ?? NaN, (grossPnl1 + grossPnl2) / 2);

  // MAE/MFE hand-trace: trade1 scans idx2..idx3 (minLow=98, maxHigh=121, entry=100) -> mae/share=2, mfe/share=21.
  assertClose("no-loss: trade1.mae is 2/share*qty", stats.tradesDetail[0]?.mae ?? NaN, 2 * qty);
  assertClose("no-loss: trade1.mfe is 21/share*qty", stats.tradesDetail[0]?.mfe ?? NaN, 21 * qty);
  // trade2 scans idx5..idx6 (minLow=99, maxHigh=113, entry=100) -> mae/share=1, mfe/share=13.
  assertClose("no-loss: trade2.mae is 1/share*qty", stats.tradesDetail[1]?.mae ?? NaN, 1 * qty);
  assertClose("no-loss: trade2.mfe is 13/share*qty", stats.tradesDetail[1]?.mfe ?? NaN, 13 * qty);

  for (const [label, value] of Object.entries(stats)) {
    if (typeof value === "number") assertFinite(`no-loss: stats.${label} is finite`, value);
  }
}

/**
 * Annualization POSITIVE case — every OTHER fixture in this file only
 * exercises the null/honesty-gate path (a bug in the real CAGR formula
 * would go completely undetected by `ta:check` without this). A 2-bar
 * window spanning EXACTLY 365 calendar days, single open-at-end trade,
 * clean round-number gross return (100% exactly) so the expected
 * annualized value is derivable from the documented formula applied to
 * KNOWN, independently-chosen inputs (spanDays=365, base=2) — the textbook
 * CAGR formula, not a re-derivation of `runBacktest`'s own code. What's
 * actually under test: whether `spanDays` came from ACTUAL ELAPSED
 * CALENDAR TIME (365, by construction) rather than bar count (which would
 * be 1, for a 2-bar array — a wildly different, obviously-wrong number;
 * see the negative-control assertion below).
 */
function checkAnnualizedReturnPositiveCase(): void {
  const baseTs = Date.UTC(2026, 0, 1);
  const dayMs = 24 * 60 * 60 * 1000;
  const spanDays = 365;
  const candles: StrategyCandle[] = [
    { timestamp: baseTs, open: 100, high: 100, low: 100, close: 100, volume: 1000 },
    { timestamp: baseTs + spanDays * dayMs, open: 200, high: 210, low: 190, close: 200, volume: 1000 }
  ];
  const notional = 10000;
  const productType = "DELIVERY" as const;
  const signal: StrategySignal = { index: 0, timestamp: candles[0].timestamp, side: "BUY", price: 100 };
  const stats = runBacktest(candles, [signal], { notional, productType });

  const qty = Math.floor(notional / 100); // 100
  assertClose("annualize+: grossReturnPct is exactly 100% (clean round-trip design)", stats.grossReturnPct, 100);
  assert("annualize+: still open at end (single BUY, no SELL)", stats.openAtEnd === true);

  const expectedAnnualizedGross = (Math.pow(2, 365.25 / spanDays) - 1) * 100;
  assertClose("annualize+: annualizedReturnPctGross matches the CAGR formula on known inputs", stats.annualizedReturnPctGross ?? NaN, expectedAnnualizedGross, 1e-6);

  // Negative control: if spanDays had been computed from BAR COUNT (1 interval, not 365 days), the result
  // would be astronomically larger — assert our real result is nowhere near that regime, i.e. it used
  // calendar days, not bar count.
  assert(
    "annualize+: result is NOT the bar-count-based figure (proves calendar-day span, not bar count, was used)",
    stats.annualizedReturnPctGross !== null && stats.annualizedReturnPctGross < 1000,
    `got ${stats.annualizedReturnPctGross}`
  );

  const entryCosts = computeOrderCosts({ side: "BUY", productType, quantity: qty, price: 100 }).totalCosts;
  const netPnl = (200 - 100) * qty - entryCosts;
  const netReturnPct = (netPnl / notional) * 100;
  const expectedAnnualizedNet = (Math.pow(1 + netReturnPct / 100, 365.25 / spanDays) - 1) * 100;
  assertClose("annualize+: annualizedReturnPctNet matches the CAGR formula on the real net return", stats.annualizedReturnPctNet ?? NaN, expectedAnnualizedNet, 1e-6);

  // barsHeld=1 (one bar elapsed since entry); MAE/MFE scans just idx1 (minLow=190, maxHigh=210, entry=100).
  assert("annualize+: barsHeld is 1", stats.tradesDetail[0]?.barsHeld === 1, `got ${stats.tradesDetail[0]?.barsHeld}`);
  assertClose("annualize+: mae is 0 (price never dipped below entry)", stats.tradesDetail[0]?.mae ?? NaN, 0);
  assertClose("annualize+: mfe is 110/share*qty", stats.tradesDetail[0]?.mfe ?? NaN, 110 * qty);

  // grossEquity ("Ideal — no costs") mirror, still-open trade: bar1's gross unrealized is (200-100)*qty, no cost
  // deduction at all (unlike `equity[1]`, which subtracts entryCosts) — a clean, hand-typed divergence from the
  // net series that proves the two really are computed independently, not aliased.
  assertClose("annualize+: equityCurve[1].grossEquity is notional + (200-100)*qty, zero cost drag", stats.equityCurve[1]?.grossEquity ?? NaN, notional + (200 - 100) * qty);
  assert(
    "annualize+: grossEquity[1] is strictly greater than equity[1] (net pays entryCosts, gross doesn't)",
    (stats.equityCurve[1]?.grossEquity ?? -Infinity) > (stats.equityCurve[1]?.equity ?? Infinity),
    `grossEquity=${stats.equityCurve[1]?.grossEquity}, equity=${stats.equityCurve[1]?.equity}`
  );

  for (const [label, value] of Object.entries(stats)) {
    if (typeof value === "number") assertFinite(`annualize+: stats.${label} is finite`, value);
  }
}

/**
 * Drawdown-SHAPE divergence — an equity path engineered so the bar
 * producing the LARGEST ₹ drawdown is DIFFERENT from the bar producing the
 * LARGEST % drawdown (an early, small peak with a steep % dip; a later,
 * much bigger peak with a shallower % but bigger ₹ dip). A single held
 * trade (entry idx0@100, exit idx8@600) makes the equity path a direct
 * linear function of each bar's close (`equity[i] = notional - entryCosts
 * + (close[i]-100) × qty` while open) — chosen specifically so both
 * `maxDrawdownAmount` (2000) and `maxEquityRunUpAmount` (50100) are EXACT,
 * cost-independent numbers (the constant `entryCosts` offset cancels out
 * of any peak-minus-current ₹ difference taken while the SAME trade is
 * still open); the %-based figures need the real `entryCosts`, computed
 * via `computeOrderCosts()` below, not hand-typed.
 */
function checkDrawdownShapeDivergence(): void {
  const closes = [100, 109, 99, 110, 500, 480, 500, 600, 600];
  const candles = closesToCandles(closes);
  const notional = 10000;
  const productType = "DELIVERY" as const;
  const qty = Math.floor(notional / 100); // 100
  const signals: StrategySignal[] = [
    { index: 0, timestamp: candles[0].timestamp, side: "BUY", price: 100 },
    { index: 8, timestamp: candles[8].timestamp, side: "SELL", price: 600 }
  ];
  const stats = runBacktest(candles, signals, { notional, productType });

  const entryCosts = computeOrderCosts({ side: "BUY", productType, quantity: qty, price: 100 }).totalCosts;

  const peak1 = 10900 - entryCosts; // running peak at idx1, before the idx2 dip
  const trough1 = 9900 - entryCosts; // equity at idx2 (also the GLOBAL running trough from idx2 onward)
  const peak2 = 50000 - entryCosts; // running peak at idx4, before the idx5 dip
  const trough2 = 48000 - entryCosts; // equity at idx5

  // The ₹ gap is bigger at the SECOND (bigger-peak) dip; the % gap is bigger at the FIRST (smaller-peak) dip
  // — the two metrics' maxima are engineered to land on genuinely different bars (fixture design sanity,
  // checked before trusting the runBacktest assertions below).
  const ddAmount1 = peak1 - trough1; // 1000, exact (entryCosts cancels)
  const ddAmount2 = peak2 - trough2; // 2000, exact
  const ddPct1 = (ddAmount1 / peak1) * 100; // ~9.18%
  const ddPct2 = (ddAmount2 / peak2) * 100; // ~4.00%
  assert("drawdown-shape: fixture design sanity — ddAmount2 > ddAmount1 (bigger ₹ dip is the LATER one)", ddAmount2 > ddAmount1, `${ddAmount2} vs ${ddAmount1}`);
  assert("drawdown-shape: fixture design sanity — ddPct1 > ddPct2 (bigger % dip is the EARLIER one)", ddPct1 > ddPct2, `${ddPct1} vs ${ddPct2}`);

  assertClose("drawdown-shape: maxDrawdownAmount is exactly 2000 (cost-independent by construction)", stats.maxDrawdownAmount, 2000, 1e-6);
  assertClose("drawdown-shape: maxDrawdownPct matches the FIRST (smaller-peak) dip, not the bigger-₹ one", stats.maxDrawdownPct, ddPct1, 1e-6);
  assert(
    "drawdown-shape: maxDrawdownAmount and maxDrawdownPct are driven by DIFFERENT dips — the whole point of this fixture",
    Math.abs(stats.maxDrawdownAmount - ddAmount2) < 1e-6 && Math.abs(stats.maxDrawdownPct - ddPct1) < 1e-6 && Math.abs(ddAmount1 - stats.maxDrawdownAmount) > 1e-6
  );

  assertClose("drawdown-shape: maxEquityRunUpAmount is exactly 50100 (cost-independent by construction)", stats.maxEquityRunUpAmount, 50100, 1e-6);
  const expectedRunUpPct = (50100 / trough1) * 100; // trough1 (idx2) is also the running trough the max run-up (at idx7) is measured off.
  assertClose("drawdown-shape: maxEquityRunUpPct matches the run-up off the idx2 trough", stats.maxEquityRunUpPct, expectedRunUpPct, 1e-6);

  // Per-bar equityCurve cross-check: the max of the curve's own drawdownAmount/drawdownPct fields must equal
  // the aggregate stats — not a second, independently-drifting computation of the same thing.
  assertClose(
    "drawdown-shape: maxDrawdownAmount equals the max drawdownAmount across equityCurve's own points",
    stats.maxDrawdownAmount,
    Math.max(...stats.equityCurve.map((p) => p.drawdownAmount)),
    1e-6
  );
  assertClose(
    "drawdown-shape: maxDrawdownPct equals the max drawdownPct across equityCurve's own points",
    stats.maxDrawdownPct,
    Math.max(...stats.equityCurve.map((p) => p.drawdownPct)),
    1e-6
  );
  assert(
    "drawdown-shape: the bar index of max drawdownAmount differs from the bar index of max drawdownPct",
    stats.equityCurve.findIndex((p) => Math.abs(p.drawdownAmount - stats.maxDrawdownAmount) < 1e-6) !==
      stats.equityCurve.findIndex((p) => Math.abs(p.drawdownPct - stats.maxDrawdownPct) < 1e-6)
  );

  for (const [label, value] of Object.entries(stats)) {
    if (typeof value === "number") assertFinite(`drawdown-shape: stats.${label} is finite`, value);
  }
}

// ── Fixture 2: edge cases — 0-signal, 1-signal open-at-end, qty guard ────

function checkZeroSignalEdgeCase(): void {
  // A flat price series: sma(2) === sma(3) at every defined bar (10 === 10) -> every state is a tie -> undefined -> zero raw signals.
  const flatCandles = closesToCandles([10, 10, 10, 10, 10, 10]);
  const signals = maCross.compute(flatCandles, { fast: 2, slow: 3 });
  assert("0-signal: flat series produces zero maCross signals", signals.length === 0, `got ${signals.length}`);

  const stats = runBacktest(flatCandles, signals, { notional: 100000, productType: "DELIVERY" });
  assert("0-signal: trades is 0", stats.trades === 0, `got ${stats.trades}`);
  assert("0-signal: wins is 0", stats.wins === 0, `got ${stats.wins}`);
  assert("0-signal: winRatePct is null (never 0/NaN standing in for undefined)", stats.winRatePct === null, `got ${stats.winRatePct}`);
  assertClose("0-signal: grossPnl is 0", stats.grossPnl, 0);
  assertClose("0-signal: netPnl is 0", stats.netPnl, 0);
  assertClose("0-signal: totalCosts is 0", stats.totalCosts, 0);
  assertClose("0-signal: grossReturnPct is 0", stats.grossReturnPct, 0);
  assertClose("0-signal: netReturnPct is 0", stats.netReturnPct, 0);
  assertClose("0-signal: maxDrawdownPct is 0 (flat equity curve)", stats.maxDrawdownPct, 0);
  assertClose("0-signal: buyHoldReturnPct is 0 (flat prices)", stats.buyHoldReturnPct, 0);
  assert("0-signal: openAtEnd is false", stats.openAtEnd === false);

  // Capital efficiency + margin, zero-trade case: nothing was ever deployed. peak/avg are real ZEROES (a true
  // fact about this run), NOT null — but return-on-peak-capital is null (undefined without any capital to divide
  // by), matching the NULL LAW's "0 has meaning, undefined doesn't" distinction the module doc draws.
  assertClose("0-signal: peakDeployedCapital is 0 (never deployed)", stats.peakDeployedCapital, 0);
  assertClose("0-signal: avgDeployedCapitalPct is 0, not null (6 real candles, genuinely zero deployment)", stats.avgDeployedCapitalPct ?? NaN, 0);
  assert("0-signal: returnOnPeakCapitalPctGross is null (nothing deployed to return on)", stats.returnOnPeakCapitalPctGross === null, `got ${stats.returnOnPeakCapitalPctGross}`);
  assert("0-signal: returnOnPeakCapitalPctNet is null", stats.returnOnPeakCapitalPctNet === null, `got ${stats.returnOnPeakCapitalPctNet}`);
  assert("0-signal: marginModel is DELIVERY_FULL_NOTIONAL (fixture's own productType)", stats.marginModel === "DELIVERY_FULL_NOTIONAL", stats.marginModel);
  assertClose("0-signal: avgMarginUsedPct is 0", stats.avgMarginUsedPct ?? NaN, 0);
  assertClose("0-signal: peakMarginUsedPct is 0", stats.peakMarginUsedPct, 0);
}

function checkSingleOpenTradeEdgeCase(): void {
  // A synthetic single BUY, no SELL — bypasses strategy.compute() to isolate runBacktest's own open-at-end path.
  const candles = closesToCandles([100, 105, 110]);
  const signal: StrategySignal = { index: 0, timestamp: candles[0].timestamp, side: "BUY", price: 100 };
  const stats = runBacktest(candles, [signal], { notional: 10000, productType: "INTRADAY" });

  assert("1-BUY: trades is 1", stats.trades === 1, `got ${stats.trades}`);
  assert("1-BUY: openAtEnd is true", stats.openAtEnd === true);
  assert("1-BUY: winRatePct is null (zero CLOSED trades)", stats.winRatePct === null, `got ${stats.winRatePct}`);
  const trade = stats.tradesDetail[0];
  assert("1-BUY: the single trade isOpen", trade?.isOpen === true);
  assert("1-BUY: exitIndex is null", trade?.exitIndex === null, `got ${trade?.exitIndex}`);
  assert("1-BUY: exitCosts is 0", trade?.exitCosts === 0, `got ${trade?.exitCosts}`);
  const qty = Math.floor(10000 / 100); // 100
  assert("1-BUY: qty matches floor(notional/entry)", trade?.qty === qty, `expected ${qty}, got ${trade?.qty}`);
  const entryCosts = computeOrderCosts({ side: "BUY", productType: "INTRADAY", quantity: qty, price: 100 }).totalCosts;
  const expectedNetPnl = (110 - 100) * qty - entryCosts;
  assertClose("1-BUY: netPnl is grossPnl minus entry costs only", trade?.netPnl ?? NaN, expectedNetPnl);

  // Capital efficiency + margin, INTRADAY single still-open trade: deployed = entryPrice(100)*qty -> also the
  // peak (only ever one trade). Bar span entry(idx0)..through(lastCandleIndex=2, since exitIndex is null)
  // INCLUSIVE = 3 bars, over candleCount=3 -> deployed the WHOLE window, 100%.
  const deployed = 100 * qty;
  assertClose("1-BUY: peakDeployedCapital is entryPrice*qty", stats.peakDeployedCapital, deployed);
  assertClose("1-BUY: avgDeployedCapitalPct is 100% (deployed for the whole 3-bar window)", stats.avgDeployedCapitalPct ?? NaN, 100);
  assertClose("1-BUY: returnOnPeakCapitalPctGross is grossPnl/deployed*100 = 1000/deployed*100", stats.returnOnPeakCapitalPctGross ?? NaN, ((110 - 100) * qty / deployed) * 100);
  assertClose("1-BUY: returnOnPeakCapitalPctNet is netPnl/deployed*100", stats.returnOnPeakCapitalPctNet ?? NaN, (expectedNetPnl / deployed) * 100);
  assert(
    "1-BUY: marginModel is the honest INTRADAY_FULL_NOTIONAL_NO_LEVERAGE_MODEL (no leverage model exists — must not fabricate one)",
    stats.marginModel === "INTRADAY_FULL_NOTIONAL_NO_LEVERAGE_MODEL",
    stats.marginModel
  );
  assertClose("1-BUY: avgMarginUsedPct equals avgDeployedCapitalPct (100%) under the no-leverage-model honesty law", stats.avgMarginUsedPct ?? NaN, 100);
  assertClose("1-BUY: peakMarginUsedPct is 100%", stats.peakMarginUsedPct, 100);

  for (const [label, value] of Object.entries(stats)) {
    if (typeof value === "number") assertFinite(`1-BUY: stats.${label} is finite`, value);
  }
}

function checkQtyMinOneGuard(): void {
  // notional smaller than the entry price -> floor(notional/price) === 0 -> must clamp to the documented "min 1".
  const candles = closesToCandles([500, 510]);
  const signal: StrategySignal = { index: 0, timestamp: candles[0].timestamp, side: "BUY", price: 500 };
  const stats = runBacktest(candles, [signal], { notional: 50, productType: "DELIVERY" });
  const trade = stats.tradesDetail[0];
  assert("qty guard: qty is clamped to a minimum of 1", trade?.qty === 1, `got ${trade?.qty}`);
}

function checkFinalizeSignalsDropsLeadingSell(): void {
  const raw: StrategySignal[] = [
    { index: 0, timestamp: 0, side: "SELL", price: 10 }, // leading SELL — must be dropped, not treated as a naked short.
    { index: 1, timestamp: 1, side: "BUY", price: 11 },
    { index: 2, timestamp: 2, side: "BUY", price: 12 }, // same-side run — collapsed, only index 1 survives.
    { index: 3, timestamp: 3, side: "SELL", price: 9 }
  ];
  const finalized = finalizeSignals(raw);
  assert("finalizeSignals: drops the leading SELL", finalized.length === 2, `got ${finalized.length}`);
  assert("finalizeSignals: first surviving signal is the BUY at index 1", finalized[0]?.index === 1 && finalized[0]?.side === "BUY");
  assert("finalizeSignals: second surviving signal is the SELL at index 3", finalized[1]?.index === 3 && finalized[1]?.side === "SELL");
}

// ── Fixture 3: `computeTechnicalRating` — a constructed uptrend must vote
// buy-heavy, downtrend sell-heavy, flat neutral-heavy. Per the founder-
// feedback pass's own "never fabricate" rule, a monotonic series still
// leaves SOME oscillators reading a mixed/contrarian signal at the final
// bar (a sustained uptrend commonly shows short-term "overbought" on
// several oscillators — a real, correct property of technical-rating
// systems, not a bug) — so the DIRECTIONAL assertions below are on the
// deterministic MA group (hand-provable: monotonic price ⇒ close on the
// same side of every SMA/EMA, every bar) and on the combined `overall`
// bucket (which the MA group's un-mixed strength is enough to tip into the
// correct family even with a contrarian oscillator group — see below). ───

function buildMonotonicCandles(n: number, start: number, step: number): StrategyCandle[] {
  const baseTs = Date.UTC(2026, 0, 1);
  const dayMs = 24 * 60 * 60 * 1000;
  return Array.from({ length: n }, (_, i) => {
    const c = start + step * i;
    return { timestamp: baseTs + i * dayMs, open: c, high: c, low: c, close: c, volume: 1000 };
  });
}

function buildConstantCandles(n: number, price: number): StrategyCandle[] {
  const baseTs = Date.UTC(2026, 0, 1);
  const dayMs = 24 * 60 * 60 * 1000;
  return Array.from({ length: n }, (_, i) => ({ timestamp: baseTs + i * dayMs, open: price, high: price, low: price, close: price, volume: 1000 }));
}

function checkTechnicalRatingFixtures(): void {
  // Uptrend: 80 monotonically increasing bars — every SMA/EMA sits below the current close every bar (a moving
  // average of a strictly increasing series is always < the latest value), so the MA group is UNANIMOUS buy
  // across every one of its 8 qualifying lines (periods 10/20/30/50 × SMA+EMA; 100/200 correctly SKIPPED — only
  // 80 bars loaded, the "never fabricate" rule) — a hand-provable, not just empirical, property.
  const up = buildMonotonicCandles(80, 1000, 2);
  const upRating = computeTechnicalRating(up);
  assert("technicalRating: uptrend MA group is unanimous buy", upRating.ma.buy === 8 && upRating.ma.sell === 0 && upRating.ma.neutral === 0, JSON.stringify(upRating.ma));
  assert("technicalRating: uptrend MA vote is strongBuy", upRating.ma.vote === "strongBuy", upRating.ma.vote);
  assert("technicalRating: uptrend overall lands in the buy family (buy/strongBuy)", upRating.overall === "buy" || upRating.overall === "strongBuy", upRating.overall);
  assert("technicalRating: uptrend MA periods 100/200 skipped, not fabricated (80 bars loaded)", upRating.ma.buy + upRating.ma.sell + upRating.ma.neutral === 8, `got ${upRating.ma.buy + upRating.ma.sell + upRating.ma.neutral}`);

  // Downtrend — the exact mirror.
  const down = buildMonotonicCandles(80, 1000, -2);
  const downRating = computeTechnicalRating(down);
  assert("technicalRating: downtrend MA group is unanimous sell", downRating.ma.buy === 0 && downRating.ma.sell === 8 && downRating.ma.neutral === 0, JSON.stringify(downRating.ma));
  assert("technicalRating: downtrend MA vote is strongSell", downRating.ma.vote === "strongSell", downRating.ma.vote);
  assert("technicalRating: downtrend overall lands in the sell family (sell/strongSell)", downRating.overall === "sell" || downRating.overall === "strongSell", downRating.overall);

  // Flat: 250 bars at a CONSTANT price — every SMA/EMA equals the close exactly (hand-provable: the moving
  // average of a constant series IS that constant), so the MA group is unanimous NEUTRAL across all 12
  // qualifying lines (250 bars covers all six periods including 100/200). `overall` combines this neutral-heavy
  // MA group with a (also neutral-heavy, empirically — most oscillators sit at their own defined "no signal"
  // midpoint on unchanging closes) oscillator group.
  const flat = buildConstantCandles(250, 1000);
  const flatRating = computeTechnicalRating(flat);
  assert("technicalRating: flat MA group is unanimous neutral", flatRating.ma.buy === 0 && flatRating.ma.sell === 0 && flatRating.ma.neutral === 12, JSON.stringify(flatRating.ma));
  assert("technicalRating: flat MA vote is neutral", flatRating.ma.vote === "neutral", flatRating.ma.vote);
  assert("technicalRating: flat overall is neutral", flatRating.overall === "neutral", flatRating.overall);
}

// ── Fixture 4: `computeIndicatorSignal` — 3 hand-verified per-indicator
// signal-state fixtures (the honesty-law dispatcher, not the rating gauge). ─

function checkIndicatorSignalFixtures(): void {
  // RSI(6) on a strictly monotonic 20-bar uptrend (closes 10..29, +1/bar): every price change is a GAIN, so
  // avgLoss is seeded at 0 and NEVER accumulates a loss again — `rsi = avgLoss===0 ? 100 : ...` fires on every
  // bar from the seed index onward. Exactly 100, not just "high" — hand-traced from the seeding rule itself
  // (`math.ts`'s own `rsi()` doc), same discipline as the maCross fixture above.
  const risingCloses = Array.from({ length: 20 }, (_, i) => 10 + i);
  const risingCandles = closesToCandles(risingCloses);
  const rsiSignal = computeIndicatorSignal("RSI", [6, 12, 24], risingCandles);
  assert("indicatorSignal: RSI(6) on a strict uptrend is exactly 100", rsiSignal.valueText.includes("RSI(6) 100.00"), rsiSignal.valueText);
  assert("indicatorSignal: RSI(6) on a strict uptrend is overbought", rsiSignal.state === "overbought", `${rsiSignal.state}`);

  // AROON(25) on a strictly monotonic 30-bar uptrend: with STRICTLY increasing high AND low, the rolling-window
  // "most recent bar with the highest high" is ALWAYS the current bar itself (barsSinceHigh=0 ⇒ up=100%), and
  // the "most recent bar with the lowest low" is ALWAYS the window's OLDEST bar (barsSinceLow=period ⇒ down=0%)
  // — hand-provable for ANY strictly monotonic series, not just this one, via the exact `>=`/`<=` comparison
  // order `math.ts`'s `aroon()` uses (see that function's own promoted-from-pack-b doc).
  const aroonCandles = closesToCandles(Array.from({ length: 30 }, (_, i) => 100 + i));
  const aroonSignal = computeIndicatorSignal("AROON", [25], aroonCandles);
  assert("indicatorSignal: AROON(25) on a strict uptrend is Up 100% / Down 0%", aroonSignal.valueText === "Up 100% · Down 0%", aroonSignal.valueText);
  assert("indicatorSignal: AROON(25) on a strict uptrend is bullish", aroonSignal.state === "bullish", `${aroonSignal.state}`);

  // BOLL(5,2) on a 6-bar spike fixture [10,10,10,10,10,100] — hand-computed exactly like the maCross fixture:
  // window[1..5]=[10,10,10,10,100], mean=140/5=28, population variance=(4×18² + 72²)/5=6480/5=1296, sd=√1296=36,
  // upper=28+2×36=100, lower=28-2×36=-44. The spike bar's close (100) sits EXACTLY at the upper band.
  const boomCandles = closesToCandles([10, 10, 10, 10, 10, 100]);
  const bollSignal = computeIndicatorSignal("BOLL", [5, 2], boomCandles);
  assert("indicatorSignal: BOLL(5,2) spike — mid/upper/lower hand-computed exactly", bollSignal.valueText === "Mid 28.00 · Upper 100.00 · Lower -44.00", bollSignal.valueText);
  assert("indicatorSignal: BOLL(5,2) spike close sits at/above the upper band — bullish", bollSignal.state === "bullish", `${bollSignal.state}`);
  assert("indicatorSignal: BOLL(5,2) spike stateText", bollSignal.stateText === "At/above upper band", `${bollSignal.stateText}`);
}

// ── Fixture 5: `computeTechnicalDetail` — founder-feedback pass (2026-08-06)
// "single source, no drift" regression guard. `computeTechnicalRating` and
// `computeTechnicalDetail` now read the SAME rule table's `evaluate()` calls
// (see `technicals.ts`'s module doc) — on the SAME candle series, the
// detail table's row tallies must exactly equal the rating's own group
// counts. Also verifies the "never fabricate" skip-with-honesty rule: a
// window too short for a period is reported `skipped`, never a signal. ────

function tallyRows(rows: readonly DetailRow[]): { buy: number; sell: number; neutral: number } {
  let buy = 0;
  let sell = 0;
  let neutral = 0;
  for (const row of rows) {
    if (row.skipped) continue;
    if (row.signal === "buy") buy++;
    else if (row.signal === "sell") sell++;
    else neutral++;
  }
  return { buy, sell, neutral };
}

function checkTechnicalDetailConsistency(): void {
  // Uptrend (80 bars) — same fixture `checkTechnicalRatingFixtures` already hand-verified above.
  const up = buildMonotonicCandles(80, 1000, 2);
  const upRating = computeTechnicalRating(up);
  const upDetail = computeTechnicalDetail(up);

  const upMaTally = tallyRows(upDetail.ma);
  assert(
    "technicalDetail: uptrend MA row tally matches rating.ma exactly (single source, no drift)",
    upMaTally.buy === upRating.ma.buy && upMaTally.sell === upRating.ma.sell && upMaTally.neutral === upRating.ma.neutral,
    JSON.stringify({ upMaTally, ratingMa: upRating.ma })
  );
  const upOscTally = tallyRows(upDetail.oscillators);
  assert(
    "technicalDetail: uptrend oscillator row tally matches rating.oscillators exactly",
    upOscTally.buy === upRating.oscillators.buy && upOscTally.sell === upRating.oscillators.sell && upOscTally.neutral === upRating.oscillators.neutral,
    JSON.stringify({ upOscTally, ratingOsc: upRating.oscillators })
  );

  // Skip-with-honesty: 80 bars loaded covers periods 10/20/30/50 but not 100/200 (SMA+EMA each -> 4 rows) —
  // those 4 rows must be reported `skipped`, never a fabricated signal.
  const skippedMaRows = upDetail.ma.filter((r) => r.skipped);
  assert("technicalDetail: MA(100)/MA(200) SMA+EMA (4 rows) are skipped at 80 bars, never fabricated", skippedMaRows.length === 4, `got ${skippedMaRows.length}`);
  assert(
    "technicalDetail: every skipped MA row's own minBars exceeds the loaded window",
    skippedMaRows.every((r) => r.skipped && r.minBars > 80),
    JSON.stringify(skippedMaRows)
  );
  assert("technicalDetail: evaluated + skipped MA rows total 12 (6 periods × SMA/EMA)", upDetail.ma.length === 12, `got ${upDetail.ma.length}`);
  assert("technicalDetail: oscillators group has all 11 TradingView rows", upDetail.oscillators.length === 11, `got ${upDetail.oscillators.length}`);

  // Every evaluated row (never a skipped one) carries a real, non-empty three-part reason.
  const evaluatedRows = [...upDetail.ma, ...upDetail.oscillators].filter((r) => !r.skipped);
  assert(
    "technicalDetail: every evaluated row has a non-empty reason.rule/reading/meaning",
    evaluatedRows.every((r) => !r.skipped && r.reason.rule.length > 0 && r.reason.reading.length > 0 && r.reason.meaning.length > 0),
    "some evaluated row has an empty reason field"
  );

  // Flat series (250 bars) — covers every MA period, zero skipped MA rows; cross-checked against the SAME
  // `checkTechnicalRatingFixtures` flat fixture's own unanimous-neutral assertion.
  const flat = buildConstantCandles(250, 1000);
  const flatDetail = computeTechnicalDetail(flat);
  const flatRating = computeTechnicalRating(flat);
  assert("technicalDetail: flat 250-bar series has zero skipped MA rows (all 6 periods covered)", flatDetail.ma.every((r) => !r.skipped), JSON.stringify(flatDetail.ma.filter((r) => r.skipped)));
  const flatMaTally = tallyRows(flatDetail.ma);
  assert(
    "technicalDetail: flat MA row tally matches rating.ma exactly",
    flatMaTally.buy === flatRating.ma.buy && flatMaTally.sell === flatRating.ma.sell && flatMaTally.neutral === flatRating.ma.neutral,
    JSON.stringify({ flatMaTally, ratingMa: flatRating.ma })
  );

  // Empty input — honest empty detail, matching computeTechnicalRating's own -1 sentinel.
  const emptyDetail = computeTechnicalDetail([]);
  assert("technicalDetail: empty candles -> computedAtIndex -1, empty rows", emptyDetail.computedAtIndex === -1 && emptyDetail.ma.length === 0 && emptyDetail.oscillators.length === 0);
}

// ── Fixture 6: `evaluateCustomSignal` — founder-feedback pass, the Custom
// section's drift guard. `CUSTOMIZABLE_RULES` re-parameterizes the SAME
// generic `evaluate*Rule()` functions `computeTechnicalDetail`'s own
// `OSCILLATOR_RULES`/`MA_RULES` call (see `technicals.ts`'s own "Custom
// section" doc note) — a custom instance built at a rule's OWN default
// params must therefore produce a `DetailRow` IDENTICAL, field for field, to
// that rule's standard row on the same candles. Also verifies the honesty
// law (a too-short window skips, never fabricates) and the defensive
// contract (unknown ruleId / out-of-range params never crash or corrupt). ──

function checkCustomSignalFixtures(): void {
  const up = buildMonotonicCandles(80, 1000, 2);
  const upDetail = computeTechnicalDetail(up);

  // RSI(14) at the rule's own default params must exactly equal the standard table's own RSI(14) row.
  const standardRsiRow = upDetail.oscillators.find((r) => r.id === "RSI");
  const customRsiRow = evaluateCustomSignal("RSI", [14], up);
  assert("customSignal: evaluateCustomSignal('RSI',[14]) returns a row", customRsiRow !== undefined, "got undefined");
  assert(
    "customSignal: evaluateCustomSignal('RSI',[14]) exactly equals the standard table's RSI(14) row",
    JSON.stringify(customRsiRow) === JSON.stringify(standardRsiRow),
    JSON.stringify({ customRsiRow, standardRsiRow })
  );

  // EMA(20) at its own default params must equal the standard table's own EMA(20) row on every field
  // EXCEPT `id` (same cross-check on the MA side, not just oscillators — `evaluateMaRule` is shared by
  // both call sites) — `id` legitimately differs by design: `MA_RULES`' per-period rows use `"EMA20"`
  // (one row per fixed period), while `CUSTOMIZABLE_RULES`' id is the family-level `"EMA"` (one entry,
  // any period) — see `evaluateCustomSignal`'s own doc for why `id` is deliberately rule-family-scoped,
  // not instance-scoped.
  const standardEma20Row = upDetail.ma.find((r) => r.id === "EMA20");
  const customEma20Row = evaluateCustomSignal("EMA", [20], up);
  assert(
    "customSignal: evaluateCustomSignal('EMA',[20]) matches the standard table's EMA(20) row on label/value/signal/reason",
    JSON.stringify({ ...customEma20Row, id: undefined }) === JSON.stringify({ ...standardEma20Row, id: undefined }),
    JSON.stringify({ customEma20Row, standardEma20Row })
  );

  // A non-default period genuinely changes the reading — RSI(20) must NOT equal RSI(14) on the same
  // candles (proves params actually flow through, not just default-only wiring), and the label/reading
  // text must carry the CUSTOM period, per the founder's own example ("RSI(20)... is 64.1").
  const rsi20Row = evaluateCustomSignal("RSI", [20], up);
  assert("customSignal: RSI(20) row exists", rsi20Row !== undefined && !rsi20Row.skipped, JSON.stringify(rsi20Row));
  assert("customSignal: RSI(20) label carries the custom period", rsi20Row?.label === "RSI(20)", rsi20Row?.label);
  if (rsi20Row && !rsi20Row.skipped) {
    assert("customSignal: RSI(20) reading text carries the custom period", rsi20Row.reason.reading.startsWith("RSI(20) is"), rsi20Row.reason.reading);
  }
  assert(
    "customSignal: RSI(20) is a genuinely different reading from RSI(14) on the same candles (params actually flow through)",
    JSON.stringify(rsi20Row) !== JSON.stringify(customRsiRow),
    "RSI(20) and RSI(14) produced identical rows — params likely not wired"
  );

  // Momentum(15) — the founder's own second named example — must exist, be evaluable, and carry its own period.
  const mtm15Row = evaluateCustomSignal("MTM", [15], up);
  assert("customSignal: Momentum(15) row exists and is evaluated (80 bars is well past its minBars)", mtm15Row !== undefined && !mtm15Row.skipped, JSON.stringify(mtm15Row));

  // Honesty law: a period that exceeds the loaded window must SKIP, never fabricate a signal.
  const rsi200Row = evaluateCustomSignal("RSI", [200], up); // only 80 bars loaded.
  assert("customSignal: RSI(200) on an 80-bar window is honestly skipped, never fabricated", rsi200Row?.skipped === true, JSON.stringify(rsi200Row));

  // Out-of-range params clamp defensively rather than crashing or reaching math.ts with a garbage period.
  const clampedRow = evaluateCustomSignal("RSI", [-5], up); // below RSI's declared min of 2.
  assert("customSignal: an out-of-range param is clamped, not passed through raw (no crash, a real row comes back)", clampedRow !== undefined, "threw or returned undefined");

  // Unknown ruleId (a stale localStorage entry from a since-removed rule) is dropped, not rendered broken.
  const unknownRow = evaluateCustomSignal("NOT_A_REAL_RULE", [14], up);
  assert("customSignal: an unknown ruleId returns undefined (dropped, not rendered broken)", unknownRow === undefined, JSON.stringify(unknownRow));

  // Empty candles: nothing honest to show yet.
  const emptyRow = evaluateCustomSignal("RSI", [14], []);
  assert("customSignal: empty candles returns undefined", emptyRow === undefined, JSON.stringify(emptyRow));

  // Catalog sanity: every id unique, every param spec has default within [min,max] (a self-inconsistent
  // catalog entry would silently clamp its OWN default, which should never happen).
  const ids = CUSTOMIZABLE_RULES.map((r) => r.id);
  assert("customSignal: CUSTOMIZABLE_RULES has 13 entries (SMA/EMA + 11 oscillator families)", ids.length === 13, `got ${ids.length}`);
  assert("customSignal: every CUSTOMIZABLE_RULES id is unique", new Set(ids).size === ids.length, JSON.stringify(ids));
  for (const def of CUSTOMIZABLE_RULES) {
    for (const spec of def.params) {
      assert(
        `customSignal: ${def.id}'s param '${spec.key}' default is within its own [min,max]`,
        spec.default >= spec.min && spec.default <= spec.max,
        JSON.stringify(spec)
      );
    }
  }
}

// ── Run everything ────────────────────────────────────────────────────────

const signals = checkMaCrossSignals();
checkBacktestCostCrossCheck(signals);
checkZeroSignalEdgeCase();
checkSingleOpenTradeEdgeCase();
checkQtyMinOneGuard();
checkThreeTradeKnownSeries();
checkNoLossSeries();
checkAnnualizedReturnPositiveCase();
checkDrawdownShapeDivergence();
checkFinalizeSignalsDropsLeadingSell();
checkTechnicalRatingFixtures();
checkIndicatorSignalFixtures();
checkTechnicalDetailConsistency();
checkCustomSignalFixtures();

// eslint-disable-next-line no-console

// ── combineRatingWithCustoms (founder 2026-08-04: customs join the FINAL rating) ──
function checkCombineRatingWithCustoms(): void {
  const up = buildMonotonicCandles(80, 100, 1);
  const rating = computeTechnicalRating(up);
  const noCustoms = combineRatingWithCustoms(rating, []);
  assert("combine: zero customs leaves overall identical", noCustoms.overall === rating.overall);
  assert("combine: zero customs zero tally", noCustoms.custom.buy === 0 && noCustoms.custom.sell === 0 && noCustoms.custom.neutral === 0);
  const twentySells = Array.from({ length: 20 }, () => "sell" as const);
  const withSells = combineRatingWithCustoms(rating, twentySells);
  assert("combine: custom tally counts sells", withSells.custom.sell === 20 && withSells.custom.vote === "strongSell");
  const rank = (r: string) => ["strongSell", "sell", "neutral", "buy", "strongBuy"].indexOf(r);
  assert("combine: 20 custom sells never raise the overall", rank(withSells.overall) <= rank(rating.overall));
}
checkCombineRatingWithCustoms();

// ── User Strategy Scripting (SS1) — lib/ta/user-scripts.ts fixtures ────────
// Node-runnable, zero Worker/DOM dependency (D1) — every function below is
// exercised directly via `runScriptSync`, the exact same seam
// `strategy-worker.ts` calls inside the real sandboxed Worker.

/** D1/D3 round-trip: a hand-written fixture script against the SAME `fixtureCandles` series this file already defines — asserts the resolved `StrategySignal[]` pulls `price`/`timestamp` from `fixtureCandles[2]`/`fixtureCandles[3]`, never from the script (which structurally CAN'T supply them — `RawScriptSignal` has no such fields at all). */
function checkUserScriptRoundTrip(): void {
  const script = `function run(bars, ta, helpers) { return [helpers.buy(2), helpers.sell(3)]; }`;
  const outcome = runScriptSync(script, fixtureCandles);
  assert("userScript: round-trip script runs ok", outcome.ok === true, JSON.stringify(outcome));
  if (!outcome.ok) return;
  assert("userScript: round-trip produces 2 raw signals", outcome.signals.length === 2, JSON.stringify(outcome.signals));

  const resolved = resolveSignalsAgainstBars(outcome.signals, fixtureCandles);
  assert("userScript: resolved signal count matches raw count", resolved.length === 2, JSON.stringify(resolved));
  const buy = resolved.find((s) => s.side === "BUY");
  const sell = resolved.find((s) => s.side === "SELL");
  assert(
    "userScript: BUY signal resolves price/timestamp from fixtureCandles[2], never from the script",
    !!buy && buy.price === fixtureCandles[2].close && buy.timestamp === fixtureCandles[2].timestamp,
    JSON.stringify(buy)
  );
  assert(
    "userScript: SELL signal resolves price/timestamp from fixtureCandles[3], never from the script",
    !!sell && sell.price === fixtureCandles[3].close && sell.timestamp === fixtureCandles[3].timestamp,
    JSON.stringify(sell)
  );
}

/** D6's `helpers.finalize` parity: a script that recomputes maCross[2,3]'s own SMA-cross logic BY HAND via `ta.sma`, then calls `helpers.finalize(raw)` — its output must match `maCross.compute()`'s real, `finalizeSignals()`-processed output (`maCrossSignals`, already independently validated by `checkMaCrossSignals`/`checkBacktestCostCrossCheck` above) exactly. Proves `helpers.finalize` is the REAL `finalizeSignals`, not a stub or a second hand-rolled dedup. */
function checkHelpersFinalizeParity(maCrossSignals: StrategySignal[]): void {
  const script = `
    function run(bars, ta, helpers) {
      var closes = helpers.closes(bars);
      var fast = ta.sma(closes, 2);
      var slow = ta.sma(closes, 3);
      var raw = [];
      for (var i = 0; i < bars.length; i++) {
        if (fast[i] === undefined || slow[i] === undefined) continue;
        if (fast[i] > slow[i]) raw.push(helpers.buy(i));
        else if (fast[i] < slow[i]) raw.push(helpers.sell(i));
      }
      return helpers.finalize(raw);
    }
  `;
  const outcome = runScriptSync(script, fixtureCandles);
  assert("userScript: helpers.finalize parity script runs ok", outcome.ok === true, JSON.stringify(outcome));
  if (!outcome.ok) return;

  const resolved = resolveSignalsAgainstBars(outcome.signals, fixtureCandles);
  const actualShape = resolved.map((s) => ({ index: s.index, side: s.side }));
  const expectedShape = maCrossSignals.map((s) => ({ index: s.index, side: s.side }));
  assert(
    "userScript: a script's own ta.sma cross logic + helpers.finalize() matches maCross.compute()'s real finalizeSignals()-processed output exactly",
    JSON.stringify(actualShape) === JSON.stringify(expectedShape),
    `actual=${JSON.stringify(actualShape)} expected=${JSON.stringify(expectedShape)}`
  );
}

/**
 * Denylist template smoke test — Node-side, explicitly NOT a live-browser
 * security proof (see SS3 for that). Two parts: (1) a structural check that
 * `buildWrappedSource`'s returned TEXT actually contains a lexical shadow
 * line for every `DENYLIST_KEYS` entry (proof the template didn't silently
 * drop the block); (2) a real (if Node-scoped, not the true Worker-level
 * global-object boundary) behavioral check — a script that logs `typeof`
 * four denylisted names must see `"undefined"` for all of them, because
 * `buildWrappedSource`'s lexical shadow layer applies inside Node's
 * `new Function` execution context exactly as it does inside a real Worker
 * — see `lib/ta/user-scripts.ts`'s own module doc for why this layer is
 * real-but-not-sufficient (a script reaching `globalThis.fetch` directly
 * would bypass it; that's what `strategy-worker.ts`'s REAL
 * `Object.defineProperty` pass against the true global object closes).
 */
function checkDenylistTemplateSmokeTest(): void {
  const wrapped = buildWrappedSource("function run(bars, ta, helpers) { return []; }");
  for (const key of DENYLIST_KEYS) {
    assert(`userScript: wrapped-source template textually contains a denylist shadow for '${key}'`, wrapped.includes(`const ${key} = undefined;`));
  }

  const script = `
    function run(bars, ta, helpers) {
      console.log(typeof fetch, typeof XMLHttpRequest, typeof WebSocket, typeof setTimeout);
      return [];
    }
  `;
  const outcome = runScriptSync(script, fixtureCandles);
  assert("userScript: denylist smoke-test script runs ok", outcome.ok === true, JSON.stringify(outcome));
  if (!outcome.ok) return;
  assert(
    "userScript: denylisted globals read as 'undefined' inside a script's own lexical scope",
    outcome.logs[0] === "undefined undefined undefined undefined",
    JSON.stringify(outcome.logs)
  );
}

/** D5's `WRAP_LINE_OFFSET` arithmetic — a deliberate syntax error on a KNOWN line (line 3 of the user's own source, below) must be corrected to exactly that line, never `3 + WRAP_LINE_OFFSET` or any other wrong value. Uses `acorn`'s direct parse of the raw user source (see `checkSyntax` in `lib/ta/user-scripts.ts`), which needs no `WRAP_LINE_OFFSET` arithmetic at all since it parses the user's text verbatim — this fixture proves that path end-to-end. */
function checkSyntaxErrorLineCorrection(): void {
  const script = ["function run(bars, ta, helpers) {", "  // deliberate syntax error on the next line", "  const x = ;", "  return [];", "}"].join("\n");
  const outcome = runScriptSync(script, fixtureCandles);
  assert("userScript: a syntax error resolves ok:false, never throws out of runScriptSync", outcome.ok === false, JSON.stringify(outcome));
  if (outcome.ok) return;
  assert("userScript: syntax error line is corrected to the user's own line 3, not a wrapped-text line", outcome.error.line === 3, JSON.stringify(outcome.error));
  assert("userScript: WRAP_LINE_OFFSET is a positive, non-hand-typed constant", Number.isInteger(WRAP_LINE_OFFSET) && WRAP_LINE_OFFSET > 0, String(WRAP_LINE_OFFSET));
}

/** D7: a script returning 25,000 raw signals must still resolve `ok: true`, TRUNCATED to exactly `USER_SCRIPT_MAX_SIGNALS` — never rejected outright (a `.max()`-style hard reject would make this a run FAILURE, contradicting D7's "ran successfully, just capped" contract). */
function checkSignalCapTruncation(): void {
  const manyBars = closesToCandles(Array.from({ length: 25_000 }, (_, i) => 100 + (i % 5)));
  const script = `
    function run(bars, ta, helpers) {
      var out = [];
      for (var i = 0; i < bars.length; i++) {
        out.push(helpers.buy(i));
      }
      return out;
    }
  `;
  const outcome = runScriptSync(script, manyBars);
  assert("userScript: a 25k-signal script still resolves ok:true (truncated, not rejected)", outcome.ok === true, outcome.ok ? "" : JSON.stringify(outcome.error));
  if (!outcome.ok) return;
  assert(
    `userScript: 25k raw signals truncated to exactly USER_SCRIPT_MAX_SIGNALS (${USER_SCRIPT_MAX_SIGNALS})`,
    outcome.signals.length === USER_SCRIPT_MAX_SIGNALS,
    `got ${outcome.signals.length}`
  );
  // SS3 — the cap-truncation honesty log line QA flagged in SS1: a
  // truncated run must say so, visibly, in the SAME logs array the console
  // strip renders.
  const expectedCapMessage = signalCapMessage(25_000, USER_SCRIPT_MAX_SIGNALS);
  assert(
    "userScript: a capped run appends the honest signal-cap message to logs",
    outcome.logs.includes(expectedCapMessage),
    JSON.stringify(outcome.logs)
  );

  const underCapOutcome = runScriptSync(
    `function run(bars, ta, helpers) { return [helpers.buy(0)]; }`,
    fixtureCandles
  );
  assert("userScript: a run under the cap resolves ok:true", underCapOutcome.ok === true, JSON.stringify(underCapOutcome));
  if (underCapOutcome.ok) {
    assert(
      "userScript: a run under the cap never appends the signal-cap message",
      !underCapOutcome.logs.some((line) => line.startsWith("Signal cap reached")),
      JSON.stringify(underCapOutcome.logs)
    );
  }
}

/** D8 honesty law: malformed `run()` return shapes (a bare string, `null`, a non-numeric `index`) must each resolve to a clean `ok: false` — NEVER a thrown exception escaping `runScriptSync` itself, and never a fabricated signal. */
function checkMalformedResultHonesty(): void {
  const notArrayOutcome = runScriptSync(`function run(bars, ta, helpers) { return "not an array"; }`, fixtureCandles);
  assert("userScript: a script returning a bare string resolves ok:false, never throws", notArrayOutcome.ok === false, JSON.stringify(notArrayOutcome));
  if (!notArrayOutcome.ok) {
    assert(
      "userScript: a script returning a bare string gets the documented invalid-result message",
      notArrayOutcome.error.message === INVALID_SCRIPT_RESULT_MESSAGE,
      notArrayOutcome.error.message
    );
  }

  const nullOutcome = runScriptSync(`function run(bars, ta, helpers) { return null; }`, fixtureCandles);
  assert("userScript: a script returning null resolves ok:false, never throws", nullOutcome.ok === false, JSON.stringify(nullOutcome));

  const badIndexOutcome = runScriptSync(`function run(bars, ta, helpers) { return [{ index: "not a number", side: "BUY" }]; }`, fixtureCandles);
  assert("userScript: an array with a non-numeric index resolves ok:false, never throws", badIndexOutcome.ok === false, JSON.stringify(badIndexOutcome));
}

/** D4: a script with no top-level `run` function must fail with the EXACT documented message, not a raw, unformatted `ReferenceError`. */
function checkMissingRunFunction(): void {
  const outcome = runScriptSync(`const notRun = function () { return []; };`, fixtureCandles);
  assert("userScript: a script with no top-level run() resolves ok:false", outcome.ok === false, JSON.stringify(outcome));
  if (outcome.ok) return;
  assert(
    "userScript: missing-run error carries the exact documented message, not a raw ReferenceError",
    outcome.error.message === MISSING_RUN_FUNCTION_MESSAGE,
    outcome.error.message
  );
}

/** D9: `SCRIPT_SENTINEL` (`"__pf_script__"`) must never collide with a real `STRATEGY_REGISTRY` key — the one correctness property `PF_SIGNALS`'s `calc()` branch dispatch (`calcParams[0] === SCRIPT_SENTINEL`) depends on to never misroute a template strategy into the script branch or vice versa. */
function checkScriptSentinelNeverCollidesWithStrategyRegistry(): void {
  assert(
    "userScript: SCRIPT_SENTINEL is never a STRATEGY_REGISTRY key (PF_SIGNALS calc() branch-dispatch safety)",
    !(SCRIPT_SENTINEL in STRATEGY_REGISTRY),
    SCRIPT_SENTINEL
  );
}

checkUserScriptRoundTrip();
checkHelpersFinalizeParity(signals);
checkDenylistTemplateSmokeTest();
checkSyntaxErrorLineCorrection();
checkSignalCapTruncation();
checkMalformedResultHonesty();
checkMissingRunFunction();
checkScriptSentinelNeverCollidesWithStrategyRegistry();

// ── Scripting SS2 — the 8 example scripts + parity fixtures (§5) ───────────
//
// The sprint's core honesty gate: each of the 7 template-rewrite example
// scripts must produce BYTE-IDENTICAL signals (index, side, price,
// timestamp) to its real STRATEGY_REGISTRY counterpart's compute(), on the
// SAME fixtureCandles series this file already defines above (reused
// deliberately, per the brief's own "single source of fixture truth"
// instruction — see example-scripts.ts's own module doc for the documented
// consequence: most of these 7 comparisons resolve to two EMPTY arrays
// under default params on only 10 bars, which is still a genuine
// regression guard, verified negatively during this sprint's own build by
// temporarily mutating one example script and confirming `ta:check` failed
// before reverting it).

function deepEqualStrategySignals(a: readonly StrategySignal[], b: readonly StrategySignal[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((s, i) => s.index === b[i].index && s.side === b[i].side && s.price === b[i].price && s.timestamp === b[i].timestamp);
}

function checkExampleScriptParity(): void {
  for (const id of Object.keys(STRATEGY_REGISTRY)) {
    const example = EXAMPLE_SCRIPTS.find((e) => e.id === id);
    if (!example) {
      assert(`exampleScripts: '${id}' has a matching example script in EXAMPLE_SCRIPTS`, false);
      continue;
    }
    const def = STRATEGY_REGISTRY[id];
    const outcome = runScriptSync(example.source, fixtureCandles);
    if (!outcome.ok) {
      assert(`exampleScripts: '${id}' example script runs without error`, false, outcome.error.message);
      continue;
    }
    const scriptSignals = resolveSignalsAgainstBars(outcome.signals, fixtureCandles);
    const templateSignals = def.compute(fixtureCandles, resolveStrategyParams(def, undefined));
    assert(
      `exampleScripts: '${id}' script signals match the real template's compute() output field-for-field (index/side/price/timestamp)`,
      deepEqualStrategySignals(scriptSignals, templateSignals),
      `script=${JSON.stringify(scriptSignals)} template=${JSON.stringify(templateSignals)}`
    );
  }
}

/**
 * A longer, genuinely oscillating synthetic series (a clean multi-cycle
 * sine wave, four full up/down swings over 160 bars) — deliberately NOT
 * `fixtureCandles` (the "reuse the exact series" instruction in the brief
 * is scoped to the 7 template-rewrite parity comparisons above, which diff
 * against a real template; the kitchen-sink script has no template to diff
 * against, and its own acceptance criterion explicitly needs "at least one
 * BUY and one SELL," which a 10-bar fixture under SMA20/RSI14/ATR14 cannot
 * produce — see example-scripts.ts's own module doc for the general
 * fixture-length issue). Amplitude/period hand-tuned (and verified via a
 * throwaway script, not guessed) so the SMA20/RSI14 crossover pattern the
 * kitchen-sink script looks for produces a clean alternating BUY-SELL-BUY-
 * SELL sequence after `helpers.finalize()`'s leading-SELL-drop rule, rather
 * than a run that happens to start (and get entirely dropped) on a SELL.
 */
function buildKitchenSinkFixture(count: number): StrategyCandle[] {
  const baseTs = Date.UTC(2026, 0, 1);
  const dayMs = 24 * 60 * 60 * 1000;
  const closes: number[] = [];
  for (let i = 0; i < count; i++) {
    closes.push(100 + Math.sin(i / 10) * 15);
  }
  return closes.map((c, i) => ({ timestamp: baseTs + i * dayMs, open: c, high: c + 1, low: c - 1, close: c, volume: 1000 }));
}

/** T6's kitchen-sink acceptance: runs cleanly and produces at least one BUY and one SELL — the Node half of that acceptance (the real-browser-worker half is the QA engineer's job, same "SS1 built the mechanism, live-browser QA proves it end-to-end" split every other Worker-dependent fixture in this file already follows). */
function checkKitchenSinkExample(): void {
  const example = EXAMPLE_SCRIPTS.find((e) => e.id === "kitchenSink");
  assert("exampleScripts: 'kitchenSink' exists in EXAMPLE_SCRIPTS", !!example);
  if (!example) return;

  const longCandles = buildKitchenSinkFixture(160);
  const outcome = runScriptSync(example.source, longCandles);
  assert("exampleScripts: kitchenSink runs without error", outcome.ok === true, outcome.ok ? undefined : outcome.error.message);
  if (!outcome.ok) return;

  const resolved = resolveSignalsAgainstBars(outcome.signals, longCandles);
  const hasBuy = resolved.some((s) => s.side === "BUY");
  const hasSell = resolved.some((s) => s.side === "SELL");
  assert("exampleScripts: kitchenSink produces at least one BUY and one SELL signal", hasBuy && hasSell, `signals=${JSON.stringify(resolved)}`);
}

checkExampleScriptParity();
checkKitchenSinkExample();

// ── Tool-values-gap-fixes brief (2026-08-04) — pure formula fixtures for
// the workbench overlay tools' new/corrected value labels. Only the PURE
// numeric/string functions are exercised here (imported straight from
// `overlays/figure-kit.ts`, which carries zero runtime klinecharts
// dependency — its only `klinecharts` import is `import type`, erased at
// compile time, so this Node process never touches the chart library) —
// the pixel-coordinate `createPointFigures` bodies themselves need real
// chart context and are QA'd in-browser instead, same split this file's
// own module doc already draws between `lib/ta/math.ts` and
// `overlays/figure-kit.ts`. ───────────────────────────────────────────────

/** T1.1 — `formatElapsedLabel`'s bucket-boundary convention, hand-verified at each edge (see the function's own doc for why the boundaries are placed where they are). */
function checkFormatElapsedLabel(): void {
  const HOUR = 60 * 60 * 1000;
  const DAY = 24 * HOUR;

  assert("formatElapsedLabel: 3 hours -> '3h'", formatElapsedLabel(3 * HOUR) === "3h", formatElapsedLabel(3 * HOUR));
  assert(
    "formatElapsedLabel: exactly 7 days -> '7d', not '1w' (our chosen boundary convention, deliberately asserted)",
    formatElapsedLabel(7 * DAY) === "7d",
    formatElapsedLabel(7 * DAY)
  );
  assert("formatElapsedLabel: 8 days crosses into the week bucket -> '1w'", formatElapsedLabel(8 * DAY) === "1w", formatElapsedLabel(8 * DAY));
  assert("formatElapsedLabel: 90 days (multi-month case) -> '3mo'", formatElapsedLabel(90 * DAY) === "3mo", formatElapsedLabel(90 * DAY));
  assert("formatElapsedLabel: ~800 days -> '2.2y' (800/365 = 2.1918.., one decimal)", formatElapsedLabel(800 * DAY) === "2.2y", formatElapsedLabel(800 * DAY));
  assert(
    "formatElapsedLabel: a nonzero 2-minute span never floors to '0h'",
    formatElapsedLabel(2 * 60 * 1000) === "1h",
    formatElapsedLabel(2 * 60 * 1000)
  );
  assert("formatElapsedLabel: a genuinely zero span is '0h'", formatElapsedLabel(0) === "0h", formatElapsedLabel(0));
}

/** T4.1 — `cypher`'s corrected ratio-base formula. Worked example from the CTO brief: X=100, A=150, B=130, C=180, D=140. XA=50, AB=20 -> B=20/50=0.400. BC=50 -> C=BC/AB=50/20=2.500 (the pre-fix bug would have wrongly computed BC/XA=50/50=1.000). XC=|180-100|=80, CD=|140-180|=40 -> D=CD/XC=40/80=0.500 (the pre-fix bug would have wrongly computed CD/XA=40/50=0.800). */
function checkComputeCypherRatios(): void {
  const ratios = computeCypherRatios([100, 150, 130, 180, 140]);
  assertClose("computeCypherRatios: B = AB/XA = 20/50 = 0.400", ratios.b, 0.4);
  assertClose("computeCypherRatios: C = BC/AB = 50/20 = 2.500 (fixed base leg — was wrongly BC/XA = 1.000)", ratios.c, 2.5);
  assertClose("computeCypherRatios: D = CD/XC = 40/80 = 0.500 (fixed base leg — was wrongly CD/XA = 0.800)", ratios.d, 0.5);
}

/** T4.2 — `threeDrives`'s per-leg-vs-preceding-leg ratio helper. 7-point worked example: [100(0), 150(A), 120(1), 160(B), 110(2), 170(C), 100(3)]. Legs: 0->A=50 (no ratio, no predecessor), A->1=30 (ratio 30/50=0.6), 1->B=40 (ratio 40/30), B->2=50 (ratio 50/40=1.25), 2->C=60 (ratio 60/50=1.2), C->3=70 (ratio 70/60). */
function checkComputeAdjacentLegRatios(): void {
  const ratios = computeAdjacentLegRatios([100, 150, 120, 160, 110, 170, 100]);
  assert("computeAdjacentLegRatios: exactly 5 ratios for a 7-point series (legs 2-6, first leg excluded)", ratios.length === 5, `got ${ratios.length}`);
  assertClose("computeAdjacentLegRatios: leg2 (A->1) = 30/50 = 0.6", ratios[0], 0.6);
  assertClose("computeAdjacentLegRatios: leg3 (1->B) = 40/30", ratios[1], 40 / 30);
  assertClose("computeAdjacentLegRatios: leg4 (B->2) = 50/40 = 1.25", ratios[2], 1.25);
  assertClose("computeAdjacentLegRatios: leg5 (2->C) = 60/50 = 1.2", ratios[3], 1.2);
  assertClose("computeAdjacentLegRatios: leg6 (C->3) = 70/60", ratios[4], 70 / 60);
}

/** T3.2/T3.3 — the shared Gann Square "Ranges And Ratio" corner label, exact string match (including the singular/plural "bar"/"bars" branch). */
function checkFormatGannRangeRatioLabel(): void {
  assert(
    "formatGannRangeRatioLabel: 10 bars, ₹250 range -> exact string, ratio 25.00/bar",
    formatGannRangeRatioLabel(10, 250) === "10 bars · ₹250 · ratio 25.00/bar",
    formatGannRangeRatioLabel(10, 250)
  );
  assert(
    "formatGannRangeRatioLabel: 1 bar uses the singular 'bar', not 'bars'",
    formatGannRangeRatioLabel(1, 42) === "1 bar · ₹42 · ratio 42.00/bar",
    formatGannRangeRatioLabel(1, 42)
  );
}

checkFormatElapsedLabel();
checkComputeCypherRatios();
checkComputeAdjacentLegRatios();
checkFormatGannRangeRatioLabel();

console.log(`ta:check — ${passCount} passed, ${failCount} failed.`);
if (failCount > 0) {
  process.exitCode = 1;
}
