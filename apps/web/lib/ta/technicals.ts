/**
 * Founder-feedback pass (2026-08-03) PART B — the Technicals Rating gauge
 * (TradingView's dial, honestly labeled: "Rule-based summary of standard
 * indicator readings on the loaded delayed bars — not a recommendation.").
 * A pure module (no klinecharts/DOM import), computed over the SAME candle
 * array the chart plots — same posture as `indicator-signals.ts`'s own
 * module doc.
 *
 * **Founder-feedback pass (2026-08-06) — the Signals table + educational
 * reasons.** "runs all the indicators and generates signal based on all
 * indicators… if user hovers over that they should get a message that tells
 * the reason for that signal, as the purpose of paper trading is learning as
 * well." This pass REFACTORED the rating engine below onto a single,
 * explicit RULE TABLE (`MA_RULES`/`OSCILLATOR_RULES`) so `computeTechnicalRating`
 * (the dial's buy/sell/neutral TALLY) and the new `computeTechnicalDetail`
 * (the full per-indicator table, `signals-table.tsx`) read the EXACT SAME
 * per-indicator `evaluate()` call — one source of truth, no drift between
 * "how many are voting buy" and "which ones, and why." Verified by a new
 * `ta:check` fixture (`selfcheck.ts`'s `checkTechnicalDetailConsistency`):
 * on the same candle series, `computeTechnicalDetail`'s row tallies must
 * exactly equal `computeTechnicalRating`'s own group counts.
 *
 * Every evaluated row also carries a three-part, plain-language `reason`
 * (`rule` — the convention itself, e.g. "RSI convention: Buy below 30, Sell
 * above 70"; `reading` — this bar's actual number against that convention;
 * `meaning` — what the convention says that configuration is conventionally
 * read as, NEVER an instruction — no "you should", no advice verb, just a
 * description of the convention). `priceVsLineReason`/`obOsReason`/
 * `macdReason` below are exported specifically so `indicator-signals.ts`'s
 * active-strip chips can call the SAME reason-text builders for the
 * indicators that genuinely overlap this rating's own rule set (RSI, the
 * MA/EMA-family price-vs-line read, MACD) — see that module's own doc for
 * which chips share text here vs. which (SuperTrend, Ichimoku, bands, SAR,
 * VWAP, Aroon, ADX/DMI) have no equivalent in this 11-indicator TradingView
 * set and so write their own bespoke reasons locally.
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
 * own period requirement is met). `computeTechnicalDetail` makes this
 * EXPLICIT per row: a not-evaluated rule renders `skipped: true` with its
 * own documented `minBars` requirement ("needs N bars") — never a signal.
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
 * Stochastic Osc %K (Classic), CCI, ADX/DMI, AO, Momentum, MACD, StochRSI, Williams %R,
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

export type Vote = "buy" | "sell" | "neutral";

/** The three-part, honest, non-advisory reading — see module doc. */
export interface DetailReason {
  /** The convention itself — e.g. "RSI convention: Buy below 30, Sell above 70." Never bar-specific. */
  rule: string;
  /** This bar's actual number(s) against that convention — e.g. "RSI(14) is 72.40 — above the overbought line." */
  reading: string;
  /** What that configuration is conventionally read as — plain description, never an instruction ("you should…"). */
  meaning: string;
}

export type DetailRow =
  | { id: string; label: string; skipped: true; minBars: number; value: string }
  | { id: string; label: string; skipped: false; value: string; signal: Vote; reason: DetailReason };

export interface TechnicalDetail {
  ma: DetailRow[];
  oscillators: DetailRow[];
  computedAtIndex: number;
}

const MA_PERIODS: readonly number[] = [10, 20, 30, 50, 100, 200];

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

/**
 * Founder 2026-08-04: the FINAL signal includes the user's CUSTOM rows
 * alongside the standard MA + Oscillator groups. Pure combiner: takes the
 * standard rating plus the custom rows' signals and returns the custom
 * tally + a combined overall (same rateFromCounts bucketing over the summed
 * counts). Skipped custom rows (needs-N-bars) are excluded entirely — an
 * unevaluable rule never votes. With zero custom rows the overall is
 * byte-identical to the standard rating's own overall (fixture-guarded).
 */
export interface CombinedRating {
  custom: RatingGroup;
  overall: Rating;
}

export function combineRatingWithCustoms(
  rating: TechnicalRating,
  customSignals: ReadonlyArray<"buy" | "sell" | "neutral">
): CombinedRating {
  let buy = 0;
  let sell = 0;
  let neutral = 0;
  for (const sig of customSignals) {
    if (sig === "buy") buy++;
    else if (sig === "sell") sell++;
    else neutral++;
  }
  const custom = { buy, sell, neutral, vote: rateFromCounts(buy, sell, neutral) };
  const overall = rateFromCounts(
    rating.ma.buy + rating.oscillators.buy + buy,
    rating.ma.sell + rating.oscillators.sell + sell,
    rating.ma.neutral + rating.oscillators.neutral + neutral
  );
  return { custom, overall };
}

function tally(votes: readonly Vote[]): RatingGroup {
  const buy = votes.filter((v) => v === "buy").length;
  const sell = votes.filter((v) => v === "sell").length;
  const neutral = votes.filter((v) => v === "neutral").length;
  return { buy, sell, neutral, vote: rateFromCounts(buy, sell, neutral) };
}

function fmtNum(v: number | undefined, digits = 2): string {
  return v === undefined || !Number.isFinite(v) ? "—" : v.toFixed(digits);
}

