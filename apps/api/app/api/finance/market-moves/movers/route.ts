/**
 * GET /api/finance/market-moves/movers
 *
 * Market Pulse — all-market top gainers/losers, served from the warm
 * `MarketMoverSnapshot` store written by the market-moves-movers cron (every few
 * minutes during market hours). We deliberately do NOT fetch NSE live on the
 * request path: a long-lived server process was observed serving STALE NSE
 * responses over its persistent connection (frozen a full session behind), while
 * the scheduled cron — which runs during market hours and writes the snapshot —
 * stays correct. Reading the cron snapshot is therefore both robust and correct;
 * freshness comes from the cron cadence, not from per-request fetching.
 *
 * Always returns the MOST RECENT captured session, so the strip stays populated
 * after market close, on weekends/holidays, and before the day's first cron run.
 *
 * Public endpoint — no auth required.
 * Response: `{ gainers: [...], losers: [...], asOf: string | null }`
 * `gainers`/`losers` are each capped at 5 (the pinned Top Movers strip shows
 * 5+5), in rank order. Empty arrays (not 404) when the cron hasn't run yet — the
 * mobile card renders its own empty state.
 */

import { NextResponse } from "next/server";

import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

const STRIP_SIZE = 5;

export async function GET() {
  // Most recent captured session — not strictly today's — so the strip stays
  // populated after close, on weekends/holidays, and before the first cron run.
  const latest = await prisma.marketMoverSnapshot.findFirst({
    orderBy: { snapshotAt: "desc" },
    select: { sessionDate: true },
  });
  if (!latest) {
    return NextResponse.json({ gainers: [], losers: [], asOf: null });
  }
  const sessionDate = latest.sessionDate;

  const [gainers, losers] = await Promise.all([
    prisma.marketMoverSnapshot.findMany({
      where: { sessionDate, direction: "GAINER" },
      orderBy: { rank: "asc" },
      take: STRIP_SIZE,
    }),
    prisma.marketMoverSnapshot.findMany({
      where: { sessionDate, direction: "LOSER" },
      orderBy: { rank: "asc" },
      take: STRIP_SIZE,
    }),
  ]);

  const all = [...gainers, ...losers];
  const asOf =
    all.length > 0
      ? new Date(Math.max(...all.map((m) => m.snapshotAt.getTime()))).toISOString()
      : null;

  const shape = (m: (typeof gainers)[number]) => ({
    tickerSymbol: m.tickerSymbol,
    companyName: m.companyName,
    changePercent: m.changePercent,
    changeAbs: m.changeAbs,
    volume: m.volume,
    isUnusualVolume: m.isUnusualVolume,
    direction: m.direction,
    rank: m.rank,
  });

  return NextResponse.json({
    gainers: gainers.map(shape),
    losers: losers.map(shape),
    asOf,
  });
}
