/**
 * One-off timing script for lib/finance/indexMembership.ts's cold sweep —
 * measures real wall-clock cost of buildIndexMembershipMap() in a fresh
 * process (so the per-index indexConstituents.ts/indexLiveWatch.ts caches
 * start genuinely empty, same as a fresh deploy) and reports coverage for a
 * few sample stocks. Not part of any CI/build step — run manually:
 *
 *   npx tsx scripts/measure-index-membership-build.ts   (from apps/web)
 */

import { buildIndexMembershipMap } from "@/lib/finance/indexMembership";
import { ALL_INDEX_SYMBOLS_WITH_CONSTITUENTS } from "@/lib/finance/indexConstituents";

async function main() {
  console.log(`Sweeping ${ALL_INDEX_SYMBOLS_WITH_CONSTITUENTS.length} covered indices (cold — no warm per-index cache)...`);
  const start = Date.now();
  const map = await buildIndexMembershipMap();
  const elapsedMs = Date.now() - start;

  console.log(`\nCold build wall time: ${elapsedMs}ms (${(elapsedMs / 1000).toFixed(1)}s)`);
  console.log(`Reverse map size: ${map.size} distinct stock symbols with at least one index membership`);

  const samples = process.argv.slice(2).length > 0 ? process.argv.slice(2) : ["RELIANCE", "TCS", "IRCTC", "SUZLON"];
  for (const symbol of samples) {
    const entries = map.get(symbol) ?? [];
    console.log(`\n${symbol}: ${entries.length} indices`);
    for (const e of entries.slice(0, 8)) {
      console.log(`  - ${e.indexName} (${e.indexSymbol})${e.weightPct != null ? ` — ${e.weightPct.toFixed(1)}%` : ""}`);
    }
    if (entries.length > 8) console.log(`  ... and ${entries.length - 8} more`);
  }

  process.exit(0);
}

main().catch((err) => {
  console.error("measure-index-membership-build failed:", err);
  process.exit(1);
});