// ── Shared, exported reason-text builders — see module doc for who reuses
// these (`indicator-signals.ts`'s overlapping chips) and why the underlying
// VOTE/state logic is deliberately NOT recomputed here (each caller passes
// its own already-determined zone/direction; only the WORDING is shared,
// so neither module's own boundary semantics can silently drift). ─────────

/** Price-vs-trend-line convention (MA/EMA/SMA/BBI/WMA/VWMA/HMA's shared read). `zone` is the caller's own already-computed relation. */
export function priceVsLineReason(label: string, close: number, line: number, zone: "above" | "below" | "at"): DetailReason {
  return {
    rule: "Moving-average convention: price trading above the line reads bullish; below it, bearish.",
    reading: `${label} is ${fmtNum(line)}; price (${fmtNum(close)}) is ${zone} it.`,
    meaning:
      zone === "above"
        ? "the price is trading above this trend-following line — conventionally read as an uptrend confirmation."
        : zone === "below"
          ? "the price is trading below this trend-following line — conventionally read as a downtrend confirmation."
          : "the price sits exactly on this trend-following line — no directional lean by this convention."
  };
}

/** Plain-threshold oversold/overbought convention (RSI/WR/CCI/StochRSI/KDJ/MFI's shared shape — a symmetric `<= oversold` / `>= overbought` pair). `zone` is the caller's own already-computed bucket. */
export function obOsReason(indicatorName: string, label: string, value: number, oversoldAt: number, overboughtAt: number, zone: "low" | "high" | "mid"): DetailReason {
  const os = fmtNum(oversoldAt, 0);
  const ob = fmtNum(overboughtAt, 0);
  return {
    rule: `${indicatorName} convention: Buy below ${os}, Sell above ${ob}.`,
    reading:
      zone === "low"
        ? `${label} is ${fmtNum(value)} — below the oversold line.`
        : zone === "high"
          ? `${label} is ${fmtNum(value)} — above the overbought line.`
          : `${label} is ${fmtNum(value)} — between the oversold and overbought lines.`,
    meaning:
      zone === "low"
        ? "price has fallen fast relative to its recent range; conventionally read as stretched momentum to the downside (oversold)."
        : zone === "high"
          ? "price has risen fast relative to its recent range; conventionally read as stretched momentum (overbought)."
          : "the reading sits inside its normal range — neither stretched up nor down by this convention."
  };
}

/** MACD's binary DIF-vs-DEA convention (no neutral state — see module doc). */
export function macdReason(dif: number, dea: number, zone: "above" | "below"): DetailReason {
  return {
    rule: "MACD convention: the DIF line above the DEA (signal) line reads bullish, below reads bearish — a binary rule with no neutral state.",
    reading: zone === "above" ? `DIF (${fmtNum(dif)}) is above DEA (${fmtNum(dea)}).` : `DIF (${fmtNum(dif)}) is below DEA (${fmtNum(dea)}).`,
    meaning:
      zone === "above"
        ? "the faster momentum average has moved above the slower signal average — conventionally read as a bullish crossover state."
        : "the faster momentum average has moved below the slower signal average — conventionally read as a bearish crossover state."
  };
}

// ── The rule table — ONE evaluate() per rule, called by BOTH
// computeTechnicalRating (tallies the vote) and computeTechnicalDetail
// (renders the row + reason) — see module doc, "single source, no drift." ──

interface RuleResult {
  vote: Vote;
  valueText: string;
  reason: DetailReason;
}

interface Rule {
  id: string;
  label: string;
  /** Documented, hand-derived from the formula's own warm-up (see each rule's own comment) — used ONLY for the "needs N bars" display text; the actual evaluated/skipped decision always comes from whether `evaluate()` itself returned a value, never from this number. */
  minBars: number;
  evaluate: (candles: readonly StrategyCandle[], closes: readonly number[]) => RuleResult | undefined;
}

// ── MA group — SMA and EMA at six fixed periods, price above/below vote. ──

function evaluateMaRule(candles: readonly StrategyCandle[], closes: readonly number[], period: number, kind: "SMA" | "EMA"): RuleResult | undefined {
  if (candles.length < period) return undefined; // never fabricate a reading off fewer bars than the period needs.
  const lastIndex = candles.length - 1;
  const close = closes[lastIndex];
  const line = (kind === "SMA" ? sma(closes, period) : ema(closes, period))[lastIndex];
  if (line === undefined) return undefined;
  const label = `${kind}(${period})`;
  const vote: Vote = close > line ? "buy" : close < line ? "sell" : "neutral";
  const zone = vote === "buy" ? "above" : vote === "sell" ? "below" : "at";
  return { vote, valueText: fmtNum(line), reason: priceVsLineReason(label, close, line, zone) };
}

const MA_RULES: readonly Rule[] = MA_PERIODS.flatMap((period) =>
  (["SMA", "EMA"] as const).map(
    (kind): Rule => ({
      id: `${kind}${period}`,
      label: `${kind}(${period})`,
      minBars: period,
      evaluate: (candles, closes) => evaluateMaRule(candles, closes, period, kind)
    })
  )
);

// ── Oscillators group — TradingView's 11-indicator "Technical Rating" set,
// each `minBars` hand-derived from its own `math.ts` warm-up (traced against
// the actual `i >= …` gates in each function, not guessed — see each
// comment below for the trace), same discipline as this program's other
// hand-verified fixtures.
//
// **Founder-feedback pass — the Custom section.** Every rule below is now
// a THIN WRAPPER around a generic, parameterizable `evaluate*Rule()`
// function that takes its period(s) as arguments instead of a hardcoded
// literal — `CUSTOMIZABLE_RULES` (further down this file) calls the EXACT
// SAME generic functions with user-chosen params. This is a
// zero-behavior-change refactor for every rule below (each wrapper passes
// the identical literal the old inline body used — confirmed by `ta:check`
// staying green on every existing assertion) — see `evaluateCustomSignal`'s
// own doc for why this "one evaluator, two callers" design is what makes a
// custom RSI(14) row PROVABLY identical to this rule's own RSI(14) row,
// not just "should be the same by convention." ───────────────────────────

