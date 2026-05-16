/**
 * Re-extract expert opinions from a single story, deleting existing ones first.
 * Usage: npx tsx scripts/reextract-story.ts <storyId>
 */
import { prisma } from "../lib/prisma";
import { isApprovedFinanceSource, extractExpertOpinionsFromStory, persistExpertOpinions } from "../lib/ai/extractExpertOpinions";

const storyId = process.argv[2];
if (!storyId) { console.error("Usage: npx tsx scripts/reextract-story.ts <storyId>"); process.exit(1); }

async function main() {
  const story = await prisma.story.findUniqueOrThrow({
    where: { id: storyId },
    select: { id: true, headline: true, sourceUrl: true, publishedAt: true, bodyText: true, summary: true },
  });

  console.log("Story:", story.headline);
  console.log("URL:", story.sourceUrl);
  console.log("Approved:", isApprovedFinanceSource(story.sourceUrl));

  // Delete existing opinions so we can see the fresh extraction
  const deleted = await prisma.expertOpinion.deleteMany({ where: { storyId } });
  console.log("Deleted", deleted.count, "existing opinions");

  const opinions = await extractExpertOpinionsFromStory({
    id: story.id,
    title: story.headline,
    content: story.bodyText ?? story.summary ?? "",
    sourceUrl: story.sourceUrl,
    publishedAt: story.publishedAt,
  });

  console.log("Extracted", opinions.length, "opinions:");
  opinions.forEach(op => {
    console.log(` - [${op.isSourceAttribution ? "ANALYSIS" : "EXPERT"}] ${op.expertName || "(no name)"} @ ${op.expertOrganization} — ${op.direction}`);
    console.log(`   "${op.paraphrasedQuote}"`);
  });

  if (opinions.length > 0) {
    await persistExpertOpinions(prisma, story.id, story.sourceUrl, story.publishedAt, opinions);
    console.log("Persisted.");
  }

  await prisma.$disconnect();
}

main().catch(e => { console.error(e.message); process.exit(1); });
