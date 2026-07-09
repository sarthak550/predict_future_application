/**
 * GET /api/finance/market-moves/movers
 *
 * Market Pulse (Phase 1) — today's top gainers/losers from the warm store
 * written by the market-moves-movers cron. Does NOT hit NSE live.
 *
 * Public endpoint — no auth required.
 * Response:
 * ```json
 * {
 *   "gainers": [{ "tickerSymbol": "TCS", "companyName": "TCS", "changePercent": 3.2, ... }],
 *   "losers": [...],
 *   "asOf": "2026-07-10T09:45:00.000Z" | null
 * }
 * ```
 * `gainers`/`losers` are each capped at 5 (the pinned Top Movers strip shows
 * 5+5) and returned in rank order. Empty arrays (not 404) when the cron
 * hasn't run yet or the market is closed — the mobile card renders its own
 * empty state.
 */

import { NextResponse } from "next/server";

import { prisma } from "@/lib/prisma";
import { getIstSessionDate } from "@/lib/marketMoves/marketHours";

export const dynamic = "force-dynamic";

const STRIP_SIZE = 5;

export async function GET() {
  const sessionDate = getIstSessionDate();

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