/** RSI: Buy below 30, Sell above 70. `rsi()` seeds its first defined value at `i === period` (0-based) — `minBars = period + 1`. */
function evaluateRsiRule(closes: readonly number[], period: number): RuleResult | undefined {
  const lastIndex = closes.length - 1;
  const value = rsi(closes, period)[lastIndex];
  if (value === undefined) return undefined;
  const vote: Vote = value < 30 ? "buy" : value > 70 ? "sell" : "neutral";
  const zone = vote === "buy" ? "low" : vote === "sell" ? "high" : "mid";
  const label = `RSI(${period})`;
  return { vote, valueText: fmtNum(value), reason: obOsReason("RSI", label, value, 30, 70, zone) };
}

const RSI_RULE: Rule = { id: "RSI", label: "RSI(14)", minBars: 15, evaluate: (_candles, closes) => evaluateRsiRule(closes, 14) };

/**
 * Classic Stochastic Oscillator %K/%D: Buy K<20 & K>D; Sell K>80 & K<D.
 * `rawK` seeds at `i=period-1`; `kSmooth` needs `kSmooth` defined rawK
 * values; `dSmooth` needs `dSmooth` defined k values — `minBars = period +
 * kSmooth + dSmooth - 2` (14,3,3 -> 18, matching the original hand trace:
 * rawK first at 13, kSmooth first at 15, dSmooth first at 17, 0-based).
 *
 * **Naming audit (2026-08-04) — NOT the same math as the `KDJ` chart
 * indicator.** This calls `math.ts`'s `stochasticOscillator` (SMA-smoothed
 * %K then SMA-smoothed %D off that, no third line) — a DIFFERENT, older
 * formula from `stochasticKdj` (RSV + recursive weighted smoothing + a J
 * line, klinecharts' own native `KDJ`, verified against its `kdj.calc`
 * source). Both are legitimately called "Stochastic" in the wild; this
 * program disambiguates them explicitly rather than papering over the
 * difference — this rule's own label/rule text always say "Classic" and
 * never bare "Stochastic", `indicator-registry.ts`'s `KDJ` entry always
 * says "(KDJ)". See that entry's own doc comment for the third family
 * member (`STOCHRSI`, Stochastic applied to RSI instead of price).
 */
function evaluateStochRule(candles: readonly StrategyCandle[], period: number, kSmooth: number, dSmooth: number): RuleResult | undefined {
  const lastIndex = candles.length - 1;
  const point = stochasticOscillator(candles, period, kSmooth, dSmooth)[lastIndex];
  if (point?.k === undefined || point?.d === undefined) return undefined;
  const { k, d } = point;
  const vote: Vote = k < 20 && k > d ? "buy" : k > 80 && k < d ? "sell" : "neutral";
  return {
    vote,
    valueText: `K ${fmtNum(k)} · D ${fmtNum(d)}`,
    reason: {
      rule:
        "Classic Stochastic Oscillator convention (%K/%D — a different formula from the KDJ indicator on your chart): Buy when %K is below 20 and crosses above %D; Sell when %K is above 80 and crosses below %D.",
      reading:
        vote === "buy"
          ? `%K is ${fmtNum(k)}, below 20, and above %D (${fmtNum(d)}).`
          : vote === "sell"
            ? `%K is ${fmtNum(k)}, above 80, and below %D (${fmtNum(d)}).`
            : `%K is ${fmtNum(k)} and %D is ${fmtNum(d)} — outside the crossover condition.`,
      meaning:
        vote === "buy"
          ? "price has fallen to the bottom of its recent trading range and the faster line has just turned up through the slower one — conventionally read as an early rebound signal."
          : vote === "sell"
            ? "price has risen to the top of its recent trading range and the faster line has just turned down through the slower one — conventionally read as an early reversal signal."
            : "the fast/slow stochastic lines aren't in the specific oversold-crossing-up or overbought-crossing-down configuration this convention requires."
    }
  };
}

const STOCH_RULE: Rule = { id: "STOCH", label: "Stochastic Osc %K(14,3,3)", minBars: 18, evaluate: (candles) => evaluateStochRule(candles, 14, 3, 3) };

/** CCI: Buy below -100, Sell above 100 — deliberately simplified to a bare threshold cross (see rule text). `cci()` seeds at `i=period-1` — `minBars=period`. */
function evaluateCciRule(candles: readonly StrategyCandle[], period: number): RuleResult | undefined {
  const lastIndex = candles.length - 1;
  const value = cci(candles, period)[lastIndex];
  if (value === undefined) return undefined;
  const vote: Vote = value < -100 ? "buy" : value > 100 ? "sell" : "neutral";
  const zone = vote === "buy" ? "low" : vote === "sell" ? "high" : "mid";
  const label = `CCI(${period})`;
  const base = obOsReason("CCI", label, value, -100, 100, zone);
  return {
    vote,
    valueText: fmtNum(value),
    reason: { ...base, rule: `${base.rule} (Simplified to a bare threshold cross here — the fuller convention also checks the value rising/falling through the line.)` }
  };
}

const CCI_RULE: Rule = { id: "CCI", label: "CCI(20)", minBars: 20, evaluate: (candles) => evaluateCciRule(candles, 20) };

