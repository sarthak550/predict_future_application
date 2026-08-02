/**
 * Founder-feedback pass (2026-08-03) PART B — the Technicals Rating gauge
 * (TradingView's dial, honestly labeled: "Rule-based summary of standard
 * indicator readings on the loaded delayed bars — not a recommendation.").
 * A pure module (no klinecharts/DOM import), computed over the SAME candle
 * array the chart plots — same posture as `indicator-signals.ts`'s own
 * module doc.
 *
 * **Rule sources**: the MA-group rule (price vs. SMA/EMA at six fixed
 * periods) and every oscillator rule below are TradingView's own
 * PUBLICLY-DOCUMENTED "Technical Rating" indicator conventions — each rule
 * is cited to its own oscillator's formula source (mostly `lib/ta/math.ts`'s
 * already-verified functions; two — Bull/Bear Power, Ultimate Oscillator —
 * have no klinecharts built-in to verify against, so they're implemented
 * directly from their own well-known, standard formulas, cited inline).
 *
 * **Never fabricate**: the MA group's six periods `[10,20,30,50,100,200]`
 * are each SKIPPED (not counted, not defaulted to neutral) when
 * `candles.length` doesn't cover the period — a 40-bar-loaded chart votes
 * on `MA(10)`/`MA(20)`/`MA(30)` only, never a fabricated `MA(200)` reading
 * off 40 bars. Same discipline for MACD (excluded entirely, not neutral,
 * until both EMA legs are seeded) and every oscillator (excluded until its
 * own period requirement is met).
 *
 * **Aggregation — TradingView's own published methodology**: each
 * evaluated indicator casts one vote (`+1` buy, `-1` sell, `0` neutral);
 * a group's score is `(buyCount - sellCount) / totalEvaluated` (a signed
 * average in `[-1, 1]`, `totalEvaluated` = buy+sell+neutral, EXCLUDING any
 * skipped/insufficient-data indicators); bucketed exactly as TradingView's
 * own widget documents its thresholds: `score <= -0.5` Strong Sell,
 * `-0.5 < score <= -0.1` Sell, `-0.1 < score < 0.1` Neutral,
 * `0.1 <= score < 0.5` Buy, `score >= 0.5` Strong Buy. `overall` applies
 * the IDENTICAL formula to the MA group's and the Oscillators group's raw
 * counts summed together (not an average of the two groups' already-bucketed
 * ratings — TradingView's own widget also computes `overall` from combined
 * counts, not from combining the two dial positions).
 *
 * **Premium mode (`volume=0` pseudo-candles) — verified volume-free**: RSI,
 * Stochastic %K, CCI, ADX/DMI, AO, Momentum, MACD, StochRSI, Williams %R,
 * Bull/Bear Power, Ultimate Oscillator, and the MA group's SMA/EMA legs are
 * ALL computed from `high`/`low`/`close` only — none of the eleven
 * TradingView oscillator rules, and neither MA leg, reads `volume`
 * anywhere. Verified by reading every formula below (and their `math.ts`
 * sources) line-by-line, not assumed from the rule names — this gauge needs
 * NO premium-mode gate, unlike several chart indicators in
 * `indicator-registry.ts`'s `PREMIUM_DISABLED_NAMES`.
 */
import { sma, ema, rsi, macd, cci, dmi, awesomeOscillator, momentum, williamsR, stochasticOscillator, stochRsi } from "./math";
import type { StrategyCandle } from "./strategies";

export type Rating = "strongBuy" | "buy" | "neutral" | "sell" | "strongSell";

export interface RatingGroup {
  buy: number;
  sell: number;
  neutral: number;
  vote: Rating;
}

export interface TechnicalRating {
  ma: RatingGroup;
  oscillators: RatingGroup;
  overall: Rating;
  /** The bar index every rule was evaluated at (always `candles.length - 1`, or `-1` for an empty/degenerate input). */
  computedAtIndex: number;
}

const MA_PERIODS: readonly number[] = [10, 20, 30, 50, 100, 200];

type Vote = "buy" | "sell" | "neutral";

/** TradingView's own published `[-1,1]` signed-average bucketing — see module doc for the exact thresholds. */
function rateFromCounts(buy: number, sell: number, neutral: number): Rating {
  const total = buy + sell + neutral;
  if (total === 0) return "neutral";
  const score = (buy - sell) / total;
  if (score <= -0.5) return "strongSell";
  if (score <= -0.1) return "sell";
  if (score < 0.1) return "neutral";
  if (score < 0.5) return "buy";
  return "strongBuy";
}

function tally(votes: readonly Vote[]): RatingGroup {
  const buy = votes.filter((v) => v === "buy").length;
  const sell = votes.filter((v) => v === "sell").length;
  const neutral = votes.filter((v) => v === "neutral").length;
  return { buy, sell, neutral, vote: rateFromCounts(buy, sell, neutral) };
}

