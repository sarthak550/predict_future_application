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
/** Phase 2 added INDEX_OPTION; Phase 3 added STOCK_OPTION — see optionContractKey/groupByOptionContract below, which were never NIFTY/BANKNIFTY-specific and needed no change beyond this type + the deriveAllOptionPositions filter widening. Phase 4 added INDEX_FUTURE — see deriveFuturesPositions below, a NEW dedicated replay function (not a widening of the option path) because futures have a fundamentally different daily-mark-to-market lifecycle. */
export type ReplayInstrumentKind = "EQUITY" | "INDEX_OPTION" | "STOCK_OPTION" | "INDEX_FUTURE";
export type ReplayOptionType = "CE" | "PE";

/**
 * Minimal PaperOrder shape the replay engine needs — callers map their Prisma
 * rows to this. Phase 2/3 (Options) fields are all optional/nullable and
 * ignored by every EQUITY-path function (deriveAllDeliveryPositions,
 * deriveIntradayDailyPositions, openIntradayPositions, etc.) — those filter on
 * `productType`, which is always null for an option row, so an option order
 * can never accidentally leak into an equity grouping. `deriveCash` is the one
 * function that intentionally does NOT filter by instrumentKind: cash is a
 * single unified pool across every asset class (see the Phase 2 brief's
 * schema-decision section) and deriveCash's existing side+netAmount-only logic
 * already treats every order identically regardless of instrument, so it
 * required no changes at all to support options (index OR stock) correctly.
 */
