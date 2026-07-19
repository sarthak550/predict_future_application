import { prisma } from "@/lib/prisma";

const NEWS_LIMIT = 20;
const FILINGS_LIMIT = 10;

export interface MoverRow {
  tickerSymbol: string;
  companyName: string;
  changePercent: number;
  changeAbs: number;
  isUnusualVolume: boolean;
  rank: number;
}

export interface TopMovers {
  gainers: MoverRow[];
  losers: MoverRow[];
  asOf: Date | null;
}

/**
 * Reads the warm MarketMoverSnapshot store written by the market-moves-movers
 * cron (apps/api) — deliberately does NOT fetch NSE live on the request path
 * (see apps/api/app/api/finance/market-moves/movers/route.ts, which this
 * mirrors: a long-lived server process was observed serving stale NSE
 * responses over a persistent connection). Always returns the most recent
 * captured session so the strip stays populated after close/weekends/before
 * the first cron run of the day.
 */
export async function fetchTopMovers(): Promise<TopMovers> {
  const latest = await prisma.marketMoverSnapshot.findFirst({
    orderBy: { snapshotAt: "desc" },
    select: { sessionDate: true },
  });

  if (!latest) {
    return { gainers: [], losers: [], asOf: null };
  }

  const [gainers, losers] = await Promise.all([
    prisma.marketMoverSnapshot.findMany({
      where: { sessionDate: latest.sessionDate, direction: "GAINER" },
      orderBy: { rank: "asc" },
    }),
    prisma.marketMoverSnapshot.findMany({
      where: { sessionDate: latest.sessionDate, direction: "LOSER" },
      orderBy: { rank: "asc" },
    }),
  ]);

  const all = [...gainers, ...losers];
  const asOf = all.length > 0 ? new Date(Math.max(...all.map((m) => m.snapshotAt.getTime()))) : null;

  const shape = (m: (typeof gainers)[number]): MoverRow => ({
    tickerSymbol: m.tickerSymbol,
    companyName: m.companyName,
    changePercent: m.changePercent,
    changeAbs: m.changeAbs,
    isUnusualVolume: m.isUnusualVolume,
    rank: m.rank,
  });

  return { gainers: gainers.map(shape), losers: losers.map(shape), asOf };
}

export interface NewsRow {
  id: string;
  tickerSymbol: string;
  companyName: string;
  headline: string;
  publisher: string;
  sourceUrl: string;
  publishedAt: Date;
}

/**
 * Latest MarketMoveNews rows, newest first. Simplified relative to
 * apps/api/app/api/finance/market-moves/news/route.ts — that route runs a
 * multi-pass near-duplicate collapse (rewritten-headline clustering, per-
 * ticker cap) tied to apps/api-only helpers (lib/marketMoves/googleNews.ts)
 * that apps/web cannot import. This applies only an exact-headline dedup
 * (case-insensitive), which is the majority of the benefit for a public
 * SEO page at a fraction of the complexity. Revisit if visibly duplicated
 * headlines become a real quality complaint on this page specifically.
 */
export async function fetchLatestNews(limit = NEWS_LIMIT): Promise<NewsRow[]> {
  const rows = await prisma.marketMoveNews.findMany({
    orderBy: [{ publishedAt: "desc" }, { id: "asc" }],
    take: limit * 2,
    select: {
      id: true,
      tickerSymbol: true,
      companyName: true,
      headline: true,
      publisher: true,
      sourceUrl: true,
      publishedAt: true,
    },
  });

  const seen = new Set<string>();
  const deduped: NewsRow[] = [];
  for (const row of rows) {
    const key = row.headline.toLowerCase().replace(/[^a-z0-9]/g, "");
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(row);
    if (deduped.length >= limit) break;
  }

  return deduped;
}

export interface FilingRow {
  id: string;
  source: "NSE" | "BSE";
  tickerSymbol: string;
  companyName: string;
  eventType: string;
  headline: string;
  detailUrl: string | null;
  announcedAt: Date;
}

export async function fetchLatestFilings(limit = FILINGS_LIMIT): Promise<FilingRow[]> {
  const rows = await prisma.marketMoveEvent.findMany({
    orderBy: [{ announcedAt: "desc" }, { id: "asc" }],
    take: limit,
    select: {
      id: true,
      source: true,
      tickerSymbol: true,
      companyName: true,
      eventType: true,
      headline: true,
      detailUrl: true,
      announcedAt: true,
    },
  });

  return rows;
}
