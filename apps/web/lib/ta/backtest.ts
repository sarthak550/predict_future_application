/**
 * TA Suite Sprint S3, T1/T4 — `runBacktest()`: long-only flip simulation
 * over a strategy's own `StrategySignal[]`, priced through the SAME audited
 * cost engine that prices every live paper order
 * (`packages/business-rules/src/papertrading/costs.ts`, imported READ-ONLY
 * — see the CEO brief's explicit "zero write access to business-rules"
 * scope line). This is the sprint's actual differentiator: every stat is
 * reported BOTH gross and net of real Indian transaction costs, not gross
 * only (the industry-standard, systematically-optimistic convention every
 * other backtest tool this founder has used follows).
 *
 * **Single-pass design** (deliberate, see the two-pointer equity-curve
 * reconstruction this file's first draft rejected): trades AND the
 * bar-by-bar net equity curve are built in ONE forward sweep over
 * `candles`, driven by a `bar-index → signal` lookup. Reconstructing the
 * equity curve in a SEPARATE pass over the already-built `trades[]` array
 * would require re-deriving "which trade, if any, was open at bar i" from
 * `entryIndex`/`exitIndex` ranges — a second, independent piece of logic
 * that could drift from the trade-construction loop's own bookkeeping.
 * Building both from the identical loop state guarantees they can never
 * disagree.
 *
 * **D7 cost mapping** (`intervalToProductType` below): `1d` → `DELIVERY`
 * (every SELL leg priced with `isFirstDeliverySellOfScripToday: true` — see
 * this module's own doc on why that simplification holds for a
 * single-instrument single-strategy backtest, not just asserted); any
 * intraday interval → `INTRADAY`. `runBacktest()` itself takes
 * `productType` directly (the caller, `strategy-panel.tsx`, resolves it via
 * `intervalToProductType(activeInterval)` — kept as two functions rather
 * than folding interval-awareness into `runBacktest` itself, so the pure
 * backtest math never needs to know what an "interval string" is).
 *
 * ── Metrics Engine extension (founder feedback: "the backtest run is not
 * very informative"; standing mandate: mirror TradingView's Strategy
 * Tester Performance Summary) ───────────────────────────────────────────
 *
 * Everything below `BacktestStats.tradesDetail` in the interface is
 * ADDITIVE — every field that existed before this extension keeps its
 * exact prior semantics and value (verified: `checkBacktestCostCrossCheck`
 * in `selfcheck.ts` still passes unmodified for every pre-existing
 * assertion). New fields follow ONE consistent sign law across the whole
 * module, stated once here instead of re-litigated per field:
 *
 *   THE SIGN LAW — every ₹ P&L figure keeps the natural sign of the money
 *   itself (a loss is a NEGATIVE number), exactly like the pre-existing
 *   `BacktestTrade.grossPnl`/`netPnl` already do. `grossLoss`/`netLoss`,
 *   `avgLossGross`/`avgLossNet`, and `largestLossGross`/`largestLossNet`
 *   are therefore all `≤ 0`. The ONLY values that flip to a positive
 *   magnitude are pure RATIOS that divide a loss into a win
 *   (`profitFactorGross`/`Net`, `avgWinLossRatioGross`/`Net`) — dividing
 *   two signed numbers of opposite sign would itself produce a negative
 *   ratio, which is not how any real trading platform (TradingView
 *   included) displays a profit factor. This is the same convention
 *   TradingView's own Performance Summary uses (Gross Loss / Avg Losing
 *   Trade / Largest Losing Trade all render negative; Profit Factor and
 *   the Avg Win/Loss ratio render positive).
 *
 *   "NULL, NEVER INFINITY/NaN" LAW — every new ratio or average that can
 *   divide by zero (no losses, no closed trades, a window too short to
 *   annualize) returns `null`, exactly matching the precedent
 *   `winRatePct` already set. `null` is asserted, never inferred — every
 *   such field is audited below and in `selfcheck.ts`'s fixtures.
 *
 *   OPEN-TRADE LAW — an at-most-one open-at-end position is marked to the
 *   last loaded bar's close (unchanged from the original spec). Every WIN/
 *   LOSS-CLASSIFIED aggregate (profit factor, expectancy, avg/largest win
 *   or loss, consecutive streaks, `grossWins`) is computed over CLOSED
 *   trades ONLY — the open trade's outcome isn't settled yet, exactly the
 *   precedent `wins`/`winRatePct` already set pre-extension. By contrast,
 *   `avgTradeGrossPnl`/`avgTradeNetPnl`, `totalBarsInTrades` (+ its
 *   derived avg/%-in-market), the equity curve, drawdown, run-up, and the
 *   annualized return all INCLUDE the open trade's mark-to-last-close
 *   contribution — these describe what actually happened to the account,
 *   not a settled-trade statistic. This split is deliberate and gives two
 *   genuinely different, both-useful numbers instead of one: on a fixture
 *   with NO open trade, `avgTradeNetPnl === expectancyNet` exactly (same
 *   closed set) — asserted directly in `selfcheck.ts` as a consistency
 *   invariant, not just documented.
 *
 * See each field's own doc comment for the metric-specific reasoning
 * (annualization's day-count convention and honesty threshold, MAE/MFE's
 * bar-exclusion rule, why drawdown/run-up have no "gross" variant, etc).
 */
import { computeOrderCosts, type PaperProductType } from "@predict-future/business-rules/papertrading/costs";

import type { StrategyCandle, StrategySignal } from "./strategies";

/** D7 — `1d` bars are priced as a DELIVERY trade (T+1 settlement, no same-day square-off); every other loaded interval (`1m`/`5m`/`15m`/`30m`/`60m`) is priced as INTRADAY. */
export function intervalToProductType(interval: string): PaperProductType {
  return interval === "1d" ? "DELIVERY" : "INTRADAY";
}