export interface PaperEngineOrder {
  symbol: string;
  side: ReplayOrderSide;
  /** Null for an option row (Phase 2/3) — genuinely meaningless for a fully-prepaid option, see the schema doc. Always set for an EQUITY row. */
  productType: ReplayProductType | null;
  quantity: number;
  fillPrice: number;
  /** Sum of every individual cost line for this leg (brokerage+stt+exchangeCharge+sebiFee+stampDuty+gst+dpCharge). */
  totalCosts: number;
  /** grossAmount ± totalCosts — see costs.ts. Used directly for cash replay so cash math automatically nets out every cost line without re-deriving it. */
  netAmount: number;
  createdAt: Date;
  /** Phase 2: defaults to "EQUITY" on Prisma rows via the schema's @default. */
  instrumentKind?: ReplayInstrumentKind;
  underlyingSymbol?: string | null;
  optionType?: ReplayOptionType | null;
  strikePrice?: number | null;
  /** The CONTRACT's expiry date (not this order's createdAt). */
  expiryDate?: Date | null;
  /** Snapshotted at fill time — see the schema doc on PaperOrder.lotSize for why this is never a live-recomputed value. */
  lotSize?: number | null;
  /**
   * Phase 4: true only for a cash-only daily mark-to-market leg (see the
   * schema doc on PaperOrder.isDailyMtm). Defaults to false/undefined for
   * every prior-phase row. deriveCash carves this leg type out of its normal
   * side-based cash math (see below) — netAmount is trusted as the already-
   * signed cash flow directly, regardless of the row's stored `side`.
   */
  isDailyMtm?: boolean;
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
 *
 * Phase 4 carve-out (verified empirically, per the Phase 4 brief's "verify
 * before relying on it" instruction): a daily mark-to-market leg
 * (`isDailyMtm: true`) is not a BUY or a SELL — it's a pure cash movement
 * with quantity: 0 and no real trade direction — so it is carved out of the
 * side-based math above and its `netAmount` (the already-signed
 * variation-margin cash flow: positive = credit, negative = debit — see
 * replay.ts's deriveFuturesPositions, which is the sole producer of this
 * value) is added directly. This is the NARROWEST carve-out that keeps every
 * pre-Phase-4 order's cash math byte-identical: the branch only ever fires
 * for a row type that did not exist before this phase.
 */
export function deriveCash(startingCapital: number, orders: PaperEngineOrder[]): number {
  let cash = startingCapital;
  for (const order of orders) {
    if (order.isDailyMtm) {
      cash += order.netAmount;
      continue;
    }
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

// ─── Phase 2: Index Options ────────────────────────────────────────────────────
//
// Long-only (BUY CE / BUY PE) means every option position's signed quantity is
// always >= 0 — replayPosition's short-capable math still applies unmodified
// (nothing here needed a new formula), it just never sees a negative delta
// because option order placement (apps/web/lib/paperTrading/optionOrders.ts)
// rejects any SELL that doesn't match an existing long holding before a fill is
// ever written — the same "validation happens before the write" convention as
// Phase 1's no-delivery-shorting rule.

export interface OptionContractPosition extends PositionReplayResult {
  underlyingSymbol: string;
  optionType: ReplayOptionType;
  strikePrice: number;
  expiryDate: Date;
  /** The most recently snapshotted lotSize among this contract's orders. Contracts are traded under one specific expiry month, so every fill against the same contract key should carry the same lotSize in practice — this is the "if it ever somehow differs" tie-break, not an expected case. */
  lotSize: number | null;
  /** abs(quantity) / lotSize, rounded — 0 when lotSize is unknown (defensive; should not happen for a real filled order, which always snapshots a lotSize at write time). */
  lots: number;
  /**
   * Phase 3: which settlement mechanism this contract uses — read off the
   * group's first order (every order in one contract group shares the same
   * instrumentKind, since underlyingSymbol alone already discriminates index
   * vs. stock). Lets every downstream consumer (UI badges, the two
   * expiry/square-off crons) branch on settlement type without re-deriving it
   * from the underlying symbol string.
   */
  instrumentKind: "INDEX_OPTION" | "STOCK_OPTION";
}

function optionContractKey(o: PaperEngineOrder): string {
  const expiryKey = o.expiryDate ? o.expiryDate.toISOString().slice(0, 10) : "unknown";
  return `${o.underlyingSymbol ?? "unknown"}::${o.strikePrice ?? "unknown"}::${expiryKey}::${o.optionType ?? "unknown"}`;
}

function groupByOptionContract(orders: PaperEngineOrder[]): Map<string, PaperEngineOrder[]> {
  const groups = new Map<string, PaperEngineOrder[]>();
  for (const order of orders) {
    const key = optionContractKey(order);
    const list = groups.get(key);
    if (list) list.push(order);
    else groups.set(key, [order]);
  }
  return groups;
}

function toOptionContractPosition(contractOrders: PaperEngineOrder[]): OptionContractPosition {
  const position = replayPosition(contractOrders);
  // Every order in one contract group carries identical underlyingSymbol/
  // strikePrice/expiryDate/optionType/instrumentKind (that's the grouping
  // key, plus instrumentKind is a pure function of underlyingSymbol) — read
  // them off any member, oldest-first convention means [0] is safe and
  // deterministic.
  const first = contractOrders[0];
  const lotSize = contractOrders.reduce<number | null>((acc, o) => o.lotSize ?? acc, null);
  return {
    ...position,
    underlyingSymbol: first.underlyingSymbol as string,
    optionType: first.optionType as ReplayOptionType,
    strikePrice: first.strikePrice as number,
    expiryDate: first.expiryDate as Date,
    lotSize,
    lots: lotSize ? Math.round(Math.abs(position.quantity) / lotSize) : 0,
    instrumentKind: first.instrumentKind as "INDEX_OPTION" | "STOCK_OPTION"
  };
}

/**
 * Every option contract (INDEX_OPTION or STOCK_OPTION) EVER traded on this
 * account, one entry per (underlyingSymbol, strikePrice, expiryDate,
 * optionType) — including fully-closed/settled ones (quantity 0). Used for
 * lifetime rollups, exactly the same "closed positions still count" reasoning
 * as deriveAllDeliveryPositions above. Most callers want the currently-open
 * subset instead — see deriveOptionPositions below.
 *
 * Phase 3: widened from `=== "INDEX_OPTION"` to also include STOCK_OPTION —
 * no other change needed here. optionContractKey/groupByOptionContract were
 * never NIFTY/BANKNIFTY-specific; they already group purely on
 * underlyingSymbol+strikePrice+expiryDate+optionType strings, which works
 * identically for a stock underlying.
 */
export function deriveAllOptionPositions(orders: PaperEngineOrder[]): OptionContractPosition[] {
  const optionOrders = orders.filter((o) => o.instrumentKind === "INDEX_OPTION" || o.instrumentKind === "STOCK_OPTION");
  const results: OptionContractPosition[] = [];
  for (const contractOrders of groupByOptionContract(optionOrders).values()) {
    results.push(toOptionContractPosition(contractOrders));
  }
  return results;
}

/**
 * Option contracts (index or stock) CURRENTLY held (quantity !== 0) —
 * long-only by validation, so every returned quantity is positive in
 * practice, mirroring deriveDeliveryHoldings' identical caveat for DELIVERY.
 */
export function deriveOptionPositions(orders: PaperEngineOrder[]): OptionContractPosition[] {
  return deriveAllOptionPositions(orders).filter((p) => p.quantity !== 0);
}

/**
 * Every OPEN option position (index OR stock — mixed in the same result set)
 * whose expiryDate falls on the IST calendar day `today` falls on — exactly
 * what Phase 2's cash-settlement cron and Phase 3's stock square-off cron both
 * need to find same-day expiries. Mirrors openIntradayPositions' day-scoped
 * detection shape, but keyed on the CONTRACT's expiryDate rather than the
 * order's createdAt (an option can be held for weeks/months before its expiry
 * day arrives, unlike an INTRADAY equity position which is always same-day).
 * No signature change needed for Phase 3: each cron filters its own
 * `instrumentKind` out of this (now mixed) result set — see
 * optionsExpiry.ts / stockOptionSquareOff.ts.
 */
export function openExpiringPositions(orders: PaperEngineOrder[], today: Date): OptionContractPosition[] {
  const targetDay = istCalendarDateNumber(today);
  return deriveOptionPositions(orders).filter((p) => istCalendarDateNumber(p.expiryDate) === targetDay);
}

/**
 * Expiry Settlement Backfill (2026-08-04) — every OPEN option position (index
 * OR stock, mixed) whose expiryDate falls STRICTLY BEFORE the IST calendar
 * day `today` falls on — i.e. already past expiry and missed by
 * openExpiringPositions' same-day detection above. This is the sibling
 * "catch up a historical backlog" query the expiry-settlement crons' backfill
 * sweep uses: openExpiringPositions alone can only ever catch a contract on
 * the exact day it expires, so any day that cron didn't run (most notably:
 * every day before it was first installed on the crontab) permanently misses
 * that day's expiries under the `===` filter — there is no future date on
 * which openExpiringPositions would ever find them again. `<` (not `<=`)
 * deliberately excludes today's own expiries, which openExpiringPositions
 * already owns — the two functions are a strict partition of every open
 * option position's expiry-relative-to-today state (future / today / overdue),
 * never overlapping, so a caller running both never double-processes a
 * position.
 */
export function overdueExpiredOptionPositions(orders: PaperEngineOrder[], today: Date): OptionContractPosition[] {
  const targetDay = istCalendarDateNumber(today);
  return deriveOptionPositions(orders).filter((p) => istCalendarDateNumber(p.expiryDate) < targetDay);
}

// ─── Phase 4: Index Futures ──────────────────────────────────────────────────
//
// A genuinely different replay shape from the option path above (hence a
// dedicated function, not a widening of replayPosition/applyFill): a futures
// position's cost basis is NOT a static weighted-average that only moves on a
// trade — it is reset every session by a daily mark-to-market leg to that
// day's real bhavcopy settlement price. This is what makes futures futures
// rather than a leveraged equity position with extra steps (see the Phase 4
// brief). Both LONG (positive signed quantity) and SHORT (negative signed
// quantity) are supported — reuses the exact side: BUY | SELL-to-open pattern
// P1's intraday equity short already established (Math.sign-based direction),
// same as every other short-capable model in this file.

export interface FuturesContractPosition {
  underlyingSymbol: string;
  expiryDate: Date;
  /** Signed total contract quantity — positive for a long position, negative for an open short. 0 when flat/closed. */
  quantity: number;
  /** The most recently snapshotted lotSize among this contract's orders (same tie-break convention as OptionContractPosition.lotSize). */
  lotSize: number | null;
  /** abs(quantity) / lotSize, rounded — 0 when lotSize is unknown. */
  lots: number;
  side: "LONG" | "SHORT" | "FLAT";
  /**
   * The CURRENT reference price for margin/MTM purposes: the entry fill
   * price until the first daily-MTM leg posts for this contract, then the
   * most recently posted MTM leg's stored settlement price. This — not the
   * original entry price — is what the next day's MTM delta and the current
   * margin-required calculation must both use (see futuresMargin.ts's
   * computeFuturesMarginRequired, called against quantity * referencePrice).
   * 0 when the position has never been opened or is fully closed.
   */
  referencePrice: number;
  /**
   * Telescoping sum of every daily-MTM leg's mark-to-market delta plus the
   * final close/settlement leg's own delta (both computed against
   * referencePrice AT THE TIME of that leg, not the original entry price) —
   * by construction this always equals (exit price − entry price) * quantity
   * for the position's full life, asserted as a cross-check in the verify
   * script. Distinct from any individual leg's `netAmount` (the actual cash
   * flow, which additionally nets out costs on close/settlement/margin-call
   * legs — costs are deliberately NOT part of this P&L figure, mirroring
   * every other *GrossPnl field in this file).
   */
  realizedGrossPnl: number;
  /** Sum of every order's totalCosts in this contract's history — a daily-MTM leg always contributes 0 here (see futuresCosts.ts's zeroDailyMtmCosts). */
  totalCosts: number;
  isOpen: boolean;
}

function futuresContractKey(o: PaperEngineOrder): string {
  const expiryKey = o.expiryDate ? o.expiryDate.toISOString().slice(0, 10) : "unknown";
  return `${o.underlyingSymbol ?? "unknown"}::${expiryKey}`;
}

function groupByFuturesContract(orders: PaperEngineOrder[]): Map<string, PaperEngineOrder[]> {
  const groups = new Map<string, PaperEngineOrder[]>();
  for (const order of orders) {
    const key = futuresContractKey(order);
    const list = groups.get(key);
    if (list) list.push(order);
    else groups.set(key, [order]);
  }
  return groups;
}

/**
 * Replays one futures contract's chronological order set (a mix of real
 * trade legs — open/add/close/flip/margin-call-close — and daily-MTM legs)
 * into quantity, current reference price, and telescoping realized P&L.
 *
 * Trade-leg math mirrors applyFill's weighted-average-on-extend /
 * realize-on-reduce shape (adding to an existing position at a new price
 * updates referencePrice by weighted average; reducing/closing realizes P&L
 * against the CURRENT referencePrice, which may already reflect a prior
 * day's MTM mark, not the original entry price — this is what makes the
 * telescoping-sum property hold). A daily-MTM leg never changes quantity —
 * it marks referencePrice to the leg's own fillPrice (the settlement price)
 * and realizes the resulting delta via the existing unrealizedGrossPnl sign
 * algebra, which is correct for both long and short without branching.
 */
function replayFuturesContract(contractOrders: PaperEngineOrder[]): {
  quantity: number;
  referencePrice: number;
  realizedGrossPnl: number;
  totalCosts: number;
  lotSize: number | null;
} {
  let quantity = 0;
  let referencePrice = 0;
  let realizedGrossPnl = 0;
  let totalCosts = 0;
  let lotSize: number | null = null;

  for (const o of contractOrders) {
    totalCosts += o.totalCosts;
    lotSize = o.lotSize ?? lotSize;

    if (o.isDailyMtm) {
      // Pure mark: quantity unchanged. (ltp - avgCost) * signedQuantity is
      // exactly unrealizedGrossPnl's formula, reused here as the REALIZED
      // delta this leg crystallizes (a futures MTM leg realizes what an
      // option/equity position would otherwise carry as unrealized).
      realizedGrossPnl += unrealizedGrossPnl(quantity, referencePrice, o.fillPrice);
      referencePrice = o.fillPrice;
      continue;
    }

    const delta = o.side === "BUY" ? o.quantity : -o.quantity;
    const extendingOrOpening = quantity === 0 || Math.sign(quantity) === Math.sign(delta);

    if (extendingOrOpening) {
      const newQuantity = quantity + delta;
      referencePrice =
        quantity === 0
          ? o.fillPrice
          : newQuantity !== 0
            ? (referencePrice * quantity + o.fillPrice * delta) / newQuantity
            : referencePrice;
      quantity = newQuantity;
      continue;
    }

    // Reducing (or flipping past flat) an existing position — a real close
    // leg (manual close, margin-call force-close, or expiry settlement).
    const directionSign = Math.sign(quantity); // +1 long, -1 short (never 0 here)
    const closingQuantity = Math.min(o.quantity, Math.abs(quantity));
    realizedGrossPnl += closingQuantity * (o.fillPrice - referencePrice) * directionSign;

    const remainingQuantity = quantity - directionSign * closingQuantity;
    const flipQuantity = o.quantity - closingQuantity;

    if (flipQuantity > 0) {
      // Existing position fully closed by this leg, with quantity left over
      // that opens a brand-new position in the OPPOSITE direction — same
      // "flip" case applyFill handles for equities/options.
      quantity = flipQuantity * Math.sign(delta);
      referencePrice = o.fillPrice;
    } else {
      quantity = remainingQuantity;
      if (quantity === 0) referencePrice = 0;
    }
  }

  return { quantity, referencePrice, realizedGrossPnl, totalCosts, lotSize };
}

/**
 * Every INDEX_FUTURE contract (underlyingSymbol, expiryDate) EVER traded on
 * this account, including fully-closed/settled ones (quantity 0) — same
 * "closed positions still count" lifetime-rollup posture as
 * deriveAllDeliveryPositions/deriveAllOptionPositions. Most callers want the
 * currently-open subset instead — see deriveOpenFuturesPositions below.
 */
export function deriveAllFuturesPositions(orders: PaperEngineOrder[]): FuturesContractPosition[] {
  const futuresOrders = orders.filter((o) => o.instrumentKind === "INDEX_FUTURE");
  const results: FuturesContractPosition[] = [];
  for (const [, contractOrders] of groupByFuturesContract(futuresOrders)) {
    const first = contractOrders[0];
    const { quantity, referencePrice, realizedGrossPnl, totalCosts, lotSize } = replayFuturesContract(contractOrders);
    results.push({
      underlyingSymbol: first.underlyingSymbol as string,
      expiryDate: first.expiryDate as Date,
      quantity,
      lotSize,
      lots: lotSize ? Math.round(Math.abs(quantity) / lotSize) : 0,
      side: quantity > 0 ? "LONG" : quantity < 0 ? "SHORT" : "FLAT",
      referencePrice,
      realizedGrossPnl,
      totalCosts,
      isOpen: quantity !== 0
    });
  }
  return results;
}

/** INDEX_FUTURE contracts CURRENTLY held (quantity !== 0) — both long and short. */
export function deriveOpenFuturesPositions(orders: PaperEngineOrder[]): FuturesContractPosition[] {
  return deriveAllFuturesPositions(orders).filter((p) => p.quantity !== 0);
}

/**
 * Kept as `deriveFuturesPositions` too — the Phase 4 brief's own naming for
 * "every open futures position" (mirrors deriveOptionPositions' naming for
 * the option path). Alias, not a duplicate implementation.
 */
export const deriveFuturesPositions = deriveOpenFuturesPositions;

/**
 * Every OPEN INDEX_FUTURE position whose expiryDate falls on the IST
 * calendar day `today` falls on — mirrors openExpiringPositions' option-path
 * shape exactly, for the futures expiry-settlement cron (T9, not built this
 * sprint) to find same-day expiries.
 */
export function openExpiringFuturesPositions(orders: PaperEngineOrder[], today: Date): FuturesContractPosition[] {
  const targetDay = istCalendarDateNumber(today);
  return deriveOpenFuturesPositions(orders).filter((p) => istCalendarDateNumber(p.expiryDate) === targetDay);
}

/**
 * Expiry Settlement Backfill (2026-08-04) — every OPEN INDEX_FUTURE position
 * whose expiryDate falls STRICTLY BEFORE the IST calendar day `today` falls
 * on. Sibling of overdueExpiredOptionPositions above — same "strict partition
 * of future/today/overdue, `<` not `<=`" reasoning applies identically here.
 */
export function overdueExpiredFuturesPositions(orders: PaperEngineOrder[], today: Date): FuturesContractPosition[] {
  const targetDay = istCalendarDateNumber(today);
  return deriveOpenFuturesPositions(orders).filter((p) => istCalendarDateNumber(p.expiryDate) < targetDay);
}
