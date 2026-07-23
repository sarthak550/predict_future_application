/**
 * Paper Trading Phase 1 — pure replay engine over a PaperOrder log.
 *
 * PaperOrder has no PENDING state (every row is filled synchronously at creation —
 * see the schema doc on model PaperOrder) so, unlike Portfolios' engine.ts, there is
 * no settlement-time fill/reject step here: this file is purely about turning an
 * ordered list of already-executed legs into holdings, cash, and P&L.
 *
 * Same architectural SHAPE as packages/business-rules/src/portfolios/engine.ts
 * (pure functions over plain DTOs, no Prisma, no I/O — shared identically by
 * apps/api's square-off cron and apps/web's order/account routes) but a genuinely
 * different holdings model, because Paper Trading allows INTRADAY shorting
 * (negative position) which Portfolios' long-only clamp-to-zero model cannot
 * represent. That's why this is a new file rather than an import from engine.ts.
 *
 * PRECONDITION on every function below that takes an order array: the caller must
 * pass orders sorted oldest-first (ascending `createdAt`) — weighted-average cost
 * basis and realized P&L attribution are both order-dependent.
 */

export type ReplayOrderSide = "BUY" | "SELL";
export type ReplayProductType = "DELIVERY" | "INTRADAY";

/** Minimal PaperOrder shape the replay engine needs — callers map their Prisma rows to this. */
export interface PaperEngineOrder {
  symbol: string;
  side: ReplayOrderSide;
  productType: ReplayProductType;
  quantity: number;
  fillPrice: number;
  /** Sum of every individual cost line for this leg (brokerage+stt+exchangeCharge+sebiFee+stampDuty+gst+dpCharge). */
  totalCosts: number;
  /** grossAmount ± totalCosts — see costs.ts. Used directly for cash replay so cash math automatically nets out every cost line without re-deriving it. */
  netAmount: number;
  createdAt: Date;
}

export interface PaperHoldingLot {
  /** Signed quantity — positive for a long position, negative for an open INTRADAY short. Never negative for DELIVERY (enforced by validation before a fill is ever written, not by this function). */
  quantity: number;
  /** Signed cost basis: quantity * avgCost. */
  costBasis: number;
  /** Always a positive per-share price (costBasis / quantity — signs cancel for a short). 0 when flat. */
  avgCost: number;
}

const EMPTY_LOT: PaperHoldingLot = { quantity: 0, costBasis: 0, avgCost: 0 };

interface FillReplayResult {
  lot: PaperHoldingLot;
  /** Realized gross P&L crystallized by THIS fill only (0 for a fill that purely extends/opens a position). */
  realizedGrossPnl: number;
}

/**
 * Applies one fill to an existing signed lot (weighted-average cost, long OR
 * short). Three cases:
 *  1. Flat, or extending a position in its existing direction (a BUY on a long/flat
 *     lot, or a SELL on a short/flat lot): grows the position, extends cost basis
 *     proportionally, realizes nothing.
 *  2. Reducing a position without fully closing it (partial close): shrinks cost
 *     basis proportionally, realizes P&L on the closed portion only.
 *  3. Fully closing AND flipping direction in one fill (e.g. a SELL for more than
 *     an existing long holds): closes the existing position (realizing P&L on all
 *     of it) and opens a brand-new position in the fill's direction for the
 *     remainder.
 *
 * Realized P&L formula for a closing quantity `q` at `price` against a lot with
 * `avgCost` and a given `directionSign` (+1 long, -1 short) BEFORE the fill:
 *   realized = q * (price - avgCost) * directionSign
 * This single formula is correct for both directions: a long profits when sold
 * above avgCost; a short profits when bought back (covered) below avgCost, and the
 * -1 sign flips that into a positive realized value automatically.
 */
function applyFill(existing: PaperHoldingLot, side: ReplayOrderSide, quantity: number, price: number): FillReplayResult {
  const delta = side === "BUY" ? quantity : -quantity;
  const extendingOrOpening = existing.quantity === 0 || Math.sign(existing.quantity) === Math.sign(delta);

  if (extendingOrOpening) {
    const newQuantity = existing.quantity + delta;
    const newCostBasis = existing.costBasis + delta * price;
    return {
      lot: { quantity: newQuantity, costBasis: newCostBasis, avgCost: newQuantity !== 0 ? newCostBasis / newQuantity : 0 },
      realizedGrossPnl: 0
    };
  }

  // Reducing an existing position — and possibly flipping past flat.
  const directionSign = Math.sign(existing.quantity); // +1 long, -1 short (never 0 here — extendingOrOpening already handled quantity===0)
  const closingQuantity = Math.min(quantity, Math.abs(existing.quantity));
  const realizedGrossPnl = closingQuantity * (price - existing.avgCost) * directionSign;

  const remainingExistingQuantity = existing.quantity - directionSign * closingQuantity;
  const remainingCostBasis = existing.costBasis * (remainingExistingQuantity / existing.quantity);

  const flipQuantity = quantity - closingQuantity;
  if (flipQuantity > 0) {
    // Existing position is fully closed by this fill, with quantity left over that
    // opens a brand-new position in the OPPOSITE direction.
    const flipSignedQuantity = flipQuantity * Math.sign(delta);
    const flipCostBasis = flipSignedQuantity * price;
    return {
      lot: { quantity: flipSignedQuantity, costBasis: flipCostBasis, avgCost: flipSignedQuantity !== 0 ? flipCostBasis / flipSignedQuantity : 0 },
      realizedGrossPnl
    };
  }

  return {
    lot: {
      quantity: remainingExistingQuantity,
      costBasis: remainingCostBasis,
      avgCost: remainingExistingQuantity !== 0 ? remainingCostBasis / remainingExistingQuantity : 0
    },
    realizedGrossPnl
  };
}