export interface BacktestTrade {
  entryIndex: number;
  entryTimestamp: number;
  entryPrice: number;
  /** `null` while the position is still open at the end of the loaded window (the "unrealised" chip case) — never a synthetic/placeholder index. */
  exitIndex: number | null;
  exitTimestamp: number | null;
  exitPrice: number | null;
  qty: number;
  /** Realized (closed trade) or unrealized-marked-to-last-close (open trade) — always a finite number, `(exit-or-lastClose - entry) * qty`. */
  grossPnl: number;
  /** `grossPnl` minus BOTH cost legs for a closed trade, or minus ONLY the entry leg's costs for an open trade (no exit-leg cost is ever charged on a position that was never actually closed — the plan's explicit backtest spec). */
  netPnl: number;
  entryCosts: number;
  /** `0` for an open (never-exited) trade. */
  exitCosts: number;
  isOpen: boolean;

  /** `entryCosts + exitCosts` — convenience sum so the UI never has to add these two itself. */
  totalCosts: number;
  /** `grossPnl ÷ (entryPrice × qty) × 100` — the trade's own % return on the capital it actually deployed (NOT ÷ notional — `qty = floor(notional/entryPrice)` means `entryPrice × qty` can be slightly less than notional). `0` in the (unreachable in practice) `entryPrice === 0` case, guarded defensively. */
  grossPnlPct: number;
  /** `netPnl ÷ (entryPrice × qty) × 100`, mirrors `grossPnlPct` net-side. */
  netPnlPct: number;
  /** Running NET equity immediately after this trade closes (or, for the still-open trade, marked to the last loaded bar's close) — `startingCapital + sum of netPnl of every trade up to and including this one`, in the SAME order as `tradesDetail`. Lets the UI plot a trade-indexed equity step chart without re-summing `tradesDetail` itself. Cross-checked in `selfcheck.ts`: the LAST trade's `cumulativeNetEquity` always equals `startingCapital + stats.netPnl` and the equity curve's final bar. */
  cumulativeNetEquity: number;
  /** `(exitIndex ?? lastCandleIndex) - entryIndex` — the number of bar-to-bar closing intervals the position was held. Both entry and exit fill AT their signal bar's close (the plan's existing convention), so the entry bar itself contributes zero held intervals; a trade that enters and exits one bar later has `barsHeld === 1`. `0` for a trade opened on the very last loaded bar (nothing has elapsed since entry yet). */
  barsHeld: number;
  /**
   * Maximum Adverse/Favorable Excursion — the worst paper loss / best paper
   * gain (magnitude in ₹, off `entryPrice × qty`) reached AT ANY POINT
   * during the holding window, using each bar's `high`/`low` (the honest
   * intrabar bound `close`-only P&L can't see). GROSS (pre-cost) by
   * construction — this is an unrealized bound the position passed
   * through, not an actual fill, so no transaction cost ever applies to
   * it. Scanned over bars `entryIndex+1 .. (exitIndex ?? lastCandleIndex)`
   * inclusive — the ENTRY bar's own high/low is deliberately excluded: the
   * fill happens at that bar's close, so the position was never exposed to
   * that bar's intrabar range before it existed. `0` when `barsHeld === 0`
   * (no bar has elapsed since entry — nothing to measure yet), floored at
   * `0` otherwise (a trade whose price only ever moved in its favor has a
   * `0` MAE, not a negative one).
   */
  mae: number;
  mfe: number;
  /** Same as `mae`/`mfe`, expressed as a % of `entryPrice` instead of ₹. */
  maePct: number;
  mfePct: number;
}

export interface BacktestStats {
  /** Total trades, closed + the at-most-one open-at-end trade (see `openAtEnd`). */
  trades: number;
  /** Wins are counted over CLOSED trades only (an open position's sign can still flip before it would ever close) — `winRatePct`'s own denominator matches. NET-classified (`netPnl > 0`) — see `grossWins` for the gross-side count. */
  wins: number;
  /** `null` when there are zero CLOSED trades — never `NaN`/`0` standing in for "undefined," per the product-gap acceptance criterion. */
  winRatePct: number | null;
  grossPnl: number;
  netPnl: number;
  /** Sum of every cost line (both legs, every trade incl. the open one's entry leg) — the ₹ figure the stats card's "costs" row shows. */
  totalCosts: number;
  grossReturnPct: number;
  netReturnPct: number;
  /** Computed over the NET (post-cost) equity curve, per the plan's explicit spec — see `buildNetEquityCurveAndTrades` below. `0` when there are zero bars or the curve never dips below its running peak (incl. the 0-signal case). */
  maxDrawdownPct: number;
  /** First-loaded-bar OPEN to last-loaded-bar CLOSE, computed directly from `candles` — deliberately independent of the strategy's own entry/exit prices (verified: this function never reads `trades`/`signals` at all). */
  buyHoldReturnPct: number;
  /** True iff the last trade is still open (unrealised) at the end of the loaded window. */
  openAtEnd: boolean;
  tradesDetail: BacktestTrade[];

  // ── Profitability, gross + net (CLOSED trades only — see module doc's
  // OPEN-TRADE LAW) ─────────────────────────────────────────────────────

  /** Sum of `grossPnl` over gross-winning CLOSED trades (`≥ 0`). */
  grossProfit: number;
  /** Sum of `grossPnl` over gross-losing CLOSED trades — SIGNED, `≤ 0` (see module doc's SIGN LAW). */
  grossLoss: number;
  /** Sum of `netPnl` over net-winning CLOSED trades (`≥ 0`). */
  netProfit: number;
  /** Sum of `netPnl` over net-losing CLOSED trades — SIGNED, `≤ 0`. */
  netLoss: number;
  /** `grossProfit ÷ |grossLoss|`. `null` when there are zero gross-losing closed trades (incl. zero closed trades at all) — NEVER `Infinity`. */
  profitFactorGross: number | null;
  /** `netProfit ÷ |netLoss|`, net-side mirror. `null` under the same zero-losses condition. */
  profitFactorNet: number | null;

  /**
   * Classic expectancy-per-trade formula (`winRate × avgWin − lossRate ×
   * |avgLoss|`), which reduces algebraically to the mean `grossPnl`/`netPnl`
   * over CLOSED trades only — "what do I expect to make on my next
   * COMPLETED trade, based on closed-trade history." `null` when there are
   * zero closed trades. Compare with `avgTradeGrossPnl`/`avgTradeNetPnl`
   * below, which is the same average but over ALL trades incl. the open
   * one — the two are asserted EQUAL in any fixture with no open-at-end
   * trade (same underlying set) and legitimately DIFFER when a trade is
   * still open (see module doc's OPEN-TRADE LAW).
   */
  expectancyGross: number | null;
  expectancyNet: number | null;
  /** Mean `grossPnl` over ALL trades in `tradesDetail` (closed + the at-most-one open one, marked to last close) — `null` when `trades === 0`. See `expectancyGross`'s own doc for how this differs from expectancy. */
  avgTradeGrossPnl: number | null;
  avgTradeNetPnl: number | null;

