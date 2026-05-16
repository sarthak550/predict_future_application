/**
 * Re-extract expert opinions for all stories that already have opinions,
 * replacing them with richer takes from the improved prompt.
 *
 * Usage: FINANCE_AI_DAILY_CAP=200 npx tsx scripts/reextract-all-opinions.ts
 */
import { prisma } from '../lib/prisma';
import { isApprovedFinanceSource, extractExpertOpinionsFromStory, persistExpertOpinions } from '../lib/ai/extractExpertOpinions';

const DELAY_MS = 600;
const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms));

async function main() {
  const stories = await prisma.story.findMany({
    where: { expertOpinions: { some: {} } },
    select: { id: true, headline: true, sourceUrl: true, publishedAt: true, bodyText: true, summary: true },
    orderBy: { publishedAt: 'desc' },
  });

  console.log(`Re-extracting ${stories.length} stories with existing opinions…\n`);

  let extracted = 0, skipped = 0, failed = 0;

  for (let i = 0; i < stories.length; i++) {
    const s = stories[i];
    process.stdout.write(`[${i + 1}/${stories.length}] ${s.headline.slice(0, 65)}\r`);

    if (!isApprovedFinanceSource(s.sourceUrl)) { skipped++; continue; }

    const content = s.bodyText ?? s.summary ?? '';
    if (!content) { skipped++; continue; }

    try {
      // Extract first — only replace if AI returns results (avoids data loss on rate-limit failures)
      const opinions = await extractExpertOpinionsFromStory({
        id: s.id, title: s.headline, content, sourceUrl: s.sourceUrl, publishedAt: s.publishedAt,
      });

      if (opinions.length > 0) {
        const deleted = await prisma.expertOpinion.deleteMany({ where: { storyId: s.id } });
        await persistExpertOpinions(prisma, s.id, s.sourceUrl, s.publishedAt, opinions);
        extracted += opinions.length;
        console.log(`\n  ✓ [${s.publishedAt.toISOString().slice(0,10)}] ${deleted.count} old → ${opinions.length} new: ${s.headline.slice(0,60)}`);
      } else {
        console.log(`\n  – [${s.publishedAt.toISOString().slice(0,10)}] 0 from AI, keeping existing: ${s.headline.slice(0,60)}`);
      }
    } catch (err) {
      console.error(`\n  ✗ Error: ${err instanceof Error ? err.message : String(err)}`);
      failed++;
    }

    await sleep(DELAY_MS);
  }

  const total = await prisma.expertOpinion.count({ where: { suppressedAt: null } });
  console.log(`\n═══════════════════════════`);
  console.log(`  Extracted: ${extracted} opinions`);
  console.log(`  Skipped:   ${skipped}`);
  console.log(`  Failed:    ${failed}`);
  console.log(`  DB total:  ${total} opinions`);
  await prisma.$disconnect();
}

main().catch(e => { console.error(e); process.exit(1); });
