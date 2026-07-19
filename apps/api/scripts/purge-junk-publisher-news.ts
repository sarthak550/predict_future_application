/**
 * One-off cleanup — deletes existing MarketMoveNews rows whose publisher is
 * on the shared Market Pulse blocklist (BLOCKLISTED_PUBLISHERS in
 * @predict-future/business-rules: junk aggregators observed in prod
 * republishing contradictory/garbled figures, e.g. Sahi, Whalesbook,
 * scanx.trade, MarketsMojo). The read-side pipeline (refineStockNews) and
 * the ingestion cron (lib/marketMoves/googleNews.ts) both already filter
 * these out going forward — this script cleans up rows stored *before*
 * the blocklist existed, since MarketMoveNews rows are otherwise kept
 * indefinitely.
 *
 * Only ever touches the MarketMoveNews table.
 *
 * Usage:
 *   DRY RUN (default — prints a per-publisher count, deletes nothing):
 *     npx tsx scripts/purge-junk-publisher-news.ts
 *
 *   APPLY:
 *     npx tsx scripts/purge-junk-publisher-news.ts --live
 */

import { BLOCKLISTED_PUBLISHERS, isBlockedPublisher } from "@predict-future/business-rules";

import { prisma } from "../lib/prisma";

const LIVE = process.argv.includes("--live");

async function main(): Promise<void> {
  console.log(`[purge-junk-publisher-news] mode = ${LIVE ? "LIVE (deleting)" : "DRY RUN"}`);
  console.log(`[purge-junk-publisher-news] blocklist: ${BLOCKLISTED_PUBLISHERS.join(", ")}`);

  const rows = await prisma.marketMoveNews.findMany({
    select: { id: true, publisher: true, sourceUrl: true },
  });

  const junkIds: string[] = [];
  const countsByPublisher = new Map<string, number>();

  for (const row of rows) {
    if (!isBlockedPublisher(row)) continue;
    junkIds.push(row.id);
    countsByPublisher.set(row.publisher, (countsByPublisher.get(row.publisher) ?? 0) + 1);
  }

  console.log(`\n[purge-junk-publisher-news] scanned ${rows.length} row(s), found ${junkIds.length} blocklisted:`);
  for (const [publisher, count] of [...countsByPublisher.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`  - "${publisher}": ${count}`);
  }

  if (junkIds.length === 0) {
    console.log("\n[purge-junk-publisher-news] nothing to delete.");
    return;
  }

  if (!LIVE) {
    console.log("\n[purge-junk-publisher-news] DRY RUN — no rows were deleted.");
    console.log("Re-run with --live to delete them.");
    return;
  }

  const { count } = await prisma.marketMoveNews.deleteMany({
    where: { id: { in: junkIds } },
  });

  console.log(`\n[purge-junk-publisher-news] deleted ${count} row(s).`);
}

main()
  .catch((err) => {
    console.error("[purge-junk-publisher-news] fatal:", err);
    process.exit(1);
  })
  .finally(() => {
    void prisma.$disconnect();
  });