  /** Count of CLOSED trades with `grossPnl > 0` — the gross-side mirror of `wins` (which is net-classified). */
  grossWins: number;
  /** `grossWins ÷ closedTradeCount × 100`. `null` when there are zero closed trades — mirrors `winRatePct`. */
  grossWinRatePct: number | null;

  /** Mean `grossPnl` of gross-winning CLOSED trades (`≥ 0`). `null` when there are none. */
  avgWinGross: number | null;
  /** Mean `grossPnl` of gross-losing CLOSED trades — SIGNED, `≤ 0`. `null` when there are none. */
  avgLossGross: number | null;
  avgWinNet: number | null;
  avgLossNet: number | null;
  /** `|avgWinGross| ÷ |avgLossGross|`. `null` when there are zero gross-losing closed trades (`avgLossGross` is `null` or exactly `0`). */
  avgWinLossRatioGross: number | null;
  avgWinLossRatioNet: number | null;

  /** Highest `grossPnl` among gross-winning CLOSED trades. `null` when there are none. */
  largestWinGross: number | null;
  /** Lowest (most negative) `grossPnl` among gross-losing CLOSED trades — SIGNED, `≤ 0`. `null` when there are none. */
  largestLossGross: number | null;
  largestWinNet: number | null;
  largestLossNet: number | null;

  /** Longest run of consecutive NET-winning CLOSED trades in chronological order. `0` when there are zero closed trades. Streaks are NET-classified only (matching `wins`'s own convention) — a gross-side streak isn't separately tracked since "win or loss" streaks are fundamentally a single classification choice, not a money amount that needs a gross/net pair. */
  maxConsecutiveWins: number;
  maxConsecutiveLosses: number;

  // ── Time / exposure (ALL trades incl. the open one — see module doc's
  // OPEN-TRADE LAW) ─────────────────────────────────────────────────────

  /** Sum of `barsHeld` across every trade in `tradesDetail`. `0` when there are zero trades. */
  totalBarsInTrades: number;
  /** `totalBarsInTrades ÷ trades`. `null` when `trades === 0`. */
  avgBarsInTrades: number | null;
  /** `totalBarsInTrades ÷ (candles.length − 1) × 100` — % of the loaded window's bar-to-bar intervals during which a position was held. `null` when fewer than 2 candles are loaded (no interval to measure). Trades are non-overlapping by construction (long-only, single position — a new entry can only ever land strictly after the prior exit), so this sum can never double-count or exceed 100%. */
  pctTimeInMarket: number | null;

  // ── Drawdown / run-up ─────────────────────────────────────────────────

  /**
   * Max drawdown in ₹ — the largest (running-peak-equity − equity) gap
   * reached at any bar, tracked INDEPENDENTLY of `maxDrawdownPct` (which
   * tracks the largest *relative* gap). These two deliberately do NOT
   * always peak at the same bar: an early, small equity peak can produce a
   * large % dip that's small in ₹, while a later, much larger peak can
   * produce a small % dip that's large in ₹ — see `selfcheck.ts`'s
   * dedicated drawdown-shape fixture, which engineers exactly this
   * divergence and asserts the two maxima land on different bars.
   */
  maxDrawdownAmount: number;
  /** Mirror of max drawdown: the largest (equity − running-trough-equity) gain reached at any bar, in %. `0` when equity never rises off a new low (incl. the 0-signal case). */
  maxEquityRunUpPct: number;
  /** Same, in ₹. Neither run-up figure has a "gross" variant — see `maxDrawdownAmount`'s sibling note on why drawdown/run-up are net-only. */
  maxEquityRunUpAmount: number;

  // ── Annualized return ─────────────────────────────────────────────────

  /**
   * CAGR-style annualization of the WHOLE-WINDOW `grossReturnPct` /
   * `netReturnPct`: `(1 + returnPct/100) ^ (365.25 / spanDays) − 1`, where
   * `spanDays` is the ACTUAL ELAPSED CALENDAR TIME between the first and
   * last loaded bar's timestamps (`(lastTimestamp − firstTimestamp) /
   * 86,400,000`) — deliberately NOT bar count. "Annualized" is inherently
   * a calendar-time concept: a 252-trading-day year should compound against
   * ~365 elapsed calendar days, not 252 bars (bar count would silently
   * treat every loaded interval, `1m` through `1d`, as if it had the same
   * "year length," which is wrong for all of them). Day-count convention:
   * `365.25`, the standard actual/365.25 finance convention (accounts for
   * leap years).
   *
   * HONESTY GATE (the founder-named failure mode this ticket forbids —
   * "never extrapolate a 3-day backtest into a fake CAGR"): returns `null`,
   * never a number, when the loaded window spans under `90` calendar days.
   * Compounding a multi-day or few-week window into a "per year" figure
   * amplifies noise into something that reads far more confident than the
   * data supports; 90 days (~1 quarter) is the shortest span this module
   * considers honest to extrapolate from, and is asserted as a hard floor,
   * not a soft rounding choice. Also `null` when `1 + returnPct/100 ≤ 0`
   * (a ≥100% loss has no real CAGR — there's nothing to "recompound" from
   * a wipeout) or when fewer than 2 candles are loaded (no span at all).
   * In practice: the workbench's default `1d` window (5 years of daily
   * bars, per `chart-workbench.tsx`) comfortably clears this floor, so
   * daily-interval backtests annualize normally; short intraday windows
   * (a day or two of `1m`/`5m` bars) correctly and honestly return `null`.
   */
  annualizedReturnPctGross: number | null;
  annualizedReturnPctNet: number | null;

