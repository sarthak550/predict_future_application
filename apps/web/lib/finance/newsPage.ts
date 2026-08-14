import { refineStockNews } from "@predict-future/business-rules";

import { prisma } from "@/lib/prisma";

/**
 * Cursor-paginated continuation of the Market Pulse stock-news feed, for
 * loading OLDER rows past a server-rendered first page. The first page
 * itself is still a plain bounded `take` (fetchLatestNews in marketPulse.ts
 * for /pulse, fetchInstrumentDetail's inline query in instrument.ts for a
 * per-symbol page) — this module only serves the "load more" continuation
 * a client component requests after that first page runs out, via
 * app/api/pulse/news/route.ts.
 *
 * Founder ask 2026-08-09: users were hard-capped at the first 100 stock-news
 * items on /pulse with no way to read older ones. Every query here stays
 * `take`-bounded (see MAX_ROUNDS below) — no unbounded findMany, per the
 * standing audit rule.
 */

export interface NewsPageRow {
  id: string;
  tickerSymbol: string;
  companyName: string;
  headline: string;
  publisher: string;
  sourceUrl: string;
  publishedAt: Date;
  summary: string | null;
}

export interface NewsPageCursor {
  publishedAt: Date;
  id: string;
}

export interface NewsPageResult {
  items: NewsPageRow[];
  hasMore: boolean;
  nextCursor: NewsPageCursor | null;
}

/** Max rows returned per request — matches the founder's "~50" spec and keeps every DB round bounded. */
export const MAX_NEWS_PAGE_TAKE = 50;
export const DEFAULT_NEWS_PAGE_TAKE = 50;

/**
 * Over-fetch factor per DB round-trip before the refineStockNews quality
 * pipeline (blocklist/dedup/near-dup-collapse/per-ticker-cap) shrinks the
 * set — mirrors the multiple fetchLatestNews and fetchInstrumentDetail
 * already use for their single-shot first page.
 */
const FETCH_MULTIPLE = 6;

/**
 * Hard ceiling on DB round-trips per page request. A heavy blocklist/near-dup
 * loss in one raw window (e.g. an old run of roundup-only headlines) can
 * leave a single round short of `take` — this lets the pipeline reach a few
 * rounds deeper for a full page, while every round stays a bounded
 * `take * FETCH_MULTIPLE` query, never an unbounded scan.
 */
const MAX_ROUNDS = 4;

export function encodeNewsPageCursor(input: { publishedAt: Date | string; id: string }): string {
  return `${new Date(input.publishedAt).toISOString()}::${input.id}`;
}

export function decodeNewsPageCursor(raw?: string | null): NewsPageCursor | null {
  if (!raw) return null;
  const sep = raw.lastIndexOf("::");
  if (sep === -1) return null;
  const publishedAtRaw = raw.slice(0, sep);
  const id = raw.slice(sep + 2);
  if (!id) return null;
  const publishedAt = new Date(publishedAtRaw);
  if (Number.isNaN(publishedAt.getTime())) return null;
  return { publishedAt, id };
}

/**
 * Ordering matches fetchLatestNews/fetchInstrumentDetail's news query exactly
 * — [{publishedAt: "desc"}, {id: "asc"}] — so a cursor built from the last
 * row either of them rendered continues the SAME sequence with no
 * duplicate/skipped row at the boundary, including ties (same-millisecond
 * publishedAt, which happens on burst ingestion): the WHERE below excludes
 * everything at-or-before the cursor's (publishedAt, id) pair under that
 * exact ordering.
 *
 * Runs refineStockNews per DB round-trip (not once globally) — a ticker
 * capped out on one round (MAX_PER_TICKER_PER_PAGE) can surface its older
 * rows on a later round/call, which is the pipeline's documented pagination
 * contract (see refineStockNews's doc comment in newsQuality.ts). One
 * consequence: near-duplicate collapse only compares rows WITHIN a round, so
 * a near-duplicate of an already-shown headline could in rare cases resurface
 * on a later page — accepted tradeoff, no exact-id duplicates or skips
 * result either way.
 */
export async function fetchNewsPage(input: {
  cursor: NewsPageCursor | null;
  take: number;
  tickerSymbol?: string;
  /** Index Constituent News (2026-08-15): scope to a SET of tickers (an index's members) instead of one. Takes precedence over `tickerSymbol` when both are passed. */
  tickerSymbols?: string[];
}): Promise<NewsPageResult> {
  const take = Math.max(1, Math.min(Math.floor(input.take) || DEFAULT_NEWS_PAGE_TAKE, MAX_NEWS_PAGE_TAKE));

  let cursor = input.cursor;
  const collected: NewsPageRow[] = [];
  let rawExhausted = false;

  for (let round = 0; round < MAX_ROUNDS && collected.length < take; round++) {
    const dbTake = take * FETCH_MULTIPLE;
    const rows = await prisma.marketMoveNews.findMany({
      where: {
        ...(input.tickerSymbols && input.tickerSymbols.length > 0
          ? { tickerSymbol: { in: input.tickerSymbols } }
          : input.tickerSymbol
            ? { tickerSymbol: input.tickerSymbol }
            : {}),
        ...(cursor
          ? {
              OR: [
                { publishedAt: { lt: cursor.publishedAt } },
                { publishedAt: cursor.publishedAt, id: { gt: cursor.id } },
              ],
            }
          : {}),
      },
      orderBy: [{ publishedAt: "desc" }, { id: "asc" }],
      take: dbTake,
      select: {
        id: true,
        tickerSymbol: true,
        companyName: true,
        headline: true,
        publisher: true,
        sourceUrl: true,
        publishedAt: true,
        summary: true,
      },
    });

    if (rows.length === 0) {
      rawExhausted = true;
      break;
    }

    const lastRaw = rows[rows.length - 1];
    cursor = { publishedAt: lastRaw.publishedAt, id: lastRaw.id };
    rawExhausted = rows.length < dbTake;

    collected.push(...refineStockNews(rows));

    if (rawExhausted) break;
  }

  const items = collected.slice(0, take);
  const hasMore = collected.length > take || !rawExhausted;

  // Any refined rows collected beyond `take` in the final over-fetch round
  // are deliberately NOT returned this call (page stays `take`-sized) — they
  // are still in the DB and will be re-fetched (and re-refined) on the next
  // call, since nextCursor is anchored to the boundary of what we actually
  // returned, not the raw DB fetch boundary. If nothing survived refinement
  // this round, fall back to the raw fetch boundary so the next call keeps
  // walking backward instead of re-querying the same exhausted window.
  const lastItem = items.at(-1);
  const nextCursor = lastItem ? { publishedAt: lastItem.publishedAt, id: lastItem.id } : (cursor ?? null);

  return { items, hasMore, nextCursor };
}
