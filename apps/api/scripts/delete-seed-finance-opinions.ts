/**
 * Seed cleanup script — removes fake seed Finance data.
 *
 * Deletes in dependency order:
 * 1. ExpertOpinion rows where sourceUrl contains 'predictfuture-seed'
 * 2. Market rows whose storyId belongs to the seeded stories
 * 3. Story rows where sourceUrl contains 'predictfuture-seed'
 *
 * This script is idempotent — safe to re-run on a clean database.
 *
 * Usage: cd apps/api && npx tsx scripts/delete-seed-finance-opinions.ts
 */

import { prisma } from "../lib/prisma";

const SEED_URL_PATTERN = "predictfuture-seed";

async function main() {
  console.log("[seed-cleanup] Starting seed Finance data cleanup...");

  // Step 1: Find seeded stories so we can delete their markets first
  const seededStories = await prisma.story.findMany({
    where: {
      sourceUrl: { contains: SEED_URL_PATTERN },
    },
    select: { id: true, sourceUrl: true },
  });

  console.log(`[seed-cleanup] Found ${seededStories.length} seeded Story rows to delete.`);

  // Step 2: Delete ExpertOpinion rows linked to seeded sourceUrls
  const deletedOpinions = await prisma.expertOpinion.deleteMany({
    where: {
      sourceUrl: { contains: SEED_URL_PATTERN },
    },
  });
  console.log(`[seed-cleanup] Deleted ${deletedOpinions.count} ExpertOpinion row(s) with seed sourceUrl.`);

  // Step 3: Delete Market rows linked to the seeded stories
  if (seededStories.length > 0) {
    const seededStoryIds = seededStories.map((s) => s.id);

    const deletedMarkets = await prisma.market.deleteMany({
      where: {
        storyId: { in: seededStoryIds },
      },
    });
    console.log(`[seed-cleanup] Deleted ${deletedMarkets.count} Market row(s) linked to seeded stories.`);
  } else {
    console.log("[seed-cleanup] No seeded stories found — skipping Market deletion.");
  }

  // Step 4: Delete the seeded Story rows themselves
  const deletedStories = await prisma.story.deleteMany({
    where: {
      sourceUrl: { contains: SEED_URL_PATTERN },
    },
  });
  console.log(`[seed-cleanup] Deleted ${deletedStories.count} Story row(s) with seed sourceUrl.`);

  console.log("[seed-cleanup] Done. Summary:");
  console.log(`  ExpertOpinions deleted: ${deletedOpinions.count}`);
  console.log(`  Stories deleted:        ${deletedStories.count}`);

  await prisma.$disconnect();
}

main().catch((err) => {
  console.error("[seed-cleanup] Fatal error:", err);
  process.exit(1);
});