  /** Per-bar net equity curve, mark-to-market on EVERY bar's close (not just at trade exits — the open trade, if any, is marked to that bar's close, identical to the mechanism `equity[i]` already used pre-extension), plus a frictionless buy-and-hold overlay. See `EquityPoint`'s own field docs. */
  equityCurve: EquityPoint[];

  // ── Capital efficiency + margin usage (founder feedback: "capital
  // efficiency, margin usage… under real trading scenarios") ───────────────
  //
  // This engine is long-only, single-position (see the module's own
  // "single-pass design" note — at most one `openTrade` at any bar), so
  // "peak CONCURRENT position value" collapses to "the biggest single
  // trade's own deployed capital" — there is never a second position to sum
  // alongside it. Every ₹ figure here is on an ENTRY-BASIS (`entryPrice ×
  // qty`, the capital actually committed at the moment of entry), not a
  // mark-to-market current value — matching the product brief's own phrase
  // "position value at entry basis" and keeping this figure stable for the
  // life of the trade rather than wobbling bar-to-bar with price.

  /** The single biggest trade's own deployed capital (`entryPrice × qty`, entry-basis) across every trade in `tradesDetail` (closed + the at-most-one open one). `0` when there are zero trades. Because this engine only ever holds one position at a time, this is also literally "peak concurrent position value" — there is no second, simultaneously-open position to add to it. */
  peakDeployedCapital: number;
  /**
   * Bar-weighted average of "capital deployed at this bar" ÷ `notional`, over every loaded bar. A bar counts as
   * deployed (at its trade's own entry-basis value) from the bar a position is entered through the bar it exits
   * (or the last loaded bar, if still open) INCLUSIVE — the entry bar itself counts, since capital is committed
   * from that bar's close onward (a deliberately different bar-inclusion rule from `barsHeld`'s excursion-scan
   * convention, which excludes the entry bar for a different reason — see `computeExcursion`'s own doc). `null`
   * only when there are zero loaded candles (no window to average over at all) — `0` is a real, meaningful value
   * for a zero-trade run (genuinely no capital was ever deployed), not a stand-in for "undefined".
   */
  avgDeployedCapitalPct: number | null;
  /** `grossPnl ÷ peakDeployedCapital × 100` — "if you'd had to hold the single biggest trade's own capital in reserve the whole run, what return did that reserve earn." `null` when `peakDeployedCapital === 0` (zero trades — nothing was ever deployed, so a return ON it is undefined, not zero). */
  returnOnPeakCapitalPctGross: number | null;
  /** Net-of-costs mirror of `returnOnPeakCapitalPctGross`. */
  returnOnPeakCapitalPctNet: number | null;

  /**
   * Which margin rule was applied — see `MarginModel`'s own doc for the full honesty accounting. Set from the
   * caller's `productType` directly, independent of whether any trade actually happened (a 0-trade DELIVERY run
   * still reports `"DELIVERY_FULL_NOTIONAL"`).
   */
  marginModel: MarginModel;
  /** Bar-weighted average margin utilization, identical in magnitude to `avgDeployedCapitalPct` under BOTH of this engine's current margin models (see `MarginModel`'s doc for why) — kept as its OWN field, not a re-export, so a future real intraday-leverage model only needs to change this computation, not `avgDeployedCapitalPct`'s. Same `null`-only-when-zero-candles rule. */
  avgMarginUsedPct: number | null;
  /** Peak margin utilization, `peakDeployedCapital ÷ notional × 100`. `0` (not `null`) for a zero-trade run — see `avgDeployedCapitalPct`'s own note on why `0` is a real value there, not an "undefined" stand-in. */
  peakMarginUsedPct: number;
}

/**
 * Which margin rule `runBacktest` applied for a run's `productType` — see the module's own capital-efficiency
 * section doc for the surrounding context.
 *
 * `DELIVERY_FULL_NOTIONAL`: the REAL regulatory rule, not a limitation — Indian cash-delivery equity trades
 * require the full notional up front, zero leverage, by law. Margin genuinely equals deployed capital here.
 *
 * `INTRADAY_FULL_NOTIONAL_NO_LEVERAGE_MODEL`: an HONEST LIMITATION, not the real rule — a real Indian discount
 * broker offers intraday leverage (commonly ~4-5×, MTF/margin-trading-funding style), but
 * `packages/business-rules/src/papertrading/` has never modeled intraday margin or leverage anywhere in this
 * codebase (see `pendingOrders.ts`'s own comment: "Phase 1 never modeled margin for intraday shorting" — the
 * live paper-trading order-blocking path has the identical gap this backtest engine does). Per the product
 * brief's explicit instruction ("if the engine has NO intraday leverage model, DO NOT invent one — report margin
 * = full notional with an explicit disclosed limitation"), this engine reports intraday margin at full notional
 * too — identical in magnitude to the delivery case — rather than fabricating a leverage multiplier this
 * codebase has never verified against a real broker. This DELIBERATELY OVERSTATES real intraday margin
 * requirement; `INTRADAY_MARGIN_MODEL_DISCLAIMER` is the exact copy the UI must render alongside any intraday
 * margin figure so this limitation is disclosed, not silently passed off as precise.
 */
export type MarginModel = "DELIVERY_FULL_NOTIONAL" | "INTRADAY_FULL_NOTIONAL_NO_LEVERAGE_MODEL";

/** Exact UI copy for the disclosed limitation on `INTRADAY_FULL_NOTIONAL_NO_LEVERAGE_MODEL` — see that model's own doc for the full reasoning. Render this wherever intraday margin/capital-efficiency figures are shown; never render an intraday margin number without it. */
export const INTRADAY_MARGIN_MODEL_DISCLAIMER =
  "No intraday leverage/margin model exists in this simulator yet, so intraday margin is shown at full notional (no leverage applied) — the same as delivery. A real broker's intraday leverage (often 4-5×) would require meaningfully less margin than this. Delivery margin (full notional) is the actual regulatory rule, not a limitation.";

/**
 * One point on the backtest's equity curve — see `BacktestStats.equityCurve`.
 */
