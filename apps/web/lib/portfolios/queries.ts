/**
 * Portfolios (P3.1) — read-side DB orchestration for apps/web/app/api/portfolios/*.
 *
 * All derived math (cash, holdings, NAV, return%) comes from the pure functions in
 * packages/business-rules/src/portfolios/engine.ts — Portfolio itself has no
 * mutable nav/cash/holdings columns (see the schema doc on model Portfolio).
 */

import type { EngineTransaction } from "@predict-future/business-rules/portfolios/engine";
import { deriveCash, deriveHoldings, valuePortfolio } from "@predict-future/business-rules/portfolios/engine";

import { prisma } from "@/lib/prisma";

const EXECUTED_TX_SELECT = {
  symbol: true,
  side: true,
  quantity: true,
  priceAtTx: true,
  status: true
} as const;

/**
 * Latest known StockEodQuote.close per symbol (any session — not scoped to "today"),
 * used both as the estimate for pending-order cash reservation and for live NAV.
 * One row per requested symbol via DISTINCT ON (symbol) ORDER BY sessionDate DESC.
 */
export async function getLatestCloseBySymbol(symbols: string[]): Promise<Map<string, number>> {
  if (symbols.length === 0) return new Map();
  const rows = await prisma.stockEodQuote.findMany({
    where: { symbol: { in: symbols } },
    select: { symbol: true, close: true },
    orderBy: { sessionDate: "desc" },
    distinct: ["symbol"]
  });
  return new Map(rows.map((r) => [r.symbol, r.close]));
}

export async function symbolHasQuotes(symbol: string): Promise<boolean> {
  const row = await prisma.stockEodQuote.findFirst({ where: { symbol }, select: { id: true } });
  return row !== null;
}

export interface LivePortfolioState {
  cash: number;
  holdings: Map<string, { quantity: number; costBasis: number; avgCost: number }>;
}

/** Live cash + holdings derived from a portfolio's EXECUTED transaction history. */
export async function getLivePortfolioState(portfolioId: string, startingCapital: number): Promise<LivePortfolioState> {
  const executedRows = await prisma.portfolioTransaction.findMany({
    where: { portfolioId, status: "EXECUTED" },
    orderBy: { requestedAt: "asc" },
    select: EXECUTED_TX_SELECT
  });
  const transactions = executedRows as EngineTransaction[];
  return {
    cash: deriveCash(startingCapital, transactions),
    holdings: deriveHoldings(transactions)
  };
}

export interface PortfolioListItem {
  id: string;
  slug: string;
  name: string;
  visibility: "PUBLIC" | "PRIVATE";
  description: string | null;
  startingCapital: number;
  createdAt: Date;
  publicSince: Date | null;
  latestCachedValue: {
    sessionDate: Date;
    cash: number;
    holdingsValue: number;
    totalValue: number;
    returnPct: number;
  } | null;
  live: {
    cash: number;
    holdingsValue: number;
    totalValue: number;
    returnPct: number;
  };
}

/**
 * Own portfolios with both the latest nightly-cron cache row (may be stale by up to
 * a day, or absent for a brand-new portfolio) AND a live-computed snapshot (always
 * fresh — priced at each held symbol's latest known close).
 */
export async function listMyPortfolios(ownerUserId: string): Promise<PortfolioListItem[]> {
  const portfolios = await prisma.portfolio.findMany({
    where: { ownerUserId },
    orderBy: { createdAt: "desc" },
    include: {
      dailyValues: { orderBy: { sessionDate: "desc" }, take: 1 }
    }
  });

  const results: PortfolioListItem[] = [];
  for (const portfolio of portfolios) {
    const { cash, holdings } = await getLivePortfolioState(portfolio.id, portfolio.startingCapital);
    const closeBySymbol = await getLatestCloseBySymbol([...holdings.keys()]);
    const live = valuePortfolio(holdings, cash, closeBySymbol, portfolio.startingCapital);
    const latest = portfolio.dailyValues[0];

    results.push({
      id: portfolio.id,
      slug: portfolio.slug,
      name: portfolio.name,
      visibility: portfolio.visibility,
      description: portfolio.description,
      startingCapital: portfolio.startingCapital,
      createdAt: portfolio.createdAt,
      publicSince: portfolio.publicSince,
      latestCachedValue: latest
        ? {
            sessionDate: latest.sessionDate,
            cash: latest.cash,
            holdingsValue: latest.holdingsValue,
            totalValue: latest.totalValue,
            returnPct: latest.returnPct
          }
        : null,
      live
    });
  }
  return results;
}

export type PortfolioDetailAccess = "owner" | "public" | "denied" | "not-found";

