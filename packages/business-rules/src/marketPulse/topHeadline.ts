/**
 * Market Pulse "why is it moving" headline join — picks the single latest,
 * non-blocklisted-publisher MarketMoveNews headline per ticker out of a
 * batch fetched with one grouped/IN query (never N+1), for attachment onto
 * Top Movers rows on both apps/api's `/api/finance/market-moves/movers`
 * route (mobile) and apps/web's `fetchTopMovers` (web).
 *
 * Pure — no I/O, no Prisma import — mirrors newsQuality.ts's structural-type
 * pattern so it runs identically in both apps against their own local row
 * shapes.
 */

import { isBlockedPublisher, type StockNewsRow } from "./newsQuality";

/** Shape attached to a mover row as `topHeadline`. */
export type TopHeadline = {
  headline: string;
  sourceUrl: string;
  publisher: string;
};

/**
 * Reduces a batch of MarketMoveNews-shaped rows (any order — not required to
 * be pre-sorted) to a map of tickerSymbol -> its single latest surviving
 * headline. Blocklisted-publisher rows (see isBlockedPublisher) are dropped
 * entirely first, so junk publishers can never surface as a "why is it
 * moving" headline. Callers should pre-filter rows to a recency window
 * (e.g. last 3 days) before calling this — it does no date filtering itself.
 */
export function pickLatestHeadlinePerTicker<T extends StockNewsRow>(rows: T[]): Map<string, TopHeadline> {
  const latestByTicker = new Map<string, T>();

  for (const row of rows) {
    if (isBlockedPublisher(row)) continue;
    const existing = latestByTicker.get(row.tickerSymbol);
    if (!existing || row.publishedAt.getTime() > existing.publishedAt.getTime()) {
      latestByTicker.set(row.tickerSymbol, row);
    }
  }

  const result = new Map<string, TopHeadline>();
  for (const [tickerSymbol, row] of latestByTicker) {
    result.set(tickerSymbol, {
      headline: row.headline,
      sourceUrl: row.sourceUrl,
      publisher: row.publisher,
    });
  }
  return result;
}
