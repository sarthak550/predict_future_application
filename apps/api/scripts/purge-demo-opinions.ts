/**
 * Purge demo/seed expert-opinion fixtures (quotes starting with "Demo call …").
 * These are fake bull+bear fixtures attached to non-finance stories; the re-extract
 * pipeline won't touch them, so they must be removed explicitly as part of the reset.
 *
 * Dry-run by default; pass --apply to delete.
 *
 * Usage (from apps/api):
 *   npx tsx scripts/purge-demo-opinions.ts          # show count
 *   npx tsx scripts/purge-demo-opinions.ts --apply  # delete
 */
import { prisma } from '../lib/prisma';

const APPLY = process.argv.includes('--apply');

async function main() {
  const where = { quote: { startsWith: 'Demo call' } };
  const count = await prisma.expertOpinion.count({ where });
  console.log(`Demo-seed opinions matching "Demo call…": ${count}`);

  if (!APPLY) {
    console.log('\nDRY RUN — nothing deleted. Re-run with --apply to delete them.');
    await prisma.$disconnect();
    return;
  }

  const res = await prisma.expertOpinion.deleteMany({ where });
  console.log(`\n🗑️  Deleted ${res.count} demo opinions (votes cascaded).`);
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
