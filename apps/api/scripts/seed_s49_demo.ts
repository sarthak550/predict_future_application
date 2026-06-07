/**
 * Sprint 49 demo seed — populates dev DB so the BigCallCard renders AND the
 * Top 3 Analyst footer/sheet show real data instead of the "Not enough resolved
 * calls yet." empty state.
 *
 * What it does:
 *   1. Picks one OPEN FINANCE market and sets `isBigCallDate = today`
 *   2. For three named analysts, backdates resolved opinions in the last 7 days
 *      with isSourceAttribution=false so `/api/experts/top-weekly` returns them
 *
 * Safe to re-run: demo opinions are tagged with quoteHash prefix `s49demo_` and
 * are wiped before re-creation. The BigCallDate flip is idempotent.
 *
 * Run: `npx tsx scripts/seed_s49_demo.ts` from apps/api
 */
import { Prisma } from "@prisma/client";

import { prisma } from "../lib/prisma";

const TOP_3 = [
  // Highest accuracy first — drives the #1 slot in BigCallCard footer
  { expertId: "cmoxzf28o000itrlidsvbqbgr", name: "Vinod Nair",      org: "Geojit Investments",      hits: 6, misses: 1 },
  { expertId: "cmoxxxu0b00apg38d85pjwc1h", name: "Rupak De",        org: "LKP Securities",          hits: 5, misses: 2 },
  { expertId: "cmoxlqqc4006fmm6w52p7qmkd", name: "Kranthi Bathini", org: "WealthMills Securities",  hits: 4, misses: 3 },
];

async function main() {
  // Refuse to run against production. This script writes fake demo opinions
  // and flips a market's isBigCallDate flag — both of which would be very bad
  // to do against a live DB. Override is intentional and explicit.
  if (process.env.NODE_ENV === "production" && process.env.ALLOW_DEMO_SEED_IN_PROD !== "yes-i-am-sure") {
    throw new Error(
      "Refusing to run seed_s49_demo.ts with NODE_ENV=production. " +
      "Set ALLOW_DEMO_SEED_IN_PROD=yes-i-am-sure if you really mean it."
    );
  }

  console.log("Sprint 49 demo seed starting...\n");

  // 1. Mark a Big Call market for today
  const market = await prisma.market.findFirst({
    where: { status: "OPEN", category: "FINANCE" },
    orderBy: { createdAt: "desc" },
  });
  if (!market) throw new Error("No OPEN FINANCE market found to mark as Big Call");
  await prisma.market.update({
    where: { id: market.id },
    data: { isBigCallDate: new Date() },
  });
  console.log(`[1/2] Marked Big Call market: ${market.title}`);
  console.log(`       (${market.id}, isBigCallDate=now)\n`);

  // 2. Backdate resolved opinions for the 3 demo analysts
  const story = await prisma.story.findFirst();
  if (!story) throw new Error("No Story available — cannot attach opinions");

  const now = new Date();
  const oneDay = 24 * 60 * 60 * 1000;

  console.log("[2/2] Seeding ExpertOpinion rows:");
  for (const target of TOP_3) {
    const cleared = await prisma.expertOpinion.deleteMany({
      where: {
        expertId: target.expertId,
        quoteHash: { startsWith: "s49demo_" },
      },
    });

    const rows: Prisma.ExpertOpinionCreateManyInput[] = [];
    for (let i = 0; i < target.hits; i++) {
      const daysAgo = (i % 6) + 1; // 1..6 days, deterministic
      const resolvedAt = new Date(now.getTime() - daysAgo * oneDay);
      const publishedAt = new Date(resolvedAt.getTime() - oneDay);
      rows.push({
        expertId: target.expertId,
        storyId: story.id,
        quote: `Demo call ${i + 1}: ${target.name} called Nifty BULLISH and it played out.`,
        direction: "BULLISH",
        sourceUrl: `https://demo.local/s49/${target.expertId}/hit-${i}`,
        extractedAt: publishedAt,
        publishedAt,
        isSourceAttribution: false,
        resolutionStatus: "RESOLVED_HIT",
        resolvedAt,
        instrument: "Nifty 50",
        instrumentTicker: "^NSEI",
        quoteHash: `s49demo_${target.expertId}_hit_${i}`,
        resolutionNote: "Sprint 49 demo seed (HIT)",
      });
    }
    for (let i = 0; i < target.misses; i++) {
      const daysAgo = (i % 6) + 1;
      const resolvedAt = new Date(now.getTime() - daysAgo * oneDay);
      const publishedAt = new Date(resolvedAt.getTime() - oneDay);
      rows.push({
        expertId: target.expertId,
        storyId: story.id,
        quote: `Demo call ${i + 1}: ${target.name} called Nifty BEARISH but it went the other way.`,
        direction: "BEARISH",
        sourceUrl: `https://demo.local/s49/${target.expertId}/miss-${i}`,
        extractedAt: publishedAt,
        publishedAt,
        isSourceAttribution: false,
        resolutionStatus: "RESOLVED_MISS",
        resolvedAt,
        instrument: "Nifty 50",
        instrumentTicker: "^NSEI",
        quoteHash: `s49demo_${target.expertId}_miss_${i}`,
        resolutionNote: "Sprint 49 demo seed (MISS)",
      });
    }
    await prisma.expertOpinion.createMany({ data: rows });
    const accuracy = Math.round((target.hits / (target.hits + target.misses)) * 100);
    console.log(`       ${target.name.padEnd(18)} | ${target.hits}H/${target.misses}M = ${accuracy}%  (cleared ${cleared.count} prior demo rows)`);
  }

  console.log("\nDone. Test it:");
  console.log("  curl http://localhost:3001/api/experts/top-weekly");
  console.log("  → should return 3 analysts ranked by accuracy");
  console.log("\nIn the Expo app:");
  console.log("  - Restart Metro if the TopAnalystsSheet import is still failing");
  console.log("  - Open Feed tab → BigCallCard now renders → footer shows #1 analyst");

  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
