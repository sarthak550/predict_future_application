/**
 * Drains the backlog of FINANCE stories that have NO expert opinions yet and extracts
 * them — the step the `ingest:news` CLI silently skips.
 *
 * Why this exists: during ingestion, opinion extraction is fire-and-forget
 * (`void extractFinanceOpinionsInBackground(...)` in rss-ingestion-service.ts). That's
 * fine on the long-running server (the cron route keeps running after the HTTP
 * response), but the `ingest:news` CLI calls prisma.$disconnect() and exits before the
 * background extraction runs — so via the CLI, articles get ingested but no opinions
 * are ever extracted. This script runs the extraction AWAITED so it actually completes.
 *
 * Resumable + paced for free-tier AI limits. Re-run until "remaining" hits ~0; each run
 * skips stories that already have opinions and honors the extractor's FINANCE_AI_DAILY_CAP.
 *
 * Usage (from apps/api):
 *   FINANCE_AI_DAILY_CAP=200 npx tsx scripts/extract-finance-opinions.ts
 *   LOOKBACK_DAYS=14 EXTRACT_DELAY_MS=1500 npx tsx scripts/extract-finance-opinions.ts
 */
import {
  extractExpertOpinionsFromStory,
  isApprovedFinanceSource,
  persistExpertOpinions,
} from "../lib/ai/extractExpertOpinions";
import { fetchArticleBody } from "../lib/news/articleBody";
import { prisma } from "../lib/prisma";

const DELAY_MS = Number(process.env.EXTRACT_DELAY_MS ?? 1200);
const LOOKBACK_DAYS = Number(process.env.LOOKBACK_DAYS ?? 30);
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

async function main() {
  const since = new Date(Date.now() - LOOKBACK_DAYS * 24 * 60 * 60 * 1000);

  const candidates = await prisma.story.findMany({
    where: {
      category: "FINANCE",
      expertOpinions: { none: {} },
      createdAt: { gte: since },
      bodyFetchFailed: { not: true },
    },
    select: { id: true, headline: true, summary: true, sourceUrl: true, publishedAt: true, bodyText: true },
    orderBy: { publishedAt: "desc" },
  });

  const approved = candidates.filter((s) => isApprovedFinanceSource(s.sourceUrl));
  console.log(
    `FINANCE stories without opinions (last ${LOOKBACK_DAYS}d): ${candidates.length} total, ${approved.length} from approved analyst sources. Delay ${DELAY_MS}ms.\n`
  );

  let processed = 0;
  let extracted = 0;
  let zero = 0;
  let failed = 0;

  for (const s of approved) {
    process.stdout.write(`[${processed + 1}/${approved.length}] ${s.headline.slice(0, 55)}\r`);
    try {
      let content = s.bodyText && s.bodyText.length >= 200 ? s.bodyText : "";
      if (!content) {
        const body = await fetchArticleBody(s.sourceUrl);
        if (body.text) {
          content = body.text;
          await prisma.story.update({
            where: { id: s.id },
            data: { bodyText: body.text, bodyFetchedAt: new Date(), bodyFetchFailed: false },
          });
        } else {
          await prisma.story.update({
            where: { id: s.id },
            data: { bodyFetchFailed: true, bodyFetchedAt: new Date() },
          });
          content = `${s.headline}\n\n${s.summary}`;
        }
      }

      const ops = await extractExpertOpinionsFromStory({
        id: s.id,
        title: s.headline,
        content,
        sourceUrl: s.sourceUrl,
        publishedAt: s.publishedAt,
      });
      processed++;

      if (ops.length > 0) {
        await persistExpertOpinions(prisma, s.id, s.sourceUrl, s.publishedAt, ops);
        extracted += ops.length;
        console.log(`\n  ✓ ${ops.length} opinion(s): ${s.headline.slice(0, 55)}`);
      } else {
        zero++;
      }
    } catch (e) {
      failed++;
      console.error(`\n  ✗ ${e instanceof Error ? e.message : String(e)}`);
    }
    await sleep(DELAY_MS);
  }

  const total = await prisma.expertOpinion.count({ where: { suppressedAt: null } });
  console.log(`\n═══════════════════════════`);
  console.log(`  Stories processed:    ${processed}`);
  console.log(`  New opinions:         ${extracted}`);
  console.log(`  Stories with 0 calls: ${zero}`);
  console.log(`  Failed:               ${failed}`);
  console.log(`  DB visible opinions:  ${total}`);
  console.log(`  Re-run to continue draining (honors FINANCE_AI_DAILY_CAP per run).`);
  console.log(`═══════════════════════════`);
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
