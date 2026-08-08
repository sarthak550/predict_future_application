import {
  pickLatestAnalystCallPerTicker,
  pickLatestHeadlinePerTicker,
  refineStockNews,
  type TopHeadline,
} from "@predict-future/business-rules";
import type { OpinionDirection, OpinionResolutionStatus } from "@prisma/client";
import { canonicalizeOrgDisplay } from "@predict-future/business-rules/experts/firmAliases";

import { prisma } from "@/lib/prisma";

const NEWS_LIMIT = 20;
const FILINGS_LIMIT = 10;

/** "Why is it moving" headlines: only consider news from the last 3 days. */
const HEADLINE_LOOKBACK_DAYS = 3;
/** "Analyst said" badge: only consider opinions from the last 14 days. */
const ANALYST_CALL_LOOKBACK_DAYS = 14;

export interface MoverAnalystCall {
  analystName: string;
  analystSlug: string | null;
  analystOrganization: string;
  direction: OpinionDirection;
  resolutionStatus: OpinionResolutionStatus;
  publishedAt: Date;
}

export interface MoverRow {
  tickerSymbol: string;
  companyName: string;
  changePercent: number;
  changeAbs: number;
  lastPrice: number | null;
  isUnusualVolume: boolean;
  rank: number;
  topHeadline: TopHeadline | null;
  analystCall: MoverAnalystCall | null;
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
 * captured session for the requested universe so the strip stays populated
 * after close/weekends/before the first cron run of the day.
 *
 * `universe`: "popular" (NIFTY 100, the recognizable large-cap names —
 * DEFAULT) or "all" (every NSE-listed security, no market-cap cap — includes
 * circuit-hit microcaps). The cron writes both as parallel MarketMoverSnapshot
 * rows every run (see the `universe` column doc comment in schema.prisma), so
 * callers fetch each side of the toggle with a separate call to this function
 * (see /pulse's page.tsx, which fetches both up front for the tab pair).
 */
export async function fetchTopMovers(universe: "popular" | "all" = "popular"): Promise<TopMovers> {
  const universeColumn = universe === "all" ? "ALL" : "POPULAR";

  const latest = await prisma.marketMoverSnapshot.findFirst({
    where: { universe: universeColumn },
    orderBy: { snapshotAt: "desc" },
    select: { sessionDate: true },
  });

  if (!latest) {
    return { gainers: [], losers: [], asOf: null };
  }

  const [gainers, losers] = await Promise.all([
    prisma.marketMoverSnapshot.findMany({
      where: { sessionDate: latest.sessionDate, universe: universeColumn, direction: "GAINER", changePercent: { gt: 0 } },
      // Sort by the actual move, not stored rank (see the API movers route —
      // guards against mixed-generation rank collisions).
      orderBy: { changePercent: "desc" },
    }),
    prisma.marketMoverSnapshot.findMany({
      where: { sessionDate: latest.sessionDate, universe: universeColumn, direction: "LOSER", changePercent: { lt: 0 } },
      orderBy: { changePercent: "asc" },
    }),
  ]);

  const all = [...gainers, ...losers];
  const asOf = all.length > 0 ? new Date(Math.max(...all.map((m) => m.snapshotAt.getTime()))) : null;

  // "Why is it moving" headline + "analyst said" badge — a single grouped/IN
  // query per source (not N+1), joined in memory. See
  // packages/business-rules/src/marketPulse/{topHeadline,instrumentMatch}.ts.
  const symbols = [...new Set(all.map((m) => m.tickerSymbol))];
  const headlineSince = new Date(Date.now() - HEADLINE_LOOKBACK_DAYS * 24 * 60 * 60 * 1000);
  const analystCallSince = new Date(Date.now() - ANALYST_CALL_LOOKBACK_DAYS * 24 * 60 * 60 * 1000);

  const [newsRows, opinionRows] = symbols.length === 0
    ? [[], []]
    : await Promise.all([
        prisma.marketMoveNews.findMany({
          where: { tickerSymbol: { in: symbols }, publishedAt: { gte: headlineSince } },
          select: {
            id: true,
            tickerSymbol: true,
            companyName: true,
            headline: true,
            publisher: true,
            sourceUrl: true,
            publishedAt: true,
          },
        }),
        prisma.expertOpinion.findMany({
          where: { instrumentTicker: { not: null }, suppressedAt: null, publishedAt: { gte: analystCallSince } },
          select: {
            instrumentTicker: true,
            direction: true,
            resolutionStatus: true,
            publishedAt: true,
            expert: { select: { name: true, slug: true, organization: true } },
          },
        }),
      ]);

  // pickLatestHeadlinePerTicker drops blocklisted-publisher rows internally.
  const headlineByTicker = pickLatestHeadlinePerTicker(newsRows);
  const analystCallBySymbol = pickLatestAnalystCallPerTicker(opinionRows);

  const shape = (m: (typeof gainers)[number]): MoverRow => {
    const analystCallRow = analystCallBySymbol.get(m.tickerSymbol.toUpperCase());
    return {
      tickerSymbol: m.tickerSymbol,
      companyName: m.companyName,
      changePercent: m.changePercent,
      changeAbs: m.changeAbs,
      lastPrice: m.lastPrice,
      isUnusualVolume: m.isUnusualVolume,
      rank: m.rank, // overwritten below with the sorted position
      topHeadline: headlineByTicker.get(m.tickerSymbol) ?? null,
      analystCall: analystCallRow
        ? {
            analystName: analystCallRow.expert.name,
            analystSlug: analystCallRow.expert.slug,
            analystOrganization: canonicalizeOrgDisplay(analystCallRow.expert.organization),
            direction: analystCallRow.direction,
            resolutionStatus: analystCallRow.resolutionStatus,
            publishedAt: analystCallRow.publishedAt,
          }
        : null,
    };
  };

  // Renumber ranks to the sorted position so the displayed number always
  // matches the order (stored ranks can collide across write generations).
  return {
    gainers: gainers.map(shape).map((m, i) => ({ ...m, rank: i + 1 })),
    losers: losers.map(shape).map((m, i) => ({ ...m, rank: i + 1 })),
    asOf,
  };
}

export interface NewsRow {
  id: string;
  tickerSymbol: string;
  companyName: string;
  headline: string;
  publisher: string;
  sourceUrl: string;
  publishedAt: Date;
  summary: string | null;
}

/**
 * Latest MarketMoveNews rows, newest first, run through the same read-side
 * quality pipeline as apps/api/app/api/finance/market-moves/news/route.ts
 * (near-duplicate collapse across NSE/BSE twin rows and reworded headlines,
 * publisher-credibility blocklist, trusted-publisher tie-break, per-ticker
 * cap) — see packages/business-rules/src/marketPulse/newsQuality.ts. Both
 * apps share one implementation so this public SEO page no longer shows the
 * full unfiltered mess that only an exact-headline dedup used to leave
 * behind.
 */
export async function fetchLatestNews(limit = NEWS_LIMIT): Promise<NewsRow[]> {
  const rows = await prisma.marketMoveNews.findMany({
    orderBy: [{ publishedAt: "desc" }, { id: "asc" }],
    take: limit * 6,
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

  return refineStockNews(rows, { limit });
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
