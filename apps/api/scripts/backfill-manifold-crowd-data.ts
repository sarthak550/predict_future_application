/**
 * Backfill Manifold crowd data (probability, volume, traders) for already-imported markets.
 *
 * Usage:
 *   cd apps/api
 *   npx tsx --env-file=.env scripts/backfill-manifold-crowd-data.ts
 */

import { prisma } from "../lib/prisma";

const MANIFOLD_BASE = "https://api.manifold.markets/v0";
const REQUEST_DELAY_MS = 200;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

interface ManifoldMarketDetail {
  id: string;
  probability?: number;
  resolutionProbability?: number;
  volume?: number;
  uniqueBettorCount?: number;
}

async function fetchManifoldMarket(id: string): Promise<ManifoldMarketDetail | null> {
  const resp = await fetch(`${MANIFOLD_BASE}/market/${id}`);
  if (!resp.ok) {
    console.warn(`  ✗ Manifold API ${resp.status} for ${id}`);
    return null;
  }
  return (await resp.json()) as ManifoldMarketDetail;
}

async function main() {
  console.log("=== Manifold Crowd Data Backfill ===");

  const markets = await prisma.market.findMany({
    where: {
      originPlatform: "manifold",
      externalProbability: null,
    },
    select: { id: true, externalId: true, title: true },
  });

  console.log(`Found ${markets.length} markets needing backfill.\n`);

  let updated = 0;
  let failed = 0;

  for (let i = 0; i < markets.length; i++) {
    const m = markets[i];
    const manifoldId = m.externalId?.replace(/^manifold:/, "");
    if (!manifoldId) {
      failed++;
      continue;
    }

    const detail = await fetchManifoldMarket(manifoldId);
    if (!detail) {
      failed++;
      await sleep(REQUEST_DELAY_MS);
      continue;
    }

    await prisma.market.update({
      where: { id: m.id },
      data: {
        externalProbability: detail.resolutionProbability ?? detail.probability ?? null,
        externalVolume: detail.volume ?? null,
        externalTraderCount: detail.uniqueBettorCount ?? null,
      },
    });

    updated++;
    if (updated % 25 === 0) {
      console.log(`  ... ${updated}/${markets.length} backfilled`);
    }
    await sleep(REQUEST_DELAY_MS);
  }

  console.log(`\nDone. Updated: ${updated}, Failed: ${failed}`);
  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error("Fatal:", e);
  await prisma.$disconnect();
  process.exit(1);
});
