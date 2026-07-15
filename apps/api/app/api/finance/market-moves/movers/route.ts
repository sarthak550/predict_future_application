/**
 * GET /api/finance/market-moves/movers
 *
 * Market Pulse (Phase 1) — top gainers/losers across the NIFTY 100.
 *
 * LIVE-FIRST (matches Groww): serves a fresh pull from NSE, memoised in-process
 * for LIVE_TTL_MS so we hit NSE at most ~once per that window no matter how many
 * users open the screen (a shared in-flight promise also collapses concurrent
 * cache-miss requests into a single upstream fetch — no thundering herd). If the
 * live pull fails or returns nothing, we fall back to the warm `MarketMoverSnapshot`
 * store written by the market-moves-movers cron, so the strip degrades to the last
 * captured session instead of going blank. NSE's variations endpoint returns the
 * last close outside market hours, so the live path stays correct after hours too.
 *
 * Public endpoint — no auth required.
 * Response:
 * ```json
 * {
 *   "gainers": [{ "tickerSymbol": "ABB", "companyName": "ABB India Limited", "changePercent": 4.9, ... }],
 *   "losers": [...],
 *   "asOf": "2026-07-16T09:45:00.000Z" | null,
 *   "live": true
 * }
 * ```
 * `gainers`/`losers` are each capped at 5 (the pinned Top Movers strip shows
 * 5+5) and returned in rank order. Empty arrays (not 404) when neither the live
 * pull nor the store has data — the mobile card renders its own empty state.
 * `live` is true when the payload came from a fresh/cached NSE pull, false when
 * it fell back to the stored snapshot.
 */

import { NextResponse } from "next/server";

import { fetchNseMovers } from "@/lib/marketMoves/nse";
import type { FetchedMarketMover } from "@/lib/marketMoves/types";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

const STRIP_SIZE = 5;
// Live pull memo window. 90s keeps the strip within ~1.5 min of Groww during a
// session while bounding NSE load to ~40 fetches/hour regardless of user traffic.
const LIVE_TTL_MS = 90_000;
// Hard ceiling on how long a user request will wait for a live NSE pull before
// falling back to the warm store. The background fetch is NOT cancelled on
// timeout — it keeps going and populates the cache for the next request.
const LIVE_FETCH_TIMEOUT_MS = 6_000;
// Mirror the cron's cross-sectional unusual-volume heuristic on the live path.
const UNUSUAL_VOLUME_MULTIPLE = 3;

type MoverOut = {
  tickerSymbol: string;
  companyName: string;
  changePercent: number;
  changeAbs: number;
  volume: number;
  isUnusualVolume: boolean;
  direction: "GAINER" | "LOSER";
  rank: number;
};
type MoversBody = { gainers: MoverOut[]; losers: MoverOut[]; asOf: string | null; live: boolean };

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

/** Ranks the raw NSE pull into the 5+5 strip shape, mirroring the cron. */
function shapeLiveMovers(movers: FetchedMarketMover[], asOf: string): MoversBody {
  const volumes = movers.map((m) => m.volume).filter((v) => v > 0);
  const medianVolume = median(volumes);
  const rank = (list: FetchedMarketMover[]): MoverOut[] =>
    list.slice(0, STRIP_SIZE).map((m, i) => ({
      tickerSymbol: m.tickerSymbol,
      companyName: m.companyName,
      changePercent: m.changePercent,
      changeAbs: m.changeAbs,
      volume: m.volume,
      isUnusualVolume: medianVolume > 0 && m.volume >= medianVolume * UNUSUAL_VOLUME_MULTIPLE,
      direction: m.direction,
      rank: i + 1,
    }));
  const gainers = rank(
    movers.filter((m) => m.direction === "GAINER").sort((a, b) => b.changePercent - a.changePercent)
  );
  const losers = rank(
    movers.filter((m) => m.direction === "LOSER").sort((a, b) => a.changePercent - b.changePercent)
  );
  return { gainers, losers, asOf, live: true };
}

let liveCache: { at: number; body: MoversBody } | null = null;
let inFlight: Promise<MoversBody | null> | null = null;

/**
 * Returns a live (or freshly-cached) NSE movers payload, or null when NSE gave
 * us nothing and we have no cached payload to serve — caller then falls back to
 * the stored snapshot. Concurrent callers on a cache miss share one fetch.
 */
async function getLiveMovers(): Promise<MoversBody | null> {
  const now = Date.now();
  if (liveCache && now - liveCache.at < LIVE_TTL_MS) return liveCache.body;
  if (inFlight) return inFlight;

  inFlight = (async () => {
    const movers = await fetchNseMovers().catch((err: unknown) => {
      console.error("[market-moves/movers] live NSE fetch threw:", err);
      return [] as FetchedMarketMover[];
    });
    if (movers.length === 0) {
      // Nothing fresh — serve the last good live cache if we have one, else null
      // so the route falls back to the DB snapshot.
      return liveCache?.body ?? null;
    }
    const body = shapeLiveMovers(movers, new Date().toISOString());
    liveCache = { at: Date.now(), body };
    return body;
  })().finally(() => {
    inFlight = null;
  });

  return inFlight;
}

/** Fallback: most-recent captured session from the warm store. */
async function getSnapshotMovers(): Promise<MoversBody> {
  const latest = await prisma.marketMoverSnapshot.findFirst({
    orderBy: { sessionDate: "desc" },
    select: { sessionDate: true },
  });
  if (!latest) {
    return { gainers: [], losers: [], asOf: null, live: false };
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

  const shape = (m: (typeof gainers)[number]): MoverOut => ({
    tickerSymbol: m.tickerSymbol,
    companyName: m.companyName,
    changePercent: m.changePercent,
    changeAbs: m.changeAbs,
    volume: m.volume,
    isUnusualVolume: m.isUnusualVolume,
    direction: m.direction,
    rank: m.rank,
  });

  return { gainers: gainers.map(shape), losers: losers.map(shape), asOf, live: false };
}

export async function GET() {
  // Race the live pull against a hard timeout so a slow/hung NSE can't stall the
  // user request — on timeout we serve the store and let the fetch finish in the
  // background to warm the cache for next time.
  const live = await Promise.race<MoversBody | null>([
    getLiveMovers(),
    new Promise<null>((resolve) => setTimeout(() => resolve(null), LIVE_FETCH_TIMEOUT_MS)),
  ]);
  if (live && (live.gainers.length > 0 || live.losers.length > 0)) {
    return NextResponse.json(live);
  }
  // Live pull unavailable/empty/slow → serve the warm store so the strip never blanks.
  return NextResponse.json(await getSnapshotMovers());
}
