/**
 * Cleans up opinions that have an instrumentTicker Yahoo Finance can't fetch.
 *
 * Strategy:
 *   1. Pull all distinct instrumentTickers from non-suppressed opinions
 *   2. Probe each ticker once via Yahoo (cheap — one HEAD-ish call per ticker)
 *   3. For tickers that 404, null out instrumentTicker on every opinion using
 *      them so the auto-resolve grader doesn't silently NOT_GRADED them
 *   4. Print the bad list so the extractor mapping can be updated
 *
 * Usage:
 *   npx tsx scripts/cleanup-invalid-tickers.ts            # apply changes
 *   DRY_RUN=1 npx tsx scripts/cleanup-invalid-tickers.ts  # log only
 */

import { prisma } from "../lib/prisma";
import { getPriceOnDate } from "../lib/finance/priceHistory";

// normalizeYahooTicker was removed from lib/ai/extractInstrument during S42-T4
// refactor. This script keeps a local identity normalizer so the cleanup pass
// still works — it now only nulls out 404 tickers, no static remapping.
function normalizeYahooTicker(ticker: string): string {
  return ticker;
}

const DRY_RUN = process.env.DRY_RUN === "1";
const PROBE_DATE = new Date(Date.now() - 7 * 86_400_000);

async function main() {
  const rows = await prisma.expertOpinion.groupBy({
    by: ["instrumentTicker"],
    where: {
      instrumentTicker: { not: null },
      suppressedAt: null,
    },
    _count: { _all: true },
  });

  const tickers = rows
    .filter((r) => r.instrumentTicker !== null)
    .map((r) => ({ ticker: r.instrumentTicker as string, count: r._count._all }));

  console.log(`Probing ${tickers.length} distinct tickers...\n`);

  // 1) Apply the static remap layer first — anything that maps to something
  //    different gets the DB row updated. Then we probe the *normalized* tickers.
  const remaps: Array<{ from: string; to: string; count: number }> = [];
  for (const { ticker, count } of tickers) {
    const normalized = normalizeYahooTicker(ticker);
    if (normalized !== ticker) {
      remaps.push({ from: ticker, to: normalized, count });
      console.log(`  🔁 ${ticker.padEnd(22)} → ${normalized.padEnd(22)} (${count})`);
    }
  }

  if (!DRY_RUN && remaps.length > 0) {
    for (const r of remaps) {
      await prisma.expertOpinion.updateMany({
        where: { instrumentTicker: r.from },
        data: { instrumentTicker: r.to },
      });
    }
    console.log(`\n✅ Remapped ${remaps.length} ticker(s) covering ${remaps.reduce((s, r) => s + r.count, 0)} opinion(s).\n`);
  } else if (remaps.length > 0) {
    console.log(`\n  (DRY_RUN — would remap ${remaps.length} ticker(s).)\n`);
  }

  // 2) Probe everything (post-remap) and null anything Yahoo still doesn't serve.
  const probedSet = new Set<string>();
  const bad: Array<{ ticker: string; count: number }> = [];
  const allCounts = new Map<string, number>();
  for (const { ticker, count } of tickers) {
    const normalized = normalizeYahooTicker(ticker);
    allCounts.set(normalized, (allCounts.get(normalized) ?? 0) + count);
  }
  for (const [ticker, count] of allCounts) {
    if (probedSet.has(ticker)) continue;
    probedSet.add(ticker);
    const price = await getPriceOnDate(ticker, PROBE_DATE);
    if (price === null) {
      bad.push({ ticker, count });
      console.log(`  🚨 ${ticker.padEnd(22)} — used by ${count} opinion${count === 1 ? "" : "s"}`);
    }
  }

  if (bad.length === 0) {
    console.log("\n✨ All remaining tickers resolve. Nothing more to clean.");
    await prisma.$disconnect();
    return;
  }

  const affected = bad.reduce((sum, b) => sum + b.count, 0);
  console.log(`\n${bad.length} unfixable ticker(s) cover ${affected} opinion(s) — nulling.`);

  if (DRY_RUN) {
    console.log("DRY_RUN=1 — no changes made.");
    await prisma.$disconnect();
    return;
  }

  const result = await prisma.expertOpinion.updateMany({
    where: { instrumentTicker: { in: bad.map((b) => b.ticker) } },
    data: { instrumentTicker: null },
  });

  console.log(`\n✅ Nulled instrumentTicker on ${result.count} opinion(s).`);
  console.log("\nTickers nulled (consider adding to TICKER_REMAP if you find a working alias):");
  for (const b of bad) console.log(`  - ${b.ticker}`);

  await prisma.$disconnect();
}

void main();