/** ADX+DI: trend established when ADX>20; Buy +DI>-DI, Sell -DI>+DI in that trend. `adx` seeds at `i = period*2-2` (0-based) — `minBars=period*2-1`. */
function evaluateAdxRule(candles: readonly StrategyCandle[], period: number): RuleResult | undefined {
  const lastIndex = candles.length - 1;
  const point = dmi(candles, period, period)[lastIndex];
  if (point?.adx === undefined || point?.pdi === undefined || point?.mdi === undefined) return undefined;
  const trending = point.adx > 20;
  const vote: Vote = trending && point.pdi > point.mdi ? "buy" : trending && point.mdi > point.pdi ? "sell" : "neutral";
  return {
    vote,
    valueText: `ADX ${fmtNum(point.adx)} · +DI ${fmtNum(point.pdi)} · -DI ${fmtNum(point.mdi)}`,
    reason: {
      rule: "ADX/DMI convention: a trend is considered established when ADX is above 20; Buy when +DI leads -DI in that trend, Sell when -DI leads +DI.",
      reading: !trending
        ? `ADX is ${fmtNum(point.adx)}, at or below the 20 trend threshold — no established trend to read a direction from.`
        : vote === "buy"
          ? `ADX is ${fmtNum(point.adx)} (trend established) and +DI (${fmtNum(point.pdi)}) is above -DI (${fmtNum(point.mdi)}).`
          : `ADX is ${fmtNum(point.adx)} (trend established) and -DI (${fmtNum(point.mdi)}) is above +DI (${fmtNum(point.pdi)}).`,
      meaning:
        vote === "buy"
          ? "directional buying pressure dominates within a confirmed trend — conventionally read as trend-following bullish."
          : vote === "sell"
            ? "directional selling pressure dominates within a confirmed trend — conventionally read as trend-following bearish."
            : "the trend-strength reading hasn't cleared the level this convention uses to call a trend 'established', so a directional read isn't considered reliable yet."
    }
  };
}

/** Naming audit (2026-08-04): `[DMI]` suffix names the chart indicator this rule's ADX/+DI/-DI lines actually come
 * from — `indicator-registry.ts`'s `DMI` entry, displayed as "DMI / ADX" — so a learner can find the plotted lines
 * behind this row's vote. */
const ADX_RULE: Rule = { id: "ADX", label: "ADX(14) [DMI]", minBars: 27, evaluate: (candles) => evaluateAdxRule(candles, 14) };

/** AO, saucer-simplified to a single-bar rising/falling test (see rule text). `awesomeOscillator` seeds at `i=maxPeriod-1`; the rule also needs the PREVIOUS bar defined — `minBars` uses `max(fast,slow)` as a documented, non-load-bearing display estimate (see `Rule.minBars` doc). */
function evaluateAoRule(candles: readonly StrategyCandle[], fastPeriod: number, slowPeriod: number): RuleResult | undefined {
  const lastIndex = candles.length - 1;
  const series = awesomeOscillator(candles, fastPeriod, slowPeriod);
  const now = series[lastIndex];
  const prev = lastIndex > 0 ? series[lastIndex - 1] : undefined;
  if (now === undefined || prev === undefined) return undefined;
  const vote: Vote = now > 0 && now > prev ? "buy" : now < 0 && now < prev ? "sell" : "neutral";
  return {
    vote,
    valueText: fmtNum(now),
    reason: {
      rule: "Awesome Oscillator convention (simplified here to a single-bar read): above zero and rising is read bullish; below zero and falling is read bearish.",
      reading:
        vote === "buy"
          ? `AO is ${fmtNum(now)}, above zero and higher than the previous bar (${fmtNum(prev)}).`
          : vote === "sell"
            ? `AO is ${fmtNum(now)}, below zero and lower than the previous bar (${fmtNum(prev)}).`
            : `AO is ${fmtNum(now)} — not in the rising-above-zero or falling-below-zero configuration.`,
      meaning:
        vote === "buy"
          ? "momentum measured over a short vs. long window is positive and building — conventionally read as bullish acceleration."
          : vote === "sell"
            ? "momentum measured over a short vs. long window is negative and building — conventionally read as bearish acceleration."
            : "momentum isn't clearly accelerating in either direction by this convention."
    }
  };
}

const AO_RULE: Rule = { id: "AO", label: "Awesome Oscillator(5,34)", minBars: 34, evaluate: (candles) => evaluateAoRule(candles, 5, 34) };

/** Momentum MTM: rising is read bullish, falling bearish. `momentum()` seeds `mtm` at `i=period`; the rule also needs the PREVIOUS bar's mtm — `minBars=period+2`. */
function evaluateMtmRule(closes: readonly number[], period: number): RuleResult | undefined {
  const lastIndex = closes.length - 1;
  const series = momentum(closes, period, 1);
  const now = series[lastIndex]?.mtm;
  const prev = lastIndex > 0 ? series[lastIndex - 1]?.mtm : undefined;
  if (now === undefined || prev === undefined) return undefined;
  const vote: Vote = now > prev ? "buy" : now < prev ? "sell" : "neutral";
  const label = `MTM(${period})`;
  return {
    vote,
    valueText: fmtNum(now),
    reason: {
      rule: "Momentum convention: a rising reading is read as bullish, a falling reading as bearish.",
      reading:
        vote === "buy"
          ? `${label} is ${fmtNum(now)}, above the previous bar's reading (${fmtNum(prev)}).`
          : vote === "sell"
            ? `${label} is ${fmtNum(now)}, below the previous bar's reading (${fmtNum(prev)}).`
            : `${label} is unchanged from the previous bar (${fmtNum(now)}).`,
      meaning:
        vote === "buy"
          ? "the pace of price change is increasing — conventionally read as strengthening upward momentum."
          : vote === "sell"
            ? "the pace of price change is decreasing — conventionally read as strengthening downward momentum."
            : "the pace of price change hasn't moved since the last bar."
    }
  };
}

