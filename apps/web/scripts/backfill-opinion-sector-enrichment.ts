/**
 * Sector filter (founder ask, 2026-08-09) — Phase 2 backfill.
 *
 * The Sector filter on /opinions resolves a ticker's sector from TWO
 * sources (see lib/finance/sectorTaxonomy.ts's doc comment): NSE's own
 * Total Market CSV (nseSectorMaster.ts, ~90% coverage of real
 * opinion-referenced equities, needs no DB write at all — fetched live and
 * cached in-process) and, as fallback, Yahoo's sector/industry already
 * stored in InstrumentEnrichment.keyStats by the existing warm-enrichment
 * pipeline (lib/finance/enrichment.ts).
 *
 * This script targets EXACTLY the residual gap: opinion-referenced NSE
 * equity tickers that (a) NSE's Total Market CSV doesn't cover AND (b)
 * don't yet have InstrumentEnrichment.keyStats populated. It is the
 * narrower "sector-only backfill for opinion-referenced tickers" the CTO
 * proposed in place of a full fundamentals backfill — reuses the existing
 * warmEnrichmentBatch function (same code path the warm-enrichment cron
 * runs), so nothing new is invented: same rate-limit politeness (300ms
 * delay/symbol), same TTL/upsert semantics, just scoped to a small explicit
 * symbol list instead of the cron's own "stalest N" batch logic.
 *
 * Going forward, no cron change is needed either: any BRAND NEW opinion on
 * a ticker outside NSE's Total Market CSV will pick up its Yahoo sector for
 * free the next time the existing warm-enrichment cron reaches that symbol
 * in its normal rolling sweep (worst case ~1 day per the cron's own doc
 * comment) — this script exists only to close the CURRENT gap immediately
 * rather than waiting on the rolling sweep's natural cadence.
 *
 * Run: npx tsx scripts/backfill-opinion-sector-enrichment.ts   (from apps/web)
 * Dry-run (report the gap without writing): add --dry-run
 */

import { prisma } from "@/lib/prisma";
import { warmEnrichmentBatch } from "@/lib/finance/enrichment";
import { getNseIndustryMap } from "@/lib/finance/nseSectorMaster";

const DRY_RUN = process.argv.includes("--dry-run");

function bareSymbol(ticker: string): string | null {
  const m = /^([A-Z0-9&-]+)\.NS$/i.exec(ticker);
  return m ? m[1].toUpperCase() : null;
}

async function main() {
  console.log(`[backfill-opinion-sectors] mode: ${DRY_RUN ? "DRY RUN (no writes)" : "LIVE"}`);

  const opinionRows = await prisma.expertOpinion.findMany({
    where: { suppressedAt: null, instrumentTicker: { not: null } },
    distinct: ["instrumentTicker"],
    select: { instrumentTicker: true },
  });
  const tickers = opinionRows.map((r) => r.instrumentTicker).filter((t): t is string => Boolean(t));
  const bareByTicker = new Map<string, string>();
  for (const t of tickers) {
    const s = bareSymbol(t);
    if (s) bareByTicker.set(t, s);
  }
  const bareSymbols = [...new Set(bareByTicker.values())];
  console.log(`[backfill-opinion-sectors] ${tickers.length} distinct opinion-referenced tickers, ${bareSymbols.length} are NSE equities (.NS)`);

  const nseIndustryMap = await getNseIndustryMap();
  console.log(`[backfill-opinion-sectors] NSE Total Market CSV: ${nseIndustryMap.size} symbols loaded`);

  const uncoveredByNse = bareSymbols.filter((s) => !nseIndustryMap.has(s));
  console.log(`[backfill-opinion-sectors] ${uncoveredByNse.length}/${bareSymbols.length} opinion-referenced symbols NOT in NSE's Total Market CSV — these need the Yahoo fallback`);

  // Before snapshot: how many of the uncovered symbols already have a usable
  // keyStats.sector (e.g. from a prior page visit or a previous cron pass)?
  const beforeRows = uncoveredByNse.length > 0
    ? await prisma.instrumentEnrichment.findMany({
        where: { symbol: { in: uncoveredByNse } },
        select: { symbol: true, keyStats: true, companyName: true },
      })
    : [];
  const beforeHasSector = new Set(
    beforeRows.filter((r) => (r.keyStats as { sector?: string } | null)?.sector).map((r) => r.symbol),
  );
  const stillMissing = uncoveredByNse.filter((s) => !beforeHasSector.has(s));

  console.log(`[backfill-opinion-sectors] BEFORE: ${beforeHasSector.size}/${uncoveredByNse.length} Yahoo-fallback-needed symbols already have keyStats.sector`);
  console.log(`[backfill-opinion-sectors] gap to close: ${stillMissing.length} symbols — ${stillMissing.join(", ") || "(none)"}`);

  if (stillMissing.length === 0) {
    console.log("[backfill-opinion-sectors] nothing to backfill — every Yahoo-fallback symbol is already covered.");
    return;
  }

  if (DRY_RUN) {
    console.log("[backfill-opinion-sectors] dry run — stopping before any write.");
    return;
  }

  // companyName is required by warmEnrichmentBatch's upsert `create` path but
  // is cosmetic (only used for a fallback company label) — the bhavcopy-
  // sourced StockEodQuote table is the authoritative source elsewhere; a
  // symbol-as-name placeholder here is harmless since this script's only
  // goal is keyStats.sector, not the companyName field.
  const eodNames = await prisma.stockEodQuote.findMany({
    where: { symbol: { in: stillMissing } },
    distinct: ["symbol"],
    select: { symbol: true, companyName: true },
  });
  const nameBySymbol = new Map(eodNames.map((r) => [r.symbol, r.companyName]));
  const batch = stillMissing.map((symbol) => ({ symbol, companyName: nameBySymbol.get(symbol) ?? symbol }));

  console.log(`[backfill-opinion-sectors] running warmEnrichmentBatch for ${batch.length} symbols (sequential, 300ms/symbol politeness delay — matches the warm-enrichment cron)...`);
  const result = await warmEnrichmentBatch(batch);
  console.log(`[backfill-opinion-sectors] processed ${result.processed}/${batch.length}: ${result.symbols.join(", ")}`);

  const afterRows = await prisma.instrumentEnrichment.findMany({
    where: { symbol: { in: stillMissing } },
    select: { symbol: true, keyStats: true },
  });
  const afterHasSector = afterRows.filter((r) => (r.keyStats as { sector?: string } | null)?.sector).length;
  console.log(`[backfill-opinion-sectors] AFTER: ${afterHasSector}/${stillMissing.length} newly resolved a sector`);
  console.log(`[backfill-opinion-sectors] TOTAL opinion-referenced-equity sector coverage now: ${nseIndustryMap.size > 0 ? bareSymbols.filter((s) => nseIndustryMap.has(s)).length : 0} (NSE) + ${beforeHasSector.size + afterHasSector} (Yahoo) / ${bareSymbols.length}`);
}

main()
  .catch((err) => {
    console.error("[backfill-opinion-sectors] fatal error:", err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
