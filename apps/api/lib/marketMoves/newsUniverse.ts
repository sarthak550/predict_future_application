/**
 * Market Pulse (Phase 1c) — builds the capped ticker universe the news cron
 * fetches Google News for on each run. Google News is queried per-stock (no
 * single feed covers "all Indian stocks"), so the universe must stay small
 * and high-signal — never all ~2000 NSE tickers (see Decision 1 in the CTO
 * assignment brief).
 *
 * Union of:
 *   - Top Movers: today's MarketMoverSnapshot, rank <= 10 per direction
 *     (20 tickers) — deeper than the mobile strip's visible 5+5 since movers
 *     rotate through the session and this is a fetch-side cap, not a display cap.
 *   - Material-filing tickers: distinct tickerSymbol from MarketMoveEvent in
 *     the last 24h with eventType != OTHER_MATERIAL (reusing the existing
 *     classifier as a free relevance filter), capped at 40, most-recent-first.
 *
 * Deduped, hard-capped at 60 tickers/refresh, movers prioritized first (the
 * smaller, higher-attention set) then most-recent filing tickers.
 */

import { prisma } from "@/lib/prisma";
import { getIstSessionDate } from "./marketHours";

const TOP_MOVERS_PER_DIRECTION = 10;
const MATERIAL_FILING_LOOKBACK_HOURS = 24;
const MATERIAL_FILING_TICKER_CAP = 40;
const UNIVERSE_HARD_CAP = 60;

export type NewsUniverseTicker = {
  tickerSymbol: string;
  companyName: string;
};

/**
 * Builds today's capped ticker universe. Never throws — a failure on either
 * half (movers or filings) degrades to an empty contribution from that half
 * rather than failing the whole build, so a partial universe is still fetched.
 */
export async function buildNewsUniverse(now: Date = new Date()): Promise<NewsUniverseTicker[]> {
  const [moverTickers, filingTickers] = await Promise.all([
    fetchTopMoverTickers(now).catch((err: unknown) => {
      console.error("[marketMoves/newsUniverse] mover lookup failed:", err);
      return [] as NewsUniverseTicker[];
    }),
    fetchMaterialFilingTickers(now).catch((err: unknown) => {
      console.error("[marketMoves/newsUniverse] filing lookup failed:", err);
      return [] as NewsUniverseTicker[];
    }),
  ]);

  const seen = new Set<string>();
  const universe: NewsUniverseTicker[] = [];

  // Movers first — the smaller, higher-attention set (Decision 1 priority order).
  for (const ticker of [...moverTickers, ...filingTickers]) {
    const key = ticker.tickerSymbol.trim().toUpperCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    universe.push(ticker);
    if (universe.length >= UNIVERSE_HARD_CAP) break;
  }

  return universe;
}

async function fetchTopMoverTickers(now: Date): Promise<NewsUniverseTicker[]> {
  const sessionDate = getIstSessionDate(now);
  const rows = await prisma.marketMoverSnapshot.findMany({
    where: { sessionDate, rank: { lte: TOP_MOVERS_PER_DIRECTION } },
    select: { tickerSymbol: true, companyName: true, direction: true, rank: true },
    orderBy: [{ direction: "asc" }, { rank: "asc" }],
  });

  return rows.map((r) => ({ tickerSymbol: r.tickerSymbol, companyName: r.companyName }));
}

async function fetchMaterialFilingTickers(now: Date): Promise<NewsUniverseTicker[]> {
  const since = new Date(now.getTime() - MATERIAL_FILING_LOOKBACK_HOURS * 60 * 60 * 1000);
  const rows = await prisma.marketMoveEvent.findMany({
    where: {
      announcedAt: { gte: since },
      eventType: { not: "OTHER_MATERIAL" },
    },
    select: { tickerSymbol: true, companyName: true },
    // orderBy before distinct → Postgres DISTINCT ON (tickerSymbol) ORDER BY
    // announcedAt DESC, so we keep the most-recent filing's company name per ticker.
    orderBy: { announcedAt: "desc" },
    distinct: ["tickerSymbol"],
    take: MATERIAL_FILING_TICKER_CAP,
  });

  return rows.map((r) => ({ tickerSymbol: r.tickerSymbol, companyName: r.companyName }));
}