const MTM_RULE: Rule = { id: "MTM", label: "Momentum(10)", minBars: 12, evaluate: (_candles, closes) => evaluateMtmRule(closes, 10) };

/** MACD: DIF>DEA buy, else sell (binary, no neutral). `dea` first seeds `signalPeriod` defined-dif bars after `dif` itself seeds at `i=slowPeriod-1` — `minBars=slowPeriod+signalPeriod-1`. */
function evaluateMacdRule(closes: readonly number[], fastPeriod: number, slowPeriod: number, signalPeriod: number): RuleResult | undefined {
  const lastIndex = closes.length - 1;
  const point = macd(closes, fastPeriod, slowPeriod, signalPeriod)[lastIndex];
  if (point?.dif === undefined || point?.dea === undefined) return undefined;
  const vote: Vote = point.dif > point.dea ? "buy" : "sell";
  return { vote, valueText: `DIF ${fmtNum(point.dif)} · DEA ${fmtNum(point.dea)}`, reason: macdReason(point.dif, point.dea, vote === "buy" ? "above" : "below") };
}

const MACD_RULE: Rule = { id: "MACD", label: "MACD(12,26,9)", minBars: 34, evaluate: (_candles, closes) => evaluateMacdRule(closes, 12, 26, 9) };

/** StochRSI: Buy K<20, Sell K>80. `minBars` kept as a documented, slightly conservative estimate (see the original hand trace this formula generalizes: `rsiPeriod+stochPeriod+kSmooth+1`, matching 14+14+3+1=32 exactly for the default params) — not load-bearing beyond the display text (see `Rule.minBars` doc). */
function evaluateStochRsiRule(closes: readonly number[], rsiPeriod: number, stochPeriod: number, kSmooth: number, dSmooth: number): RuleResult | undefined {
  const lastIndex = closes.length - 1;
  const point = stochRsi(closes, rsiPeriod, stochPeriod, kSmooth, dSmooth)[lastIndex];
  if (point?.k === undefined) return undefined;
  const k = point.k;
  const vote: Vote = k < 20 ? "buy" : k > 80 ? "sell" : "neutral";
  const zone = vote === "buy" ? "low" : vote === "sell" ? "high" : "mid";
  return { vote, valueText: `K ${fmtNum(k)}`, reason: obOsReason("Stochastic RSI", "K", k, 20, 80, zone) };
}

const STOCHRSI_RULE: Rule = { id: "STOCHRSI", label: "Stochastic RSI(14)", minBars: 32, evaluate: (_candles, closes) => evaluateStochRsiRule(closes, 14, 14, 3, 3) };

/** Williams %R: Buy below -80, Sell above -20. `williamsR()` seeds at `i=period-1` — `minBars=period`. */
function evaluateWrRule(candles: readonly StrategyCandle[], period: number): RuleResult | undefined {
  const lastIndex = candles.length - 1;
  const value = williamsR(candles, period)[lastIndex];
  if (value === undefined) return undefined;
  const vote: Vote = value < -80 ? "buy" : value > -20 ? "sell" : "neutral";
  const zone = vote === "buy" ? "low" : vote === "sell" ? "high" : "mid";
  const label = `WR(${period})`;
  return { vote, valueText: fmtNum(value), reason: obOsReason("Williams %R", label, value, -80, -20, zone) };
}

const WR_RULE: Rule = { id: "WR", label: "Williams %R(14)", minBars: 14, evaluate: (candles) => evaluateWrRule(candles, 14) };

/** Elder Ray Bull/Bear Power, simplified to a single-bar rising/falling test (see rule text). `ema(period)` seeds at `i=period-1`; the rule also needs the PREVIOUS bar — `minBars=period+1`. */
function evaluateBbpRule(candles: readonly StrategyCandle[], period: number): RuleResult | undefined {
  const lastIndex = candles.length - 1;
  const series = bullBearPower(candles, period);
  const now = series[lastIndex];
  const prev = lastIndex > 0 ? series[lastIndex - 1] : undefined;
  if (now?.bull === undefined || now?.bear === undefined || prev?.bull === undefined || prev?.bear === undefined) return undefined;
  const bullSignal = now.bull > 0 && now.bull > prev.bull;
  const bearSignal = now.bear < 0 && now.bear < prev.bear;
  const vote: Vote = bullSignal && !bearSignal ? "buy" : bearSignal && !bullSignal ? "sell" : "neutral";
  return {
    vote,
    valueText: `Bull ${fmtNum(now.bull)} · Bear ${fmtNum(now.bear)}`,
    reason: {
      rule: "Elder Ray convention (simplified here to a single-bar read): Bull Power above zero and rising is read bullish; Bear Power below zero and falling is read bearish.",
      reading:
        vote === "buy"
          ? `Bull Power is ${fmtNum(now.bull)}, above zero and higher than the previous bar (Bear Power ${fmtNum(now.bear)}).`
          : vote === "sell"
            ? `Bear Power is ${fmtNum(now.bear)}, below zero and lower than the previous bar (Bull Power ${fmtNum(now.bull)}).`
            : `Bull Power is ${fmtNum(now.bull)}, Bear Power is ${fmtNum(now.bear)} — neither is in its own rising/falling extreme.`,
      meaning:
        vote === "buy"
          ? "buyers are pushing highs further above the trend average and that pressure is building — conventionally read as bullish."
          : vote === "sell"
            ? "sellers are pushing lows further below the trend average and that pressure is building — conventionally read as bearish."
            : "neither buying nor selling pressure is building by this convention's specific test."
    }
  };
}