/**
 * Ultimate Oscillator(7,14,28) — Larry Williams' standard formula: buying
 * pressure `BP = close - min(low, prevClose)`, true range
 * `TR = max(high, prevClose) - min(low, prevClose)`,
 * `UO = 100 × (4×Avg7 + 2×Avg14 + Avg28) / 7` where `AvgN = ΣBP(N) / ΣTR(N)`.
 * No klinecharts built-in exists for this — implemented directly from the
 * standard, publicly-documented formula (not derived from any chart
 * indicator in this program).
 */
function ultimateOscillator(candles: readonly StrategyCandle[], p1: number, p2: number, p3: number): number | undefined {
  const maxPeriod = Math.max(p1, p2, p3);
  if (candles.length <= maxPeriod) return undefined;
  const bp: number[] = new Array(candles.length).fill(0);
  const tr: number[] = new Array(candles.length).fill(0);
  for (let i = 1; i < candles.length; i++) {
    const c = candles[i];
    const prevClose = candles[i - 1].close;
    bp[i] = c.close - Math.min(c.low, prevClose);
    tr[i] = Math.max(c.high, prevClose) - Math.min(c.low, prevClose);
  }
  const sumTail = (arr: readonly number[], period: number): number => arr.slice(arr.length - period).reduce((s, v) => s + v, 0);
  const avg = (period: number): number => {
    const trSum = sumTail(tr, period);
    return trSum !== 0 ? sumTail(bp, period) / trSum : 0;
  };
  return (100 * (4 * avg(p1) + 2 * avg(p2) + avg(p3))) / 7;
}

/**
 * Elder Ray Bull/Bear Power(13) — `bullPower = high - EMA(close,13)`,
 * `bearPower = low - EMA(close,13)`. Standard, publicly-documented formula
 * (Alexander Elder); no klinecharts built-in exists for this either.
 */
function bullBearPower(candles: readonly StrategyCandle[], period: number): { bull?: number; bear?: number }[] {
  const closes = candles.map((c) => c.close);
  const basis = ema(closes, period);
  return candles.map((c, i) => (basis[i] !== undefined ? { bull: c.high - basis[i]!, bear: c.low - basis[i]! } : {}));
}

