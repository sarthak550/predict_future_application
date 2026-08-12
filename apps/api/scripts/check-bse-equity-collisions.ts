/**
 * BSE Expansion Phase 3A (2026-08-12) — acceptance-blocking collision check
 * for the `.BO`-suffixed BSE-only-equity `/instruments/[symbol]` namespace,
 * mirroring `check-bse-collisions.ts`'s own precedent (BSE index symbols vs.
 * every existing universe) for the equity side.
 *
 * The `.BO` namespace is collision-free BY CONSTRUCTION — no existing NSE
 * symbol, bond symbol, or index name (NSE or BSE) ever contains a literal
 * "." (verified structurally here, not just spot-checked). This script
 * exists to make that guarantee auditable/reproducible on demand, same as
 * INDEX_UNIVERSE's own collision-check discipline, and MUST be re-run
 * against prod immediately before deploy (drift risk: a new listing between
 * this dev check and deploy), same law as every other collision check in
 * this codebase.
 *
 * Usage: npx tsx scripts/check-bse-equity-collisions.ts
 */

import { prisma } from "../lib/prisma";

async function main() {
  const bseRows = await prisma.bseEodQuote.findMany({ distinct: ["tickerSymbol"], select: { tickerSymbol: true } });
  const bseEquitySymbols = new Set(bseRows.map((r) => `${r.tickerSymbol.toUpperCase()}.BO`));

  const [nseRows, bondRows, bseIndexRows, indexRows] = await Promise.all([
    prisma.stockEodQuote.findMany({ distinct: ["symbol"], select: { symbol: true } }),
    prisma.bondEodQuote.findMany({ distinct: ["symbol"], select: { symbol: true } }),
    prisma.bseIndexEodQuote.findMany({ distinct: ["indexName"], select: { indexName: true } }),
    prisma.indexEodQuote.findMany({ distinct: ["indexName"], select: { indexName: true } }),
  ]);

  const otherUniverses = [
    ...nseRows.map((r) => r.symbol.toUpperCase()),
    ...bondRows.map((r) => r.symbol.toUpperCase()),
    ...bseIndexRows.map((r) => r.indexName.toUpperCase()),
    ...indexRows.map((r) => r.indexName.toUpperCase()),
  ];
  const otherSet = new Set(otherUniverses);

  console.log(`[check-bse-equity-collisions] ${bseEquitySymbols.size} BSE-only-equity .BO symbols vs. ${otherSet.size} other universe entries (NSE equities + bonds + NSE index names + BSE index names)`);

  let collisions = 0;
  for (const symbol of bseEquitySymbols) {
    if (otherSet.has(symbol)) {
      collisions++;
      console.error(`[check-bse-equity-collisions] COLLISION: ${symbol}`);
    }
  }

  const dotBearingOtherEntries = otherUniverses.filter((s) => s.includes("."));
  if (dotBearingOtherEntries.length > 0) {
    console.warn(
      `[check-bse-equity-collisions] WARNING: found ${dotBearingOtherEntries.length} non-BSE-equity entries containing a literal "." — the ".BO" namespace's collision-free-by-construction assumption may no longer hold: ${dotBearingOtherEntries.slice(0, 10).join(", ")}`
    );
  }

  if (collisions === 0) {
    console.log("[check-bse-equity-collisions] PASS — zero collisions.");
  } else {
    console.error(`[check-bse-equity-collisions] FAIL — ${collisions} collision(s) found. Do not deploy until resolved.`);
    process.exitCode = 1;
  }
}

main()
  .catch((err) => {
    console.error("[check-bse-equity-collisions] fatal error:", err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
