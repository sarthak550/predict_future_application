/**
 * Backfill Expert.slug for existing rows (Analyst Scorecard Phase 1 — S-Analyst-T1.1).
 *
 * Idempotent: only processes experts where slug IS NULL, so re-running after a partial
 * run or after new experts have been created (which now get a slug at creation time via
 * apps/api/lib/finance/expertSlug.ts) is always safe — it only ever fills gaps.
 *
 * Processes rows SEQUENTIALLY (not Promise.all) so the collision check in
 * generateUniqueExpertSlug (a DB read-then-write) can't race against itself within the
 * same run.
 *
 * Usage:
 *   npx tsx scripts/backfill-expert-slugs.ts --dry-run   # print planned slugs, write nothing
 *   npx tsx scripts/backfill-expert-slugs.ts             # apply
 *
 * Safe to run against prod: the `slug` column is nullable (see schema comment on
 * Expert.slug), so this is a data backfill, not a migration — no db push required to run
 * it (the column must already exist from `prisma db push`, but writing to it needs no
 * further schema change).
 */

import { generateUniqueExpertSlug } from "../lib/finance/expertSlug";
import { prisma } from "../lib/prisma";

const DRY_RUN = process.argv.includes("--dry-run");

async function main() {
  console.log(`[backfill-expert-slugs] Starting${DRY_RUN ? " (DRY RUN — no writes)" : ""}...`);

  const experts = await prisma.expert.findMany({
    where: { slug: null },
    select: { id: true, name: true, organization: true },
    orderBy: { createdAt: "asc" },
  });

  console.log(`[backfill-expert-slugs] Found ${experts.length} expert(s) without a slug.`);

  let assigned = 0;
  let failed = 0;

  for (const expert of experts) {
    try {
      const slug = await generateUniqueExpertSlug(prisma, expert.name, expert.organization, expert.id);

      console.log(
        `[backfill-expert-slugs] id=${expert.id} name="${expert.name}" org="${expert.organization}" -> slug="${slug}"`
      );

      if (!DRY_RUN) {
        await prisma.expert.update({
          where: { id: expert.id },
          data: { slug },
        });
      }

      assigned += 1;
    } catch (err) {
      failed += 1;
      console.error(
        `[backfill-expert-slugs] FAILED id=${expert.id} name="${expert.name}": ${err instanceof Error ? err.message : err}`
      );
    }
  }

  console.log(
    `[backfill-expert-slugs] Done. ${assigned} slug(s) ${DRY_RUN ? "planned" : "assigned"}, ${failed} failed, ${experts.length} scanned.`
  );
}

main()
  .catch((err) => {
    console.error("[backfill-expert-slugs] Fatal error:", err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
