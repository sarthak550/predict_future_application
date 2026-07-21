/**
 * Portfolios (P3.1) — valuation-cache orchestration for POST /api/cron/portfolios-value.
 *
 * PortfolioDailyValue is a CACHE, not a source of truth (see the schema doc on
 * model Portfolio) — every row here is fully recomputable from
 * (Portfolio.startingCapital, EXECUTED PortfolioTransaction rows, StockEodQuote
 * closes). This cron incrementally fills in any (portfolio, session) pair that's
 * missing a cached row, using the pure valuePortfolio()/deriveHoldings()/deriveCash()
 * functions from packages/business-rules/src/portfolios/engine.ts.
 *
 * "Sessions" here means calendar trading sessions, not per-symbol sessions: the set
 * of distinct StockEodQuote.sessionDate values across the WHOLE table, since a
 * session is a market-wide trading day. A symbol a portfolio holds that didn't
 * publish a quote on a given session (halt, or simply outside that day's liquidity
 * cut — see StockEodQuote's schema doc) is valued at its last known close instead of
 * being dropped or valued at 0 — see buildCloseCarryForward in the engine.
 */

import {
  buildCloseCarryForward,
  deriveCash,
  deriveHoldings,
  valuePortfolio,
  type EngineTransaction,
  type QuotePoint
} from "@predict-future/business-rules/portfolios/engine";

import { prisma } from "@/lib/prisma";

export interface ValuationRunResult {
  portfoliosProcessed: number;
  sessionsWritten: number;
  errors: number;
}

/**
 * Backfills PortfolioDailyValue for every portfolio with at least one EXECUTED
 * transaction, for any StockEodQuote session it's missing a cached row for.
 * Idempotent via the (portfolioId, sessionDate) unique constraint — upserts with an
 * empty `update` so re-running never overwrites an existing cached row, it only ever
 * fills gaps. Never throws — per-portfolio failures are caught and counted.
 */
export async function backfillDailyValues(): Promise<ValuationRunResult> {
  const result: ValuationRunResult = { portfoliosProcessed: 0, sessionsWritten: 0, errors: 0 };

  const sessionRows = await prisma.stockEodQuote.groupBy({
    by: ["sessionDate"],
    orderBy: { sessionDate: "asc" }
  });
  const allSessions = sessionRows.map((row) => row.sessionDate);
  if (allSessions.length === 0) return result;

  const portfoliosWithFills = await prisma.portfolioTransaction.findMany({
    where: { status: "EXECUTED" },
    select: { portfolioId: true },
    distinct: ["portfolioId"]
  });

  for (const { portfolioId } of portfoliosWithFills) {
    result.portfoliosProcessed += 1;
    try {
      result.sessionsWritten += await backfillPortfolio(portfolioId, allSessions);
    } catch (err) {
      result.errors += 1;
      console.error(`[cron/portfolios-value] portfolio ${portfolioId} failed:`, err);
    }
  }

  return result;
}

async function backfillPortfolio(portfolioId: string, allSessions: Date[]): Promise<number> {
  const portfolio = await prisma.portfolio.findUnique({
    where: { id: portfolioId },
    select: { startingCapital: true }
  });
  if (!portfolio) return 0;

  const executedRows = await prisma.portfolioTransaction.findMany({
    where: { portfolioId, status: "EXECUTED" },
    orderBy: { requestedAt: "asc" },
    select: {
      symbol: true,
      side: true,
      quantity: true,
      priceAtTx: true,
      status: true,
      executionSessionDate: true,
      requestedAt: true
    }
  });
  if (executedRows.length === 0) return 0;

  const settledAt = (tx: (typeof executedRows)[number]) => tx.executionSessionDate ?? tx.requestedAt;
  const earliestSession = executedRows.reduce(
    (min, tx) => (settledAt(tx) < min ? settledAt(tx) : min),
    settledAt(executedRows[0])
  );

  const existingValues = await prisma.portfolioDailyValue.findMany({
    where: { portfolioId },
    select: { sessionDate: true }
  });
  const existingDates = new Set(existingValues.map((v) => v.sessionDate.getTime()));

  const targetSessions = allSessions.filter(
    (session) => session.getTime() >= earliestSession.getTime() && !existingDates.has(session.getTime())
  );
  if (targetSessions.length === 0) return 0;

  // Carry-forward close lookup, scoped to every symbol this portfolio has ever traded.
  const symbols = [...new Set(executedRows.map((tx) => tx.symbol))];
  const quoteRows = await prisma.stockEodQuote.findMany({
    where: { symbol: { in: symbols } },
    select: { symbol: true, sessionDate: true, close: true }
  });
  const carryForward = buildCloseCarryForward(quoteRows as QuotePoint[]);

  let written = 0;
  for (const sessionDate of targetSessions) {
    const executedAsOf = executedRows.filter(
      (tx) => settledAt(tx).getTime() <= sessionDate.getTime()
    ) as EngineTransaction[];
    if (executedAsOf.length === 0) continue; // before this portfolio's first fill

    const holdings = deriveHoldings(executedAsOf);
    const cash = deriveCash(portfolio.startingCapital, executedAsOf);

    const closeBySymbol = new Map<string, number>();
    for (const symbol of holdings.keys()) {
      const close = carryForward.getClose(symbol, sessionDate);
      if (close != null) closeBySymbol.set(symbol, close);
    }

    const valuation = valuePortfolio(holdings, cash, closeBySymbol, portfolio.startingCapital);

    await prisma.portfolioDailyValue.upsert({
      where: { portfolioId_sessionDate: { portfolioId, sessionDate } },
      update: {},
      create: {
        portfolioId,
        sessionDate,
        cash: valuation.cash,
        holdingsValue: valuation.holdingsValue,
        totalValue: valuation.totalValue,
        returnPct: valuation.returnPct
      }
    });
    written += 1;
  }

  return written;
}
