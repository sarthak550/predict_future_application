/**
 * Backfill probability history for Manifold-imported markets.
 *
 * For each Manifold market (prioritized by trader count):
 *   1. Fetch /v0/bets?contractId=X&limit=1000 from Manifold (latest 1000 bets)
 *   2. Sort ascending by createdTime, decimate to ~40 evenly-spaced points
 *   3. Insert as MarketProbabilitySnapshot rows so the existing ProbabilityChart renders them
 *
 * Usage:
 *   cd apps/api
 *   npx tsx --env-file=.env scripts/backfill-manifold-probability-history.ts [--limit=N] [--min-traders=N]
 *
 * Flags:
 *   --limit=N         Max markets to process (default: 100)
 *   --min-traders=N   Skip markets with fewer than N traders (default: 20)
 */

import { prisma } from "../lib/prisma";

const MANIFOLD_BASE = "https://api.manifold.markets/v0";
const REQUEST_DELAY_MS = 250;
const MAX_BETS_PER_FETCH = 1000;
const TARGET_SNAPSHOT_COUNT = 40;

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

function parseArgs() {
  const args = process.argv.slice(2);
  const limit = parseInt(
    args.find((a) => a.startsWith("--limit="))?.split("=")[1] ?? "100",
    10,
  );
  const minTraders = parseInt(
    args.find((a) => a.startsWith("--min-traders="))?.split("=")[1] ?? "20",
    10,
  );
  return {
    limit: Math.max(1, isNaN(limit) ? 100 : limit),
    minTraders: Math.max(0, isNaN(minTraders) ? 20 : minTraders),
  };
}

interface ManifoldBet {
  id: string;
  contractId: string;
  createdTime: number;
  probAfter: number;
  amount: number;
}

async function fetchBets(contractId: string): Promise<ManifoldBet[]> {
  const url = `${MANIFOLD_BASE}/bets?contractId=${contractId}&limit=${MAX_BETS_PER_FETCH}`;
  const resp = await fetch(url);
  if (!resp.ok) return [];
  return (await resp.json()) as ManifoldBet[];
}

/** Downsample sorted bets to ~targetCount points, always keeping first and last. */
function decimate(bets: ManifoldBet[], targetCount: number): ManifoldBet[] {
  if (bets.length <= targetCount) return bets;
  const stride = bets.length / targetCount;
  const picked: ManifoldBet[] = [];
  for (let i = 0; i < targetCount; i++) {
    picked.push(bets[Math.floor(i * stride)]);
  }
  // Always include the very last bet so the chart ends at the final probability
  if (picked[picked.length - 1].id !== bets[bets.length - 1].id) {
    picked.push(bets[bets.length - 1]);
  }
  return picked;
}

async function main() {
  const { limit, minTraders } = parseArgs();

  console.log("=== Manifold Probability History Backfill ===");
  console.log(`  limit:       ${limit} markets`);
  console.log(`  min-traders: ${minTraders}`);
  console.log("");

  // Get Manifold markets that don't yet have any probability snapshots,
  // ordered by trader count (most engaging first).
  const markets = await prisma.market.findMany({
    where: {
      originPlatform: "manifold",
      externalTraderCount: { gte: minTraders },
      probabilitySnapshots: { none: {} },
    },
    select: {
      id: true,
      externalId: true,
      externalTraderCount: true,
      title: true,
    },
    orderBy: { externalTraderCount: "desc" },
    take: limit,
  });

  console.log(`Found ${markets.length} markets needing backfill.\n`);

  let processed = 0;
  let snapshotsCreated = 0;
  let skippedNoBets = 0;
  let failed = 0;

  for (const m of markets) {
    const manifoldId = m.externalId?.replace(/^manifold:/, "");
    if (!manifoldId) {
      failed++;
      continue;
    }

    const bets = await fetchBets(manifoldId);
    if (bets.length === 0) {
      skippedNoBets++;
      await sleep(REQUEST_DELAY_MS);
      continue;
    }

    // Manifold returns descending; sort ascending for time-series
    const sorted = [...bets].sort((a, b) => a.createdTime - b.createdTime);
    const points = decimate(sorted, TARGET_SNAPSHOT_COUNT);

    await prisma.marketProbabilitySnapshot.createMany({
      data: points.map((b) => ({
        marketId: m.id,
        probability: b.probAfter,
        snapshotAt: new Date(b.createdTime),
      })),
      skipDuplicates: true,
    });

    snapshotsCreated += points.length;
    processed++;
    if (processed % 10 === 0) {
      console.log(`  ... ${processed}/${markets.length} processed`);
    }

    await sleep(REQUEST_DELAY_MS);
  }

  console.log("\nDone.");
  console.log(`  Processed:           ${processed} markets`);
  console.log(`  Snapshots created:   ${snapshotsCreated}`);
  console.log(`  Skipped (no bets):   ${skippedNoBets}`);
  console.log(`  Failed:              ${failed}`);

  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error("Fatal:", e);
  await prisma.$disconnect();
  process.exit(1);
});
