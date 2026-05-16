/**
 * One-off migration: backfill existing IMPLICATION votes from the old 3-value
 * system (BULLISH / NEUTRAL / BEARISH) to the new 5-bucket system.
 *
 * Mapping:
 *   BULLISH  → STRONG_GAIN
 *   NEUTRAL  → FLAT
 *   BEARISH  → STRONG_DROP
 *
 * Run from apps/api/:
 *   npx tsx scripts/migrate-poll-a-buckets.ts
 */

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  console.log("Starting Poll A bucket migration...");

  const [bullishResult, neutralResult, bearishResult] = await Promise.all([
    prisma.expertOpinionVote.updateMany({
      where: { pollType: "IMPLICATION", choice: "BULLISH" },
      data: { choice: "STRONG_GAIN" },
    }),
    prisma.expertOpinionVote.updateMany({
      where: { pollType: "IMPLICATION", choice: "NEUTRAL" },
      data: { choice: "FLAT" },
    }),
    prisma.expertOpinionVote.updateMany({
      where: { pollType: "IMPLICATION", choice: "BEARISH" },
      data: { choice: "STRONG_DROP" },
    }),
  ]);

  console.log(`Migrated BULLISH → STRONG_GAIN: ${bullishResult.count} rows`);
  console.log(`Migrated NEUTRAL → FLAT: ${neutralResult.count} rows`);
  console.log(`Migrated BEARISH → STRONG_DROP: ${bearishResult.count} rows`);
  console.log(
    `Total rows migrated: ${bullishResult.count + neutralResult.count + bearishResult.count}`
  );
  console.log("Migration complete.");
}

main()
  .catch((err) => {
    console.error("Migration failed:", err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
