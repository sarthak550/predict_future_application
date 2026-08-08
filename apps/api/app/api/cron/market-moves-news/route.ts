/**
 * POST /api/cron/market-moves-news
 *
 * Market Pulse (Phase 1c) — pulls readable, real-time Google News RSS
 * headlines for a capped ticker universe (top movers + recent material
 * filings, see lib/marketMoves/newsUniverse.ts) and upserts them into
 * MarketMoveNews on dedupeKey. This is the primary read surface replacing
 * raw filing text (MarketMoveEvent rows are demoted, not removed — see the
 * mobile "Regulatory Filings" disclosure).
 *
 * Gated by isNewsRefreshWindow() (08:00-21:00 IST, Mon-Fri) — wider than
 * trading hours since results/news commonly land after the 15:30 close.
 * Silently no-ops outside that window.
 *
 * Protected by CRON_SECRET (Bearer or x-cron-secret header), identical
 * contract to the two existing Market Pulse crons. Intended cadence: every
 * 30 min via EC2 crontab:
 *   0,30 8-21 * * 1-5 curl -s -X POST https://<host>/api/cron/market-moves-news \
 *       -H "Authorization: Bearer $CRON_SECRET"
 * (the crontab's own schedule is a coarse filter; this route's own gate is
 * the source of truth and safely no-ops if the crontab fires early/late/on
 * a holiday).
 *
 * Sequential per-ticker fetch with ~400ms spacing (not parallel) — every
 * request hits the same host (news.google.com), so a flat inter-request
 * delay avoids hammering it. ~60 tickers x 0.4s ~= 24s per run. Per-ticker
 * try/catch — one blocked/failed ticker logs and is skipped, the rest of the
 * run continues. This route itself never throws past the batch loop.
 *
 * After the fetch/upsert loop, runs a short-summary generation pass (2-3
 * sentence AI summaries, NEWS_SUMMARY_DAILY_CAP-gated, OFF unless that env
 * var is set — see lib/ai/newsSummaryDailyCap.ts and
 * lib/marketMoves/summarizeStockNewsBatch.ts) over rows just upserted this
 * run, then a straggler sweep over any row still missing a summary in the
 * last 3 days. Adds roughly 30-90s to the run when the lane is enabled
 * (bounded by MAX_NEW_SUMMARIES_PER_RUN + MAX_STRAGGLER_SUMMARIES_PER_RUN,
 * each doing a body-fetch + AI call) — still comfortably inside the 30-min
 * cadence window. Never blocks or fails the fetch/upsert result above.
 *
 * Prod note: run `prisma db push` to land the MarketMoveNews model before
 * activating this cron.
 */

import { NextResponse } from "next/server";

import { fetchGoogleNewsForTicker, type GoogleNewsItem } from "@/lib/marketMoves/googleNews";
import { buildNewsUniverse } from "@/lib/marketMoves/newsUniverse";
import { isNewsRefreshWindow } from "@/lib/marketMoves/marketHours";
import { summarizeNewStockNews, summarizeStockNewsStragglers } from "@/lib/marketMoves/summarizeStockNewsBatch";
import { prisma } from "@/lib/prisma";

const INTER_REQUEST_DELAY_MS = 400;

function hasCronAccess(request: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const authHeader = request.headers.get("authorization");
  const cronHeader = request.headers.get("x-cron-secret");
  return authHeader === `Bearer ${secret}` || cronHeader === secret;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function run(request: Request) {
  if (!hasCronAccess(request)) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  if (!isNewsRefreshWindow()) {
    return NextResponse.json({ ok: true, skipped: "outside_news_refresh_window" });
  }

  const universe = await buildNewsUniverse().catch((err: unknown) => {
    console.error("[cron/market-moves-news] universe build threw unexpectedly:", err);
    return [] as Awaited<ReturnType<typeof buildNewsUniverse>>;
  });

  if (universe.length === 0) {
    return NextResponse.json({ ok: true, tickers: 0, fetched: 0, upserted: 0, reason: "empty_universe" });
  }

  let fetched = 0;
  let upserted = 0;
  let failed = 0;
  const upsertedIds: string[] = [];

  for (let i = 0; i < universe.length; i++) {
    const ticker = universe[i];

    let items: GoogleNewsItem[] = [];
    try {
      items = await fetchGoogleNewsForTicker(ticker.tickerSymbol, ticker.companyName);
    } catch (err) {
      failed++;
      console.error(`[cron/market-moves-news] fetch failed for ${ticker.tickerSymbol}:`, err);
      items = [];
    }

    fetched += items.length;

    for (const item of items) {
      try {
        // NOTE: `update` deliberately never touches `summary`/`summaryGeneratedAt` —
        // a re-fetched/refreshed headline must never wipe a previously-generated
        // summary. Only the summarizer batch below writes those fields.
        const row = await prisma.marketMoveNews.upsert({
          where: { dedupeKey: item.dedupeKey },
          update: {
            headline: item.headline,
            publisher: item.publisher,
            sourceUrl: item.sourceUrl,
            publishedAt: item.publishedAt,
          },
          create: {
            tickerSymbol: item.tickerSymbol,
            companyName: item.companyName,
            headline: item.headline,
            publisher: item.publisher,
            sourceUrl: item.sourceUrl,
            dedupeKey: item.dedupeKey,
            publishedAt: item.publishedAt,
          },
          select: { id: true },
        });
        upserted++;
        upsertedIds.push(row.id);
      } catch (err) {
        failed++;
        console.error(`[cron/market-moves-news] upsert failed for ${item.dedupeKey}:`, err);
      }
    }

    if (i < universe.length - 1) {
      await sleep(INTER_REQUEST_DELAY_MS);
    }
  }

  // ---- Summary generation (Stock News short-summary lane, NEWS_SUMMARY_DAILY_CAP) ----
  // New-batch pass over rows just upserted this run, THEN (sequential, not
  // concurrent — see below) a straggler sweep over ANY row (this cron's universe
  // or apps/web's on-demand refresh) still missing a summary within the last 3
  // days. Sequential is deliberate: a row just upserted this run is itself within
  // the straggler sweep's 3-day window, so running both passes concurrently could
  // race the same row through two summarize calls at once (double AI spend, wasted
  // budget). Running the new-batch pass to completion first means its writes make
  // those rows fall out of the straggler query's `summary: null` filter before it
  // runs. Awaited here (EC2 crontab route, no serverless timeout to respect), but
  // every failure mode inside is non-throwing and headline-only display is always
  // the safe fallback. See lib/marketMoves/summarizeStockNewsBatch.ts.
  let summarized = 0;
  try {
    const newBatch = await summarizeNewStockNews(upsertedIds);
    const stragglers = await summarizeStockNewsStragglers();
    summarized = newBatch.summarized + stragglers.summarized;
  } catch (err) {
    console.error("[cron/market-moves-news] summary batch failed:", err);
  }

  return NextResponse.json({
    ok: true,
    tickers: universe.length,
    fetched,
    upserted,
    failed,
    summarized,
  });
}

export const GET = run;
export const POST = run;
