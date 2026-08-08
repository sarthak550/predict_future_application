/**
 * Batch orchestration for the MarketMoveNews short-summary lane — shared by the
 * market-moves-news cron's two passes:
 *   1. New-batch: rows just upserted this run that have no summary yet.
 *   2. Straggler sweep: ANY row (regardless of which process created it —
 *      this cron's own fetch, or apps/web's on-demand instrument-page
 *      refresh, see apps/web/lib/finance/enrichment.ts) still missing a
 *      summary within a recent lookback window. This is how on-demand rows
 *      created by apps/web get backfilled without apps/web needing its own
 *      AI-key config or budget lane — this cron runs every 30 min and sweeps
 *      the whole table, not just its own fetch universe.
 *
 * Concurrency-limited + inter-batch paused, same shape as
 * lib/news/rss-ingestion-service.ts's runSummarizerBatch, to avoid Groq 429s.
 * Every item is still individually gated by NEWS_SUMMARY_DAILY_CAP inside
 * summarizeStockNewsItem — these per-run caps exist to bound cron WALL-CLOCK
 * TIME (body-fetch + AI call per item), not spend; spend is bounded by the
 * daily cap alone.
 */

import { prisma } from "@/lib/prisma";
import { summarizeStockNewsItem } from "./summarizeStockNews";
import { isNewsSummaryLaneEnabled } from "@/lib/ai/newsSummaryDailyCap";

const CONCURRENCY = 3;
const BATCH_PAUSE_MS = 1500;
const MAX_NEW_SUMMARIES_PER_RUN = 15;
const MAX_STRAGGLER_SUMMARIES_PER_RUN = 15;
const STRAGGLER_LOOKBACK_MS = 3 * 24 * 60 * 60 * 1000; // 3 days, matches the Story pipeline's straggler window

type SummaryCandidate = {
  id: string;
  headline: string;
  companyName: string;
  sourceUrl: string;
};

async function runBatch(candidates: SummaryCandidate[], logTag: string): Promise<{ summarized: number }> {
  let summarized = 0;

  for (let i = 0; i < candidates.length; i += CONCURRENCY) {
    if (i > 0) {
      await new Promise<void>((r) => setTimeout(r, BATCH_PAUSE_MS));
    }

    const batch = candidates.slice(i, i + CONCURRENCY);
    const results = await Promise.all(
      batch.map(async (item) => {
        try {
          const summary = await summarizeStockNewsItem(item);
          if (!summary) return false;
          await prisma.marketMoveNews.update({
            where: { id: item.id },
            data: { summary, summaryGeneratedAt: new Date() },
          });
          return true;
        } catch (err) {
          console.error(`${logTag} failed for ${item.id}:`, err);
          return false;
        }
      })
    );
    summarized += results.filter(Boolean).length;
  }

  return { summarized };
}

/**
 * New-batch pass: summarizes rows from THIS run's dedupeKeys that don't have a
 * summary yet. Takes the ids the cron just upserted (not a DB query) since the
 * caller already has that list in memory from the fetch loop.
 */
export async function summarizeNewStockNews(
  newlyUpsertedIds: string[]
): Promise<{ summarized: number; attempted: number }> {
  if (!isNewsSummaryLaneEnabled() || newlyUpsertedIds.length === 0) {
    return { summarized: 0, attempted: 0 };
  }

  const candidates = await prisma.marketMoveNews.findMany({
    where: { id: { in: newlyUpsertedIds }, summary: null },
    select: { id: true, headline: true, companyName: true, sourceUrl: true },
    take: MAX_NEW_SUMMARIES_PER_RUN,
  });

  if (candidates.length === 0) {
    return { summarized: 0, attempted: 0 };
  }

  const { summarized } = await runBatch(candidates, "[marketMoves/summarizeStockNews:new]");
  return { summarized, attempted: candidates.length };
}

/**
 * Straggler sweep: rows missing a summary within the last 3 days, regardless
 * of origin (this cron's own universe, or apps/web's on-demand refresh).
 */
export async function summarizeStockNewsStragglers(): Promise<{ summarized: number; attempted: number }> {
  if (!isNewsSummaryLaneEnabled()) {
    return { summarized: 0, attempted: 0 };
  }

  const since = new Date(Date.now() - STRAGGLER_LOOKBACK_MS);
  const candidates = await prisma.marketMoveNews.findMany({
    where: { summary: null, publishedAt: { gte: since } },
    select: { id: true, headline: true, companyName: true, sourceUrl: true },
    orderBy: { publishedAt: "desc" },
    take: MAX_STRAGGLER_SUMMARIES_PER_RUN,
  });

  if (candidates.length === 0) {
    return { summarized: 0, attempted: 0 };
  }

  const { summarized } = await runBatch(candidates, "[marketMoves/summarizeStockNews:straggler]");
  return { summarized, attempted: candidates.length };
}
