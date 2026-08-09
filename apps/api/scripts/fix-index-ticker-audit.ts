/**
 * Index Identity Audit repair script (2026-08-10).
 *
 * Founder ask, after catching "capital goods" opinions force-mapped onto the
 * Infrastructure index: "did you look for all other indices as well and see
 * if any other is mismatched or not there with us." This script applies
 * EVERY verdict from that full audit (.scratch/index-audit-verdicts.md) to
 * the ExpertOpinion rows already persisted in prod — it does NOT touch
 * extraction going forward (that's TICKER_REMAP / the keyword map in
 * apps/api/lib/ai/extractInstrument.ts, and the 5 new INDEX_UNIVERSE
 * entries in packages/business-rules/src/finance/indexUniverse.ts, both
 * fixed alongside this script).
 *
 * Three buckets, run in order:
 *
 *   A) UNCONDITIONAL_TICKER_REMAP — a dead/malformed ticker that is WRONG
 *      for literally every instrument-text variant it appears under in the
 *      source-of-truth pairs dump (.scratch/prod-instrument-ticker-pairs.tsv,
 *      433 distinct pairs). Blanket `instrumentTicker: <old>` -> `<new>`,
 *      independent of the instrument label. Mirrors extractInstrument.ts's
 *      TICKER_REMAP semantics exactly (same-identity normalization only).
 *
 *   B) CONDITIONAL_FIXES — instrument TEXT + current ticker together decide
 *      the verdict, because the same ticker means different things under
 *      different text (e.g. ^NSEBANK is correct for "Bank Nifty" but wrong
 *      for "Private Sector Banks"; ^NSEI is correct for "Nifty 50" but wrong
 *      for "IT Services"). Each rule matches on an exact (case-insensitive)
 *      instrument label AND the current ticker, so a row already fixed (or
 *      never broken) never matches twice.
 *
 *   C) CAPITAL_GOODS_SWEEP — a regex safety net, broader than the exact
 *      "Nifty Capital Goods" match in the original fix-proxy-index-opinions.ts
 *      (2026-08-10), which the founder flagged as having missed a casing/
 *      wording variant still carrying ^CNXINFRA. Catches ANY remaining
 *      "capital goods"-labeled row with a non-null ticker, regardless of
 *      exact wording, and nulls the ticker + normalizes the label for
 *      consistency with the already-corrected 25 rows.
 *
 * Every verdict below is documented with its reasoning in
 * .scratch/index-audit-verdicts.md — this file intentionally does not
 * restate that reasoning per-rule to avoid drift between a comment and the
 * audit table; it implements the table's verdicts.
 *
 * DRY_RUN by default; --live to write. Idempotent: bucket A's WHERE clause
 * keys off the OLD ticker (gone after the first run), bucket B keys off
 * (old text, old ticker) pairs (also gone after fixing), bucket C's WHERE
 * requires a non-null ticker (also gone after nulling).
 *
 * Usage (from apps/api, DATABASE_URL of the target DB in env):
 *   npx tsx scripts/fix-index-ticker-audit.ts          # preview
 *   npx tsx scripts/fix-index-ticker-audit.ts --live   # apply
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const LIVE = process.argv.includes("--live");

// ---------------------------------------------------------------------------
// Bucket A — unconditional ticker -> ticker normalization (dead/malformed
// ticker, same real index, regardless of instrument text).
// ---------------------------------------------------------------------------
const UNCONDITIONAL_TICKER_REMAP: Array<{ from: string; to: string }> = [
  { from: "^NIFTYIT", to: "^CNXIT" },
  { from: "^NIFTYREAL", to: "^CNXREALTY" },
  { from: "^NIFTY200", to: "^CNX200" },
  { from: "^NSE MIDCAP 100", to: "NIFTY_MIDCAP_100.NS" },
  { from: "^NSE MIDCAP50", to: "^NSEMDCP50" },
  { from: "^NSEMIDCAP", to: "^NSEMDCP50" },
  { from: "NIFTY_FMCG.NS", to: "^CNXFMCG" },
  // ^CNXFIN is live but resolves to the DIFFERENT "NIFTY FINANCIAL SERVICES
  // 25/50" sub-index (verified 2026-08-10) — every row carrying it in prod
  // is labeled plain "Nifty Financial Services", never the 25/50 variant.
  { from: "^CNXFIN", to: "NIFTY_FIN_SERVICE.NS" },
  { from: "^NSEFIN", to: "NIFTY_FIN_SERVICE.NS" },
  { from: "NIFTYENERGY.NS", to: "^CNXENERGY" },
  { from: "NIFTYDEFENCE.NS", to: "NIFTY_IND_DEFENCE.NS" },
  { from: "TYX", to: "^TYX" },
  { from: "^CNXPSU", to: "^CNXPSUBANK" },
  { from: "^NSEPSUBK", to: "^CNXPSUBANK" },
];

// ---------------------------------------------------------------------------
// Bucket B — instrument text + current ticker together decide the verdict.
// `instrument` is matched case-insensitively, exact (mirrors the pairs dump).
// ---------------------------------------------------------------------------
type ConditionalFix =
  | { instrument: string; ticker: string; action: "null" }
  | { instrument: string; ticker: string; action: "retarget"; newTicker: string };

const CONDITIONAL_FIXES: ConditionalFix[] = [
  // --- Cross-identity mismatches -> null (no verified index matches the text) ---
  { instrument: "Indian Textiles Sector", ticker: "^CNXAUTO", action: "null" },
  { instrument: "PSU Bank Index", ticker: "CPSEETF.NS", action: "null" },
  { instrument: "Consumer Discretionary", ticker: "^BSESN", action: "null" },
  { instrument: "Defensive Sectors", ticker: "^NSEI", action: "null" },
  { instrument: "Automobiles and Consumer Services", ticker: "^CNXCONSUM", action: "null" },
  { instrument: "Small and Midcaps", ticker: "^NSEI", action: "null" },
  { instrument: "Value Stocks", ticker: "^NSEI", action: "null" },
  { instrument: "Telecom", ticker: "^CNXTELE", action: "null" }, // ^CNXTELE also dead; no real NSE Telecom index exists
  { instrument: "Power Sector", ticker: "^NSEPOWER", action: "null" }, // ^NSEPOWER dead; no real NSE Power index exists
  { instrument: "Power Equipment Sector", ticker: "CGPOWER.NS", action: "null" }, // sector text forced onto one company's stock
  { instrument: "Banking, NBFC, and Healthcare Sectors", ticker: "LTFH.NS", action: "null" }, // 3 sectors forced onto one stock
  { instrument: "Mid-cap and Small-cap", ticker: "^NSEMDCP100", action: "null" }, // bundles 2 distinct segments
  { instrument: "Mid-cap and Small-cap Segments", ticker: "^NSEMDCP100", action: "null" },
  { instrument: "Mid and Smallcaps", ticker: "^NIFTYSC250", action: "null" },

  // --- Cross-identity mismatches -> retarget (text directly names a real,
  // now-verified index; fixing the identity serves the founder's own rule
  // — "a ticker must match the instrument's ACTUAL identity" — better than
  // leaving it unlinked) ---
  { instrument: "Financials", ticker: "^BSESN", action: "retarget", newTicker: "NIFTY_FIN_SERVICE.NS" },
  { instrument: "IT Services", ticker: "^NSEI", action: "retarget", newTicker: "^CNXIT" },
  { instrument: "Oil and Gas Sector", ticker: "^NSEI", action: "retarget", newTicker: "NIFTY_OIL_AND_GAS.NS" },
  { instrument: "Manufacturing Sector", ticker: "^NSEI", action: "retarget", newTicker: "NIFTY_INDIA_MFG.NS" },
  { instrument: "Private Sector Banks", ticker: "^NSEBANK", action: "retarget", newTicker: "NIFTY_PVT_BANK.NS" },
  { instrument: "Private Sector Banks", ticker: "HDFCBANK.NS", action: "retarget", newTicker: "NIFTY_PVT_BANK.NS" },
  { instrument: "Indian Private Banks Sector", ticker: "^NSEBANK", action: "retarget", newTicker: "NIFTY_PVT_BANK.NS" },
  {
    instrument: "Public Sector Banks (relative to Private Lenders)",
    ticker: "^NSEBANK",
    action: "retarget",
    newTicker: "^CNXPSUBANK",
  },
  { instrument: "Defence Sector", ticker: "BEL.NS", action: "retarget", newTicker: "NIFTY_IND_DEFENCE.NS" },
  { instrument: "Defence Sector", ticker: "MAZAGON.NS", action: "retarget", newTicker: "NIFTY_IND_DEFENCE.NS" },

  // --- Dead/malformed ticker for the right index, single-occurrence rows
  // (folded in here rather than bucket A because each text is unambiguous
  // only in combination with its own current ticker) ---
  { instrument: "Midcaps", ticker: "^NSEMDCP100", action: "retarget", newTicker: "NIFTY_MIDCAP_100.NS" },
  { instrument: "Smallcaps", ticker: "^NIFTYSC250", action: "retarget", newTicker: "NIFTYSMLCAP250.NS" },
];

// ---------------------------------------------------------------------------
// Bucket C — capital-goods safety net (broader than the exact-match repair
// in fix-proxy-index-opinions.ts, which the founder flagged as having missed
// a casing/wording variant still carrying ^CNXINFRA).
// ---------------------------------------------------------------------------
const CAPITAL_GOODS_REGEX = /capital goods/i;
const CAPITAL_GOODS_CANONICAL_LABEL = "Capital Goods sector";

async function main() {
  console.log(`[fix-index-ticker-audit] Starting (${LIVE ? "LIVE" : "DRY RUN — no writes"})...`);

  // --- Bucket A ---
  console.log("\n=== Bucket A: unconditional ticker normalization ===");
  let bucketACount = 0;
  for (const { from, to } of UNCONDITIONAL_TICKER_REMAP) {
    const rows = await prisma.expertOpinion.findMany({
      where: { instrumentTicker: from },
      select: { id: true, instrument: true, instrumentTicker: true },
    });
    if (rows.length === 0) continue;
    bucketACount += rows.length;
    console.log(`  ${from} -> ${to}: ${rows.length} row(s)`);
    for (const r of rows) {
      console.log(`    ${LIVE ? "[fix]" : "[would-fix]"} id=${r.id} instrument="${r.instrument}" ticker=${from} -> ${to}`);
    }
    if (LIVE) {
      await prisma.expertOpinion.updateMany({ where: { instrumentTicker: from }, data: { instrumentTicker: to } });
    }
  }
  console.log(`Bucket A total: ${bucketACount} row(s)`);

  // --- Bucket B ---
  console.log("\n=== Bucket B: conditional (instrument text + ticker) fixes ===");
  let bucketBCount = 0;
  let bucketBNull = 0;
  let bucketBRetarget = 0;
  for (const fix of CONDITIONAL_FIXES) {
    const rows = await prisma.expertOpinion.findMany({
      where: { instrument: { equals: fix.instrument, mode: "insensitive" }, instrumentTicker: fix.ticker },
      select: { id: true, instrument: true, instrumentTicker: true },
    });
    if (rows.length === 0) continue;
    bucketBCount += rows.length;
    const label =
      fix.action === "null"
        ? `"${fix.instrument}" (${fix.ticker}) -> ticker=null`
        : `"${fix.instrument}" (${fix.ticker}) -> ${fix.newTicker}`;
    console.log(`  ${label}: ${rows.length} row(s)`);
    for (const r of rows) {
      console.log(`    ${LIVE ? "[fix]" : "[would-fix]"} id=${r.id}`);
    }
    if (fix.action === "null") {
      bucketBNull += rows.length;
      if (LIVE) {
        await prisma.expertOpinion.updateMany({
          where: { instrument: { equals: fix.instrument, mode: "insensitive" }, instrumentTicker: fix.ticker },
          data: { instrumentTicker: null },
        });
      }
    } else {
      bucketBRetarget += rows.length;
      if (LIVE) {
        await prisma.expertOpinion.updateMany({
          where: { instrument: { equals: fix.instrument, mode: "insensitive" }, instrumentTicker: fix.ticker },
          data: { instrumentTicker: fix.newTicker },
        });
      }
    }
  }
  console.log(`Bucket B total: ${bucketBCount} row(s) (${bucketBNull} nulled, ${bucketBRetarget} retargeted)`);

  // --- Bucket C ---
  console.log("\n=== Bucket C: capital-goods safety net ===");
  const capitalGoodsRows = await prisma.expertOpinion.findMany({
    where: { instrument: { contains: "capital goods", mode: "insensitive" }, instrumentTicker: { not: null } },
    select: { id: true, instrument: true, instrumentTicker: true },
  });
  console.log(`  "capital goods"-labeled rows still carrying a ticker: ${capitalGoodsRows.length}`);
  for (const r of capitalGoodsRows) {
    if (!CAPITAL_GOODS_REGEX.test(r.instrument ?? "")) continue;
    console.log(
      `    ${LIVE ? "[fix]" : "[would-fix]"} id=${r.id} instrument="${r.instrument}" ticker=${r.instrumentTicker} -> instrument="${CAPITAL_GOODS_CANONICAL_LABEL}" ticker=null`,
    );
  }
  if (LIVE) {
    const c = await prisma.expertOpinion.updateMany({
      where: { instrument: { contains: "capital goods", mode: "insensitive" }, instrumentTicker: { not: null } },
      data: { instrument: CAPITAL_GOODS_CANONICAL_LABEL, instrumentTicker: null },
    });
    console.log(`Bucket C total: ${c.count} row(s)`);
  } else {
    console.log(`Bucket C total: ${capitalGoodsRows.length} row(s)`);
  }

  console.log(LIVE ? "\n[fix-index-ticker-audit] Wrote all buckets." : "\n[fix-index-ticker-audit] Dry run only. Re-run with --live to persist.");
}

main()
  .catch((err) => {
    console.error("[fix-index-ticker-audit] FAILED:", err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