const BBP_RULE: Rule = { id: "BBP", label: "Bull/Bear Power(13)", minBars: 14, evaluate: (candles) => evaluateBbpRule(candles, 13) };

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

/** Ultimate Oscillator: Buy below 30, Sell above 70. `candles.length <= maxPeriod` is undefined — `minBars=max(p1,p2,p3)+1`. */
function evaluateUoRule(candles: readonly StrategyCandle[], p1: number, p2: number, p3: number): RuleResult | undefined {
  const value = ultimateOscillator(candles, p1, p2, p3);
  if (value === undefined) return undefined;
  const vote: Vote = value < 30 ? "buy" : value > 70 ? "sell" : "neutral";
  return {
    vote,
    valueText: fmtNum(value),
    reason: {
      rule: "Ultimate Oscillator convention: Buy below 30, Sell above 70.",
      reading: `UO is ${fmtNum(value)} — ${vote === "buy" ? "below 30" : vote === "sell" ? "above 70" : "between 30 and 70"}.`,
      meaning:
        vote === "buy"
          ? "a blend of short, medium and long-term buying/selling pressure is stretched to the downside — conventionally read as oversold."
          : vote === "sell"
            ? "a blend of short, medium and long-term buying/selling pressure is stretched to the upside — conventionally read as overbought."
            : "the blended buying/selling pressure reading sits within its normal range."
    }
  };
}

const UO_RULE: Rule = { id: "UO", label: "Ultimate Oscillator(7,14,28)", minBars: 29, evaluate: (candles) => evaluateUoRule(candles, 7, 14, 28) };

const OSCILLATOR_RULES: readonly Rule[] = [RSI_RULE, STOCH_RULE, CCI_RULE, ADX_RULE, AO_RULE, MTM_RULE, MACD_RULE, STOCHRSI_RULE, WR_RULE, BBP_RULE, UO_RULE];

export function computeTechnicalRating(candles: readonly StrategyCandle[]): TechnicalRating {
  if (candles.length === 0) {
    const empty = tally([]);
    return { ma: empty, oscillators: empty, overall: "neutral", computedAtIndex: -1 };
  }
  const closes = candles.map((c) => c.close);
  const maVotes = MA_RULES.map((r) => r.evaluate(candles, closes)?.vote).filter((v): v is Vote => v !== undefined);
  const oscVotes = OSCILLATOR_RULES.map((r) => r.evaluate(candles, closes)?.vote).filter((v): v is Vote => v !== undefined);

  const ma = tally(maVotes);
  const oscillators = tally(oscVotes);
  const overall = rateFromCounts(ma.buy + oscillators.buy, ma.sell + oscillators.sell, ma.neutral + oscillators.neutral);

  return { ma, oscillators, overall, computedAtIndex: candles.length - 1 };
}

/**
 * The full per-indicator table behind the gauge's tally — `signals-table.tsx`.
 * Calls the EXACT SAME `Rule.evaluate()` as `computeTechnicalRating` (see
 * module doc) — the row tallies below are therefore, by construction, always
 * identical to that function's own `ma`/`oscillators` counts on the same
 * candle series (verified by `ta:check`'s `checkTechnicalDetailConsistency`).
 */
export function computeTechnicalDetail(candles: readonly StrategyCandle[]): TechnicalDetail {
  if (candles.length === 0) return { ma: [], oscillators: [], computedAtIndex: -1 };
  const closes = candles.map((c) => c.close);

  function buildRows(rules: readonly Rule[]): DetailRow[] {
    return rules.map((rule) => {
      const result = rule.evaluate(candles, closes);
      if (!result) return { id: rule.id, label: rule.label, skipped: true, minBars: rule.minBars, value: `needs ${rule.minBars} bars` };
      return { id: rule.id, label: rule.label, skipped: false, value: result.valueText, signal: result.vote, reason: result.reason };
    });
  }

  return { ma: buildRows(MA_RULES), oscillators: buildRows(OSCILLATOR_RULES), computedAtIndex: candles.length - 1 };
}

// ─────────────────────────────────────────────────────────────────────────
// Custom section — founder ask: "custom strategy… a '+' button for user to
// build and customise the parameters and allowing to name these strategies
// — e.g. see what RSI(20) or Momentum(15) signals." Renders as a THIRD
// collapsible section in `signals-table.tsx`, below Moving Averages/
// Oscillators — deliberately NEVER feeding `computeTechnicalRating`'s dial
// (the rating stays pure standard-methodology; custom rows are purely
// informational, see that component's own doc for the exact UI copy this
// pass locks in).
//
// `CUSTOMIZABLE_RULES` re-parameterizes every rule above that takes a
// period/param set (every MA period and every one of the 11 TradingView
// oscillator rules) into a `CustomizableRuleDef` — each entry's `evaluate()`
// calls the EXACT SAME generic `evaluate*Rule()` function the fixed-default
// `Rule` above it calls (see the "Custom section" doc note on `OSCILLATOR_
// RULES`). A user's custom RSI(14) row and the standard table's own RSI(14)
// row are therefore PROVABLY identical, not independently re-derived —
// verified by `evaluateCustomSignal`'s own `ta:check` fixture:
// `evaluateCustomSignal("RSI", [14], candles)` must equal the standard
// table's own RSI(14) `DetailRow` exactly, field for field.
// ─────────────────────────────────────────────────────────────────────────

export interface CustomRuleParamSpec {
  key: string;
  label: string;
  default: number;
  min: number;
  max: number;
  step?: number;
}

