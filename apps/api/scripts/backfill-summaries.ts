/**
 * Backfill AI summaries for stories without markets that have short/unenhanced summaries.
 * Run with: npx tsx scripts/backfill-summaries.ts
 * from apps/api directory.
 */
import { prisma } from "../lib/prisma";
import { generatePollWithAI } from "../lib/ai/gemini";

async function main() {
  // Find stories without markets where summary = description (AI never enhanced)
  const stories = await prisma.story.findMany({
    where: {
      status: { in: ["PUBLISHED", "APPROVED"] },
      market: null,
    },
    select: {
      id: true,
      headline: true,
      summary: true,
      category: true,
      sourceName: true,
      sourceUrl: true,
      publishedAt: true,
    },
    orderBy: { publishedAt: "desc" },
    take: 30,
  });

  // Filter to only stories needing summary enhancement
  const needsEnhancement = stories.filter((s) => {
    const wordCount = s.summary.trim().split(/\s+/).filter(Boolean).length;
    // Summary is same as description, or too short
    return wordCount < 50;
  });

  console.log(`Found ${stories.length} stories without markets, ${needsEnhancement.length} need summary enhancement.`);

  if (needsEnhancement.length === 0) {
    console.log("Nothing to backfill.");
    process.exit(0);
  }

  let enhanced = 0;
  let errors = 0;

  for (const story of needsEnhancement) {
    try {
      if (enhanced + errors > 0) {
        await new Promise((r) => setTimeout(r, 5000));
      }

      console.log(`\nProcessing: "${story.headline.slice(0, 70)}..."`);

      const aiResult = await generatePollWithAI({
        headline: story.headline,
        summary: story.summary,
        category: story.category,
        sourceName: story.sourceName,
        sourceUrl: story.sourceUrl,
        publishedAt: story.publishedAt.toISOString(),
      });

      if (aiResult.enhancedSummary) {
        const wordCount = aiResult.enhancedSummary.trim().split(/\s+/).filter(Boolean).length;
        await prisma.story.update({
          where: { id: story.id },
          data: { summary: aiResult.enhancedSummary },
        });
        console.log(`  → ENHANCED (${wordCount} words)`);
        enhanced++;
      } else if (aiResult.skip) {
        console.log(`  → SKIPPED (no enhanced summary returned)`);
        errors++;
      } else {
        // AI generated a poll instead of skipping — that's fine, just skip this story
        console.log(`  → AI wants poll, skipping summary-only backfill`);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`  → ERROR: ${msg}`);
      errors++;

      if (msg.toLowerCase().includes("rate limit")) {
        console.warn("Rate limited — stopping.");
        break;
      }
    }
  }

  console.log(`\n--- DONE ---`);
  console.log(`Enhanced: ${enhanced}`);
  console.log(`Errors: ${errors}`);

  await prisma.$disconnect();
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
