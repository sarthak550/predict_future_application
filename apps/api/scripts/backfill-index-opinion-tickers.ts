/**
 * Index Universe Expansion (Sprint A, A4) — bounded backfill for existing
 * ExpertOpinion rows whose `instrument` text names a now-qualifying
 * INDEX_UNIVERSE index (business-rules) but whose `instrumentTicker` is
 * null, because the extraction-time keyword map didn't resolve a ticker for
 * that index until this ticket added one (see extractInstrument.ts's
 * 2026-08-09 additions). Confirmed live in prod/dev: opinions exist with
 * instrument="Nifty IT", instrumentTicker=null — text capture already
 * worked, nothing ever assigned it a canonical ticker.
 *
 * Match rule — EXACT, NEVER FUZZY (the brief's own hard requirement): a
 * row's normalized `instrument` text must equal either an INDEX_UNIVERSE
 * entry's normalized `name`, or one of the small, hand-verified
 * INDEX_NAME_ALIASES (e.g. "Nifty Infra" -> "NIFTY INFRASTRUCTURE" — the
 * extraction-time shorthand that predates this registry). No substring
 * matching, no Levenshtein, no AI re-classification.
 *
 * DEFAULT IS DRY RUN (same convention as scripts/backfill-instrument-alias.ts)
 * — pass --live to actually write. Reports a per-index count so a human can
 * review before any write; a before/after opinion count on the Nifty IT and
 * Nifty Infrastructure pages is the acceptance check called out in the
 * brief.
 *
 * NOT run against prod by this ticket — dry-run AND --live were both only
 * exercised against the local dev database. The exact command for the
 * coordinator to run against prod is in this ticket's report.
 *
 * Usage (from apps/api):
 *   npx tsx scripts/backfill-index-opinion-tickers.ts            # dry run (default), writes nothing
 *   npx tsx scripts/backfill-index-opinion-tickers.ts --live      # backfill instrumentTicker for real
 */

import { resolveIndexUniverseEntryByRawName } from "@predict-future/business-rules/finance/indexUniverse";
import { prisma } from "../lib/prisma";

const LIVE = process.argv.includes("--live");

async function main() {
  console.log(`[backfill-index-opinion-tickers] Starting${LIVE ? " (LIVE — writing ExpertOpinion.instrumentTicker)" : " (DRY RUN — no writes)"}...`);

  // Every null-ticker opinion with SOME instrument text — the candidate
  // pool this script narrows down via exact-match only. Not filtered on
  // suppressedAt: a suppressed opinion's ticker is still worth correcting
  // (suppression and instrument identity are orthogonal), and re-surfacing
  // is a separate, human-reviewed decision this script doesn't make.
  const rows = await prisma.expertOpinion.findMany({
    where: { instrumentTicker: null, instrument: { not: null } },
    select: { id: true, instrument: true },
  });

  console.log(`[backfill-index-opinion-tickers] Found ${rows.length} null-ticker opinion(s) with instrument text.`);

  const matchesByIndexSymbol = new Map<string, { name: string; ticker: string; ids: string[] }>();
  let unmatched = 0;

  for (const row of rows) {
    if (!row.instrument) continue;
    const entry = resolveIndexUniverseEntryByRawName(row.instrument);
    if (!entry) {
      unmatched++;
      continue;
    }
    const bucket = matchesByIndexSymbol.get(entry.symbol) ?? { name: entry.name, ticker: entry.yahooTicker, ids: [] };
    bucket.ids.push(row.id);
    matchesByIndexSymbol.set(entry.symbol, bucket);
  }

  const matchedTotal = [...matchesByIndexSymbol.values()].reduce((sum, b) => sum + b.ids.length, 0);
  console.log(
    `\n[backfill-index-opinion-tickers] ${matchedTotal} opinion(s) match an INDEX_UNIVERSE index by exact normalized text ` +
      `(${unmatched} instrument text(s) matched none — left untouched, no fuzzy fallback).\n`,
  );

  const sortedBuckets = [...matchesByIndexSymbol.entries()].sort((a, b) => b[1].ids.length - a[1].ids.length);
  for (const [symbol, bucket] of sortedBuckets) {
    console.log(`  ${bucket.name} [${symbol} -> ${bucket.ticker}]: ${bucket.ids.length} opinion(s)`);
  }

  if (!LIVE) {
    console.log(`\n[backfill-index-opinion-tickers] Dry run only — no ExpertOpinion rows written. Re-run with --live to persist.`);
    await prisma.$disconnect();
    return;
  }

  let written = 0;
  for (const [, bucket] of sortedBuckets) {
    const result = await prisma.expertOpinion.updateMany({
      where: { id: { in: bucket.ids }, instrumentTicker: null }, // re-check instrumentTicker: null — never clobber a value set by a concurrent process since this script started
      data: { instrumentTicker: bucket.ticker },
    });
    written += result.count;
  }
  console.log(`\n[backfill-index-opinion-tickers] Wrote instrumentTicker on ${written} opinion(s).`);

  await prisma.$disconnect();
}

main().catch((err) => {
  console.error("Fatal error:", err instanceof Error ? err.message : err);
  process.exit(1);
});
