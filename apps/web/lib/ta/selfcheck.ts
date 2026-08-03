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

import { runBacktest, intervalToProductType, type BacktestTrade } from "./backtest";
import { maCross, finalizeSignals, type StrategyCandle, type StrategySignal } from "./strategies";
import { computeTechnicalRating, computeTechnicalDetail, evaluateCustomSignal, CUSTOMIZABLE_RULES, type DetailRow } from "./technicals";
import { computeIndicatorSignal } from "./indicator-signals";

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
  assertClose("1-BUY: netPnl is grossPnl minus entry costs only", trade?.netPnl ?? NaN, (110 - 100) * qty - entryCosts);

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
checkFinalizeSignalsDropsLeadingSell();
checkTechnicalRatingFixtures();
checkIndicatorSignalFixtures();
checkTechnicalDetailConsistency();
checkCustomSignalFixtures();

// eslint-disable-next-line no-console
console.log(`ta:check — ${passCount} passed, ${failCount} failed.`);
if (failCount > 0) {
  process.exitCode = 1;
}
