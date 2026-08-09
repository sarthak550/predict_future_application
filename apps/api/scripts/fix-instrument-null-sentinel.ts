/**
 * One-off prod data repair (founder-reported bug, 2026-08-09).
 *
 * Two independent repairs, both scoped to real, authoritatively-verified
 * company identities — NEVER string-similarity guessing (house law: instrument
 * identity is verified against StockEodQuote / the NSE equity master, always):
 *
 *   PART 1 — literal-string-"null" instrument/instrumentTicker opinions.
 *     Root cause: lib/ai/extractInstrument.ts's callGroqForInstrument used to
 *     let the AI's junk sentinel string "null" through uncaught in one code
 *     path (fixed 2026-08-09 — see sanitizeExtractedValue.ts's doc comment).
 *     Prod has exactly one such row: the "International Gemmological
 *     Institute" (IGI) opinion. This part finds any opinion whose instrument
 *     OR instrumentTicker is a literal junk-sentinel string, and — ONLY for
 *     rows whose quote demonstrably names IGI — resets instrument/
 *     instrumentTicker to the verified IGIL identity. Any other junk-sentinel
 *     row (there should be none beyond IGI, but this does not assume that) is
 *     logged and left untouched rather than guessed at.
 *     Also cleans up the junk rawName="NULL" InstrumentAlias row this bug
 *     produced, and ensures a proper resolved alias row exists for IGI so
 *     future IGI opinions resolve automatically (apps/web reads
 *     InstrumentAlias for its instrument links/dropdown/cascade).
 *
 *   PART 2 — legitimately-listed companies stuck with a null instrumentTicker.
 *     Of the 21 non-suppressed null-ticker prod opinions, most are genuinely
 *     unmappable sector/macro calls (left alone). Three are real listed
 *     companies whose name simply never resolved to a ticker at extraction
 *     time: Sagility (NSE: SAGILITY), Swiggy (NSE: SWIGGY), PG Electroplast
 *     (NSE: PGEL). Each is verified against StockEodQuote before its
 *     instrumentTicker is set — any that fail to verify are logged and
 *     skipped, never guessed.
 *
 * Usage (from apps/api):
 *   npx tsx scripts/fix-instrument-null-sentinel.ts             # DRY RUN (default) — reports only, writes nothing
 *   DRY_RUN=true npx tsx scripts/fix-instrument-null-sentinel.ts  # explicit dry run (same as above)
 *   DRY_RUN=false npx tsx scripts/fix-instrument-null-sentinel.ts # LIVE — applies changes
 *
 * DRY RUN is the default (bare invocation) to match this repo's higher-risk
 * one-off-script convention (see cleanup-invalid-tickers.ts, backfill-
 * instrument-alias.ts) — must pass DRY_RUN=false explicitly to write.
 * Idempotent: re-running after a live run finds 0 remaining candidates in
 * Part 1 (already-fixed rows no longer match the junk-sentinel filter) and 0
 * remaining candidates in Part 2 (already-fixed rows no longer have a null
 * instrumentTicker).
 */

import { previewInstrumentResolution, resolveInstrumentAlias } from "../lib/finance/instrumentAlias";
import { prisma } from "../lib/prisma";

const DRY_RUN = process.env.DRY_RUN !== "false";

/** Literal AI junk-sentinel strings — mirrors sanitizeExtractedValue.ts's set, case variants included for the raw DB filter. */
const JUNK_SENTINEL_VALUES = ["null", "NULL", "Null", "nUlL", "none", "None", "NONE", "N/A", "n/a", "undefined", "UNDEFINED"];

/** Quote substrings (case-insensitive) that identify the IGI opinion regardless of which spelling the source article used. */
const IGI_QUOTE_MARKERS = ["gemological institute", "gemmological institute"];
const IGI_SYMBOL = "IGIL";
const IGI_TICKER = "IGIL.NS";

