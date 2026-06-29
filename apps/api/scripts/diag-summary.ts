import { prisma } from "@/lib/prisma";
import { fetchArticleBody } from "@/lib/news/articleBody";
import { summarizeNewsStory } from "@/lib/ai/summarizeNews";
import { needsBetterSummary } from "@/lib/news/rss-ingestion-service";

const CONCURRENCY = 1;
const BATCH_DELAY_MS = 2500; // pace under the AI per-minute rate limit
const MAX = Number(process.env.MAX ?? 100);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const stories = await prisma.story.findMany({
    where: { status: { in: ["PUBLISHED", "APPROVED"] } },
    select: { id: true, headline: true, summary: true, sourceUrl: true },
    orderBy: { publishedAt: "desc" },
    take: 600,
  });
  const needAll = stories.filter((s) => needsBetterSummary(s.summary, s.headline));
  const eligible = needAll.slice(0, MAX);
  console.log(`fetched=${stories.length}  need-summary=${needAll.length}  processing=${eligible.length}`);

  let ok = 0,
    fail = 0;
  for (let i = 0; i < eligible.length; i += CONCURRENCY) {
    const batch = eligible.slice(i, i + CONCURRENCY);
    await Promise.allSettled(
      batch.map(async (story) => {
        try {
          const { text: body } = await fetchArticleBody(story.sourceUrl);
          if (!body) {
            fail++;
            return;
          }
          const summary = await summarizeNewsStory(story.headline, body);
          if (!summary) {
            fail++;
            return;
          }
          await prisma.story.update({ where: { id: story.id }, data: { summary } });
          ok++;
          console.log(`  ✓ [${summary.split(/\s+/).filter(Boolean).length}w] ${story.headline.slice(0, 55)}`);
        } catch (e) {
          fail++;
          console.log(`  ! ${story.headline.slice(0, 45)}: ${e instanceof Error ? e.message.slice(0, 60) : e}`);
        }
      })
    );
    await sleep(BATCH_DELAY_MS);
  }
  console.log(`\nDONE: updated=${ok}  failed(no body / AI null / err)=${fail}`);
}

main()
  .then(() => prisma.$disconnect())
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
