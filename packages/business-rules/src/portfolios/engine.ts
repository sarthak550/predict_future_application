/**
 * Portfolios (P3.1) — pure derivation engine.
 *
 * Structural immutability: Portfolio has NO mutable nav/cash/holdings columns (see
 * the schema doc on model Portfolio in apps/api/prisma/schema.prisma). Everything —
 * cash, holdings, NAV, return% — is derived here from
 * (startingCapital, EXECUTED PortfolioTransaction rows, StockEodQuote closes).
 * PortfolioDailyValue is only a nightly-cron CACHE of valuePortfolio()'s output.
 *
 * Everything in this file is a pure function over plain DTOs — no Prisma, no I/O —
 * so it's shared identically by:
 *  - apps/api/lib/portfolios/{settlement,valuation}.ts (cron orchestration)
 *  - apps/web/lib/portfolios/{queries,transactions}.ts (request-time orchestration —
 *    apps/web cannot import apps/api's server code, so this package is the only place
 *    the math can live without being duplicated, unlike the
 *    apps/api/lib/finance/credibility.ts <-> business-rules/experts/scorecard.ts
 *    split, which duplicates by necessity because credibility.ts predates this
 *    package's portfolio math)
 *  - apps/api/scripts/verify-portfolios-engine.ts (the P3.1 acceptance test)
 */

export type EngineTxSide = "BUY" | "SELL";
export type EngineTxStatus = "PENDING" | "EXECUTED" | "CANCELLED";

/** Minimal transaction shape the engine needs — callers map their Prisma rows to this. */
export interface EngineTransaction {
  symbol: string;
  side: EngineTxSide;
  quantity: number;
  /** Fill price. Must be non-null for any row with status EXECUTED; ignored otherwise. */
  priceAtTx: number | null;
  status: EngineTxStatus;
}

export interface HoldingLot {
  quantity: number;
  /** Total rupee cost basis of the current position (weighted-average-cost method). */
  costBasis: number;
  /** costBasis / quantity, 0 when quantity is 0. */
  avgCost: number;
}

const EMPTY_LOT: HoldingLot = { quantity: 0, costBasis: 0, avgCost: 0 };

/** Applies one BUY fill to an existing lot (weighted-average-cost). */
function applyBuy(existing: HoldingLot, quantity: number, price: number): HoldingLot {
  const newQuantity = existing.quantity + quantity;
  const newCostBasis = existing.costBasis + quantity * price;
  return {
    quantity: newQuantity,
    costBasis: newCostBasis,
    avgCost: newQuantity > 0 ? newCostBasis / newQuantity : 0
  };
}

/**
 * Applies one SELL fill to an existing lot (weighted-average-cost): reduces quantity
 * and proportionally reduces cost basis, realizing the rest as P&L (not tracked here
 * — realized P&L is derivable separately from proceeds - costBasis-removed if needed
 * later; out of scope for P3.1). Clamps to zero rather than going negative — callers
 * MUST validate sell quantity <= held quantity before calling; this is a defensive
 * floor, not a substitute for that validation (see validateNewTransaction /
 * settleTransaction, both of which reject oversells before this ever runs negative).
 */
function applySell(existing: HoldingLot, quantity: number): HoldingLot {
  const remainingQuantity = Math.max(0, existing.quantity - quantity);
  const remainingCostBasis =
    existing.quantity > 0 ? existing.costBasis * (remainingQuantity / existing.quantity) : 0;
  return {
    quantity: remainingQuantity,
    costBasis: remainingCostBasis,
    avgCost: remainingQuantity > 0 ? remainingCostBasis / remainingQuantity : 0
  };
}

/**
 * Replays a portfolio's EXECUTED transaction history into a per-symbol holdings map.
 * Ignores PENDING/CANCELLED rows entirely (only EXECUTED, cash-settled fills count).
 *
 * PRECONDITION: `transactions` must be sorted oldest-first (ascending `requestedAt`)
 * by the caller. Weighted-average cost basis is order-dependent — replaying out of
 * order silently produces a wrong (but not obviously wrong-looking) avgCost.
 */
export function deriveHoldings(transactions: EngineTransaction[]): Map<string, HoldingLot> {
  const holdings = new Map<string, HoldingLot>();

  for (const tx of transactions) {
    if (tx.status !== "EXECUTED" || tx.priceAtTx == null) continue;
    const existing = holdings.get(tx.symbol) ?? EMPTY_LOT;
    const updated = tx.side === "BUY" ? applyBuy(existing, tx.quantity, tx.priceAtTx) : applySell(existing, tx.quantity);
    if (updated.quantity > 0) {
      holdings.set(tx.symbol, updated);
    } else {
      holdings.delete(tx.symbol);
    }
  }

  return holdings;
}

/**
 * Cash balance = startingCapital, adjusted by every EXECUTED fill (BUY subtracts
 * quantity * priceAtTx, SELL adds it). PENDING and CANCELLED rows never touch cash —
 * PENDING orders are reflected only via derivePendingCashReserve's ESTIMATE, not an
 * actual cash movement, until they settle.
 */