export interface EquityPoint {
  timestamp: number;
  /** Net-of-costs account equity, marked to THIS bar's close (starting capital + realized net P&L of every trade closed by this bar + unrealized net P&L of whichever trade, if any, is open at this bar). */
  equity: number;
  /** Drawdown from the running peak equity-to-date, in %. `0` at (or above) a new equity high. */
  drawdownPct: number;
  /** Same, in ₹. `maxDrawdownAmount === Math.max(...equityCurve.map(p => p.drawdownAmount))` by construction — both are produced by the same running-peak loop, not independently re-derived. */
  drawdownAmount: number;
  /** Frictionless buy-and-hold equity for the SAME starting capital: `notional × candles[i].close ÷ candles[0].open`. Deliberately cost-free and signal-independent, mirroring `buyHoldReturnPct`'s own existing convention (a single hypothetical buy at the window's first open, held throughout, never re-priced for transaction costs — the classic passive baseline every strategy is measured against, not a claim that real buy-and-hold investing is literally free). At the final bar, `buyHoldEquity === notional × (1 + buyHoldReturnPct/100)` exactly. */
  buyHoldEquity: number;
  /**
   * The "Ideal — no costs" mirror of `equity` — same mark-to-market mechanism (built in the SAME forward pass,
   * so it can never drift from `equity`), but with EVERY transaction cost zeroed out on both legs. At the final
   * bar, `grossEquity === notional × (1 + grossReturnPct/100)` exactly (same relationship `equity`'s own final
   * bar already has with `netReturnPct`). Added for the Strategy Results UI's Ideal/Real toggle (a chart needs a
   * cost-free SERIES to plot, not just the whole-window `grossPnl`/`grossReturnPct` scalars that already
   * existed) — deliberately does NOT get its own `maxDrawdownPct`/`maxEquityRunUpPct` aggregate pair in
   * `BacktestStats` (that law — "costs are real cash flows, so only the net equity curve is an actual economic
   * curve" — is unchanged and still governs the STATS contract); any drawdown/run-up shading drawn against this
   * series is a transient CHART computation the UI derives locally, not a persisted engine stat.
   */
  grossEquity: number;
}

export interface BacktestOptions {
  /** Notional capital per trade — NOT compounded across trades (every entry independently sizes `qty = floor(notional/entryPrice)`, matching a fixed-position-size backtest convention, not a compounding-equity one). Defaults to ₹1,00,000 per the plan. */
  notional?: number;
  productType: PaperProductType;
}

/** First-open to last-close, computed straight from `candles` — see `BacktestStats.buyHoldReturnPct`'s own doc for why this must never touch `signals`/`trades`. */
function computeBuyHoldReturnPct(candles: readonly StrategyCandle[]): number {
  if (candles.length === 0) return 0;
  const firstOpen = candles[0].open;
  const lastClose = candles[candles.length - 1].close;
  if (!Number.isFinite(firstOpen) || firstOpen === 0) return 0;
  return ((lastClose - firstOpen) / firstOpen) * 100;
}

/**
 * Single forward pass over the already-built net `equity[]` array (see this
 * module's own "single-pass design" doc — this is a downstream O(bars)
 * DERIVATION from that one array, not a second independent reconstruction
 * of it) that produces the full `EquityPoint[]` curve AND the four
 * aggregate drawdown/run-up figures in one sweep: a running PEAK (for
 * drawdown, mirrors the pre-extension `computeMaxDrawdownPct` exactly —
 * verified algebraically identical, just also emitting the ₹ amount
 * alongside the existing %) and a running TROUGH (for run-up, the mirror-
 * image computation: largest gain off a running low instead of largest dip
 * off a running high).
 */
function buildEquityCurve(
  candles: readonly StrategyCandle[],
  equity: readonly number[],
  equityGross: readonly number[],
  startingCapital: number
): {
  points: EquityPoint[];
  maxDrawdownPct: number;
  maxDrawdownAmount: number;
  maxEquityRunUpPct: number;
  maxEquityRunUpAmount: number;
} {
  const points: EquityPoint[] = new Array(candles.length);
  const firstOpen = candles.length > 0 ? candles[0].open : 0;
  const firstOpenValid = Number.isFinite(firstOpen) && firstOpen !== 0;

  let peak = startingCapital;
  let trough = startingCapital;
  let maxDrawdownPct = 0;
  let maxDrawdownAmount = 0;
  let maxEquityRunUpPct = 0;
  let maxEquityRunUpAmount = 0;

  for (let i = 0; i < candles.length; i++) {
    const e = equity[i];

    if (e > peak) peak = e;
    const drawdownAmount = peak - e;
    if (drawdownAmount > maxDrawdownAmount) maxDrawdownAmount = drawdownAmount;
    const drawdownPct = peak > 0 ? (drawdownAmount / peak) * 100 : 0;
    if (drawdownPct > maxDrawdownPct) maxDrawdownPct = drawdownPct;

    if (e < trough) trough = e;
    const runUpAmount = e - trough;
    if (runUpAmount > maxEquityRunUpAmount) maxEquityRunUpAmount = runUpAmount;
    const runUpPct = trough > 0 ? (runUpAmount / trough) * 100 : 0;
    if (runUpPct > maxEquityRunUpPct) maxEquityRunUpPct = runUpPct;

    const buyHoldEquity = firstOpenValid ? (startingCapital * candles[i].close) / firstOpen : startingCapital;

    points[i] = { timestamp: candles[i].timestamp, equity: e, drawdownPct, drawdownAmount, buyHoldEquity, grossEquity: equityGross[i] };
  }

  return { points, maxDrawdownPct, maxDrawdownAmount, maxEquityRunUpPct, maxEquityRunUpAmount };
}

const ANNUALIZATION_MIN_SPAN_DAYS = 90;
const DAYS_PER_YEAR = 365.25;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** See `BacktestStats.annualizedReturnPctGross`/`Net`'s own doc for the full convention and honesty gate — this is the shared implementation both feed through, so the gross and net sides can never apply different rules. */
function computeAnnualizedReturnPct(returnPct: number, firstTimestamp: number, lastTimestamp: number): number | null {
  const spanDays = (lastTimestamp - firstTimestamp) / MS_PER_DAY;
  if (!Number.isFinite(spanDays) || spanDays < ANNUALIZATION_MIN_SPAN_DAYS) return null;
  const base = 1 + returnPct / 100;
  if (base <= 0) return null;
  const annualized = (Math.pow(base, DAYS_PER_YEAR / spanDays) - 1) * 100;
  return Number.isFinite(annualized) ? annualized : null;
}

