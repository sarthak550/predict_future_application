/**
 * S43-T3 backfill — correct ExpertOpinion rows where instrument was contaminated
 * by the article headline (e.g., tagged "Sensex" because the headline contained
 * "10 Sensex stocks…" while the quote clearly named TCS or HDFC Bank).
 *
 * What it does:
 *   1. SELECT rows WHERE instrument IN ('Nifty 50', 'Sensex', 'Bank Nifty') AND
 *      quote (lowercased) contains at least one key from STOCK_MAP.
 *   2. For each candidate: call checkTickerMap(quote, headline).
 *      - If pass 1 (STOCK_MAP) returns a stock → overwrite instrument + instrumentTicker.
 *      - If pass 1 returns null → leave the row unchanged (don't substitute speculatively).
 *   3. Emit per-row log: [backfill] id=<uuid> was="Sensex" now="TCS"
 *   4. Print summary: scanned, corrected, skipped.
 *
 * IMPORTANT — no AI calls.
 * checkTickerMap is deterministic (keyword map only). GROQ_API_KEY is not needed.
 * Set GROQ_API_KEY="" if you want to be explicit, but the script never calls Groq.
 *
 * Usage (dry run — recommended first):
 *   GROQ_API_KEY="" npx tsx scripts/backfill-instrument-mistag.ts --dry-run
 *
 * Usage (apply changes — run only after QA approval):
 *   GROQ_API_KEY="" npx tsx scripts/backfill-instrument-mistag.ts
 *
 * Risk: near-zero. No schema changes. Only updates instrument + instrumentTicker on rows
 * that the two-pass resolver now confidently reclassifies as a specific stock.
 * Rows where pass 1 misses are left untouched — no speculative substitution.
 */

import { checkTickerMap, normalizeYahooTicker } from "../lib/ai/extractInstrument";
import { prisma } from "../lib/prisma";

const DRY_RUN = process.argv.includes("--dry-run");

/**
 * Instruments that the old single-pass resolver mis-tagged due to headline contamination.
 * These are the three broad indices that appear most often in ETMarkets article headlines.
 */
const CONTAMINATED_INSTRUMENTS = ["Nifty 50", "Sensex", "Bank Nifty"] as const;

/**
 * STOCK_MAP keys extracted for the candidate filter.
 * We import checkTickerMap but we need the raw keys to build a fast pre-filter SQL-side.
 * Since we can't import STOCK_MAP directly (it's not exported), we duplicate the key list
 * here as a filter set. This list must stay in sync with STOCK_MAP in extractInstrument.ts.
 *
 * Rationale for not exporting STOCK_MAP: the map is an implementation detail of the resolver;
 * exporting it would couple external consumers to the internal key format. The backfill is
 * a one-time operational script, so a local copy is acceptable.
 */
const STOCK_MAP_KEYS = [
  "hdfc bank",
  "bajaj finance",
  "icici bank",
  "axis bank",
  "kotak mahindra",
  "kotak bank",
  "kotak",
  "tata motors",
  "tata steel",
  "tatasteel",
  "bharti airtel",
  "asian paints",
  "maruti suzuki",
  "maruti",
  "reliance industries",
  "reliance",
  "infosys",
  "wipro",
  "l&t",
  " lt ",
  " lt",
  "itc",
  "sbin",
  " sbi ",
  "sbi ",
  " sbi",
  "tcs",
] as const;

async function main(): Promise<void> {
  console.log(`[backfill-mistag] mode = ${DRY_RUN ? "DRY RUN" : "APPLY"}`);
  console.log(`[backfill-mistag] identifying mis-tagged opinions (instrument in [${CONTAMINATED_INSTRUMENTS.join(", ")}] AND quote contains a stock keyword)`);

  // Load all candidate rows: instrument is one of the contaminated indices.
  // The `quote` field is non-nullable per schema so all rows have a quote.
  const candidates = await prisma.expertOpinion.findMany({
    where: {
      instrument: { in: [...CONTAMINATED_INSTRUMENTS] },
    },
    select: {
      id: true,
      instrument: true,
      instrumentTicker: true,
      quote: true,
      headline: true,
    },
  });

  console.log(`[backfill-mistag] loaded ${candidates.length} candidate row(s) with contaminated instrument`);

  // Pre-filter in JS: only rows whose quote contains at least one STOCK_MAP key.
  const stockKeySet = STOCK_MAP_KEYS as readonly string[];
  const filtered = candidates.filter((row) => {
    const quoteLower = row.quote.toLowerCase();
    return stockKeySet.some((k) => quoteLower.includes(k));
  });

  console.log(`[backfill-mistag] ${filtered.length} row(s) contain a stock keyword in their quote — running resolver`);

  let corrected = 0;
  let skipped = 0;

  for (const row of filtered) {
    const quote = row.quote;
    const headline = row.headline ?? "";
    const wasInstrument = row.instrument ?? "";

    // Skip if the quote explicitly names the row's current instrument — it's not a
    // mis-tag; the analyst is talking about the index and a stock appears as
    // supporting evidence. Only overwrite when the quote does NOT contain the
    // current instrument label, which is the real "wrong tag" case.
    const currentInstrumentLower = (row.instrument ?? "").toLowerCase();
    if (currentInstrumentLower && row.quote.toLowerCase().includes(currentInstrumentLower)) {
      skipped++;
      console.log(`[backfill] id=${row.id} skipped — quote explicitly names current instrument "${row.instrument}"`);
      continue;
    }

    const resolved = checkTickerMap(quote, headline);

    // Only act if pass 1 (STOCK_MAP) produced a result. We check this by verifying
    // the resolved ticker is a .NS equity (not an index/sector/commodity).
    // The simpler check: if resolved exists and its ticker ends with .NS, it came
    // from pass 1 (all INDEX_SECTOR_COMMODITY_MAP results use ^ prefix or =F suffix).
    if (!resolved || !resolved.ticker.endsWith(".NS")) {
      // Pass 1 missed — leave the row alone. Don't substitute an index result.
      skipped++;
      continue;
    }

    const normalizedTicker = normalizeYahooTicker(resolved.ticker);
    const nowInstrument = resolved.instrument;

    console.log(
      `[backfill] id=${row.id} was="${wasInstrument}" now="${nowInstrument}" ticker="${normalizedTicker}"`
    );

    if (!DRY_RUN) {
      await prisma.expertOpinion.update({
        where: { id: row.id },
        data: {
          instrument: nowInstrument,
          instrumentTicker: normalizedTicker,
        },
      });
    }

    corrected++;
  }

  const totalScanned = filtered.length;
  const unresolvedSkipped = skipped;

  console.log("\n[backfill-mistag] summary");
  console.log(`  candidates loaded: ${candidates.length} (instrument in contaminated set)`);
  console.log(`  with stock keyword: ${totalScanned}`);
  console.log(`  corrected: ${corrected}`);
  console.log(`  skipped (quote names current instrument OR pass 1 miss): ${unresolvedSkipped}`);

  if (DRY_RUN) {
    console.log("\n[backfill-mistag] DRY RUN — no rows were modified.");
    console.log("Re-run without --dry-run to apply.");
  } else {
    console.log("\n[backfill-mistag] done.");
  }
}

main()
  .catch((err) => {
    console.error("[backfill-mistag] fatal:", err);
    process.exit(1);
  })
  .finally(() => {
    void prisma.$disconnect();
  });