export interface CustomizableRuleDef {
  /** Stable id, e.g. `"RSI"` — this is a custom row's own `DetailRow.id` AND the persisted `ruleId` in `pf.workbench.customSignals` (see `custom-signal-builder.tsx`'s own doc). */
  id: string;
  /** The rule family's display name, e.g. `"RSI"` — the builder's auto-generated instance name starts from `buildLabel(defaultParams)`, e.g. `"RSI(14)"`. */
  name: string;
  params: readonly CustomRuleParamSpec[];
  buildLabel: (params: readonly number[]) => string;
  evaluate: (candles: readonly StrategyCandle[], closes: readonly number[], params: readonly number[]) => RuleResult | undefined;
  /** Display-only estimate, same non-load-bearing posture as every `Rule.minBars` above (see that field's own doc) — the real skip decision always comes from `evaluate()` returning `undefined`, never from this number. */
  minBars: (params: readonly number[]) => number;
}

export const CUSTOMIZABLE_RULES: readonly CustomizableRuleDef[] = [
  {
    id: "SMA",
    name: "SMA",
    params: [{ key: "period", label: "Period", default: 20, min: 2, max: 400 }],
    buildLabel: ([period]) => `SMA(${period})`,
    evaluate: (candles, closes, [period]) => evaluateMaRule(candles, closes, period, "SMA"),
    minBars: ([period]) => period
  },
  {
    id: "EMA",
    name: "EMA",
    params: [{ key: "period", label: "Period", default: 20, min: 2, max: 400 }],
    buildLabel: ([period]) => `EMA(${period})`,
    evaluate: (candles, closes, [period]) => evaluateMaRule(candles, closes, period, "EMA"),
    minBars: ([period]) => period
  },
  {
    id: "RSI",
    name: "RSI",
    params: [{ key: "period", label: "Period", default: 14, min: 2, max: 100 }],
    buildLabel: ([period]) => `RSI(${period})`,
    evaluate: (_candles, closes, [period]) => evaluateRsiRule(closes, period),
    minBars: ([period]) => period + 1
  },
  {
    id: "STOCH",
    // Naming audit (2026-08-04): deliberately NOT bare "Stochastic" — this rule calls the CLASSIC %K/%D formula
    // (`evaluateStochRule` -> `math.ts`'s `stochasticOscillator`), a different formula from the chart's "Stochastic
    // (KDJ)" indicator (RSV + recursive weighted smoothing + a J line). Naming both bare "Stochastic" would let a
    // learner pick this thinking it reproduces the KDJ line on their chart — it doesn't. See `STOCH_RULE`'s own doc.
    name: "Stochastic Osc %K/%D (Classic)",
    // Param NAMES here follow the underlying `stochasticOscillator(candles, period, kSmooth, dSmooth)`
    // signature 1:1 (the %K length, then its own smoothing, then %D's smoothing) rather than the brief's
    // shorthand "(k,d,smooth)" literally — a documented, defensible reading of ambiguous terminology
    // (TradingView's own Stochastic settings panel uses this exact "%K Length / %K Smoothing / %D
    // Smoothing" trio), same posture as prior TA Suite passes' own ambiguous-terminology calls.
    params: [
      { key: "period", label: "%K Length", default: 14, min: 2, max: 100 },
      { key: "kSmooth", label: "%K Smoothing", default: 3, min: 1, max: 20 },
      { key: "dSmooth", label: "%D Smoothing", default: 3, min: 1, max: 20 }
    ],
    buildLabel: ([period, kSmooth, dSmooth]) => `Stochastic Osc %K(${period},${kSmooth},${dSmooth})`,
    evaluate: (candles, _closes, [period, kSmooth, dSmooth]) => evaluateStochRule(candles, period, kSmooth, dSmooth),
    minBars: ([period, kSmooth, dSmooth]) => period + kSmooth + dSmooth - 2
  },
  {
    id: "CCI",
    // Naming audit (2026-08-04): matches `indicator-registry.ts`'s `CCI` displayLabel exactly — no math difference
    // here (this rule and the chart indicator both read the same CCI formula), just decoding the acronym.
    name: "Commodity Channel (CCI)",
    params: [{ key: "period", label: "Period", default: 20, min: 2, max: 200 }],
    buildLabel: ([period]) => `CCI(${period})`,
    evaluate: (candles, _closes, [period]) => evaluateCciRule(candles, period),
    minBars: ([period]) => period
  },
  {
    id: "ADX",
    // Naming audit (2026-08-04): matches `indicator-registry.ts`'s `DMI` displayLabel ("DMI / ADX") — ADX/+DI/-DI
    // are lines WITHIN the chart's DMI indicator, not a separate indicator of their own; the name says so.
    name: "DMI / ADX",
    params: [{ key: "period", label: "Period", default: 14, min: 2, max: 100 }],
    buildLabel: ([period]) => `ADX(${period}) [DMI]`,
    evaluate: (candles, _closes, [period]) => evaluateAdxRule(candles, period),
    minBars: ([period]) => period * 2 - 1
  },
  {
    id: "AO",
    name: "Awesome Oscillator",
    params: [
      { key: "fast", label: "Fast period", default: 5, min: 2, max: 100 },
      { key: "slow", label: "Slow period", default: 34, min: 3, max: 200 }
    ],
    buildLabel: ([fast, slow]) => `Awesome Oscillator(${fast},${slow})`,
    evaluate: (candles, _closes, [fast, slow]) => evaluateAoRule(candles, fast, slow),
    minBars: ([fast, slow]) => Math.max(fast, slow) + 1
  },
  {
    id: "MTM",
    // Naming audit (2026-08-04): matches `indicator-registry.ts`'s `MTM` displayLabel exactly.
    name: "Momentum (MTM)",
    params: [{ key: "period", label: "Period", default: 10, min: 2, max: 200 }],
    buildLabel: ([period]) => `Momentum(${period})`,
    evaluate: (_candles, closes, [period]) => evaluateMtmRule(closes, period),
    minBars: ([period]) => period + 2
  },
  {
    id: "MACD",
    name: "MACD",
    params: [
      { key: "fast", label: "Fast period", default: 12, min: 2, max: 100 },
      { key: "slow", label: "Slow period", default: 26, min: 3, max: 200 },
      { key: "signal", label: "Signal period", default: 9, min: 1, max: 100 }
    ],
    buildLabel: ([fast, slow, signal]) => `MACD(${fast},${slow},${signal})`,
    evaluate: (_candles, closes, [fast, slow, signal]) => evaluateMacdRule(closes, fast, slow, signal),
    minBars: ([, slow, signal]) => slow + signal - 1
  },
  {
    id: "STOCHRSI",
    name: "Stochastic RSI",
    // TradingView's own default StochRSI applies ONE "length" to both the RSI and Stochastic lookback (K/D
    // smoothing stay fixed at 3) — a documented simplification of the underlying 4-param `stochRsi()` down
    // to the single customizable dimension the founder's own example ("RSI(20)") implies for every rule here.
    params: [{ key: "period", label: "Period", default: 14, min: 2, max: 100 }],
    buildLabel: ([period]) => `Stochastic RSI(${period})`,
    evaluate: (_candles, closes, [period]) => evaluateStochRsiRule(closes, period, period, 3, 3),
    minBars: ([period]) => period * 2 + 4
  },
  {
    id: "WR",
    // Naming audit (2026-08-04): matches `indicator-registry.ts`'s `WR` displayLabel exactly.
    name: "Williams %R (WR)",
    params: [{ key: "period", label: "Period", default: 14, min: 2, max: 100 }],
    buildLabel: ([period]) => `Williams %R(${period})`,
    evaluate: (candles, _closes, [period]) => evaluateWrRule(candles, period),
    minBars: ([period]) => period
  },
  {
    id: "BBP",
    name: "Bull/Bear Power",
    params: [{ key: "period", label: "Period", default: 13, min: 2, max: 100 }],
    buildLabel: ([period]) => `Bull/Bear Power(${period})`,
    evaluate: (candles, _closes, [period]) => evaluateBbpRule(candles, period),
    minBars: ([period]) => period + 1
  },
  {
    id: "UO",
    name: "Ultimate Oscillator",
    params: [
      { key: "a", label: "Short period", default: 7, min: 2, max: 100 },
      { key: "b", label: "Medium period", default: 14, min: 3, max: 200 },
      { key: "c", label: "Long period", default: 28, min: 4, max: 300 }
    ],
    buildLabel: ([a, b, c]) => `Ultimate Oscillator(${a},${b},${c})`,
    evaluate: (candles, _closes, [a, b, c]) => evaluateUoRule(candles, a, b, c),
    minBars: ([a, b, c]) => Math.max(a, b, c) + 1
  }
];

