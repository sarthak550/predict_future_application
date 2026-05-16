/**
 * Backfill expert opinion extraction for 2026 FINANCE articles.
 *
 * Three passes:
 *   Pass 0 — body-blocked articles (bodyFetchFailed=true): extract from headline + summary.
 *   Pass 1 — articles that already have bodyText but no expert opinions yet.
 *   Pass 2 — articles that still need body fetch (fetch then extract).
 *
 * Usage: cd apps/api && FINANCE_AI_DAILY_CAP=2000 npx tsx scripts/backfill-2026-opinions.ts
 */

import { prisma } from "../lib/prisma";
import { fetchArticleBody } from "../lib/news/articleBody";
import {
  isApprovedFinanceSource,
  extractExpertOpinionsFromStory,
  persistExpertOpinions,
} from "../lib/ai/extractExpertOpinions";

const SINCE = new Date("2026-01-01");
const PASS0_LIMIT = parseInt(process.env.PASS0_LIMIT ?? "100", 10);
const PASS1_LIMIT = parseInt(process.env.PASS1_LIMIT ?? "900", 10);
const PASS2_LIMIT = parseInt(process.env.PASS2_LIMIT ?? "150", 10);
const DELAY_MS = parseInt(process.env.DELAY_MS ?? "400", 10);

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