/**
 * MAE/MFE for one trade — see `BacktestTrade.mae`/`mfe`'s own doc for the
 * bar-exclusion rule. Returns PER-SHARE magnitudes + %; the caller
 * multiplies by `qty` for the money-denominated fields.
 */
function computeExcursion(
  candles: readonly StrategyCandle[],
  entryIndex: number,
  throughIndex: number,
  entryPrice: number
): { maePerShare: number; mfePerShare: number; maePct: number; mfePct: number } {
  let minLow = Infinity;
  let maxHigh = -Infinity;
  for (let i = entryIndex + 1; i <= throughIndex; i++) {
    if (candles[i].low < minLow) minLow = candles[i].low;
    if (candles[i].high > maxHigh) maxHigh = candles[i].high;
  }
  if (!Number.isFinite(minLow) || !Number.isFinite(maxHigh)) {
    // No bar has elapsed since entry yet (throughIndex === entryIndex) — nothing to measure.
    return { maePerShare: 0, mfePerShare: 0, maePct: 0, mfePct: 0 };
  }
  const maePerShare = Math.max(0, entryPrice - minLow);
  const mfePerShare = Math.max(0, maxHigh - entryPrice);
  const maePct = entryPrice > 0 ? (maePerShare / entryPrice) * 100 : 0;
  const mfePct = entryPrice > 0 ? (mfePerShare / entryPrice) * 100 : 0;
  return { maePerShare, mfePerShare, maePct, mfePct };
}

/** Longest run of consecutive NET-winning / NET-losing CLOSED trades, in the chronological order `closedTrades` is already in. See `BacktestStats.maxConsecutiveWins`'s own doc for why this is net-only. */
function computeMaxConsecutive(closedTrades: readonly Pick<BacktestTrade, "netPnl">[]): { maxConsecutiveWins: number; maxConsecutiveLosses: number } {
  let maxWins = 0;
  let maxLosses = 0;
  let curWins = 0;
  let curLosses = 0;
  for (const t of closedTrades) {
    if (t.netPnl > 0) {
      curWins += 1;
      curLosses = 0;
      if (curWins > maxWins) maxWins = curWins;
    } else {
      curLosses += 1;
      curWins = 0;
      if (curLosses > maxLosses) maxLosses = curLosses;
    }
  }
  return { maxConsecutiveWins: maxWins, maxConsecutiveLosses: maxLosses };
}

/**
 * Win/loss aggregate stats over a set of CLOSED trades, generic over WHICH
 * P&L field to classify on via `pnlOf` — the ONE implementation both the
 * gross and net call sites route through, so gross/net logic can never
 * silently drift apart (same "one shared function, not two hand-rolled
 * copies" principle `strategies.ts`'s own `finalizeSignals` already
 * established for this codebase). See module doc's SIGN LAW for why `loss`/
 * `avgLoss`/`largestLoss` stay signed (`≤ 0`) while `profitFactor`/
 * `avgWinLossRatio` are positive magnitudes.
 */
function computeProfitLossAggregates(
  closedTrades: readonly BacktestTrade[],
  pnlOf: (t: BacktestTrade) => number
): {
  profit: number;
  loss: number;
  winCount: number;
  avgWin: number | null;
  avgLoss: number | null;
  avgWinLossRatio: number | null;
  profitFactor: number | null;
  largestWin: number | null;
  largestLoss: number | null;
} {
  let profit = 0;
  let loss = 0; // signed, sum of every non-positive pnl
  let winCount = 0;
  let winSum = 0;
  let lossCount = 0;
  let lossSum = 0; // signed
  let largestWin: number | null = null;
  let largestLoss: number | null = null; // signed, the most negative

  for (const t of closedTrades) {
    const pnl = pnlOf(t);
    if (pnl > 0) {
      profit += pnl;
      winCount += 1;
      winSum += pnl;
      largestWin = largestWin === null ? pnl : Math.max(largestWin, pnl);
    } else {
      loss += pnl;
      lossCount += 1;
      lossSum += pnl;
      largestLoss = largestLoss === null ? pnl : Math.min(largestLoss, pnl);
    }
  }

  const avgWin = winCount > 0 ? winSum / winCount : null;
  const avgLoss = lossCount > 0 ? lossSum / lossCount : null;
  const profitFactor = loss === 0 ? null : profit / Math.abs(loss);
  const avgWinLossRatio = avgWin !== null && avgLoss !== null && avgLoss !== 0 ? Math.abs(avgWin) / Math.abs(avgLoss) : null;

  return { profit, loss, winCount, avgWin, avgLoss, avgWinLossRatio, profitFactor, largestWin, largestLoss };
}

/**
 * Capital-efficiency + margin-usage aggregates — see `BacktestStats`'s own capital-efficiency section doc for
 * the full reasoning (entry-basis valuation, single-position-so-"peak concurrent"-collapses-to-"biggest trade",
 * the honest no-intraday-leverage-model accounting). Derived from the already-built `tradesDetail` (closed +
 * the at-most-one open trade, entry/exit indices already resolved) rather than re-walking `candles` a third
 * time — trades are non-overlapping by construction (this module's own `pctTimeInMarket` doc already establishes
 * this), so summing each trade's own bar-span independently can never double-count a bar.
 */
function computeCapitalAndMarginMetrics(
  tradesDetail: readonly BacktestTrade[],
  candleCount: number,
  notional: number,
  productType: PaperProductType,
  grossPnl: number,
  netPnl: number
): Pick<
  BacktestStats,
  "peakDeployedCapital" | "avgDeployedCapitalPct" | "returnOnPeakCapitalPctGross" | "returnOnPeakCapitalPctNet" | "marginModel" | "avgMarginUsedPct" | "peakMarginUsedPct"
