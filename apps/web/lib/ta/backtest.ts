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
}

export interface BacktestStats {
  /** Total trades, closed + the at-most-one open-at-end trade (see `openAtEnd`). */
  trades: number;
  /** Wins are counted over CLOSED trades only (an open position's sign can still flip before it would ever close) — `winRatePct`'s own denominator matches. */
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
}

export interface BacktestOptions {
  /** Notional capital per trade — NOT compounded across trades (every entry independently sizes `qty = floor(notional/entryPrice)`, matching a fixed-position-size backtest convention, not a compounding-equity one). Defaults to ₹1,00,000 per the plan. */
  notional?: number;
  productType: PaperProductType;
}

function computeMaxDrawdownPct(equity: readonly number[], startingCapital: number): number {
  let peak = startingCapital;
  let maxDrawdown = 0;
  for (const e of equity) {
    if (e > peak) peak = e;
    if (peak > 0) {
      const dd = ((peak - e) / peak) * 100;
      if (dd > maxDrawdown) maxDrawdown = dd;
    }
  }
  return maxDrawdown;
}

/** First-open to last-close, computed straight from `candles` — see `BacktestStats.buyHoldReturnPct`'s own doc for why this must never touch `signals`/`trades`. */
function computeBuyHoldReturnPct(candles: readonly StrategyCandle[]): number {
  if (candles.length === 0) return 0;
  const firstOpen = candles[0].open;
  const lastClose = candles[candles.length - 1].close;
  if (!Number.isFinite(firstOpen) || firstOpen === 0) return 0;
  return ((lastClose - firstOpen) / firstOpen) * 100;
}

export function runBacktest(candles: readonly StrategyCandle[], signals: readonly StrategySignal[], options: BacktestOptions): BacktestStats {
  const notional = options.notional && options.notional > 0 ? options.notional : 100000;
  const productType = options.productType;

  const signalByIndex = new Map<number, StrategySignal>();
  for (const s of signals) signalByIndex.set(s.index, s);

  const trades: BacktestTrade[] = [];
  const equity: number[] = new Array(candles.length);
  let realizedNet = 0;
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
      openTrade = null;
    }

    // Mark-to-market AFTER this bar's entry/exit resolves — "enter/exit at signal-bar close" applies to the
    // equity curve too, not just the trade log.
    let unrealized = 0;
    if (openTrade) {
      unrealized = (candles[i].close - openTrade.entryPrice) * openTrade.qty - openTrade.entryCosts;
    }
    equity[i] = notional + realizedNet + unrealized;
  }

  let openTradeDetail: BacktestTrade | null = null;
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

  const tradesDetail = openTradeDetail ? [...trades, openTradeDetail] : trades;
  const closedCount = trades.length;
  const wins = trades.filter((t) => t.netPnl > 0).length;
  const winRatePct = closedCount > 0 ? (wins / closedCount) * 100 : null;

  const grossPnl = tradesDetail.reduce((s, t) => s + t.grossPnl, 0);
  const netPnl = tradesDetail.reduce((s, t) => s + t.netPnl, 0);
  const totalCosts = tradesDetail.reduce((s, t) => s + t.entryCosts + t.exitCosts, 0);

  const grossReturnPct = (grossPnl / notional) * 100;
  const netReturnPct = (netPnl / notional) * 100;
  const maxDrawdownPct = computeMaxDrawdownPct(equity, notional);
  const buyHoldReturnPct = computeBuyHoldReturnPct(candles);

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
    tradesDetail
  };
}
