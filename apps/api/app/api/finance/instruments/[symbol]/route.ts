import { NextResponse } from "next/server";

import { nseSymbolMatchesInstrumentTicker, refineStockNews } from "@predict-future/business-rules";

import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

/** Mini trend: how many trailing sessions' closes to return. */
const SPARK_SESSIONS = 30;
/** Over-fetch factor before the refineStockNews quality pipeline (dedup/quality can only shrink the set). */
const NEWS_FETCH_MULTIPLE = 6;
const NEWS_LIMIT = 10;
const FILINGS_LIMIT = 10;
const OPINIONS_LIMIT = 10;
/** Opinions considered "recent enough to match" for both the returned list and the sentiment split. */
const OPINION_LOOKBACK_DAYS = 90;

/**
 * GET /api/finance/instruments/[symbol]
 *
 * Market Pulse Phase 2 — public tap-through stock detail. Backs both the web
 * /instruments/[symbol] page and the mobile stock bottom-sheet with a single
 * shared shape.
 *
 * `symbol` is an NSE symbol (case-insensitive on input, uppercased before any
 * query — every ticker column in this schema stores NSE symbols uppercase).
 *
 * Response shape:
 *   { symbol, companyName,
 *     quote: { sessionDate, close, prevClose, changePercent, volume, deliveryPct } | null,
 *     spark: { sessionDate, close }[],   // last SPARK_SESSIONS sessions, oldest first
 *     news: StockNewsRow[],              // latest NEWS_LIMIT, through the shared quality pipeline
 *     filings: MarketMoveEvent[],        // latest FILINGS_LIMIT
 *     opinions: { id, quote, direction, publishedAt, resolutionStatus, expert }[],
 *     sentiment: { bullish, bearish, neutral } }
 *
 * 404 when the symbol is entirely unknown to us — no quote AND no news AND
 * no filings AND no opinions. A symbol with content but no quote yet (e.g.
 * bhavcopy hasn't been seeded) still 200s with `quote: null` — the page/sheet
 * render a "price data pending" state rather than a hard 404 in that case.
 *
 * Public endpoint — no auth required. Cache-Control: public, max-age=300 (the
 * quote store only changes once/day at EOD; news/filings/opinions refresh on
 * their own cron cadences, all coarser than 5 minutes).
 */
export async function GET(_request: Request, { params }: { params: { symbol: string } }) {
  const rawSymbol = params.symbol;
  if (!rawSymbol || typeof rawSymbol !== "string") {
    return NextResponse.json({ error: "Symbol is required." }, { status: 400 });
  }
  const symbol = rawSymbol.trim().toUpperCase();
  if (symbol.length === 0) {
    return NextResponse.json({ error: "Symbol is required." }, { status: 400 });
  }

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
        rawText: true,
        announcedAt: true,
      },
    }),
    // instrumentTicker is Yahoo-style (`RELIANCE.NS`) — a startsWith prefix
    // filter at the DB level is a safe exact match (requires the literal
    // "<symbol>." prefix, so "REL" can never match "RELIANCE.NS") and is
    // strictly cheaper than the unfiltered all-tickers scans the movers
    // routes already run in production. No index on instrumentTicker exists
    // yet — acceptable at current table size, same as those routes.
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
        instrumentTicker: true,
        direction: true,
        publishedAt: true,
        resolutionStatus: true,
        expert: { select: { name: true, slug: true } },
      },
    }),
  ]);

  // Belt-and-suspenders re-check with the shared matcher (in case a future
  // symbol collision slips past the DB prefix filter) — cheap over an
  // already-small, already-filtered in-memory set.
  const matchedOpinions = opinionCandidates.filter(
    (o) => o.instrumentTicker != null && nseSymbolMatchesInstrumentTicker(symbol, o.instrumentTicker)
  );

  const news = refineStockNews(newsRows, { limit: NEWS_LIMIT });

  const opinions = matchedOpinions.slice(0, OPINIONS_LIMIT).map((o) => ({
    id: o.id,
    quote: o.quote,
    direction: o.direction,
    publishedAt: o.publishedAt.toISOString(),
    resolutionStatus: o.resolutionStatus,
    expert: { name: o.expert.name, slug: o.expert.slug },
  }));

  const sentiment = matchedOpinions.reduce(
    (acc, o) => {
      if (o.direction === "BULLISH") acc.bullish += 1;
      else if (o.direction === "BEARISH") acc.bearish += 1;
      else acc.neutral += 1;
      return acc;
    },
    { bullish: 0, bearish: 0, neutral: 0 }
  );

  const hasAnyContent = latestQuote != null || news.length > 0 || filings.length > 0 || matchedOpinions.length > 0;
  if (!hasAnyContent) {
    return NextResponse.json({ error: "Unknown instrument." }, { status: 404 });
  }

  const companyName =
    latestQuote?.companyName ??
    filings[0]?.companyName ??
    newsRows[0]?.companyName ??
    symbol;

  const response = NextResponse.json({
    symbol,
    companyName,
    quote: latestQuote
      ? {
          sessionDate: latestQuote.sessionDate.toISOString(),
          close: latestQuote.close,
          prevClose: latestQuote.prevClose,
          changePercent: latestQuote.changePercent,
          volume: latestQuote.volume,
          deliveryPct: latestQuote.deliveryPct,
        }
      : null,
    spark: sparkRows
      .slice()
      .reverse()
      .map((row) => ({ sessionDate: row.sessionDate.toISOString(), close: row.close })),
    news: news.map((n) => ({
      id: n.id,
      tickerSymbol: n.tickerSymbol,
      companyName: n.companyName,
      headline: n.headline,
      publisher: n.publisher,
      sourceUrl: n.sourceUrl,
      publishedAt: n.publishedAt.toISOString(),
    })),
    filings: filings.map((f) => ({
      id: f.id,
      source: f.source,
      tickerSymbol: f.tickerSymbol,
      companyName: f.companyName,
      eventType: f.eventType,
      headline: f.headline,
      detailUrl: f.detailUrl,
      announcedAt: f.announcedAt.toISOString(),
    })),
    opinions,
    sentiment,
  });
  response.headers.set("Cache-Control", "public, max-age=300, s-maxage=300");
  return response;
}
