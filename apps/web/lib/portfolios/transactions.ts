/**
 * Portfolios (P3.1) — write-side DB orchestration for placing/cancelling orders.
 * Order-placement-time validation uses the pure validateNewTransaction() from
 * packages/business-rules/src/portfolios/engine.ts; the actual fill/cancel decision
 * happens later, at settlement, in apps/api/lib/portfolios/settlement.ts.
 */

import type { EngineTransaction } from "@predict-future/business-rules/portfolios/engine";
import {
  deriveCash,
  deriveHoldings,
  derivePendingCashReserve,
  derivePendingSellQtyBySymbol,
  validateNewTransaction
} from "@predict-future/business-rules/portfolios/engine";
import type { TxSide, TxStatus } from "@prisma/client";

import { prisma } from "@/lib/prisma";
import { getLatestCloseBySymbol, symbolHasQuotes } from "@/lib/portfolios/queries";

export interface PlacedTransaction {
  id: string;
  symbol: string;
  side: TxSide;
  quantity: number;
  status: TxStatus;
  requestedAt: Date;
}

export type PlaceTransactionResult =
  | { ok: true; transaction: PlacedTransaction }
  | { ok: false; status: 404 | 403 | 422; reason: string };

/**
 * Places a new PENDING BUY/SELL order for `portfolioId` on behalf of `userId`.
 * Only the portfolio's own owner can trade it (SHADOW/expert-owned portfolios have
 * no owner user and so have no trading path through this API in P3.1).
 */
export async function placeTransaction(
  portfolioId: string,
  userId: string,
  input: { symbol: string; side: TxSide; quantity: number }
): Promise<PlaceTransactionResult> {
  const portfolio = await prisma.portfolio.findUnique({
    where: { id: portfolioId },
    select: { id: true, ownerUserId: true, startingCapital: true }
  });
  if (!portfolio) return { ok: false, status: 404, reason: "Portfolio not found." };
  if (portfolio.ownerUserId !== userId) {
    return { ok: false, status: 403, reason: "You do not own this portfolio." };
  }

  if (!(await symbolHasQuotes(input.symbol))) {
    return { ok: false, status: 422, reason: `Unknown symbol "${input.symbol}" — no price history available.` };
  }

  const [executedRows, pendingRows] = await Promise.all([
    prisma.portfolioTransaction.findMany({
      where: { portfolioId, status: "EXECUTED" },
      orderBy: { requestedAt: "asc" },
      select: { symbol: true, side: true, quantity: true, priceAtTx: true, status: true }
    }),
    prisma.portfolioTransaction.findMany({
      where: { portfolioId, status: "PENDING" },
      select: { symbol: true, side: true, quantity: true, priceAtTx: true, status: true }
    })
  ]);

  const executed = executedRows as EngineTransaction[];
  const pending = pendingRows as EngineTransaction[];
  const holdings = deriveHoldings(executed);
  const cash = deriveCash(portfolio.startingCapital, executed);

  const pendingSymbols = [...new Set(pending.filter((t) => t.side === "BUY").map((t) => t.symbol))];
  const closeBySymbol = await getLatestCloseBySymbol([...new Set([...pendingSymbols, input.symbol])]);

  const pendingReserve = derivePendingCashReserve(pending, closeBySymbol);
  const pendingSellQtyBySymbol = derivePendingSellQtyBySymbol(pending);

  const validation = validateNewTransaction({
    side: input.side,
    quantity: input.quantity,
    symbol: input.symbol,
    availableCash: cash - pendingReserve,
    estimatedPrice: closeBySymbol.get(input.symbol) ?? null,
    heldQuantity: holdings.get(input.symbol)?.quantity ?? 0,
    pendingSellQuantity: pendingSellQtyBySymbol.get(input.symbol) ?? 0
  });

  if (!validation.ok) {
    return { ok: false, status: 422, reason: validation.reason };
  }

  const transaction = await prisma.portfolioTransaction.create({
    data: {
      portfolioId,
      symbol: input.symbol,
      side: input.side,
      quantity: input.quantity,
      status: "PENDING"
    },
    select: { id: true, symbol: true, side: true, quantity: true, status: true, requestedAt: true }
  });

  return { ok: true, transaction };
}

export type CancelTransactionResult = { ok: true } | { ok: false; status: 404 | 403 | 409; reason: string };

/** Cancels a PENDING order. EXECUTED/CANCELLED rows are immutable — no path mutates them. */
export async function cancelTransaction(
  portfolioId: string,
  transactionId: string,
  userId: string
): Promise<CancelTransactionResult> {
  const portfolio = await prisma.portfolio.findUnique({
    where: { id: portfolioId },
    select: { ownerUserId: true }
  });
  if (!portfolio) return { ok: false, status: 404, reason: "Portfolio not found." };
  if (portfolio.ownerUserId !== userId) {
    return { ok: false, status: 403, reason: "You do not own this portfolio." };
  }

  const result = await prisma.portfolioTransaction.updateMany({
    where: { id: transactionId, portfolioId, status: "PENDING" },
    data: { status: "CANCELLED", note: "Cancelled by user." }
  });

  if (result.count === 0) {
    const exists = await prisma.portfolioTransaction.findFirst({ where: { id: transactionId, portfolioId } });
    if (!exists) return { ok: false, status: 404, reason: "Transaction not found." };
    return { ok: false, status: 409, reason: "Only PENDING orders can be cancelled." };
  }

  return { ok: true };
}