> {
  const lastCandleIndex = candleCount - 1;
  let peakDeployedCapital = 0;
  let totalDeployedBarUnits = 0;

  for (const t of tradesDetail) {
    const deployed = t.entryPrice * t.qty;
    if (deployed > peakDeployedCapital) peakDeployedCapital = deployed;
    const throughIndex = t.exitIndex ?? lastCandleIndex;
    const barsSpanned = throughIndex - t.entryIndex + 1; // inclusive of the entry bar itself — see field doc.
    totalDeployedBarUnits += barsSpanned * deployed;
  }

  const avgDeployedCapitalPct = candleCount > 0 && notional > 0 ? (totalDeployedBarUnits / candleCount / notional) * 100 : null;
  const returnOnPeakCapitalPctGross = peakDeployedCapital > 0 ? (grossPnl / peakDeployedCapital) * 100 : null;
  const returnOnPeakCapitalPctNet = peakDeployedCapital > 0 ? (netPnl / peakDeployedCapital) * 100 : null;

  // Honesty law (see `MarginModel`'s own doc): neither product type has a real leverage model in this codebase
  // yet, so margin utilization is numerically identical to capital deployment in both cases — a future real
  // intraday-leverage model would change ONLY this block, not the capital fields above.
  const marginModel: MarginModel = productType === "DELIVERY" ? "DELIVERY_FULL_NOTIONAL" : "INTRADAY_FULL_NOTIONAL_NO_LEVERAGE_MODEL";
  const avgMarginUsedPct = avgDeployedCapitalPct;
  const peakMarginUsedPct = notional > 0 ? (peakDeployedCapital / notional) * 100 : 0;

  return { peakDeployedCapital, avgDeployedCapitalPct, returnOnPeakCapitalPctGross, returnOnPeakCapitalPctNet, marginModel, avgMarginUsedPct, peakMarginUsedPct };
}

