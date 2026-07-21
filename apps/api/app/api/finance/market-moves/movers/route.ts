/**
 * GET /api/finance/market-moves/movers
 *
 * Market Pulse — top gainers/losers, served from the warm `MarketMoverSnapshot`
 * store written by the market-moves-movers cron (every few minutes during
 * market hours). We deliberately do NOT fetch NSE live on the request path: a
 * long-lived server process was observed serving STALE NSE responses over its
 * persistent connection (frozen a full session behind), while the scheduled
 * cron — which runs during market hours and writes the snapshot — stays
 * correct. Reading the cron snapshot is therefore both robust and correct;
 * freshness comes from the cron cadence, not from per-request fetching.
 *
 * Universe toggle (`?universe=popular|all`, default `popular`): the cron writes
 * TWO parallel universes every run — "popular" (NIFTY 100, the recognizable
 * large-cap names) and "all" (every NSE-listed security, no market-cap cap,
 * which surfaces circuit-hit microcaps unfamiliar to most users). Popular is
 * the default because it matches what users expect from apps like Groww.
 *
 * Always returns the MOST RECENT captured session for the requested universe,
 * so the strip stays populated after market close, on weekends/holidays, and
 * before the day's first cron run.
 *
 * Public endpoint — no auth required.
 * Response: `{ gainers: [...], losers: [...], asOf: string | null, universe: "popular" | "all" }`
 * `gainers`/`losers` each return the FULL latest session for that universe (the
 * DB holds up to ~100 per direction for "all", ~50 for "popular" — still a tiny
 * payload), in rank order. Clients render their own collapsed "top 5 + show
 * all" UI on top of this (web: MoverList, mobile: MoverRow) rather than the
 * server truncating. Empty arrays (not 404) when the cron hasn't run yet —
 * callers render their own empty state.
 */

import { NextResponse } from "next/server";

import { pickLatestAnalystCallPerTicker, pickLatestHeadlinePerTicker } from "@predict-future/business-rules";

import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

/** "Why is it moving" headlines: only consider news from the last 3 days. */
const HEADLINE_LOOKBACK_DAYS = 3;
/** "Analyst said" badge: only consider opinions from the last 14 days. */
const ANALYST_CALL_LOOKBACK_DAYS = 14;

export async function GET(request: Request) {
  const url = new URL(request.url);
  // Default POPULAR: the recognizable NIFTY 100 names, not all-market microcaps.
  const universe = url.searchParams.get("universe") === "all" ? "ALL" : "POPULAR";
  const universeLabel = universe === "ALL" ? "all" : "popular";

  // Most recent captured session for this universe — not strictly today's — so
  // the strip stays populated after close, on weekends/holidays, and before
  // the first cron run.
  const latest = await prisma.marketMoverSnapshot.findFirst({
    where: { universe },
    orderBy: { snapshotAt: "desc" },
    select: { sessionDate: true },
  });
  if (!latest) {
    return NextResponse.json({ gainers: [], losers: [], asOf: null, universe: universeLabel });
  }
  const sessionDate = latest.sessionDate;

  const [gainers, losers] = await Promise.all([
    prisma.marketMoverSnapshot.findMany({
      where: { sessionDate, universe, direction: "GAINER", changePercent: { gt: 0 } },
      // Sort by the actual move, not the stored rank — defense against any
      // mixed-generation rows where ranks from different passes collide.
      orderBy: { changePercent: "desc" },
    }),
    prisma.marketMoverSnapshot.findMany({
      where: { sessionDate, universe, direction: "LOSER", changePercent: { lt: 0 } },
      orderBy: { changePercent: "asc" },
    }),
  ]);

  const all = [...gainers, ...losers];
  const asOf =
    all.length > 0
      ? new Date(Math.max(...all.map((m) => m.snapshotAt.getTime()))).toISOString()
      : null;

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
            expert: { select: { name: true, slug: true } },
          },
        }),
      ]);

  // pickLatestHeadlinePerTicker drops blocklisted-publisher rows internally.
  const headlineByTicker = pickLatestHeadlinePerTicker(newsRows);
  const analystCallBySymbol = pickLatestAnalystCallPerTicker(opinionRows);

  const shape = (m: (typeof gainers)[number]) => {
    const analystCallRow = analystCallBySymbol.get(m.tickerSymbol.toUpperCase());
    return {
      tickerSymbol: m.tickerSymbol,
      companyName: m.companyName,
      changePercent: m.changePercent,
      changeAbs: m.changeAbs,
      volume: m.volume,
      lastPrice: m.lastPrice,
      isUnusualVolume: m.isUnusualVolume,
      direction: m.direction,
      rank: m.rank,
      topHeadline: headlineByTicker.get(m.tickerSymbol) ?? null,
      analystCall: analystCallRow
        ? {
            analystName: analystCallRow.expert.name,
            analystSlug: analystCallRow.expert.slug,
            direction: analystCallRow.direction,
            resolutionStatus: analystCallRow.resolutionStatus,
            publishedAt: analystCallRow.publishedAt.toISOString(),
          }
        : null,
    };
  };

  return NextResponse.json({
    // Renumber to the sorted position — stored ranks can collide across passes.
    gainers: gainers.map(shape).map((m, i) => ({ ...m, rank: i + 1 })),
    losers: losers.map(shape).map((m, i) => ({ ...m, rank: i + 1 })),
    asOf,
    universe: universeLabel,
  });
}
