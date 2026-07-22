import { nseSymbolMatchesInstrumentTicker, refineStockNews } from "@predict-future/business-rules";
import type { OpinionDirection, OpinionResolutionStatus } from "@prisma/client";

import { prisma } from "@/lib/prisma";

// Enough sessions for a 1Y timeframe on the interactive chart (~250 trading
// days) — the mobile API keeps its own smaller window.
const SPARK_SESSIONS = 260;
const NEWS_LIMIT = 10;
/** Over-fetch factor before the refineStockNews quality pipeline (dedup/quality can only shrink the set). */
const NEWS_FETCH_MULTIPLE = 6;
const FILINGS_LIMIT = 10;
const OPINIONS_LIMIT = 10;
/** Opinions considered "recent enough to match" for both the returned list and the sentiment split. */
const OPINION_LOOKBACK_DAYS = 90;

export interface InstrumentQuote {
  sessionDate: Date;
  close: number;
  prevClose: number;
  changePercent: number;
  volume: number;
  deliveryPct: number | null;
}

export interface InstrumentSparkPoint {
  sessionDate: Date;
  close: number;
}

export interface InstrumentNewsRow {
  id: string;
  tickerSymbol: string;
  companyName: string;
  headline: string;
  publisher: string;
  sourceUrl: string;
  publishedAt: Date;
}

export interface InstrumentFilingRow {
  id: string;
  source: "NSE" | "BSE";
  tickerSymbol: string;
  companyName: string;
  eventType: string;
  headline: string;
  detailUrl: string | null;
  announcedAt: Date;
}

export interface InstrumentOpinionRow {
  id: string;
  quote: string;
  headline: string | null;
  instrument: string | null;
  sourceUrl: string;
  direction: OpinionDirection;
  publishedAt: Date;
  resolutionStatus: OpinionResolutionStatus;
  resolutionNote: string | null;
  resolvedAt: Date | null;
  expert: { name: string; slug: string | null };
}

export interface InstrumentSentiment {
  bullish: number;
  bearish: number;
  neutral: number;
  totalCount: number;
  /** Days the sentiment split is computed over — surfaced so the UI's copy always matches the actual window. */
  lookbackDays: number;
}

export interface InstrumentDetail {
  symbol: string;
  companyName: string;
  quote: InstrumentQuote | null;
  spark: InstrumentSparkPoint[];
  news: InstrumentNewsRow[];
  filings: InstrumentFilingRow[];
  opinions: InstrumentOpinionRow[];
  sentiment: InstrumentSentiment;
}

/**
 * Market Pulse Phase 2 — instrument tap-through detail. Mirrors the query
 * shape of GET /api/finance/instruments/[symbol] (apps/api) but runs Prisma
 * directly against the shared DB rather than hopping HTTP to apps/api, per
 * this app's SSR/ISR convention (see fetchTopMovers/fetchLatestNews in
 * lib/finance/marketPulse.ts, getSentimentSplit in lib/finance/sentiment.ts).
 * KEEP THE MATCHING LOGIC IN LOCKSTEP with that route: both filter
 * ExpertOpinion by a startsWith(`${symbol}.`) prefix on instrumentTicker,
 * re-verified in memory with the shared nseSymbolMatchesInstrumentTicker
 * matcher, and both apply the shared refineStockNews quality pipeline to
 * MarketMoveNews.
 *
 * Returns `null` when the symbol is entirely unknown — no quote AND no news
 * AND no filings AND no opinions in the lookback window. A symbol with
 * content but no quote yet (bhavcopy not seeded) still resolves — callers
 * render a "price data pending" state rather than notFound() in that case.
 */
export async function fetchInstrumentDetail(rawSymbol: string): Promise<InstrumentDetail | null> {
  const symbol = rawSymbol.trim().toUpperCase();
  if (!symbol) return null;

  const opinionSince = new Date(Date.now() - OPINION_LOOKBACK_DAYS * 24 * 60 * 60 * 1000);

  const [latestQuote, sparkRows, newsRows, filings, opinionCandidates] = await Promise.all([
    prisma.stockEodQuote.findFirst({
      where: { symbol },
      orderBy: { sessionDate: "desc" },
    }),
    prisma.stockEodQuote.findMany({
      where: { symbol },
      orderBy: { sessionDate: "desc" },
      take: SPARK_SESSIONS,
      select: { sessionDate: true, close: true },
    }),
    prisma.marketMoveNews.findMany({
      where: { tickerSymbol: symbol },
      orderBy: [{ publishedAt: "desc" }, { id: "asc" }],
      take: NEWS_LIMIT * NEWS_FETCH_MULTIPLE,
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
    prisma.marketMoveEvent.findMany({
      where: { tickerSymbol: symbol },
      orderBy: [{ announcedAt: "desc" }, { id: "asc" }],
      take: FILINGS_LIMIT,
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
    }),
    // See the apps/api route's identical comment: startsWith(`${symbol}.`) is
    // a safe exact match on the Yahoo-style instrumentTicker ("RELIANCE.NS"),
    // cheaper than the unfiltered all-tickers scans the movers routes already
    // run in production. No index on instrumentTicker exists yet — acceptable
    // at current table size, same as those routes.
    prisma.expertOpinion.findMany({
      where: {
        suppressedAt: null,
        instrumentTicker: { startsWith: `${symbol}.`, mode: "insensitive" },
        publishedAt: { gte: opinionSince },
      },
      orderBy: { publishedAt: "desc" },
      select: {
        id: true,
        quote: true,
        headline: true,
        instrument: true,
        sourceUrl: true,
        instrumentTicker: true,
        direction: true,
        publishedAt: true,
        resolutionStatus: true,
        resolutionNote: true,
        resolvedAt: true,
        expert: { select: { name: true, slug: true } },
      },
    }),
  ]);

  // Belt-and-suspenders re-check with the shared matcher, same as the API route.
  const matchedOpinions = opinionCandidates.filter(
    (o) => o.instrumentTicker != null && nseSymbolMatchesInstrumentTicker(symbol, o.instrumentTicker)
  );

  const news = refineStockNews(newsRows, { limit: NEWS_LIMIT });

  const hasAnyContent = latestQuote != null || news.length > 0 || filings.length > 0 || matchedOpinions.length > 0;
  if (!hasAnyContent) return null;

  const companyName = latestQuote?.companyName ?? filings[0]?.companyName ?? newsRows[0]?.companyName ?? symbol;

  const sentimentCounts = matchedOpinions.reduce(
    (acc, o) => {
      if (o.direction === "BULLISH") acc.bullish += 1;
      else if (o.direction === "BEARISH") acc.bearish += 1;
      else acc.neutral += 1;
      return acc;
    },
    { bullish: 0, bearish: 0, neutral: 0 }
  );

  return {
    symbol,
    companyName,
    quote: latestQuote,
    spark: sparkRows.slice().reverse(),
    news,
    filings,
    opinions: matchedOpinions.slice(0, OPINIONS_LIMIT).map((o) => ({
      id: o.id,
      quote: o.quote,
      headline: o.headline,
      instrument: o.instrument,
      sourceUrl: o.sourceUrl,
      direction: o.direction,
      publishedAt: o.publishedAt,
      resolutionStatus: o.resolutionStatus,
      resolutionNote: o.resolutionNote,
      resolvedAt: o.resolvedAt,
      expert: { name: o.expert.name, slug: o.expert.slug },
    })),
    sentiment: {
      ...sentimentCounts,
      totalCount: matchedOpinions.length,
      lookbackDays: OPINION_LOOKBACK_DAYS,
    },
  };
}
