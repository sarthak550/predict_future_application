/**
 * Quota-resilient, RESUMABLE re-extraction of expert opinions for all stories that
 * already have opinions, replacing them with clean takes from the fixed prompt +
 * fixed instrument resolver (label-first, boundary-matched, headline-free).
 *
 * Designed for free-tier AI rate limits:
 *   - Extracts FIRST, replaces only on success → a rate-limited story keeps its old
 *     rows (the feed is NEVER emptied). This makes a "full reset" safe to run
 *     incrementally — each pass cleans more stories as quota frees up.
 *   - RESUMABLE: skips stories whose newest opinion is younger than RESUME_WINDOW_H
 *     hours (already re-extracted this cycle), so re-runs continue where they stopped.
 *   - Paced via REEXTRACT_DELAY_MS (default 4000ms) to stay under requests-per-minute.
 *   - Honors FINANCE_AI_DAILY_CAP (the extractor's own daily call cap).
 *
 * Run it repeatedly (e.g. a few times a day) until "remaining" hits 0. When the AI
 * is fully throttled a pass will report 0 extracted — just run it again later.
 *
 * Usage (from apps/api):
 *   npx tsx scripts/reextract-all-opinions.ts
 *   FINANCE_AI_DAILY_CAP=200 REEXTRACT_DELAY_MS=5000 npx tsx scripts/reextract-all-opinions.ts
 */
import { isApprovedFinanceSource, extractExpertOpinionsFromStory, persistExpertOpinions } from '../lib/ai/extractExpertOpinions';
import { prisma } from '../lib/prisma';

const DELAY_MS = Number(process.env.REEXTRACT_DELAY_MS ?? 4000);
const RESUME_WINDOW_H = Number(process.env.REEXTRACT_RESUME_WINDOW_H ?? 24);
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

async function main() {
  const resumeCutoff = new Date(Date.now() - RESUME_WINDOW_H * 60 * 60 * 1000);

  const stories = await prisma.story.findMany({
    where: { expertOpinions: { some: {} } },
    select: {
      id: true,
      headline: true,
      sourceUrl: true,
      publishedAt: true,
      bodyText: true,
      summary: true,
      expertOpinions: { select: { createdAt: true }, orderBy: { createdAt: 'desc' }, take: 1 },
    },
    orderBy: { publishedAt: 'desc' },
  });

  console.log(`Found ${stories.length} stories with opinions. Resume window: ${RESUME_WINDOW_H}h, delay: ${DELAY_MS}ms\n`);

  let extracted = 0, replaced = 0, alreadyFresh = 0, notApproved = 0, noBody = 0, noAi = 0, failed = 0;

  for (let i = 0; i < stories.length; i++) {
    const s = stories[i]!;

    // RESUME: already re-extracted within the window → skip.
    const newest = s.expertOpinions[0]?.createdAt;
    if (newest && newest >= resumeCutoff) { alreadyFresh++; continue; }

    if (!isApprovedFinanceSource(s.sourceUrl)) { notApproved++; continue; }
    const content = s.bodyText ?? s.summary ?? '';
    if (!content) { noBody++; continue; }

    process.stdout.write(`[${i + 1}/${stories.length}] ${s.headline.slice(0, 60)}\r`);

    try {
      const opinions = await extractExpertOpinionsFromStory({
        id: s.id, title: s.headline, content, sourceUrl: s.sourceUrl, publishedAt: s.publishedAt,
      });
      if (opinions.length > 0) {
        const del = await prisma.expertOpinion.deleteMany({ where: { storyId: s.id } });
        await persistExpertOpinions(prisma, s.id, s.sourceUrl, s.publishedAt, opinions);
        extracted += opinions.length;
        replaced++;
        console.log(`\n  ✓ [${s.publishedAt.toISOString().slice(0, 10)}] ${del.count} old → ${opinions.length} new: ${s.headline.slice(0, 55)}`);
      } else {
        // AI returned nothing (throttled, or no qualifying calls) → keep existing.
        noAi++;
      }
    } catch (err) {
      console.error(`\n  ✗ ${err instanceof Error ? err.message : String(err)}`);
      failed++;
    }

    await sleep(DELAY_MS);
  }

  const remaining = stories.length - alreadyFresh - notApproved - noBody - replaced;
  const total = await prisma.expertOpinion.count({ where: { suppressedAt: null } });
  console.log(`\n═══════════════════════════`);
  console.log(`  Replaced (cleaned):  ${replaced} stories  (${extracted} new opinions)`);
  console.log(`  Already fresh:       ${alreadyFresh}  (skipped, within ${RESUME_WINDOW_H}h)`);
  console.log(`  AI returned 0:       ${noAi}  ← throttled or no calls; re-run later`);
  console.log(`  Not approved src:    ${notApproved}  (won't re-extract — purge separately)`);
  console.log(`  No body text:        ${noBody}`);
  console.log(`  Failed:              ${failed}`);
  console.log(`  ── still needing a clean pass: ~${remaining} stories`);
  console.log(`  DB visible opinions: ${total}`);
  console.log(`═══════════════════════════`);
  if (noAi > 0) console.log(`\n${noAi} stories got 0 from the AI (likely throttled). Re-run this script later to continue.`);
  await prisma.$disconnect();
}

main().catch((e) => { console.error(e); process.exit(1); });