export function computeTechnicalRating(candles: readonly StrategyCandle[]): TechnicalRating {
  if (candles.length === 0) {
    const empty = tally([]);
    return { ma: empty, oscillators: empty, overall: "neutral", computedAtIndex: -1 };
  }
  const closes = candles.map((c) => c.close);
  const lastIndex = candles.length - 1;
  const close = closes[lastIndex];

  // ── MA group — SMA and EMA at six fixed periods, price above/below vote,
  // periods the loaded window can't yet support are SKIPPED (see module doc). ──
  const maVotes: Vote[] = [];
  for (const period of MA_PERIODS) {
    if (candles.length < period) continue; // never fabricate a reading off fewer bars than the period needs.
    const smaValue = sma(closes, period)[lastIndex];
    const emaValue = ema(closes, period)[lastIndex];
    if (smaValue !== undefined) maVotes.push(close > smaValue ? "buy" : close < smaValue ? "sell" : "neutral");
    if (emaValue !== undefined) maVotes.push(close > emaValue ? "buy" : close < emaValue ? "sell" : "neutral");
  }

  // ── Oscillators group — TradingView's 11-indicator "Technical Rating" set. ──
  const oscVotes: Vote[] = [];

  // 1. RSI(14): <30 buy, >70 sell, else neutral.
  const rsiValue = rsi(closes, 14)[lastIndex];
  if (rsiValue !== undefined) oscVotes.push(rsiValue < 30 ? "buy" : rsiValue > 70 ? "sell" : "neutral");

  // 2. Stochastic %K(14,3,3): K<20 & K>D buy; K>80 & K<D sell; else neutral.
  const stoch = stochasticOscillator(candles, 14, 3, 3)[lastIndex];
  if (stoch?.k !== undefined && stoch?.d !== undefined) {
    oscVotes.push(stoch.k < 20 && stoch.k > stoch.d ? "buy" : stoch.k > 80 && stoch.k < stoch.d ? "sell" : "neutral");
  }

  // 3. CCI(20): <-100 buy, >100 sell, else neutral — deliberately simplified per the brief's own instruction
  //    (TradingView's real rule also requires the value to be rising/falling through the threshold; a bare
  //    threshold cross is used here instead, honestly, not silently).
  const cciValue = cci(candles, 20)[lastIndex];
  if (cciValue !== undefined) oscVotes.push(cciValue < -100 ? "buy" : cciValue > 100 ? "sell" : "neutral");

  // 4. ADX(14) + PDI/MDI: ADX>20 & PDI>MDI buy; ADX>20 & MDI>PDI sell; else neutral (includes ADX<=20, "no trend").
  //    `dmi()`'s second (`adxPeriod`) argument only affects its own `adxr` output, which this rule ignores — 14
  //    is passed for both since TradingView's own ADX(14) uses one shared period for DI and ADX smoothing.
  const dmiPoint = dmi(candles, 14, 14)[lastIndex];
  if (dmiPoint?.adx !== undefined && dmiPoint?.pdi !== undefined && dmiPoint?.mdi !== undefined) {
    const trending = dmiPoint.adx > 20;
    oscVotes.push(trending && dmiPoint.pdi > dmiPoint.mdi ? "buy" : trending && dmiPoint.mdi > dmiPoint.pdi ? "sell" : "neutral");
  }

  // 5. AO(5,34), saucer-simplified: above 0 & rising buy; below 0 & falling sell; else neutral. (The real "saucer"
  //    pattern needs a twin-peak shape check — simplified here to a single-bar rising/falling test, flagged.)
  const aoSeries = awesomeOscillator(candles, 5, 34);
  const aoNow = aoSeries[lastIndex];
  const aoPrev = lastIndex > 0 ? aoSeries[lastIndex - 1] : undefined;
  if (aoNow !== undefined && aoPrev !== undefined) {
    oscVotes.push(aoNow > 0 && aoNow > aoPrev ? "buy" : aoNow < 0 && aoNow < aoPrev ? "sell" : "neutral");
  }

  // 6. Momentum MTM(10): rising buy, falling sell, else neutral.
  const mtmSeries = momentum(closes, 10, 1);
  const mtmNow = mtmSeries[lastIndex]?.mtm;
  const mtmPrev = lastIndex > 0 ? mtmSeries[lastIndex - 1]?.mtm : undefined;
  if (mtmNow !== undefined && mtmPrev !== undefined) {
    oscVotes.push(mtmNow > mtmPrev ? "buy" : mtmNow < mtmPrev ? "sell" : "neutral");
  }

  // 7. MACD(12,26,9): DIF>DEA buy, else sell — the brief's own literal binary rule (no neutral tie state);
  //    excluded entirely (not counted) until both EMA legs and the signal line are seeded.
  const macdPoint = macd(closes, 12, 26, 9)[lastIndex];
  if (macdPoint?.dif !== undefined && macdPoint?.dea !== undefined) {
    oscVotes.push(macdPoint.dif > macdPoint.dea ? "buy" : "sell");
  }

  // 8. StochRSI(14): K<20 buy, K>80 sell, else neutral. Registry defaults for the stoch/K/D sub-params (14,3,3).
  const stochRsiPoint = stochRsi(closes, 14, 14, 3, 3)[lastIndex];
  if (stochRsiPoint?.k !== undefined) {
    oscVotes.push(stochRsiPoint.k < 20 ? "buy" : stochRsiPoint.k > 80 ? "sell" : "neutral");
  }

  // 9. Williams %R(14): <-80 buy, >-20 sell, else neutral.
  const wrValue = williamsR(candles, 14)[lastIndex];
  if (wrValue !== undefined) oscVotes.push(wrValue < -80 ? "buy" : wrValue > -20 ? "sell" : "neutral");

  // 10. Bull/Bear Power(13), simplified per the brief: bull>0 & rising buy; bear<0 & falling sell; else neutral
  //     (both/neither condition holding — a genuinely mixed read — also falls to neutral).
  const bbSeries = bullBearPower(candles, 13);
  const bbNow = bbSeries[lastIndex];
  const bbPrev = lastIndex > 0 ? bbSeries[lastIndex - 1] : undefined;
  if (bbNow?.bull !== undefined && bbNow?.bear !== undefined && bbPrev?.bull !== undefined && bbPrev?.bear !== undefined) {
    const bullSignal = bbNow.bull > 0 && bbNow.bull > bbPrev.bull;
    const bearSignal = bbNow.bear < 0 && bbNow.bear < bbPrev.bear;
    oscVotes.push(bullSignal && !bearSignal ? "buy" : bearSignal && !bullSignal ? "sell" : "neutral");
  }

  // 11. Ultimate Oscillator(7,14,28): <30 buy, >70 sell, else neutral.
  const uoValue = ultimateOscillator(candles, 7, 14, 28);
  if (uoValue !== undefined) oscVotes.push(uoValue < 30 ? "buy" : uoValue > 70 ? "sell" : "neutral");

  const ma = tally(maVotes);
  const oscillators = tally(oscVotes);
  const overall = rateFromCounts(ma.buy + oscillators.buy, ma.sell + oscillators.sell, ma.neutral + oscillators.neutral);

  return { ma, oscillators, overall, computedAtIndex: lastIndex };
}