export function deriveCash(startingCapital: number, transactions: EngineTransaction[]): number {
  let cash = startingCapital;
  for (const tx of transactions) {
    if (tx.status !== "EXECUTED" || tx.priceAtTx == null) continue;
    const amount = tx.quantity * tx.priceAtTx;
    cash += tx.side === "SELL" ? amount : -amount;
  }
  return cash;
}

/**
 * Estimated rupee cash reserved by PENDING BUY orders, priced at each symbol's
 * LATEST KNOWN close (not the eventual fill price — that's unknown until
 * settlement). This is an ESTIMATE that exists purely to stop a user from placing
 * more BUY orders than they can plausibly afford at order-placement time; it is NOT
 * a guarantee of affordability at fill time. The settlement cron re-validates every
 * PENDING BUY against its REAL fill price and CANCELs it if the estimate turns out
 * to have been wrong (e.g. the stock gapped up between order placement and the next
 * session close) — see settleTransaction below.
 *
 * Symbols with no known close are silently excluded from the reserve; validation at
 * order-placement time should already have rejected orders for unknown symbols
 * before they ever reach PENDING, so this is a defensive fallback, not a real path.
 */
export function derivePendingCashReserve(
  pendingTransactions: EngineTransaction[],
  latestCloseBySymbol: ReadonlyMap<string, number>
): number {
  let reserve = 0;
  for (const tx of pendingTransactions) {
    if (tx.status !== "PENDING" || tx.side !== "BUY") continue;
    const close = latestCloseBySymbol.get(tx.symbol);
    if (close == null) continue;
    reserve += tx.quantity * close;
  }
  return reserve;
}

/** Total quantity already queued for sale across a portfolio's PENDING SELL orders, per symbol. */
export function derivePendingSellQtyBySymbol(pendingTransactions: EngineTransaction[]): Map<string, number> {
  const result = new Map<string, number>();
  for (const tx of pendingTransactions) {
    if (tx.status !== "PENDING" || tx.side !== "SELL") continue;
    result.set(tx.symbol, (result.get(tx.symbol) ?? 0) + tx.quantity);
  }
  return result;
}

export interface PortfolioValuation {
  cash: number;
  holdingsValue: number;
  totalValue: number;
  /** (totalValue - startingCapital) / startingCapital. */
  returnPct: number;
}

/**
 * Values a set of holdings against a per-symbol close lookup for one session.
 * A symbol held but missing from `closeBySymbol` is valued at 0 for THIS call —
 * callers that need last-known-close carry-forward (the nightly valuation cron, for
 * a symbol that didn't trade on a given session) must build `closeBySymbol` with
 * that carry-forward already applied (see buildCloseCarryForward) before calling.
 */
export function valuePortfolio(
  holdings: ReadonlyMap<string, HoldingLot>,
  cash: number,
  closeBySymbol: ReadonlyMap<string, number>,
  startingCapital: number
): PortfolioValuation {
  let holdingsValue = 0;
  for (const [symbol, lot] of holdings) {
    const close = closeBySymbol.get(symbol) ?? 0;
    holdingsValue += lot.quantity * close;
  }
  const totalValue = cash + holdingsValue;
  const returnPct = startingCapital > 0 ? (totalValue - startingCapital) / startingCapital : 0;
  return { cash, holdingsValue, totalValue, returnPct };
}

// ─── Order-placement-time validation ────────────────────────────────────────────

export interface TransactionValidationInput {
  side: EngineTxSide;
  quantity: number;
  symbol: string;
  /** deriveCash(...) - derivePendingCashReserve(...) as of "now". */
  availableCash: number;
  /** Latest known StockEodQuote.close for `symbol`, or null if the symbol has never traded. */
  estimatedPrice: number | null;
  /** EXECUTED-derived held quantity for `symbol` (0 if none). */
  heldQuantity: number;
  /** Quantity already queued for sale across other PENDING SELL orders for `symbol`. */
  pendingSellQuantity: number;
}

export type TransactionValidationResult = { ok: true } | { ok: false; reason: string };

/**
 * Order-placement-time (not settlement-time) validation for a new BUY/SELL request.
 * Cash-constrained + long-only: a BUY must be covered by available cash at the
 * latest known price (an estimate — see derivePendingCashReserve); a SELL cannot
 * exceed currently-held quantity net of already-pending sells (no shorting).
 */
export function validateNewTransaction(input: TransactionValidationInput): TransactionValidationResult {
  if (!Number.isInteger(input.quantity) || input.quantity < 1) {
    return { ok: false, reason: "Quantity must be a positive integer." };
  }

  if (input.side === "BUY") {
    if (input.estimatedPrice == null) {
      return { ok: false, reason: `No known price for ${input.symbol}.` };
    }
    const estimatedCost = input.quantity * input.estimatedPrice;
    if (estimatedCost > input.availableCash) {
      return {
        ok: false,
        reason: `Insufficient cash: this order needs an estimated ₹${estimatedCost.toFixed(2)}, but only ₹${input.availableCash.toFixed(2)} is available.`
      };
    }
    return { ok: true };
  }

  // SELL — long-only: cannot sell more than is actually held, net of other pending sells.
  const sellable = input.heldQuantity - input.pendingSellQuantity;
  if (input.quantity > sellable) {
    return {
      ok: false,
      reason: `Insufficient holdings: requested ${input.quantity}, only ${sellable} available to sell (${input.heldQuantity} held, ${input.pendingSellQuantity} already pending sale).`
    };
  }
  return { ok: true };
}

