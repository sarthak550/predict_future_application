/**
 * POST /api/cron/market-moves-bse-index-eod
 *
 * BSE Expansion Phase 1 (2026-08-12) — daily self-owned OHLC history for
 * every index BSE's own bulk archive endpoint publishes (see
 * apps/api/lib/marketMoves/bseIndexEod.ts's module doc for the live-verified
 * source/format). Sibling of market-moves-index-eod/route.ts (IndexEodQuote)
 * but a fully separate table/file — BSE indices are never mixed into
 * IndexEodQuote, which stays NSE-only.
 *
 * Protected by CRON_SECRET (Bearer or x-cron-secret header), same convention
 * as every other cron route. No market-hours "live" branch (identical
 * reasoning to market-moves-index-eod: this route always attempts the day's
 * archive query, which either has data or doesn't).
 *
 * Idempotent: `upsertBseIndexEodQuotes` uses createMany/skipDuplicates keyed
 * on (indexName, sessionDate) — a published session's index closes are
 * immutable once written, so re-running the same day simply no-ops on
 * already-written rows.
 *
 * Recommended cadence — mirrors market-moves-index-eod's timing (BSE's own
 * archive publishes on a similar post-close schedule to NSE's ind_close_all,
 * not independently verified minute-by-minute, so the same safety margin +
 * self-heal retry shape is used defensively):
 *   0 14 * * 1-5  curl -s -X POST https://<host>/api/cron/market-moves-bse-index-eod \
 *       -H "Authorization: Bearer $CRON_SECRET"     # 19:30 IST
 *   30 15 * * 1-5 curl -s -X POST https://<host>/api/cron/market-moves-bse-index-eod \
 *       -H "Authorization: Bearer $CRON_SECRET"     # 21:00 IST self-heal retry
 *   (both times in UTC; IST = UTC+5:30. Re-running is always safe.)
 */

import { NextResponse } from "next/server";

import { fetchBseIndexEodQuotes, type FetchedBseIndexEodQuote } from "@/lib/marketMoves/bseIndexEod";
import { getIstSessionDate } from "@/lib/marketMoves/marketHours";
import { prisma } from "@/lib/prisma";
import { notifyWebRevalidate } from "@/lib/webRevalidate";

function hasCronAccess(request: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const authHeader = request.headers.get("authorization");
  const cronHeader = request.headers.get("x-cron-secret");
  return authHeader === `Bearer ${secret}` || cronHeader === secret;
}

/** Batch size for BseIndexEodQuote createMany calls — ~130-160 rows/day observed live, well within a single batch. */
const BATCH_SIZE = 500;

async function upsertBseIndexEodQuotes(
  quotes: FetchedBseIndexEodQuote[],
  sessionDate: Date
): Promise<{ upserted: number; failed: number }> {
  const rows = quotes.map((q) => ({
    sessionDate,
    indexName: q.indexName,
    open: q.open,
    high: q.high,
    low: q.low,
    close: q.close,
    changeAbs: q.changeAbs,
    changePercent: q.changePercent,
    previousClose: q.previousClose,
    volume: q.volume,
    turnover: q.turnover,
    peRatio: q.peRatio,
    pbRatio: q.pbRatio,
    dividendYield: q.dividendYield,
  }));

  let upserted = 0;
  let failed = 0;
  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const batch = rows.slice(i, i + BATCH_SIZE);
    try {
      const result = await prisma.bseIndexEodQuote.createMany({ data: batch, skipDuplicates: true });
      upserted += result.count;
    } catch (err) {
      failed += batch.length;
      console.error(`[cron/market-moves-bse-index-eod] batch upsert failed (offset ${i}):`, err);
    }
  }
  return { upserted, failed };
}

async function run(request: Request) {
  if (!hasCronAccess(request)) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const sessionDate = getIstSessionDate();

  const quotes = await fetchBseIndexEodQuotes(sessionDate).catch((err: unknown) => {
    console.error("[cron/market-moves-bse-index-eod] fetch threw unexpectedly:", err);
    return null;
  });

  if (!quotes) {
    return NextResponse.json({ ok: true, skipped: "not_yet_published" });
  }

  const result = await upsertBseIndexEodQuotes(quotes, sessionDate);
  if (result.failed > 0 && result.upserted === 0) {
    return NextResponse.json(
      { ok: false, reason: "write_failed", fetched: quotes.length, ...result },
      { status: 200 }
    );
  }

  await notifyWebRevalidate(["/bse-indices"]);
  return NextResponse.json({ ok: true, fetched: quotes.length, ...result });
}

export const GET = run;
export const POST = run;
