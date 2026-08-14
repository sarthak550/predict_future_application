import { Prisma } from "@prisma/client";

import { prisma } from "@/lib/prisma";

/**
 * Latest-row-per-symbol lookups as real Postgres `DISTINCT ON` queries
 * (searchability-sweep finding #1's sibling fix, 2026-08-15).
 *
 * Prisma's findMany({distinct, orderBy}) does NOT push DISTINCT into SQL —
 * it pages EVERY matching row into the query engine and dedups client-side
 * (verified via pg_stat_activity: the emitted SQL has no LIMIT/DISTINCT at
 * all). For "latest quote per symbol" joins that means fetching a symbol's
 * entire multi-hundred-session history to keep one row — e.g. an index
 * composition join over ~750 constituents pulled ~190k rows per page
 * render, burning the exact Neon data-transfer quota that caused the
 * 2026-08-12 outage. `DISTINCT ON (symbol) ... ORDER BY symbol, sessionDate
 * DESC` returns exactly one row per symbol server-side.
 */

/** Latest close/changePercent per NSE symbol (any session — a symbol absent from the latest session still resolves to its most recent row). */
export async function latestStockQuoteBySymbol(
  symbols: string[]
): Promise<Array<{ symbol: string; close: number; changePercent: number | null }>> {
  if (symbols.length === 0) return [];
  return prisma.$queryRaw`
    SELECT DISTINCT ON ("symbol") "symbol", "close", "changePercent"
    FROM "StockEodQuote"
    WHERE "symbol" IN (${Prisma.join(symbols)})
    ORDER BY "symbol" ASC, "sessionDate" DESC
  `;
}

/** Latest close/changePercent per BSE-only tickerSymbol. */
export async function latestBseQuoteByTicker(
  tickers: string[]
): Promise<Array<{ tickerSymbol: string; close: number; changePercent: number | null }>> {
  if (tickers.length === 0) return [];
  return prisma.$queryRaw`
    SELECT DISTINCT ON ("tickerSymbol") "tickerSymbol", "close", "changePercent"
    FROM "BseEodQuote"
    WHERE "tickerSymbol" IN (${Prisma.join(tickers)})
    ORDER BY "tickerSymbol" ASC, "sessionDate" DESC
  `;
}

/** Latest ticker/companyName per BSE scrip code — bseIndexConstituents' member-resolution join. */
export async function latestBseRowByScripCode(
  scripCodes: string[]
): Promise<Array<{ scripCode: string; tickerSymbol: string; companyName: string }>> {
  if (scripCodes.length === 0) return [];
  return prisma.$queryRaw`
    SELECT DISTINCT ON ("scripCode") "scripCode", "tickerSymbol", "companyName"
    FROM "BseEodQuote"
    WHERE "scripCode" IN (${Prisma.join(scripCodes)})
    ORDER BY "scripCode" ASC, "sessionDate" DESC
  `;
}
