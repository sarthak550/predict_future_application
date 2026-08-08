/**
 * Backfill Expert.nameNormalized for existing rows (duplicate-expert prevention, 2026-08).
 *
 * The column is additive with a `""` default (see the schema comment on
 * Expert.nameNormalized), so it can be pushed to prod without a backfill in the same
 * deploy. This script is the follow-up data fill — run it once after the schema
 * change lands wherever it's needed (dev now; prod is the orchestrator's job, same
 * pattern as scripts/backfill-expert-slugs.ts).
 *
 * Idempotent: only processes rows where nameNormalized = "" (the un-backfilled
 * default) AND name is non-empty, so re-running after a partial run, or after new
 * experts have been created (which now get nameNormalized at creation time via
 * lib/finance/expertMatch.ts), only ever fills gaps. Rows with a genuinely blank
 * name are left at "" on purpose — see the "blank name" note in expertMatch.ts;
 * they carry no name signal to normalize and must never be clustered together.
 *
 * Usage (from apps/api):
 *   npx tsx scripts/backfill-expert-name-normalized.ts --dry-run   # print plan, write nothing
 *   npx tsx scripts/backfill-expert-name-normalized.ts             # apply
 */

import { normalizeExpertName } from "../lib/finance/expertDedup";
import { prisma } from "../lib/prisma";

const DRY_RUN = process.argv.includes("--dry-run");

async function main() {
  console.log(`[backfill-expert-name-normalized] Starting${DRY_RUN ? " (DRY RUN — no writes)" : ""}...`);

  const experts = await prisma.expert.findMany({
    where: { nameNormalized: "", name: { not: "" } },
    select: { id: true, name: true },
    orderBy: { createdAt: "asc" },
  });

  console.log(`[backfill-expert-name-normalized] Found ${experts.length} expert(s) to backfill.`);

  let updated = 0;
  let skippedBlank = 0;

  for (const expert of experts) {
    const nameNormalized = normalizeExpertName(expert.name);
    if (!nameNormalized) {
      // A name that's entirely punctuation/whitespace normalizes to "" — leave as-is.
      skippedBlank++;
      continue;
    }

    if (DRY_RUN) {
      console.log(`  ${expert.id}  "${expert.name}"  ->  "${nameNormalized}"`);
    } else {
      await prisma.expert.update({
        where: { id: expert.id },
        data: { nameNormalized },
      });
    }
    updated++;
  }

  console.log(`\n[backfill-expert-name-normalized] ${DRY_RUN ? "Would update" : "Updated"}: ${updated}`);
  if (skippedBlank > 0) {
    console.log(`[backfill-expert-name-normalized] Skipped (name normalizes to blank): ${skippedBlank}`);
  }

  await prisma.$disconnect();
}

main().catch((err) => {
  console.error("Fatal error:", err instanceof Error ? err.message : err);
  process.exit(1);
});
