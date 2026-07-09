/**
 * POST /api/cron/market-moves-movers
 *
 * Market Pulse (Phase 1) — polls NSE's NIFTY 200 index-constituent endpoint
 * (see apps/api/lib/marketMoves/nse.ts — the same Akamai-blocking caveat
 * documented there applies here) and upserts today's top gainers/losers into
 * `MarketMoverSnapshot`, one row per (sessionDate, tickerSymbol).
 *
 * Weekday + market-hours gated (09:15-15:30 IST, Mon-Fri) — silently no-ops
 * outside that window rather than upserting stale/closed-market snapshots.
 * No holiday-calendar awareness in Phase 1 (see marketHours.ts doc comment).
 *
 * Protected by CRON_SECRET (Bearer or x-cron-secret header). Intended
 * cadence: every 15 min via EC2 crontab during market hours:
 *   15,30,45,0 9-15 * * 1-5 curl -s -X POST https://<host>/api/cron/market-moves-movers \
 *       -H "Authorization: Bearer $CRON_SECRET"
 * (the crontab's own schedule is a coarse filter; this route's own gate is
 * the source of truth and safely no-ops if the crontab fires early/late/on
 * a holiday).
 *
 * isUnusualVolume is a same-day cross-sectional heuristic (today's volume vs.
 * the median of today's scanned universe) — see schema doc comment on
 * MarketMoverSnapshot for why this isn't a true historical rolling average.
 *
 * Prod note: run `prisma db push` to land the MarketMoverSnapshot model
 * before activating this cron.
 */

import { NextResponse } from "next/server";

import { fetchNseMovers } from "@/lib/marketMoves/nse";
import type { FetchedMarketMover } from "@/lib/marketMoves/types";
import { isNseWeekdayMarketHours, getIstSessionDate } from "@/lib/marketMoves/marketHours";
import { prisma } from "@/lib/prisma";

function hasCronAccess(request: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const authHeader = request.headers.get("authorization");
  const cronHeader = request.headers.get("x-cron-secret");
  return authHeader === `Bearer ${secret}` || cronHeader === secret;
}

/** Simple median helper for the cross-sectional unusual-volume heuristic. */
function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

const UNUSUAL_VOLUME_MULTIPLE = 3;
const TOP_N_PER_DIRECTION = 25; // headroom above the 5+5 the mobile strip shows, for future ranking tweaks

async function run(request: Request) {
  if (!hasCronAccess(request)) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  if (!isNseWeekdayMarketHours()) {
    return NextResponse.json({ ok: true, skipped: "outside_market_hours" });
  }

  const movers = await fetchNseMovers().catch((err: unknown) => {
    console.error("[cron/market-moves-movers] NSE fetch threw unexpectedly:", err);
    return [] as FetchedMarketMover[];
  });

  if (movers.length === 0) {
    return NextResponse.json({ ok: true, fetched: 0, upserted: 0, reason: "no_data" });
  }

  // Enrichment: NSE's index-constituent endpoint doesn't carry a full company
  // name, only the symbol. Backfill from the most recently seen announcement
  // for that symbol (already flowing in via the announcements cron), when
  // one exists — a free, incremental improvement over showing the raw ticker
  // twice. Falls back to the ticker symbol itself when no match exists yet.
  const symbols = movers.map((m) => m.tickerSymbol);
  const knownCompanies = await prisma.marketMoveEvent.findMany({
    where: { tickerSymbol: { in: symbols }, source: "NSE" },
    select: { tickerSymbol: true, companyName: true },
    // orderBy before distinct → Postgres DISTINCT ON (tickerSymbol) ORDER BY
    // announcedAt DESC, so we get the MOST RECENT company name per symbol.
    orderBy: { announcedAt: "desc" },
    distinct: ["tickerSymbol"],
  });
  const companyNameBySymbol = new Map(knownCompanies.map((c) => [c.tickerSymbol, c.companyName]));

  const sessionDate = getIstSessionDate();
  const volumes = movers.map((m) => m.volume).filter((v) => v > 0);
  const medianVolume = median(volumes);

  const gainers = movers
    .filter((m) => m.direction === "GAINER")
    .sort((a, b) => b.changePercent - a.changePercent)
    .slice(0, TOP_N_PER_DIRECTION);
  const losers = movers
    .filter((m) => m.direction === "LOSER")
    .sort((a, b) => a.changePercent - b.changePercent)
    .slice(0, TOP_N_PER_DIRECTION);

  let upserted = 0;
  let failed = 0;

  for (const group of [gainers, losers]) {
    for (let i = 0; i < group.length; i++) {
      const m = group[i];
      const rank = i + 1;
      const isUnusualVolume = medianVolume > 0 && m.volume >= medianVolume * UNUSUAL_VOLUME_MULTIPLE;
      try {
        await prisma.marketMoverSnapshot.upsert({
          where: { sessionDate_tickerSymbol: { sessionDate, tickerSymbol: m.tickerSymbol } },
          update: {
            companyName: companyNameBySymbol.get(m.tickerSymbol) ?? m.companyName,
            changePercent: m.changePercent,
            changeAbs: m.changeAbs,
            volume: m.volume,
            isUnusualVolume,
            direction: m.direction,
            rank,
            snapshotAt: new Date(),
          },
          create: {
            sessionDate,
            tickerSymbol: m.tickerSymbol,
            companyName: companyNameBySymbol.get(m.tickerSymbol) ?? m.companyName,
            changePercent: m.changePercent,
            changeAbs: m.changeAbs,
            volume: m.volume,
            avgVolume: null,
            isUnusualVolume,
            direction: m.direction,
            rank,
          },
        });
        upserted++;
      } catch (err) {
        failed++;
        console.error(`[cron/market-moves-movers] upsert failed for ${m.tickerSymbol}:`, err);
      }
    }
  }

  return NextResponse.json({
    ok: true,
    fetched: movers.length,
    gainers: gainers.length,
    losers: losers.length,
    upserted,
    failed,
  });
}

export const GET = run;
export const POST = run;
