/**
 * POST /api/cron/market-moves-bse-eod
 *
 * BSE Expansion Phase 3A (2026-08-12) — daily full-market EOD ingestion for
 * BSE-EXCLUSIVE equities (companies BSE lists that have no NSE-listed twin —
 * see apps/api/lib/marketMoves/bseBhavcopy.ts's module doc for the live-
 * verified source, the Accept-header gotcha, and the ISIN-first dual-listing
 * dedup law). Sibling of market-moves-eod (StockEodQuote) but a fully
 * separate table/file — BSE-only rows are NEVER mixed into StockEodQuote.
 *
 * Protected by CRON_SECRET (Bearer or x-cron-secret header), same convention
 * as every other cron route.
 *
 * Idempotent: `createMany`/`skipDuplicates` keyed on (sessionDate,
 * scripCode) — a published session's closes are immutable once written, so
 * re-running the same day simply no-ops on already-written rows.
 *
 * Recommended cadence — mirrors market-moves-eod's post-close timing (BSE's
 * UDiFF file publishes on a similar evening schedule to NSE's own bhavcopy,
 * not independently minute-verified, so the same safety-margin + self-heal
 * retry shape is used defensively):
 *   0 14 * * 1-5  curl -s -X POST https://<host>/api/cron/market-moves-bse-eod \
 *       -H "Authorization: Bearer $CRON_SECRET"     # 19:30 IST
 *   30 15 * * 1-5 curl -s -X POST https://<host>/api/cron/market-moves-bse-eod \
 *       -H "Authorization: Bearer $CRON_SECRET"     # 21:00 IST self-heal retry
 *   (both times in UTC; IST = UTC+5:30. Re-running is always safe.)
 */

import { NextResponse } from "next/server";

import { fetchBseEquityEodQuotes, type FetchedBseEodQuote } from "@/lib/marketMoves/bseBhavcopy";
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

/** Batch size for BseEodQuote createMany calls — ~2,000 BSE-only rows/day observed live, comfortably chunked. */
const BATCH_SIZE = 500;

async function upsertBseEodQuotes(
  quotes: FetchedBseEodQuote[],
  sessionDate: Date
): Promise<{ upserted: number; failed: number }> {
  const rows = quotes.map((q) => ({
    sessionDate,
    scripCode: q.scripCode,
    tickerSymbol: q.tickerSymbol,
    isin: q.isin,
    companyName: q.companyName,
    securityGroup: q.securityGroup,
    prevClose: q.prevClose,
    close: q.close,
    changePercent: q.changePercent,
    volume: q.volume,
  }));

  let upserted = 0;
  let failed = 0;
  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const batch = rows.slice(i, i + BATCH_SIZE);
    try {
      const result = await prisma.bseEodQuote.createMany({ data: batch, skipDuplicates: true });
      upserted += result.count;
    } catch (err) {
      failed += batch.length;
      console.error(`[cron/market-moves-bse-eod] batch upsert failed (offset ${i}):`, err);
    }
  }
  return { upserted, failed };
}

async function run(request: Request) {
  if (!hasCronAccess(request)) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const sessionDate = getIstSessionDate();

  const quotes = await fetchBseEquityEodQuotes(sessionDate).catch((err: unknown) => {
    console.error("[cron/market-moves-bse-eod] fetch threw unexpectedly:", err);
    return null;
  });

  if (!quotes) {
    return NextResponse.json({ ok: true, skipped: "not_yet_published_or_dedup_unsafe" });
  }

  const result = await upsertBseEodQuotes(quotes, sessionDate);
  if (result.failed > 0 && result.upserted === 0) {
    return NextResponse.json(
      { ok: false, reason: "write_failed", fetched: quotes.length, ...result },
      { status: 200 }
    );
  }

  await notifyWebRevalidate(["/sitemap.xml"]);
  return NextResponse.json({ ok: true, fetched: quotes.length, ...result });
}

export const GET = run;
export const POST = run;
