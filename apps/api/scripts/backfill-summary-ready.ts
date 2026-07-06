/**
 * backfill-summary-ready.ts
 *
 * One-time backfill for the new `Story.summaryReady` flag. Sets summaryReady=true
 * for every existing PUBLISHED/APPROVED story whose current summary already passes
 * the SAME quality bar the live feed filter uses (needsBetterSummary === false).
 *
 * MUST run AFTER `prisma db push` (which adds the column, defaulting every row to
 * false) and BEFORE the app code that filters `summaryReady: true` goes live —
 * otherwise the feed is empty until the cron sweep slowly rebuilds it.
 *
 * Uses the exact `needsBetterSummary` function (not a SQL approximation) so there
 * is zero semantic drift between the backfill and the runtime filter.
 *
 * Run:  DATABASE_URL=<prod-direct-url> npx tsx scripts/backfill-summary-ready.ts
 */

import { PrismaClient } from "@prisma/client";
import { needsBetterSummary } from "@/lib/news/rss-ingestion-service";

const prisma = new PrismaClient();

async function main() {
  const stories = await prisma.story.findMany({
    where: { summaryReady: false, status: { in: ["PUBLISHED", "APPROVED"] } },
    select: { id: true, summary: true, headline: true },
  });

  const readyIds = stories
    .filter((s) => !needsBetterSummary(s.summary, s.headline))
    .map((s) => s.id);

  console.info(
    `[backfill:summaryReady] ${stories.length} candidate stories, ${readyIds.length} already have a valid summary`
  );

  if (readyIds.length === 0) {
    console.info("[backfill:summaryReady] nothing to backfill");
    return;
  }

  // Update in chunks to keep the IN() list a sane size.
  const CHUNK = 500;
  let updated = 0;
  for (let i = 0; i < readyIds.length; i += CHUNK) {
    const chunk = readyIds.slice(i, i + CHUNK);
    const { count } = await prisma.story.updateMany({
      where: { id: { in: chunk } },
      data: { summaryReady: true },
    });
    updated += count;
  }

  console.info(`[backfill:summaryReady] done — marked ${updated} stories summaryReady=true`);
}

main()
  .catch((err) => {
    console.error("[backfill:summaryReady] failed:", err);
    process.exitCode = 1;
  })
  .finally(() => void prisma.$disconnect());