async function main() {
  // ── Pass 0: body-blocked articles — extract from headline + summary ──────
  console.log("\n[Pass 0] Finding 2026 FINANCE articles with body fetch failed but no opinions…");
  const pass0 = await prisma.story.findMany({
    where: {
      category: "FINANCE",
      publishedAt: { gte: SINCE },
      bodyFetchFailed: true,
      expertOpinions: { none: {} },
    },
    select: { id: true, headline: true, sourceUrl: true, publishedAt: true, summary: true },
    orderBy: { publishedAt: "desc" },
    take: PASS0_LIMIT,
  });
  console.log(`[Pass 0] ${pass0.length} articles to process.`);

  let p0Extracted = 0;
  let p0Skipped = 0;
  for (let i = 0; i < pass0.length; i++) {
    const story = pass0[i];
    process.stdout.write(`[Pass 0] ${i + 1}/${pass0.length} — ${story.headline.slice(0, 60)}\r`);

    if (!isApprovedFinanceSource(story.sourceUrl)) { p0Skipped++; continue; }
    if (!story.summary) { p0Skipped++; continue; }

    try {
      const content = `${story.headline}\n\n${story.summary}`;
      const opinions = await extractExpertOpinionsFromStory({
        id: story.id,
        title: story.headline,
        content,
        sourceUrl: story.sourceUrl,
        publishedAt: story.publishedAt,
      });
      if (opinions.length > 0) {
        await persistExpertOpinions(prisma, story.id, story.sourceUrl, story.publishedAt, opinions);
        p0Extracted += opinions.length;
        console.log(`\n[Pass 0]   ✓ ${opinions.length} opinion(s) from "${story.headline.slice(0, 60)}"`);
      }
    } catch (err) {
      console.error(`\n[Pass 0]   ✗ Error: ${err instanceof Error ? err.message : String(err)}`);
    }
    await sleep(DELAY_MS);
  }
  console.log(`\n[Pass 0] Done. ${p0Extracted} opinions extracted, ${p0Skipped} sources skipped.`);

  // ── Pass 1: bodyText exists, no opinions yet ─────────────────────────────
  console.log("\n[Pass 1] Finding 2026 FINANCE articles with body but no opinions…");
  const pass1 = await prisma.story.findMany({
    where: {
      category: "FINANCE",
      publishedAt: { gte: SINCE },
      bodyText: { not: null },
      expertOpinions: { none: {} },
    },
    select: { id: true, headline: true, sourceUrl: true, publishedAt: true, bodyText: true, summary: true },
    orderBy: { publishedAt: "desc" },
    take: PASS1_LIMIT,
  });
  console.log(`[Pass 1] ${pass1.length} articles to process.`);

  let p1Extracted = 0;
  let p1Skipped = 0;
  for (let i = 0; i < pass1.length; i++) {
    const story = pass1[i];
    process.stdout.write(`[Pass 1] ${i + 1}/${pass1.length} — ${story.headline.slice(0, 60)}\r`);

    if (!isApprovedFinanceSource(story.sourceUrl)) {
      p1Skipped++;
      continue;
    }

    try {
      const opinions = await extractExpertOpinionsFromStory({
        id: story.id,
        title: story.headline,
        content: story.bodyText ?? story.summary ?? "",
        sourceUrl: story.sourceUrl,
        publishedAt: story.publishedAt,
      });

      if (opinions.length > 0) {
        await persistExpertOpinions(prisma, story.id, story.sourceUrl, story.publishedAt, opinions);
        p1Extracted += opinions.length;
        console.log(`\n[Pass 1]   ✓ ${opinions.length} opinion(s) from "${story.headline.slice(0, 60)}"`);
      }
    } catch (err) {
      console.error(`\n[Pass 1]   ✗ Error: ${err instanceof Error ? err.message : String(err)}`);
    }

    await sleep(DELAY_MS);
  }
  console.log(`\n[Pass 1] Done. ${p1Extracted} opinions extracted, ${p1Skipped} sources skipped.`);

  // ── Pass 2: no body yet — fetch then extract ─────────────────────────────
  console.log("\n[Pass 2] Finding 2026 FINANCE articles that need body fetch…");
  const pass2 = await prisma.story.findMany({
    where: {
      category: "FINANCE",
      publishedAt: { gte: SINCE },
      bodyText: null,
      bodyFetchFailed: false,
      expertOpinions: { none: {} },
    },
    select: { id: true, headline: true, sourceUrl: true, publishedAt: true, summary: true },
    orderBy: { publishedAt: "desc" },
    take: PASS2_LIMIT,
  });
  console.log(`[Pass 2] ${pass2.length} articles to process.`);

  let p2Extracted = 0;
  let p2Failed = 0;
  let p2Skipped = 0;
  for (let i = 0; i < pass2.length; i++) {
    const story = pass2[i];
    process.stdout.write(`[Pass 2] ${i + 1}/${pass2.length} — ${story.headline.slice(0, 60)}\r`);

    if (!isApprovedFinanceSource(story.sourceUrl)) {
      p2Skipped++;
      continue;
    }

    try {
      const bodyResult = await fetchArticleBody(story.sourceUrl);
      if (!bodyResult.text) {
        await prisma.story.update({
          where: { id: story.id },
          data: { bodyFetchFailed: true, bodyFetchedAt: new Date() },
        });
        p2Failed++;
        continue;
      }

      await prisma.story.update({
        where: { id: story.id },
        data: { bodyText: bodyResult.text, bodyFetchedAt: new Date() },
      });

      const opinions = await extractExpertOpinionsFromStory({
        id: story.id,
        title: story.headline,
        content: bodyResult.text,
        sourceUrl: story.sourceUrl,
        publishedAt: story.publishedAt,
      });

      if (opinions.length > 0) {
        await persistExpertOpinions(prisma, story.id, story.sourceUrl, story.publishedAt, opinions);
        p2Extracted += opinions.length;
        console.log(`\n[Pass 2]   ✓ ${opinions.length} opinion(s) from "${story.headline.slice(0, 60)}"`);
      }
    } catch (err) {
      console.error(`\n[Pass 2]   ✗ Error: ${err instanceof Error ? err.message : String(err)}`);
      p2Failed++;
    }

    await sleep(DELAY_MS);
  }
  console.log(`\n[Pass 2] Done. ${p2Extracted} opinions extracted, ${p2Failed} fetch failures, ${p2Skipped} sources skipped.`);

  // ── Summary ──────────────────────────────────────────────────────────────
  const totalNow = await prisma.expertOpinion.count({ where: { suppressedAt: null } });
  const storiesWithOpinions = await prisma.story.count({
    where: { category: "FINANCE", expertOpinions: { some: {} } },
  });
  console.log(`\n[Done] Total opinions in DB: ${totalNow}`);
  console.log(`[Done] FINANCE stories with opinions: ${storiesWithOpinions}`);
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
