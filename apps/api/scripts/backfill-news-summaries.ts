/**
 * Bounded, opt-in backfill for the "small summary instead of just headlines"
 * feature — NOT run automatically by any cron. Both the Market Pulse Stock
 * News cron (market-moves-news) and the general FINANCE-story ingestion pass
 * only ever summarize NEW stories going forward; this script is the explicit
 * tool for the founder (or CTO) to run once to backfill EXISTING rows,
 * capped so it can't accidentally blow through the NEWS_SUMMARY_DAILY_CAP
 * budget in one run against a large historical backlog.
 *
 * Targets (pick one via --target, default "stock-news"):
 *   stock-news — MarketMoveNews rows (Market Pulse "Stock news" tab,
 *     instrument pages, /pulse) missing `summary`.
 *   story      — Story rows tagged FINANCE missing a real AI summary
 *     (same needsBetterSummary heuristic the ingestion pipeline itself uses).
 *
 * Resumable: honors NEWS_SUMMARY_DAILY_CAP same as the live pipelines (shared
 * in-memory counter, this process's own budget for however long it runs) —
 * re-run on a later day (or with a higher cap set for the run) to continue
 * draining a backlog larger than one day's budget.
 *
 * Usage (from apps/api):
 *   NEWS_SUMMARY_DAILY_CAP=100 npx tsx scripts/backfill-news-summaries.ts --target stock-news --limit 50
 *   NEWS_SUMMARY_DAILY_CAP=100 npx tsx scripts/backfill-news-summaries.ts --target story --limit 50 --lookback-days 14
 */
import { summarizeStockNewsItem } from "../lib/marketMoves/summarizeStockNews";
import { summarizeNewsStory } from "../lib/ai/summarizeNews";
import { needsBetterSummary } from "../lib/news/rss-ingestion-service";
import { fetchArticleBody } from "../lib/news/articleBody";
import { getNewsSummaryDailyCap } from "../lib/ai/newsSummaryDailyCap";
import { prisma } from "../lib/prisma";

function parseArg(name: string, fallback: string): string {
  const flag = `--${name}`;
  const idx = process.argv.indexOf(flag);
  if (idx === -1 || idx === process.argv.length - 1) return fallback;
  return process.argv[idx + 1];
}

const TARGET = parseArg("target", "stock-news") as "stock-news" | "story";
const LIMIT = Number(parseArg("limit", "50"));
const LOOKBACK_DAYS = Number(parseArg("lookback-days", "30"));
const DELAY_MS = Number(process.env.BACKFILL_DELAY_MS ?? 1200);

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

async function backfillStockNews() {
  if (getNewsSummaryDailyCap() <= 0) {
    console.error("NEWS_SUMMARY_DAILY_CAP is unset/0 — set it for this run, e.g. NEWS_SUMMARY_DAILY_CAP=100.");
    process.exit(1);
  }

  const since = new Date(Date.now() - LOOKBACK_DAYS * 24 * 60 * 60 * 1000);
  const candidates = await prisma.marketMoveNews.findMany({
    where: { summary: null, publishedAt: { gte: since } },
    select: { id: true, headline: true, companyName: true, sourceUrl: true },
    orderBy: { publishedAt: "desc" },
    take: LIMIT,
  });

  console.log(
    `MarketMoveNews rows missing summary (last ${LOOKBACK_DAYS}d, capped at ${LIMIT}): ${candidates.length}. Delay ${DELAY_MS}ms.\n`
  );

  let summarized = 0;
  let failed = 0;

  for (let i = 0; i < candidates.length; i++) {
    const row = candidates[i];
    process.stdout.write(`[${i + 1}/${candidates.length}] ${row.headline.slice(0, 55)}\r`);
    try {
      const summary = await summarizeStockNewsItem(row);
      if (summary) {
        await prisma.marketMoveNews.update({
          where: { id: row.id },
          data: { summary, summaryGeneratedAt: new Date() },
        });
        summarized++;
        console.log(`\n  ✓ ${row.headline.slice(0, 55)}`);
      } else {
        failed++;
      }
    } catch (e) {
      failed++;
      console.error(`\n  ✗ ${e instanceof Error ? e.message : String(e)}`);
    }
    await sleep(DELAY_MS);
  }

  console.log(`\n═══════════════════════════`);
  console.log(`  Rows attempted:  ${candidates.length}`);
  console.log(`  Summarized:      ${summarized}`);
  console.log(`  Skipped/failed:  ${failed}`);
  console.log(`  Re-run to continue draining (honors NEWS_SUMMARY_DAILY_CAP per run).`);
  console.log(`═══════════════════════════`);
}

async function backfillStory() {
  if (getNewsSummaryDailyCap() <= 0) {
    console.error("NEWS_SUMMARY_DAILY_CAP is unset/0 — set it for this run, e.g. NEWS_SUMMARY_DAILY_CAP=100.");
    process.exit(1);
  }

  const since = new Date(Date.now() - LOOKBACK_DAYS * 24 * 60 * 60 * 1000);
  const candidates = await prisma.story.findMany({
    where: {
      category: "FINANCE",
      status: { in: ["PUBLISHED", "APPROVED"] },
      publishedAt: { gte: since },
    },
    select: { id: true, headline: true, summary: true, sourceUrl: true },
    orderBy: { publishedAt: "desc" },
    take: LIMIT * 3, // needsBetterSummary filters further below; over-fetch to reach LIMIT eligible rows
  });

  const eligible = candidates.filter((s) => needsBetterSummary(s.summary, s.headline)).slice(0, LIMIT);

  console.log(
    `FINANCE stories needing a better summary (last ${LOOKBACK_DAYS}d, capped at ${LIMIT}): ${eligible.length}. Delay ${DELAY_MS}ms.\n`
  );

  let summarized = 0;
  let failed = 0;

  for (let i = 0; i < eligible.length; i++) {
    const s = eligible[i];
    process.stdout.write(`[${i + 1}/${eligible.length}] ${s.headline.slice(0, 55)}\r`);
    try {
      const { text: bodyText } = await fetchArticleBody(s.sourceUrl);
      if (!bodyText) {
        failed++;
        await sleep(DELAY_MS);
        continue;
      }
      const summary = await summarizeNewsStory(s.headline, bodyText);
      if (summary) {
        await prisma.story.update({ where: { id: s.id }, data: { summary, summaryReady: true } });
        summarized++;
        console.log(`\n  ✓ ${s.headline.slice(0, 55)}`);
      } else {
        failed++;
      }
    } catch (e) {
      failed++;
      console.error(`\n  ✗ ${e instanceof Error ? e.message : String(e)}`);
    }
    await sleep(DELAY_MS);
  }

  console.log(`\n═══════════════════════════`);
  console.log(`  Stories attempted: ${eligible.length}`);
  console.log(`  Summarized:        ${summarized}`);
  console.log(`  Skipped/failed:    ${failed}`);
  console.log(`  Re-run to continue draining (honors NEWS_SUMMARY_DAILY_CAP per run).`);
  console.log(`═══════════════════════════`);
}

async function main() {
  if (TARGET === "stock-news") {
    await backfillStockNews();
  } else if (TARGET === "story") {
    await backfillStory();
  } else {
    console.error(`Unknown --target "${TARGET}" — expected "stock-news" or "story".`);
    process.exit(1);
  }
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