export interface PositionReplayResult {
  /** Current signed open quantity (0 if fully closed). */
  quantity: number;
  avgCost: number;
  /** Sum of realized P&L crystallized by every closing/reducing fill in this order set. */
  realizedGrossPnl: number;
  /** Sum of every order's totalCosts in this set — entry leg(s) + exit leg(s) alike. */
  totalCosts: number;
  isOpen: boolean;
}

/**
 * Replays an arbitrary (already filtered to whatever scope the caller wants —
 * one symbol, one linkedOpinionId group, one product type, one calendar day, any
 * combination) chronological order list into a single position result. This is
 * the one building block every other function in this file composes:
 *  - deriveDeliveryHoldings groups by symbol and calls this per group.
 *  - openIntradayPositions groups by symbol (within one day) and calls this per group.
 *  - "Calls I've traded" (T8) calls this directly on one linkedOpinionId's orders.
 */
export function replayPosition(orders: PaperEngineOrder[]): PositionReplayResult {
  let lot: PaperHoldingLot = EMPTY_LOT;
  let realizedGrossPnl = 0;
  let totalCosts = 0;

  for (const order of orders) {
    const result = applyFill(lot, order.side, order.quantity, order.fillPrice);
    lot = result.lot;
    realizedGrossPnl += result.realizedGrossPnl;
    totalCosts += order.totalCosts;
  }

  return { quantity: lot.quantity, avgCost: lot.avgCost, realizedGrossPnl, totalCosts, isOpen: lot.quantity !== 0 };
}

/** (ltp - avgCost) * signedQuantity — correct for both long (positive quantity) and short (negative quantity) without branching: a short's unrealized profit when LTP < avgCost falls out of the sign algebra automatically. */
export function unrealizedGrossPnl(quantity: number, avgCost: number, ltp: number): number {
  return (ltp - avgCost) * quantity;
}

/** realizedGrossPnl + unrealizedGrossPnl - totalCosts. The single "net P&L" number every UI surface shows. */
export function netPnl(realizedGrossPnl: number, unrealizedGrossPnlValue: number, totalCosts: number): number {
  return realizedGrossPnl + unrealizedGrossPnlValue - totalCosts;
}

function groupBySymbol(orders: PaperEngineOrder[]): Map<string, PaperEngineOrder[]> {
  const groups = new Map<string, PaperEngineOrder[]>();
  for (const order of orders) {
    const list = groups.get(order.symbol);
    if (list) list.push(order);
    else groups.set(order.symbol, [order]);
  }
  return groups;
}

export interface SymbolPosition extends PositionReplayResult {
  symbol: string;
}

/**
 * Every DELIVERY position for this account, one entry per symbol EVER traded —
 * including fully-closed ones (quantity 0). Used for lifetime realized-P&L/costs
 * rollups, where a closed position's history still matters. Most callers want the
 * CURRENTLY HELD subset instead — see deriveDeliveryHoldings below.
 */
export function deriveAllDeliveryPositions(orders: PaperEngineOrder[]): SymbolPosition[] {
  const deliveryOrders = orders.filter((o) => o.productType === "DELIVERY");
  const results: SymbolPosition[] = [];
  for (const [symbol, symbolOrders] of groupBySymbol(deliveryOrders)) {
    results.push({ symbol, ...replayPosition(symbolOrders) });
  }
  return results;
}

/**
 * DELIVERY-only holdings, one entry per symbol CURRENTLY held (quantity !== 0).
 * DELIVERY is long-only by validation (no delivery shorting — see
 * apps/web/lib/paperTrading/orders.ts), so every returned quantity is positive in
 * practice; this function itself doesn't assume that, it just filters whatever
 * deriveAllDeliveryPositions computes.
 */
