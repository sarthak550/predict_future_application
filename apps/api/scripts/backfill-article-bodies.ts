/**
 * Backfill article bodies for FINANCE stories that have no bodyText yet,
 * have not previously failed body fetch, and have no expert opinions yet.
 *
 * For each story:
 * 1. Fetch the article body via fetchArticleBody().
 * 2. On success: persist bodyText + bodyFetchedAt.
 * 3. On failure: persist bodyFetchFailed=true + bodyFetchedAt.
 * 4. If body landed: run extractExpertOpinionsFromStory + persistExpertOpinions.
 *
 * Limit: 50 stories per run to avoid runaway costs and timeouts.
 *
 * Usage: cd apps/api && npx tsx scripts/backfill-article-bodies.ts
 */

import { prisma } from "../lib/prisma";
import { fetchArticleBody } from "../lib/news/articleBody";
import { isApprovedFinanceSource, extractExpertOpinionsFromStory, persistExpertOpinions } from "../lib/ai/extractExpertOpinions";

const BATCH_LIMIT = 50;

async function main() {
  console.log("[backfill] Starting article body backfill for FINANCE stories...");

  // Find FINANCE stories with no bodyText, no prior failure, and no expert opinions yet
  const stories = await prisma.story.findMany({
    where: {
      category: "FINANCE",
      bodyText: null,
      bodyFetchFailed: false,
      expertOpinions: { none: {} },
    },
    select: {
      id: true,
      headline: true,
      summary: true,
      sourceUrl: true,
      publishedAt: true,
    },
    orderBy: { publishedAt: "desc" },
    take: BATCH_LIMIT,
  });

  if (stories.length === 0) {
    console.log("[backfill] No stories need body backfill. Exiting.");
    await prisma.$disconnect();
    return;
  }

  console.log(`[backfill] Found ${stories.length} stories to process.`);

  let bodiesFetched = 0;
  let bodyFailures = 0;
  let opinionsExtracted = 0;

  for (let i = 0; i < stories.length; i++) {
    const story = stories[i];
    console.log(`[backfill] ${i + 1}/${stories.length} — fetching body for story ${story.id}: ${story.sourceUrl.slice(0, 80)}`);

    // Fetch article body
    const bodyResult = await fetchArticleBody(story.sourceUrl);

    if (bodyResult.text) {
      // Persist body text
      await prisma.story.update({
        where: { id: story.id },
        data: {
          bodyText: bodyResult.text,
          bodyFetchedAt: new Date(),
          bodyFetchFailed: false,
        },
      });
      bodiesFetched++;
      console.log(`[backfill] Body fetched (${bodyResult.text.length} chars) for story ${story.id}`);

      // Only extract opinions from approved finance sources
      if (!isApprovedFinanceSource(story.sourceUrl)) {
        console.log(`[backfill] Skipping opinion extraction — source not in approved list: ${story.sourceUrl}`);
        continue;
      }

      // Extract expert opinions using the article body
      try {
        const opinions = await extractExpertOpinionsFromStory({
          id: story.id,
          title: story.headline,
          content: bodyResult.text,
          sourceUrl: story.sourceUrl,
          publishedAt: story.publishedAt,
        });

        if (opinions.length > 0) {
          await persistExpertOpinions(prisma, story.id, story.sourceUrl, story.publishedAt, opinions);
          opinionsExtracted += opinions.length;
          console.log(`[backfill] Extracted ${opinions.length} opinion(s) for story ${story.id}`);
        } else {
          console.log(`[backfill] No opinions extracted for story ${story.id}`);
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`[backfill] Opinion extraction failed for story ${story.id}: ${msg}`);
      }
    } else {
      // Persist failure flag
      await prisma.story.update({
        where: { id: story.id },
        data: {
          bodyFetchFailed: true,
          bodyFetchedAt: new Date(),
        },
      });
      bodyFailures++;
      console.warn(`[backfill] Body fetch failed for story ${story.id}: ${bodyResult.error}`);
    }
  }

  console.log(
    `[backfill] Complete — ${bodiesFetched}/${stories.length} bodies fetched, ` +
    `${bodyFailures} failures, ${opinionsExtracted} opinions extracted`
  );

  await prisma.$disconnect();
}

main().catch((err) => {
  console.error("[backfill] Fatal error:", err);
  process.exit(1);
});
