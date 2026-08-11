/**
 * POST /api/cron/market-moves-index-eod
 *
 * Index History Stage 2 (2026-08-11) — daily self-owned OHLC history for
 * EVERY NSE-published index (see apps/api/lib/marketMoves/indexEod.ts's
 * module doc for the CSV source/format). Sibling of
 * market-moves-movers/route.ts's EOD pass (StockEodQuote/BondEodQuote) but a
 * fully separate table/file — indices are never mixed into StockEodQuote.
 *
 * Protected by CRON_SECRET (Bearer or x-cron-secret header), same convention
 * as every other cron route. Self-heal pattern: `?force=1` is accepted but is
 * a no-op here (unlike market-moves-movers, this route has no market-hours
 * "live" branch to bypass — it always attempts the EOD file, which is either
 * published or it isn't) — kept for crontab-invocation symmetry with sibling
 * routes, not because it changes behavior.
 *
 * Idempotent: `upsertIndexEodQuotes` uses createMany/skipDuplicates keyed on
 * (indexName, sessionDate) — a published session's index closes are
 * immutable once written, so re-running the same day simply no-ops on
 * already-written rows (same discipline as market-moves-movers.ts's
 * upsertQuotes for StockEodQuote).
 *
 * Recommended cadence — the ind_close_all file is typically published a
 * little AFTER the sec_bhavdata_full bhavcopy in the evening; scheduled
 * comfortably after both the movers EOD pass (19:15 IST) and a safety
 * margin, plus a later self-heal retry in case NSE was slow that evening:
 *   0 14 * * 1-5  curl -s -X POST https://<host>/api/cron/market-moves-index-eod \
 *       -H "Authorization: Bearer $CRON_SECRET"     # 19:30 IST
 *   30 15 * * 1-5 curl -s -X POST https://<host>/api/cron/market-moves-index-eod \
 *       -H "Authorization: Bearer $CRON_SECRET"     # 21:00 IST self-heal retry
 *   (both times in UTC; IST = UTC+5:30. Re-running is always safe — see
 *   idempotency note above.)
 */

import { NextResponse } from "next/server";

import { fetchIndexEodQuotes, type FetchedIndexEodQuote } from "@/lib/marketMoves/indexEod";
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

/** Batch size for IndexEodQuote createMany calls — ~164 rows/day, well within a single batch, but kept batched for consistency with the equity/bond EOD writers and headroom if NSE's index list grows. */
const BATCH_SIZE = 500;

/**
 * Idempotent full-universe write into IndexEodQuote, keyed on (indexName,
 * sessionDate). createMany/skipDuplicates, not upsert — same reasoning as
 * market-moves-movers.ts's upsertQuotes: a published session's index closes
 * are immutable once written, so skipping duplicates on rerun is both
 * correct and cheaper than a delete+reinsert.
 */
async function upsertIndexEodQuotes(
  quotes: FetchedIndexEodQuote[],
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
    volume: q.volume,
    turnoverCr: q.turnoverCr,
    peRatio: q.peRatio,
    pbRatio: q.pbRatio,
    dividendYield: q.dividendYield,
  }));

  let upserted = 0;
  let failed = 0;
  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const batch = rows.slice(i, i + BATCH_SIZE);
    try {
      const result = await prisma.indexEodQuote.createMany({ data: batch, skipDuplicates: true });
      upserted += result.count;
    } catch (err) {
      failed += batch.length;
      console.error(`[cron/market-moves-index-eod] batch upsert failed (offset ${i}):`, err);
    }
  }
  return { upserted, failed };
}

async function run(request: Request) {
  if (!hasCronAccess(request)) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const sessionDate = getIstSessionDate();

  const quotes = await fetchIndexEodQuotes(sessionDate).catch((err: unknown) => {
    console.error("[cron/market-moves-index-eod] fetch threw unexpectedly:", err);
    return null;
  });

  if (!quotes) {
    return NextResponse.json({ ok: true, skipped: "not_yet_published" });
  }

  const result = await upsertIndexEodQuotes(quotes, sessionDate);
  if (result.failed > 0 && result.upserted === 0) {
    return NextResponse.json(
      { ok: false, reason: "write_failed", fetched: quotes.length, ...result },
      { status: 200 }
    );
  }

  await notifyWebRevalidate(["/indices", ["/indices/[slug]", "page"], ["/instruments/[symbol]", "page"]]);
  return NextResponse.json({ ok: true, fetched: quotes.length, ...result });
}

export const GET = run;
export const POST = run;
