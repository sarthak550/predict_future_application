/**
 * Standalone backfill script — run with: npx tsx scripts/backfill-predictions.ts
 * from apps/api directory.
 *
 * Finds stories without markets, calls AI to generate polls or enhanced summaries.
 */
import { randomUUID } from "crypto";

import { prisma } from "../lib/prisma";
import { generatePollWithAI } from "../lib/ai/gemini";

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

async function main() {
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
    take: 15,
  });

  console.log(`Found ${stories.length} stories without markets.`);

  if (stories.length === 0) {
    console.log("Nothing to backfill.");
    process.exit(0);
  }

  // Get an admin user for market creation
  const admin = await prisma.user.findFirst({
    where: { role: "ADMIN" },
    select: { id: true },
  });

  if (!admin) {
    console.error("No admin user found. Create one first.");
    process.exit(1);
  }

  let created = 0;
  let skipped = 0;
  let errors = 0;

  for (const story of stories) {
    try {
      // Rate limit delay — Gemini free tier allows ~15 RPM
      if (created + skipped + errors > 0) {
        const delay = 5000; // 5 seconds between requests
        console.log(`  (waiting ${delay / 1000}s for rate limit...)`);
        await new Promise((r) => setTimeout(r, delay));
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

      // AI decided no good poll possible — update summary
      if (aiResult.skip && aiResult.enhancedSummary) {
        await prisma.story.update({
          where: { id: story.id },
          data: { summary: aiResult.enhancedSummary },
        });
        console.log(`  → SKIPPED (enhanced summary saved)`);
        skipped++;
        continue;
      }

      if (aiResult.skip) {
        console.log(`  → SKIPPED (no enhanced summary)`);
        skipped++;
        continue;
      }

      // Create market
      const now = new Date();
      const closeAt = new Date(now.getTime() + (aiResult.expiresInHours || 24) * 60 * 60 * 1000);

      await prisma.market.create({
        data: {
          slug: `${slugify(aiResult.title).slice(0, 64)}-${randomUUID().slice(0, 8)}`,
          title: aiResult.title,
          description: aiResult.description,
          category: story.category,
          template: "CUSTOM",
          marketType: aiResult.marketType ?? "BINARY",
          visibility: "PUBLIC",
          marketScope: "GLOBAL",
          creatorId: admin.id,
          status: "OPEN",
          closeAt,
          resolveAt: new Date(closeAt.getTime() + 24 * 60 * 60 * 1000),
          resolutionSourceType: "MANUAL",
          resolutionSourceName: "Opinion Poll",
          resolutionRuleText: "This is an opinion poll generated from the news story.",
          storyId: story.id,
          approvedAt: new Date(),
          approvedById: admin.id,
          ...(aiResult.marketType === "NUMERIC" ? {
            unit: aiResult.unit || "units",
            minValue: aiResult.minValue ?? 0,
            maxValue: aiResult.maxValue ?? 1000,
            precision: aiResult.precision ?? 0,
          } : {}),
        },
      });

      console.log(`  → CREATED ${aiResult.marketType} market: "${aiResult.title}"`);
      created++;
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
  console.log(`Created: ${created} markets`);
  console.log(`Skipped: ${skipped} (enhanced summaries)`);
  console.log(`Errors: ${errors}`);

  await prisma.$disconnect();
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
