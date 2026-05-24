/**
 * Backfill headline field on ExpertOpinion records (S35-T2).
 *
 * Generates a 4-6 word server-side headline from each opinion's paraphrasedQuote
 * via the Gemini AI pipeline. Idempotent — skips opinions that already have a headline.
 *
 * Usage:
 *   cd apps/api && npx tsx scripts/backfill-opinion-headlines.ts
 *
 * Env vars honoured:
 *   BATCH_SIZE    — how many opinions to process per run (default: 100)
 *   DELAY_MS      — ms delay between AI calls to avoid rate limits (default: 300)
 *   DRY_RUN       — set to "true" to log generated headlines without persisting
 */

import { prisma } from "../lib/prisma";
import { generateHeadlineForOpinion } from "../lib/ai/generateHeadline";

const BATCH_SIZE = parseInt(process.env.BATCH_SIZE ?? "100", 10);
const DELAY_MS = parseInt(process.env.DELAY_MS ?? "300", 10);
const DRY_RUN = process.env.DRY_RUN === "true";

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

async function main() {
  console.info(`[backfill-opinion-headlines] Starting. batch=${BATCH_SIZE} delay=${DELAY_MS}ms dryRun=${DRY_RUN}`);

  // Only process opinions without headlines (idempotent)
  const opinions = await prisma.expertOpinion.findMany({
    where: {
      headline: null,
      suppressedAt: null,
      isSourceAttribution: false,
    },
    select: {
      id: true,
      quote: true,
      direction: true,
      instrument: true,
      expert: {
        select: { name: true, organization: true },
      },
    },
    orderBy: { publishedAt: "desc" },
    take: BATCH_SIZE,
  });

  console.info(`[backfill-opinion-headlines] Found ${opinions.length} opinions without headlines.`);

  let processed = 0;
  let skipped = 0;

  for (const op of opinions) {
    try {
      const headline = await generateHeadlineForOpinion({
        quote: op.quote,
        direction: op.direction,
        instrument: op.instrument ?? undefined,
        expertName: op.expert.name,
      });

      if (!headline) {
        console.warn(`[backfill-opinion-headlines] No headline generated for ${op.id} — skipping.`);
        skipped++;
        continue;
      }

      if (DRY_RUN) {
        console.info(`[DRY] ${op.id}: "${headline}"`);
      } else {
        await prisma.expertOpinion.update({
          where: { id: op.id },
          data: { headline },
        });
        console.info(`[backfill-opinion-headlines] Updated ${op.id}: "${headline}"`);
      }

      processed++;
    } catch (err) {
      console.error(`[backfill-opinion-headlines] Error on ${op.id}:`, err);
      skipped++;
    }

    if (DELAY_MS > 0) {
      await sleep(DELAY_MS);
    }
  }

  console.info(`[backfill-opinion-headlines] Done. processed=${processed} skipped=${skipped}`);
  await prisma.$disconnect();
}

main().catch((err) => {
  console.error("[backfill-opinion-headlines] Fatal:", err);
  process.exit(1);
});