/** Part 2 targets: real listed companies among the null-ticker opinions. Symbol is verified below — never assumed. */
const NULL_TICKER_TARGETS: Array<{ label: string; symbol: string }> = [
  { label: "Sagility", symbol: "SAGILITY" },
  { label: "Swiggy", symbol: "SWIGGY" },
  { label: "PG Electroplast", symbol: "PGEL" },
];

async function verifySymbol(symbol: string): Promise<{ symbol: string; companyName: string } | null> {
  const row = await prisma.stockEodQuote.findFirst({
    where: { symbol },
    orderBy: { sessionDate: "desc" },
    select: { companyName: true },
  });
  if (!row?.companyName) return null;
  return { symbol, companyName: row.companyName };
}

async function main() {
  console.log(`[fix-instrument-null-sentinel] mode = ${DRY_RUN ? "DRY RUN (no writes)" : "LIVE (writing)"}`);

  // ═══════════════════════════════════════════════════════════════════════
  // PART 1 — literal-string-"null" instrument/instrumentTicker opinions
  // ═══════════════════════════════════════════════════════════════════════
  console.log("\n=== Part 1: literal junk-sentinel instrument/instrumentTicker opinions ===");

  const junkCandidates = await prisma.expertOpinion.findMany({
    where: {
      OR: [
        { instrument: { in: JUNK_SENTINEL_VALUES } },
        { instrumentTicker: { in: JUNK_SENTINEL_VALUES } },
      ],
    },
    select: { id: true, instrument: true, instrumentTicker: true, quote: true },
  });
  console.log(`Found ${junkCandidates.length} opinion(s) with a literal junk-sentinel instrument/ticker value.`);

  const igiVerified = await verifySymbol(IGI_SYMBOL);
  if (!igiVerified) {
    console.error(
      `[fix-instrument-null-sentinel] ${IGI_SYMBOL} not found in StockEodQuote on this database — refusing to fix any IGI opinion here (authoritative-source guard). Part 1 will only report, not fix.`
    );
  } else {
    console.log(`Verified ${IGI_SYMBOL} against StockEodQuote: companyName="${igiVerified.companyName}"`);
  }

  let igiFixed = 0;
  let junkSkipped = 0;
  for (const row of junkCandidates) {
    const quoteLower = row.quote.toLowerCase();
    const isIgi = IGI_QUOTE_MARKERS.some((m) => quoteLower.includes(m));

    if (isIgi && igiVerified) {
      console.log(
        `[fix] id=${row.id} was instrument="${row.instrument}" ticker="${row.instrumentTicker}" -> instrument="${igiVerified.companyName}" ticker="${IGI_TICKER}"`
      );
      if (!DRY_RUN) {
        await prisma.expertOpinion.update({
          where: { id: row.id },
          data: { instrument: igiVerified.companyName, instrumentTicker: IGI_TICKER },
        });
      }
      igiFixed++;
    } else {
      console.log(
        `[skip] id=${row.id} instrument="${row.instrument}" ticker="${row.instrumentTicker}" — junk sentinel but not a recognized/verifiable company; leaving untouched (quote: "${row.quote.slice(0, 100)}...")`
      );
      junkSkipped++;
    }
  }

  // Ensure a resolved InstrumentAlias row exists for IGI going forward.
  if (igiVerified) {
    if (DRY_RUN) {
      const { rawName, resolution } = await previewInstrumentResolution(prisma, igiVerified.companyName, IGI_TICKER);
      console.log(
        `[alias preview] rawName="${rawName}" -> ${resolution ? `resolved "${resolution.canonicalName}" [${resolution.symbol}] via ${resolution.resolutionSource}` : "UNRESOLVED"}`
      );
    } else {
      const result = await resolveInstrumentAlias(prisma, igiVerified.companyName, IGI_TICKER);
      console.log(
        `[alias] IGI alias row ensured: resolved=${result?.resolved} symbol=${result?.symbol} canonicalName="${result?.canonicalName}"`
      );
    }
  }

  // Clean up the junk rawName="NULL" InstrumentAlias row this bug produced.
  // It should never survive as a lookup key — the extraction guard now makes
  // it unreachable going forward, and a stale unresolved row here would just
  // keep resolveInstrumentAlias's lookup-first cache pinned to "unresolvable".
  const junkAliasRows = await prisma.instrumentAlias.findMany({
    where: { rawName: { in: JUNK_SENTINEL_VALUES.map((v) => v.toUpperCase()) } },
  });
  console.log(`\nFound ${junkAliasRows.length} junk InstrumentAlias row(s) with a junk-sentinel rawName.`);
  for (const row of junkAliasRows) {
    console.log(`[alias-delete] id=${row.id} rawName="${row.rawName}" resolved=${row.resolved}`);
    if (!DRY_RUN) {
      await prisma.instrumentAlias.delete({ where: { id: row.id } });
    }
  }

  // ═══════════════════════════════════════════════════════════════════════
  // PART 2 — legitimately-listed companies stuck with a null instrumentTicker
  // ═══════════════════════════════════════════════════════════════════════
  console.log("\n=== Part 2: null-ticker opinions for verified listed companies ===");

  let part2Fixed = 0;
  let part2Skipped = 0;
  for (const target of NULL_TICKER_TARGETS) {
    const verified = await verifySymbol(target.symbol);
    if (!verified) {
      console.log(`[skip] "${target.label}" (${target.symbol}) — NOT found in StockEodQuote on this database; not touching any opinion for it.`);
      part2Skipped++;
      continue;
    }
    console.log(`Verified ${target.symbol} against StockEodQuote: companyName="${verified.companyName}"`);

    const rows = await prisma.expertOpinion.findMany({
      where: {
        suppressedAt: null,
        instrumentTicker: null,
        instrument: { equals: target.label, mode: "insensitive" },
      },
      select: { id: true, instrument: true },
    });

    if (rows.length === 0) {
      console.log(`  no null-ticker opinion(s) found with instrument="${target.label}" on this database.`);
      continue;
    }

    const ticker = `${verified.symbol}.NS`;
    for (const row of rows) {
      console.log(`[fix] id=${row.id} instrument="${row.instrument}" -> instrumentTicker="${ticker}"`);
      if (!DRY_RUN) {
        await prisma.expertOpinion.update({
          where: { id: row.id },
          data: { instrumentTicker: ticker },
        });
      }
      part2Fixed++;
    }

    // Ensure an alias row exists for this identity too, same as Part 1.
    if (DRY_RUN) {
      const { rawName, resolution } = await previewInstrumentResolution(prisma, verified.companyName, ticker);
      console.log(`  [alias preview] rawName="${rawName}" -> ${resolution ? `resolved [${resolution.symbol}]` : "UNRESOLVED"}`);
    } else if (rows.length > 0) {
      const result = await resolveInstrumentAlias(prisma, verified.companyName, ticker);
      console.log(`  [alias] ensured: resolved=${result?.resolved} symbol=${result?.symbol}`);
    }
  }

  // ═══════════════════════════════════════════════════════════════════════
  console.log("\n=== Summary ===");
  console.log(`Part 1: ${igiFixed} IGI opinion(s) ${DRY_RUN ? "would be" : ""} fixed, ${junkSkipped} unrecognized junk-sentinel row(s) left untouched, ${junkAliasRows.length} junk alias row(s) ${DRY_RUN ? "would be" : ""} deleted.`);
  console.log(`Part 2: ${part2Fixed} opinion(s) ${DRY_RUN ? "would be" : ""} fixed across ${NULL_TICKER_TARGETS.length - part2Skipped}/${NULL_TICKER_TARGETS.length} verified target(s) (${part2Skipped} target(s) failed StockEodQuote verification).`);

  if (DRY_RUN) {
    console.log("\nDRY RUN — no rows were modified. Re-run with DRY_RUN=false to apply.");
  } else {
    console.log("\nDone — changes applied.");
  }

  await prisma.$disconnect();
}

main().catch((err) => {
  console.error("[fix-instrument-null-sentinel] fatal:", err);
  process.exit(1);
});
