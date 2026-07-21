/**
 * Portfolios (P3.1) — settlement orchestration for POST /api/cron/portfolios-settle.
 *
 * Execution rule (next-session-close, no lookahead): a PENDING transaction fills at
 * the close of the FIRST StockEodQuote session whose row was INGESTED (createdAt)
 * strictly after the transaction's requestedAt. Quotes ingest around 19:15 IST via
 * the market-moves-movers EOD pass (see apps/api/lib/marketMoves/bhavcopy.ts), so in
 * practice: an order placed at 14:00 IST Tuesday fills at Tuesday's close (that
 * row's createdAt, ~19:15 Tuesday, is after the 14:00 requestedAt); an order placed
 * at 20:00 IST Tuesday (after that day's ingest already ran) fills at Wednesday's
 * close instead — there is no way for an order to see a close that had already been
 * published before the order was placed.
 *
 * All pure cash/holdings math lives in
 * packages/business-rules/src/portfolios/engine.ts — this file is DB orchestration
 * only: load state, ask the engine for a decision, persist it.
 */

import {
  deriveCash,
  deriveHoldings,
  settleTransaction,
  type EngineTransaction,
  type SettlementState
} from "@predict-future/business-rules/portfolios/engine";

import { prisma } from "@/lib/prisma";

export interface SettlementRunResult {
  portfoliosScanned: number;
  executed: number;
  cancelled: number;
  stillPending: number;
  errors: number;
}

/**
 * Fills or cancels every eligible PENDING PortfolioTransaction across every
 * portfolio that has at least one. Never throws — per-portfolio failures are caught
 * and counted so one bad portfolio can't block the rest of the run (cron routes must
 * never throw, per the CRON_SECRET-gated route convention used across this app).
 * Idempotent: a transaction is only ever picked up while status is still PENDING,
 * and each write is itself guarded by an optimistic `updateMany({ where: { status:
 * "PENDING" } })` so a concurrent/overlapping invocation can't double-fill a row.
 */
export async function settlePendingTransactions(): Promise<SettlementRunResult> {
  const result: SettlementRunResult = {
    portfoliosScanned: 0,
    executed: 0,
    cancelled: 0,
    stillPending: 0,
    errors: 0
  };

  const portfoliosWithPending = await prisma.portfolioTransaction.findMany({
    where: { status: "PENDING" },
    select: { portfolioId: true },
    distinct: ["portfolioId"]
  });

  for (const { portfolioId } of portfoliosWithPending) {
    result.portfoliosScanned += 1;
    try {
      await settlePortfolio(portfolioId, result);
    } catch (err) {
      result.errors += 1;
      console.error(`[cron/portfolios-settle] portfolio ${portfolioId} failed:`, err);
    }
  }

  return result;
}

async function settlePortfolio(portfolioId: string, result: SettlementRunResult): Promise<void> {
  const portfolio = await prisma.portfolio.findUnique({
    where: { id: portfolioId },
    select: { startingCapital: true }
  });
  if (!portfolio) return; // deleted mid-run — nothing to settle

  const executedRows = await prisma.portfolioTransaction.findMany({
    where: { portfolioId, status: "EXECUTED" },
    orderBy: { requestedAt: "asc" },
    select: { symbol: true, side: true, quantity: true, priceAtTx: true, status: true }
  });

  const pendingRows = await prisma.portfolioTransaction.findMany({
    where: { portfolioId, status: "PENDING" },
    orderBy: { requestedAt: "asc" },
    select: { id: true, symbol: true, side: true, quantity: true, requestedAt: true }
  });

  // Seed settlement state from the portfolio's already-EXECUTED history, then
  // process each PENDING order oldest-first so a fill earlier in this same run
  // (e.g. a BUY) is reflected in the cash/holdings available to a later one.
  let state: SettlementState = {
    cash: deriveCash(portfolio.startingCapital, executedRows as EngineTransaction[]),
    holdings: deriveHoldings(executedRows as EngineTransaction[])
  };

  for (const tx of pendingRows) {
    // No-lookahead execution rule: eligible session = first StockEodQuote row for
    // this symbol ingested strictly after the order was placed.
    const eligibleQuote = await prisma.stockEodQuote.findFirst({
      where: { symbol: tx.symbol, createdAt: { gt: tx.requestedAt } },
      orderBy: { sessionDate: "asc" },
      select: { sessionDate: true, close: true }
    });

    if (!eligibleQuote) {
      result.stillPending += 1;
      continue; // no session has ingested since this order was placed — try again next run
    }

    const outcome = settleTransaction(state, tx, eligibleQuote.close);

    const updateResult = await prisma.portfolioTransaction.updateMany({
      where: { id: tx.id, status: "PENDING" },
      data:
        outcome.status === "EXECUTED"
          ? {
              status: "EXECUTED",
              executionSessionDate: eligibleQuote.sessionDate,
              priceAtTx: outcome.priceAtTx
            }
          : {
              status: "CANCELLED",
              executionSessionDate: eligibleQuote.sessionDate,
              note: outcome.note
            }
    });

    if (updateResult.count === 0) {
      // A concurrent invocation already settled this row first. Don't trust our
      // speculative in-memory state for the REST of this run either — bail out of
      // this portfolio's loop early; whatever's left over self-heals on the next
      // cron tick, which always recomputes cash/holdings fresh from the DB.
      return;
    }

    state = outcome.state;
    if (outcome.status === "EXECUTED") result.executed += 1;
    else result.cancelled += 1;
  }
}