// ─── Settlement-time fill/reject ────────────────────────────────────────────────

export interface SettlementState {
  cash: number;
  holdings: Map<string, HoldingLot>;
}

export type SettlementOutcome =
  | { status: "EXECUTED"; priceAtTx: number; state: SettlementState }
  | { status: "CANCELLED"; note: string; state: SettlementState };

/**
 * Pure settlement-time fill/reject decision for one PENDING transaction, given the
 * portfolio's cash/holdings state immediately before this fill (i.e. after any
 * earlier PENDING orders in the same settlement run have already been applied) and
 * the ACTUAL session close price. This is the one place an order can still be
 * rejected after having passed validateNewTransaction at placement time — the
 * available-cash/holdings estimate used then can go stale by the time the order
 * actually fills (price moved, or an intervening SELL/BUY changed the position).
 * Rejection returns the state UNCHANGED (the order simply never happened).
 */
export function settleTransaction(
  state: SettlementState,
  transaction: { symbol: string; side: EngineTxSide; quantity: number },
  fillPrice: number
): SettlementOutcome {
  if (transaction.side === "BUY") {
    const cost = transaction.quantity * fillPrice;
    if (cost > state.cash) {
      return {
        status: "CANCELLED",
        note: `Insufficient cash at fill time: needed ₹${cost.toFixed(2)}, had ₹${state.cash.toFixed(2)}.`,
        state
      };
    }
    const existing = state.holdings.get(transaction.symbol) ?? EMPTY_LOT;
    const newHoldings = new Map(state.holdings);
    newHoldings.set(transaction.symbol, applyBuy(existing, transaction.quantity, fillPrice));
    return { status: "EXECUTED", priceAtTx: fillPrice, state: { cash: state.cash - cost, holdings: newHoldings } };
  }

  // SELL
  const existing = state.holdings.get(transaction.symbol) ?? EMPTY_LOT;
  if (transaction.quantity > existing.quantity) {
    return {
      status: "CANCELLED",
      note: `Insufficient holdings at fill time: requested ${transaction.quantity}, held ${existing.quantity}.`,
      state
    };
  }
  const proceeds = transaction.quantity * fillPrice;
  const updated = applySell(existing, transaction.quantity);
  const newHoldings = new Map(state.holdings);
  if (updated.quantity > 0) {
    newHoldings.set(transaction.symbol, updated);
  } else {
    newHoldings.delete(transaction.symbol);
  }
  return { status: "EXECUTED", priceAtTx: fillPrice, state: { cash: state.cash + proceeds, holdings: newHoldings } };
}

// ─── Close-price carry-forward (nightly valuation cron) ─────────────────────────

export interface QuotePoint {
  symbol: string;
  sessionDate: Date;
  close: number;
}

/**
 * Builds a (symbol, targetSessionDate) -> close lookup with last-known-close
 * carry-forward: if a symbol has no exact StockEodQuote row for targetSessionDate
 * (e.g. trading halt, or the symbol simply wasn't in that day's liquid-volume cut),
 * the most recent PRIOR close is used instead. Returns null from `getClose` if the
 * symbol has no quote at or before targetSessionDate at all.
 */
export function buildCloseCarryForward(quotes: QuotePoint[]): {
  getClose: (symbol: string, targetSessionDate: Date) => number | null;
} {
  const bySymbol = new Map<string, { sessionDate: Date; close: number }[]>();
  for (const q of quotes) {
    const list = bySymbol.get(q.symbol);
    if (list) {
      list.push({ sessionDate: q.sessionDate, close: q.close });
    } else {
      bySymbol.set(q.symbol, [{ sessionDate: q.sessionDate, close: q.close }]);
    }
  }
  for (const list of bySymbol.values()) {
    list.sort((a, b) => a.sessionDate.getTime() - b.sessionDate.getTime());
  }

  return {
    getClose(symbol: string, targetSessionDate: Date): number | null {
      const list = bySymbol.get(symbol);
      if (!list || list.length === 0) return null;

      const targetTime = targetSessionDate.getTime();
      // Binary search for the last entry with sessionDate <= target — a heavily
      // traded symbol can have hundreds of rows across the table's history.
      let lo = 0;
      let hi = list.length - 1;
      let result: number | null = null;
      while (lo <= hi) {
        const mid = (lo + hi) >> 1;
        if (list[mid].sessionDate.getTime() <= targetTime) {
          result = list[mid].close;
          lo = mid + 1;
        } else {
          hi = mid - 1;
        }
      }
      return result;
    }
  };
}
