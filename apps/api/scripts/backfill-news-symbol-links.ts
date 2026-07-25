/**
 * One-off backfill: resolve dead "BSE:<code>" tickers to NSE symbols by exact
 * normalized company-name match (see lib/marketMoves/nseSymbolResolver.ts) on
 * BOTH MarketMoveNews (1,157 unlinked of 3,353 at time of writing) and
 * MarketMoveEvent, so historical articles/filings link to their instrument
 * pages like new ingests now do.
 *
 * Idempotent: only touches rows still carrying a BSE: prefix; a resolved row
 * never matches the filter again. Unresolvable (BSE-only / name-mismatch)
 * rows are left as-is and counted.
 *
 * Run: DATABASE_URL=... npx tsx scripts/backfill-news-symbol-links.ts
 */

import { prisma } from "../lib/prisma";
import { resolveNseSymbolByCompanyName } from "../lib/marketMoves/nseSymbolResolver";

async function backfillTable(table: "marketMoveNews" | "marketMoveEvent"): Promise<void> {
  const rows: { id: string; companyName: string; tickerSymbol: string }[] =
    table === "marketMoveNews"
      ? await prisma.marketMoveNews.findMany({
          where: { tickerSymbol: { startsWith: "BSE:" } },
          select: { id: true, companyName: true, tickerSymbol: true },
        })
      : await prisma.marketMoveEvent.findMany({
          where: { tickerSymbol: { startsWith: "BSE:" } },
          select: { id: true, companyName: true, tickerSymbol: true },
        });

  // Batch by DISTINCT company name: resolve once per name, then one
  // updateMany per resolved name — a few hundred round trips instead of one
  // per row (row-by-row over a Singapore DB link timed out at 10 min).
  let resolved = 0;
  let unresolved = 0;
  const unresolvedSamples = new Map<string, number>();

  const rowsByName = new Map<string, number>();
  for (const row of rows) rowsByName.set(row.companyName, (rowsByName.get(row.companyName) ?? 0) + 1);

  for (const [companyName, count] of rowsByName) {
    const symbol = await resolveNseSymbolByCompanyName(companyName);
    if (!symbol) {
      unresolved += count;
      unresolvedSamples.set(companyName, count);
      continue;
    }
    if (table === "marketMoveNews") {
      await prisma.marketMoveNews.updateMany({
        where: { companyName, tickerSymbol: { startsWith: "BSE:" } },
        data: { tickerSymbol: symbol },
      });
    } else {
      await prisma.marketMoveEvent.updateMany({
        where: { companyName, tickerSymbol: { startsWith: "BSE:" } },
        data: { tickerSymbol: symbol },
      });
    }
    resolved += count;
  }

  console.log(`\n[${table}] BSE-coded rows: ${rows.length} → resolved to NSE: ${resolved}, left unresolved: ${unresolved}`);
  const topUnresolved = [...unresolvedSamples.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8);
  if (topUnresolved.length > 0) {
    console.log(`  top unresolved names (likely BSE-only listings):`);
    for (const [name, count] of topUnresolved) console.log(`   - ${name} (${count})`);
  }
}

async function main() {
  await backfillTable("marketMoveNews");
  await backfillTable("marketMoveEvent");
  await prisma.$disconnect();
}

main();