export function runBacktest(candles: readonly StrategyCandle[], signals: readonly StrategySignal[], options: BacktestOptions): BacktestStats {
  const notional = options.notional && options.notional > 0 ? options.notional : 100000;
  const productType = options.productType;

  const signalByIndex = new Map<number, StrategySignal>();
  for (const s of signals) signalByIndex.set(s.index, s);

  // Base trade shape (pre-metrics-engine fields only) — kept byte-identical to the pre-extension construction
  // logic below; the new per-trade fields are added in a separate enrichment pass after this loop, over
  // `candles`, which every base trade already carries enough indices/prices to derive from.
  type BaseTrade = Omit<BacktestTrade, "totalCosts" | "grossPnlPct" | "netPnlPct" | "cumulativeNetEquity" | "barsHeld" | "mae" | "mfe" | "maePct" | "mfePct">;

  const trades: BaseTrade[] = [];
  const equity: number[] = new Array(candles.length);
  // "Ideal — no costs" mirror of `equity`, built in the SAME loop — see `EquityPoint.grossEquity`'s own doc for
  // why this can never drift from the net array (same forward pass, same per-bar state).
  const equityGross: number[] = new Array(candles.length);
  let realizedNet = 0;
  let realizedGross = 0;
  let openTrade: { entryIndex: number; entryTimestamp: number; entryPrice: number; qty: number; entryCosts: number } | null = null;

  for (let i = 0; i < candles.length; i++) {
    const sig = signalByIndex.get(i);

    if (sig?.side === "BUY" && !openTrade) {
      const qty = Math.max(1, Math.floor(notional / sig.price));
      const entryCosts = computeOrderCosts({ side: "BUY", productType, quantity: qty, price: sig.price }).totalCosts;
      openTrade = { entryIndex: i, entryTimestamp: sig.timestamp, entryPrice: sig.price, qty, entryCosts };
    } else if (sig?.side === "SELL" && openTrade) {
      const exitCosts = computeOrderCosts({
        side: "SELL",
        productType,
        quantity: openTrade.qty,
        price: sig.price,
        // D7 — every backtest DELIVERY sell is treated as the day's first (see module doc): a single-instrument,
        // single-strategy backtest can never actually place two same-day DELIVERY sells of the same scrip.
        isFirstDeliverySellOfScripToday: true
      }).totalCosts;
      const grossPnl = (sig.price - openTrade.entryPrice) * openTrade.qty;
      const netPnl = grossPnl - openTrade.entryCosts - exitCosts;
      trades.push({
        entryIndex: openTrade.entryIndex,
        entryTimestamp: openTrade.entryTimestamp,
        entryPrice: openTrade.entryPrice,
        exitIndex: i,
        exitTimestamp: sig.timestamp,
        exitPrice: sig.price,
        qty: openTrade.qty,
        grossPnl,
        netPnl,
        entryCosts: openTrade.entryCosts,
        exitCosts,
        isOpen: false
      });
      realizedNet += netPnl;
      realizedGross += grossPnl;
      openTrade = null;
    }

    // Mark-to-market AFTER this bar's entry/exit resolves — "enter/exit at signal-bar close" applies to the
    // equity curve too, not just the trade log.
    let unrealized = 0;
    let unrealizedGross = 0;
    if (openTrade) {
      unrealized = (candles[i].close - openTrade.entryPrice) * openTrade.qty - openTrade.entryCosts;
      // Gross mark-to-market: zero cost drag at all, not even the entry leg — the literal "no costs" ideal view.
      unrealizedGross = (candles[i].close - openTrade.entryPrice) * openTrade.qty;
    }
    equity[i] = notional + realizedNet + unrealized;
    equityGross[i] = notional + realizedGross + unrealizedGross;
  }

  let openTradeDetail: BaseTrade | null = null;
  if (openTrade && candles.length > 0) {
    const lastClose = candles[candles.length - 1].close;
    const grossPnl = (lastClose - openTrade.entryPrice) * openTrade.qty;
    // No exit-leg cost — this position was never actually closed, per the plan's explicit spec.
    const netPnl = grossPnl - openTrade.entryCosts;
    openTradeDetail = {
      entryIndex: openTrade.entryIndex,
      entryTimestamp: openTrade.entryTimestamp,
      entryPrice: openTrade.entryPrice,
      exitIndex: null,
      exitTimestamp: null,
      exitPrice: null,
      qty: openTrade.qty,
      grossPnl,
      netPnl,
      entryCosts: openTrade.entryCosts,
      exitCosts: 0,
      isOpen: true
    };
  }

  const baseTradesDetail = openTradeDetail ? [...trades, openTradeDetail] : trades;
  const closedCount = trades.length;
  const wins = trades.filter((t) => t.netPnl > 0).length;
  const winRatePct = closedCount > 0 ? (wins / closedCount) * 100 : null;

  const grossPnl = baseTradesDetail.reduce((s, t) => s + t.grossPnl, 0);
  const netPnl = baseTradesDetail.reduce((s, t) => s + t.netPnl, 0);
  const totalCosts = baseTradesDetail.reduce((s, t) => s + t.entryCosts + t.exitCosts, 0);

  const grossReturnPct = (grossPnl / notional) * 100;
  const netReturnPct = (netPnl / notional) * 100;
  const buyHoldReturnPct = computeBuyHoldReturnPct(candles);

  // ── Enrichment pass: add the new per-trade fields over the already-built base trades. Needs `candles` (for
  // MAE/MFE) and a running sum (for cumulativeNetEquity) — a for-loop, not `.map()`, since the running sum is
  // stateful across iterations. ──────────────────────────────────────────────────────────────────────────
  const lastCandleIndex = candles.length - 1;
  const tradesDetail: BacktestTrade[] = new Array(baseTradesDetail.length);
  let cumulativeNet = 0;
  for (let i = 0; i < baseTradesDetail.length; i++) {
    const t = baseTradesDetail[i];
    const throughIndex = t.exitIndex ?? lastCandleIndex;
    const barsHeld = throughIndex - t.entryIndex;
    const { maePerShare, mfePerShare, maePct, mfePct } = computeExcursion(candles, t.entryIndex, throughIndex, t.entryPrice);
    const deployed = t.entryPrice * t.qty;
    cumulativeNet += t.netPnl;
    tradesDetail[i] = {
      ...t,
      totalCosts: t.entryCosts + t.exitCosts,
      grossPnlPct: deployed !== 0 ? (t.grossPnl / deployed) * 100 : 0,
      netPnlPct: deployed !== 0 ? (t.netPnl / deployed) * 100 : 0,
      cumulativeNetEquity: notional + cumulativeNet,
      barsHeld,
      mae: maePerShare * t.qty,
      mfe: mfePerShare * t.qty,
      maePct,
      mfePct
    };
  }

  // ── Aggregates: profitability (gross + net, CLOSED-only), time-in-market (ALL trades), drawdown/run-up,
  // annualized return, equity curve. See module doc for the OPEN-TRADE LAW governing which of these include
  // the still-open position. ──────────────────────────────────────────────────────────────────────────────
  const closedTradesDetail = tradesDetail.filter((t) => !t.isOpen);

  const grossAgg = computeProfitLossAggregates(closedTradesDetail, (t) => t.grossPnl);
  const netAgg = computeProfitLossAggregates(closedTradesDetail, (t) => t.netPnl);
  const grossWinRatePct = closedCount > 0 ? (grossAgg.winCount / closedCount) * 100 : null;

  const expectancyGross = closedCount > 0 ? (grossAgg.profit + grossAgg.loss) / closedCount : null;
  const expectancyNet = closedCount > 0 ? (netAgg.profit + netAgg.loss) / closedCount : null;
  const avgTradeGrossPnl = tradesDetail.length > 0 ? grossPnl / tradesDetail.length : null;
  const avgTradeNetPnl = tradesDetail.length > 0 ? netPnl / tradesDetail.length : null;

  const { maxConsecutiveWins, maxConsecutiveLosses } = computeMaxConsecutive(closedTradesDetail);

  const totalBarsInTrades = tradesDetail.reduce((s, t) => s + t.barsHeld, 0);
  const avgBarsInTrades = tradesDetail.length > 0 ? totalBarsInTrades / tradesDetail.length : null;
  const pctTimeInMarket = candles.length >= 2 ? (totalBarsInTrades / (candles.length - 1)) * 100 : null;

  const { points: equityCurve, maxDrawdownPct, maxDrawdownAmount, maxEquityRunUpPct, maxEquityRunUpAmount } = buildEquityCurve(candles, equity, equityGross, notional);

  const annualizedReturnPctGross = candles.length >= 2 ? computeAnnualizedReturnPct(grossReturnPct, candles[0].timestamp, candles[candles.length - 1].timestamp) : null;
  const annualizedReturnPctNet = candles.length >= 2 ? computeAnnualizedReturnPct(netReturnPct, candles[0].timestamp, candles[candles.length - 1].timestamp) : null;

  const capitalAndMargin = computeCapitalAndMarginMetrics(tradesDetail, candles.length, notional, productType, grossPnl, netPnl);

  return {
    trades: tradesDetail.length,
    wins,
    winRatePct,
    grossPnl,
    netPnl,
    totalCosts,
    grossReturnPct,
    netReturnPct,
    maxDrawdownPct,
    buyHoldReturnPct,
    openAtEnd: openTradeDetail !== null,
    tradesDetail,

    grossProfit: grossAgg.profit,
    grossLoss: grossAgg.loss,
    netProfit: netAgg.profit,
    netLoss: netAgg.loss,
    profitFactorGross: grossAgg.profitFactor,
    profitFactorNet: netAgg.profitFactor,

    expectancyGross,
    expectancyNet,
    avgTradeGrossPnl,
    avgTradeNetPnl,

    grossWins: grossAgg.winCount,
    grossWinRatePct,

    avgWinGross: grossAgg.avgWin,
    avgLossGross: grossAgg.avgLoss,
    avgWinNet: netAgg.avgWin,
    avgLossNet: netAgg.avgLoss,
    avgWinLossRatioGross: grossAgg.avgWinLossRatio,
    avgWinLossRatioNet: netAgg.avgWinLossRatio,

    largestWinGross: grossAgg.largestWin,
    largestLossGross: grossAgg.largestLoss,
    largestWinNet: netAgg.largestWin,
    largestLossNet: netAgg.largestLoss,

    maxConsecutiveWins,
    maxConsecutiveLosses,

    totalBarsInTrades,
    avgBarsInTrades,
    pctTimeInMarket,

    maxDrawdownAmount,
    maxEquityRunUpPct,
    maxEquityRunUpAmount,

    annualizedReturnPctGross,
    annualizedReturnPctNet,

    equityCurve,

    ...capitalAndMargin
  };
}
