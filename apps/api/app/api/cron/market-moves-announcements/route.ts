/**
 * POST /api/cron/market-moves-announcements
 *
 * Market Pulse (Phase 1) — polls NSE + BSE unofficial corporate-announcement
 * feeds concurrently, applies the ticker-first drop rule (already enforced
 * inside each fetcher — see apps/api/lib/marketMoves/{nse,bse}.ts), and
 * upserts into `MarketMoveEvent` keyed by `dedupeKey` (`${source}:${sourceId}`)
 * so re-polling the same announcement is a no-op.
 *
 * Protected by CRON_SECRET (Bearer or x-cron-secret header), identical to
 * every other cron route in this repo. Intended cadence: every 3-5 min via
 * EC2 crontab (NOT vercel.json — this cadence exceeds the plan's cron limits,
 * same reasoning as macro-snapshot):
 *   [every 5 min] curl -s -X POST https://<host>/api/cron/market-moves-announcements \
 *       -H "Authorization: Bearer $CRON_SECRET"
 *
 * Never throws past a single item's upsert — one bad row logs and is skipped
 * so the rest of the batch still lands. Both fetchers independently never
 * throw either (they return [] on any network/parse/block failure).
 *
 * Prod note: run `prisma db push` to land the MarketMoveEvent model before
 * activating this cron.
 */

import { NextResponse } from "next/server";

import { fetchNseAnnouncements } from "@/lib/marketMoves/nse";
import { fetchBseAnnouncements } from "@/lib/marketMoves/bse";
import { prisma } from "@/lib/prisma";

function hasCronAccess(request: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const authHeader = request.headers.get("authorization");
  const cronHeader = request.headers.get("x-cron-secret");
  return authHeader === `Bearer ${secret}` || cronHeader === secret;
}

async function run(request: Request) {
  if (!hasCronAccess(request)) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const [nseEvents, bseEvents] = await Promise.all([
    fetchNseAnnouncements().catch((err: unknown) => {
      console.error("[cron/market-moves-announcements] NSE fetch threw unexpectedly:", err);
      return [];
    }),
    fetchBseAnnouncements().catch((err: unknown) => {
      console.error("[cron/market-moves-announcements] BSE fetch threw unexpectedly:", err);
      return [];
    }),
  ]);

  const allEvents = [...nseEvents, ...bseEvents];

  let upserted = 0;
  let failed = 0;

  for (const event of allEvents) {
    const dedupeKey = `${event.source}:${event.sourceId}`;
    try {
      await prisma.marketMoveEvent.upsert({
        where: { dedupeKey },
        update: {
          // Re-polling the same announcement can pick up a corrected headline
          // or a newly-attached PDF — keep the row fresh rather than frozen
          // at first-seen values.
          headline: event.headline,
          detailUrl: event.detailUrl,
          rawText: event.rawText,
          eventType: event.eventType,
        },
        create: {
          source: event.source,
          sourceId: event.sourceId,
          dedupeKey,
          tickerSymbol: event.tickerSymbol,
          tickerType: event.tickerType,
          companyName: event.companyName,
          eventType: event.eventType,
          headline: event.headline,
          detailUrl: event.detailUrl,
          rawText: event.rawText,
          announcedAt: event.announcedAt,
        },
      });
      upserted++;
    } catch (err) {
      failed++;
      console.error(`[cron/market-moves-announcements] upsert failed for ${dedupeKey}:`, err);
    }
  }

  return NextResponse.json({
    ok: true,
    nseFetched: nseEvents.length,
    bseFetched: bseEvents.length,
    upserted,
    failed,
  });
}

export const GET = run;
export const POST = run;
