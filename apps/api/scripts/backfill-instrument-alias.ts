/**
 * Backfill InstrumentAlias for every distinct instrument identity already
 * referenced by ExpertOpinion rows (founder ask, 2026-08-09 — see
 * InstrumentAlias's schema doc comment and lib/finance/instrumentAlias.ts).
 *
 * DEFAULT IS DRY RUN (deliberately the OPPOSITE default of the sibling
 * backfill-expert-name-normalized.ts, whose default is LIVE) — pass --live
 * to actually write. This script is being authored before InstrumentAlias
 * has been pushed to any database (the founder runs `prisma db push`
 * themselves, same convention as every schema change here), so its dry-run
 * path is built to run WITHOUT the table existing at all: it calls
 * previewInstrumentResolution, which never reads or writes InstrumentAlias,
 * only the real authoritative sources (StockEodQuote, nse.ts's
 * fetchEquityNames) — so `--dry-run` output is genuine, live-data-backed
 * resolution, not a simulation. `--live` mode calls resolveInstrumentAlias
 * itself (lookup-first + write) and will fail loudly if the table hasn't
 * been pushed yet — that's intentional, not a bug to work around here.
 *
 * Idempotent in --live mode: resolveInstrumentAlias is itself lookup-first,
 * so re-running after a partial run only resolves rawNames not already in
 * the table.
 *
 * Usage (from apps/api):
 *   npx tsx scripts/backfill-instrument-alias.ts             # dry run (default), writes nothing
 *   npx tsx scripts/backfill-instrument-alias.ts --live       # resolve + persist
 */

import type { InstrumentResolutionSource } from "@prisma/client";

import { normalizeInstrumentRawName } from "@predict-future/business-rules/instruments/instrumentDedup";
import { previewInstrumentResolution, resolveInstrumentAlias } from "../lib/finance/instrumentAlias";
import { prisma } from "../lib/prisma";

const LIVE = process.argv.includes("--live");
const EXAMPLES_PER_BUCKET = 5;

async function main() {
  console.log(`[backfill-instrument-alias] Starting${LIVE ? " (LIVE — writing InstrumentAlias)" : " (DRY RUN — no writes)"}...`);

  // Distinct (instrument, instrumentTicker) pairs actually referenced by
  // public opinions — the same universe opinionsQuery.ts's dropdown/cascade
  // logic will read InstrumentAlias against.
  const rows = await prisma.expertOpinion.findMany({
    where: { suppressedAt: null, OR: [{ instrument: { not: null } }, { instrumentTicker: { not: null } }] },
    distinct: ["instrument", "instrumentTicker"],
    select: { instrument: true, instrumentTicker: true },
    orderBy: { instrument: "asc" },
  });

  console.log(`[backfill-instrument-alias] Found ${rows.length} distinct (instrument, instrumentTicker) pair(s).`);

  // Dedupe by rawName — several raw label variants can already share one
  // ticker (extraction already collapses "SBI"/"State Bank of India" to the
  // same ticker), so this is smaller than `rows.length`.
  const seen = new Set<string>();
  const bySource = new Map<InstrumentResolutionSource | "UNRESOLVED", { count: number; examples: string[] }>();
  const bump = (key: InstrumentResolutionSource | "UNRESOLVED", example: string) => {
    const entry = bySource.get(key) ?? { count: 0, examples: [] };
    entry.count += 1;
    if (entry.examples.length < EXAMPLES_PER_BUCKET) entry.examples.push(example);
    bySource.set(key, entry);
  };

  let processed = 0;
  let skippedNoKey = 0;

  for (const row of rows) {
    const rawName = normalizeInstrumentRawName(row.instrumentTicker, row.instrument);
    if (!rawName || seen.has(rawName)) {
      if (!rawName) skippedNoKey++;
      continue;
    }
    seen.add(rawName);
    processed++;

    if (LIVE) {
      const result = await resolveInstrumentAlias(prisma, row.instrument, row.instrumentTicker);
      const label = `${rawName}  (from instrument="${row.instrument ?? ""}", ticker="${row.instrumentTicker ?? ""}")`;
      if (result?.resolved) {
        bump(result.resolutionSource ?? "UNRESOLVED", `${label}  ->  "${result.canonicalName}" [${result.symbol}]`);
      } else {
        bump("UNRESOLVED", label);
      }
    } else {
      const { resolution } = await previewInstrumentResolution(prisma, row.instrument, row.instrumentTicker);
      const label = `${rawName}  (from instrument="${row.instrument ?? ""}", ticker="${row.instrumentTicker ?? ""}")`;
      if (resolution) {
        bump(resolution.resolutionSource, `${label}  ->  "${resolution.canonicalName}" [${resolution.symbol}]`);
      } else {
        bump("UNRESOLVED", label);
      }
    }
  }

  console.log(`\n[backfill-instrument-alias] Processed ${processed} distinct raw name(s) (skipped ${skippedNoKey} with no key — neither ticker nor label).\n`);

  let resolvedTotal = 0;
  for (const [source, { count, examples }] of bySource) {
    if (source !== "UNRESOLVED") resolvedTotal += count;
    console.log(`[backfill-instrument-alias] ${source}: ${count}`);
    for (const ex of examples) console.log(`    ${ex}`);
  }
  const unresolvedCount = bySource.get("UNRESOLVED")?.count ?? 0;
  console.log(
    `\n[backfill-instrument-alias] Summary: ${resolvedTotal} resolved / ${unresolvedCount} unresolved / ${processed} total ` +
      `(${processed > 0 ? ((resolvedTotal / processed) * 100).toFixed(1) : "0.0"}% resolution rate).`
  );
  if (!LIVE) {
    console.log(`[backfill-instrument-alias] Dry run only — no InstrumentAlias rows written. Re-run with --live to persist.`);
  }

  await prisma.$disconnect();
}

main().catch((err) => {
  console.error("Fatal error:", err instanceof Error ? err.message : err);
  process.exit(1);
});