export interface PortfolioDetail {
  id: string;
  slug: string;
  name: string;
  visibility: "PUBLIC" | "PRIVATE";
  description: string | null;
  startingCapital: number;
  createdAt: Date;
  publicSince: Date | null;
  isOwner: boolean;
  holdings: { symbol: string; quantity: number; costBasis: number; avgCost: number; latestClose: number | null }[];
  live: { cash: number; holdingsValue: number; totalValue: number; returnPct: number };
  dailyValues: { sessionDate: Date; cash: number; holdingsValue: number; totalValue: number; returnPct: number }[];
  /** Owner-only — pending trading intentions are not exposed to public viewers. */
  pendingTransactions:
    | { id: string; symbol: string; side: "BUY" | "SELL"; quantity: number; requestedAt: Date }[]
    | null;
  executedTransactionCount: number;
}

/**
 * Resolves access + builds the full detail payload in one pass. Returns access
 * "not-found" / "denied" with `detail: null` for the route handler to translate into
 * the right HTTP status without a second round trip.
 */
export async function getPortfolioDetail(
  portfolioId: string,
  viewerUserId: string | null
): Promise<{ access: PortfolioDetailAccess; detail: PortfolioDetail | null }> {
  const portfolio = await prisma.portfolio.findUnique({ where: { id: portfolioId } });
  if (!portfolio) return { access: "not-found", detail: null };

  const isOwner = portfolio.ownerUserId !== null && portfolio.ownerUserId === viewerUserId;
  if (!isOwner && portfolio.visibility !== "PUBLIC") {
    return { access: "denied", detail: null };
  }

  const { cash, holdings } = await getLivePortfolioState(portfolio.id, portfolio.startingCapital);
  const closeBySymbol = await getLatestCloseBySymbol([...holdings.keys()]);
  const live = valuePortfolio(holdings, cash, closeBySymbol, portfolio.startingCapital);

  const dailyValueRows = await prisma.portfolioDailyValue.findMany({
    where: { portfolioId: portfolio.id },
    orderBy: { sessionDate: "asc" }
  });

  const executedTransactionCount = await prisma.portfolioTransaction.count({
    where: { portfolioId: portfolio.id, status: "EXECUTED" }
  });

  let pendingTransactions: PortfolioDetail["pendingTransactions"] = null;
  if (isOwner) {
    const rows = await prisma.portfolioTransaction.findMany({
      where: { portfolioId: portfolio.id, status: "PENDING" },
      orderBy: { requestedAt: "desc" },
      select: { id: true, symbol: true, side: true, quantity: true, requestedAt: true }
    });
    pendingTransactions = rows;
  }

  const detail: PortfolioDetail = {
    id: portfolio.id,
    slug: portfolio.slug,
    name: portfolio.name,
    visibility: portfolio.visibility,
    description: portfolio.description,
    startingCapital: portfolio.startingCapital,
    createdAt: portfolio.createdAt,
    publicSince: portfolio.publicSince,
    isOwner,
    holdings: [...holdings.entries()].map(([symbol, lot]) => ({
      symbol,
      quantity: lot.quantity,
      costBasis: lot.costBasis,
      avgCost: lot.avgCost,
      latestClose: closeBySymbol.get(symbol) ?? null
    })),
    live,
    dailyValues: dailyValueRows.map((row) => ({
      sessionDate: row.sessionDate,
      cash: row.cash,
      holdingsValue: row.holdingsValue,
      totalValue: row.totalValue,
      returnPct: row.returnPct
    })),
    pendingTransactions,
    executedTransactionCount
  };

  return { access: isOwner ? "owner" : "public", detail };
}

export interface SymbolSearchResult {
  symbol: string;
  companyName: string;
  close: number;
  sessionDate: Date;
}

/**
 * Symbol/company search over StockEodQuote's latest available session. Web has no
 * access to apps/api's fetchEquityNames equity-master fallback (server-only, lives
 * in apps/api) — DISTINCT StockEodQuote symbols is a fine substitute here since it's
 * also the exact universe portfolios can actually trade (a symbol with no quote
 * history can't be priced, so it couldn't be validated for a BUY/SELL anyway).
 */
export async function searchSymbols(query: string, limit = 20): Promise<SymbolSearchResult[]> {
  const trimmed = query.trim();
  if (trimmed.length === 0) return [];

  const latestSession = await prisma.stockEodQuote.findFirst({
    orderBy: { sessionDate: "desc" },
    select: { sessionDate: true }
  });
  if (!latestSession) return [];

  const rows = await prisma.stockEodQuote.findMany({
    where: {
      sessionDate: latestSession.sessionDate,
      OR: [{ symbol: { startsWith: trimmed.toUpperCase() } }, { companyName: { contains: trimmed, mode: "insensitive" } }]
    },
    select: { symbol: true, companyName: true, close: true, sessionDate: true },
    orderBy: { symbol: "asc" },
    take: limit
  });
  return rows;
}