export function deriveDeliveryHoldings(orders: PaperEngineOrder[]): SymbolPosition[] {
  return deriveAllDeliveryPositions(orders).filter((p) => p.quantity !== 0);
}

const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;

/** The IST calendar date (date-only) an arbitrary UTC instant falls on, as a comparable number (YYYYMMDD). Mirrors the IST calendar-date math already established in portfolios/shadow.ts, duplicated here (not imported) to keep this file free of cross-file coupling within the package — it's three lines. */
function istCalendarDateNumber(instant: Date): number {
  const ist = new Date(instant.getTime() + IST_OFFSET_MS);
  return ist.getUTCFullYear() * 10000 + (ist.getUTCMonth() + 1) * 100 + ist.getUTCDate();
}

export interface DayGroupedPosition extends SymbolPosition {
  /** IST calendar day this INTRADAY position belongs to, encoded YYYYMMDD (same encoding istCalendarDateNumber uses internally) — lets callers bucket "today" vs. history without re-parsing dates. */
  dayKey: number;
}

function groupBySymbolAndIstDay(orders: PaperEngineOrder[]): Map<string, { symbol: string; dayKey: number; orders: PaperEngineOrder[] }> {
  const groups = new Map<string, { symbol: string; dayKey: number; orders: PaperEngineOrder[] }>();
  for (const order of orders) {
    const dayKey = istCalendarDateNumber(order.createdAt);
    const key = `${order.symbol}::${dayKey}`;
    const existing = groups.get(key);
    if (existing) existing.orders.push(order);
    else groups.set(key, { symbol: order.symbol, dayKey, orders: [order] });
  }
  return groups;
}

/**
 * Every INTRADAY position EVER taken, one entry per (symbol, IST calendar day) —
 * INTRADAY positions are day-scoped by regulation (must square off same day), so
 * two different days in the same symbol are two independent positions, never
 * replayed together. Includes already-flat (quantity 0, normally because the
 * square-off cron or the user's own close already flattened it) groups too — used
 * for lifetime realized-P&L/costs rollups. Most callers want only TODAY's still-open
 * subset instead — see openIntradayPositions below.
 */
export function deriveIntradayDailyPositions(orders: PaperEngineOrder[]): DayGroupedPosition[] {
  const intradayOrders = orders.filter((o) => o.productType === "INTRADAY");
  const results: DayGroupedPosition[] = [];
  for (const { symbol, dayKey, orders: dayOrders } of groupBySymbolAndIstDay(intradayOrders).values()) {
    results.push({ symbol, dayKey, ...replayPosition(dayOrders) });
  }
  return results;
}

/**
 * Every symbol with a non-zero net INTRADAY position for the IST calendar day
 * `sessionDate` falls on, across ALL of `orders` (the caller should already have
 * scoped `orders` to one account, but does not need to pre-filter by day — this
 * function does that filtering itself). This is what the auto square-off cron
 * calls: any symbol returned here has an open intraday position that must be
 * force-closed before session close.
 */
export function openIntradayPositions(orders: PaperEngineOrder[], sessionDate: Date): SymbolPosition[] {
  const targetDay = istCalendarDateNumber(sessionDate);
  return deriveIntradayDailyPositions(orders)
    .filter((p) => p.dayKey === targetDay && p.quantity !== 0)
    .map(({ symbol, quantity, avgCost, realizedGrossPnl, totalCosts, isOpen }) => ({
      symbol,
      quantity,
      avgCost,
      realizedGrossPnl,
      totalCosts,
      isOpen
    }));
}

/**
 * Account cash balance = startingCapital, adjusted by every order's netAmount
 * (BUY subtracts, SELL adds). Every PaperOrder row is always-executed (no
 * PENDING/CANCELLED filtering needed, unlike Portfolios' deriveCash).
 */
export function deriveCash(startingCapital: number, orders: PaperEngineOrder[]): number {
  let cash = startingCapital;
  for (const order of orders) {
    cash += order.side === "SELL" ? order.netAmount : -order.netAmount;
  }
  return cash;
}

/**
 * Whether `candidateOrder` would be the FIRST DELIVERY SELL of its symbol, for
 * this account, on the IST calendar day it's being placed on — i.e. whether the
 * once-per-scrip-per-day DP charge applies to it. `existingOrders` should be every
 * prior order for the account (any symbol/product type is fine to pass in
 * unfiltered — this function does its own filtering).
 */
export function isFirstDeliverySellOfScripToday(
  existingOrders: PaperEngineOrder[],
  symbol: string,
  atInstant: Date
): boolean {
  const targetDay = istCalendarDateNumber(atInstant);
  return !existingOrders.some(
    (o) =>
      o.symbol === symbol &&
      o.productType === "DELIVERY" &&
      o.side === "SELL" &&
      istCalendarDateNumber(o.createdAt) === targetDay
  );
}