export function getCustomizableRule(id: string): CustomizableRuleDef | undefined {
  return CUSTOMIZABLE_RULES.find((r) => r.id === id);
}

export function defaultCustomRuleParams(def: CustomizableRuleDef): number[] {
  return def.params.map((p) => p.default);
}

/** Clamps a positional `number[]` (the on-disk `pf.workbench.customSignals` shape) to each spec's `[min,max]`, falling back to the spec's own default on a non-finite/missing value — same defensive posture as `strategies.ts`'s `clampStrategyParams`/`indicator-registry.ts`'s `clampParams`. */
export function clampCustomRuleParams(def: CustomizableRuleDef, values: readonly number[]): number[] {
  return def.params.map((spec, i) => {
    const raw = values[i];
    const value = Number.isFinite(raw) ? raw : spec.default;
    return Math.min(spec.max, Math.max(spec.min, value));
  });
}

/**
 * Evaluates ONE custom signal instance against the loaded candles, returning
 * the EXACT SAME `DetailRow` shape `computeTechnicalDetail`'s rows use —
 * `signals-table.tsx`'s Custom section renders these through the identical
 * `DetailRowLine`/`SignalReasonTrigger` path the standard rows already use,
 * no parallel rendering code. `id`/`label` are the RULE's own id/auto-label
 * (e.g. `"RSI"`/`"RSI(14)"`), not a particular user instance's — a user can
 * have TWO custom RSI rows with different periods; this function has no
 * notion of "instance", only "rule + params", by design.
 * `signals-table.tsx` substitutes the user's own instance name when
 * rendering (see `custom-signal-builder.tsx`'s `CustomSignalItem`).
 *
 * Params are clamped defensively (never trusts an out-of-range or malformed
 * localStorage value to reach a `math.ts` function). An unknown `ruleId`
 * (a stale localStorage entry from a since-removed rule) or an empty
 * `candles` array returns `undefined` — the caller (either the Custom
 * section, which has nothing honest to show yet, or the localStorage
 * loader, which drops the item) is responsible for handling that, same
 * "unknown ruleId dropped" contract `loadStoredCustomSignals` documents.
 */
export function evaluateCustomSignal(ruleId: string, params: readonly number[], candles: readonly StrategyCandle[]): DetailRow | undefined {
  const def = getCustomizableRule(ruleId);
  if (!def || candles.length === 0) return undefined;
  const clamped = clampCustomRuleParams(def, params);
  const closes = candles.map((c) => c.close);
  const label = def.buildLabel(clamped);
  const result = def.evaluate(candles, closes, clamped);
  if (!result) {
    const minBars = def.minBars(clamped);
    return { id: def.id, label, skipped: true, minBars, value: `needs ${minBars} bars` };
  }
  return { id: def.id, label, skipped: false, value: result.valueText, signal: result.vote, reason: result.reason };
}
