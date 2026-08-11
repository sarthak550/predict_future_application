/**
 * Index Composition — long-tail CSV discovery sweep (2026-08-12).
 *
 * Founder follow-up on the just-shipped composition panel (commit 397b4c9):
 * "we had 100s of indices — why are we talking about just 35." The panel's
 * constituent registry (apps/web/lib/finance/indexConstituents.ts) is a
 * hand-verified dictionary of 30 `ind_<slug>list.csv` filenames covering
 * only the 35 indices with a full `/instruments/[symbol]` page. This script
 * extends the sweep to ALL 163 indices IndexEodQuote has history for (the
 * Stage 2 long-tail backfill's own universe — see indexLongTail.ts),
 * wherever NSE's archives host actually publishes a constituent list.
 *
 * WHY BRUTE-FORCE PROBING (not a discovered mapping API): this ticket first
 * spent real effort hunting for a machine-readable index->filename map
 * (niftyindices.com's IndexMapping.json, Backpage.aspx page-methods, a
 * sitemap) — none exposed the CSV slug directly, and IndexMapping.json only
 * maps a short "trading name" to a long display name, not a filename. The
 * filename grammar itself is confirmed irregular by the 30 known-good
 * entries (ind_niftyautolist.csv vs ind_nifty_privatebanklist.csv vs
 * ind_niftyindiamanufacturing_list.csv) — no single deterministic rule
 * reproduces all 30. So: generate a broad candidate set per index (derived
 * from the grammar those 30 entries actually exhibit), probe each with a
 * paced GET, keep the first hit, record a verified miss when every
 * candidate 404s.
 *
 * OUTPUT: prints a TS-literal object of new hits (symbol -> slug) and a
 * TS-literal array of verified-miss symbols, ready to hand-paste into
 * indexConstituents.ts — this script never writes source files itself, same
 * "hand-auditable dictionary, never runtime-guessed" discipline that file's
 * own module doc requires. Also writes a full JSON report (hits + misses +
 * every candidate tried per miss) to /tmp/index-csv-discovery-report.json
 * for the write-up.
 *
 * Politeness: one request at a time, REQUEST_DELAY_MS between requests,
 * stop probing a given index at its first hit. Usage:
 *   npx tsx scripts/discover-index-constituent-csvs.ts
 */

import { deriveIndexSymbol, isIndexUniverseSymbol } from "@predict-future/business-rules/finance/indexUniverse";

import { prisma } from "../lib/prisma";

const NSE_ARCHIVES_BASE = "https://nsearchives.nseindia.com/content/indices";
const REQUEST_DELAY_MS = 400;
const FETCH_TIMEOUT_MS = 12_000;
const BROWSER_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

// The 30 keys already verified live in apps/web/lib/finance/indexConstituents.ts
// — never re-probed here (this sweep is additive to that dictionary, not a
// re-verification of it).
const ALREADY_VERIFIED = new Set([
  "NIFTY", "BANKNIFTY", "FINNIFTY", "MIDCPNIFTY", "NIFTYNXT50",
  "NIFTY100", "NIFTY200", "NIFTY500", "NIFTYMIDCAP50", "NIFTYMIDCAP100",
  "NIFTYMIDCAP150", "NIFTYTOTALMARKET", "NIFTYMICROCAP250",
  "NIFTYAUTO", "NIFTYFMCG", "NIFTYIT", "NIFTYMEDIA", "NIFTYMETAL",
  "NIFTYPHARMA", "NIFTYPSUBANK", "NIFTYPRIVATEBANK", "NIFTYREALTY",
  "NIFTYHEALTHCAREINDEX", "NIFTYOILGAS", "NIFTYINFRASTRUCTURE",
  "NIFTYENERGY", "NIFTYINDIACONSUMPTION", "NIFTYINDIAMANUFACTURING",
  "NIFTYINDIADEFENCE", "NIFTYSMALLCAP250",
]);

// Same 5 tradable-underlying NSE names indexLongTail.ts excludes by name
// (their /instruments/ symbol is a short mnemonic, not deriveIndexSymbol of
// the full name — already covered by ALREADY_VERIFIED above via symbol, but
// the DB carries the full NSE name so we must exclude by name too).
const TRADABLE_INDEX_NSE_NAMES = new Set([
  "NIFTY 50", "NIFTY BANK", "NIFTY FINANCIAL SERVICES", "NIFTY MIDCAP SELECT", "NIFTY NEXT 50",
]);

// Volatility index — no equity constituents exist by definition. Never probed.
const EXCLUDED_BY_NATURE = new Set(["INDIAVIX"]);

function normalizeName(raw: string): string {
  return raw.trim().toUpperCase().replace(/\s+/g, " ");
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Candidate filename-core generator. Derives a DEDUPED list of lowercase,
 * no-space "core" strings for a given NSE index display name, covering every
 * variant grammar the 30 known-good entries exhibit:
 *   - full alnum-only string ("NIFTY OIL & GAS" -> "niftyoilgas")
 *   - "&" -> "and" instead of dropped
 *   - drop a leading "INDIA " token (NIFTY INDIA CONSUMPTION -> NIFTY CONSUMPTION)
 *   - drop a trailing " INDEX" token (NIFTY HEALTHCARE INDEX -> NIFTY HEALTHCARE)
 *   - "FINANCIAL SERVICES" -> "FINANCE" (NIFTY FINANCIAL SERVICES -> NIFTY FINANCE)
 *   - "INFRASTRUCTURE" -> "INFRA"
 *   - digit-group separators (":", "-", " ") collapsed two ways: fully
 *     stripped ("50:25:25" -> "502525") and underscore-joined ("50_25_25")
 *   - "nifty_" + rest (explicit underscore-after-nifty variant, e.g.
 *     ind_nifty_privatebanklist.csv)
 */
function candidateCores(rawName: string): string[] {
  const cores = new Set<string>();
  const upper = normalizeName(rawName);

  const toAlnumLower = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]/g, "");

  const variants: string[] = [upper];

  // "&" handling: drop, or spell "AND"
  variants.push(upper.replace(/&/g, ""));
  variants.push(upper.replace(/&/g, " AND "));

  // Drop a leading "NIFTY INDIA " -> "NIFTY "
  if (upper.startsWith("NIFTY INDIA ")) {
    variants.push(upper.replace(/^NIFTY INDIA /, "NIFTY "));
  }

  // Drop a trailing " INDEX"
  if (upper.endsWith(" INDEX")) {
    variants.push(upper.replace(/ INDEX$/, ""));
  }

  // Known long-word shortenings
  if (upper.includes("FINANCIAL SERVICES")) {
    variants.push(upper.replace(/FINANCIAL SERVICES/g, "FINANCE"));
  }
  if (upper.includes("INFRASTRUCTURE")) {
    variants.push(upper.replace(/INFRASTRUCTURE/g, "INFRA"));
  }

  // Digit-group / ratio separators: preserve as underscore instead of
  // stripping (applied on top of every variant collected so far).
  const withUnderscoreRatios = variants.map((v) => v.replace(/[\s:\-]+(?=\d)/g, "_").replace(/(?<=\d)[\s:\-]+/g, "_"));

  for (const v of [...variants, ...withUnderscoreRatios]) {
    const core = toAlnumLower(v);
    if (core) cores.add(core);
  }

  // Explicit "nifty_" + rest-alnum variant (only meaningful when the name
  // starts with "NIFTY " and has more than one token after it).
  if (upper.startsWith("NIFTY ")) {
    const rest = toAlnumLower(upper.slice("NIFTY ".length));
    if (rest) cores.add(`nifty_${rest}`);
  }

  return [...cores];
}

/** Every ind_<core>(list|_list).csv URL to try for a given raw NSE index name, in priority order. */
function candidateUrls(rawName: string): { slug: string; url: string }[] {
  const cores = candidateCores(rawName);
  const out: { slug: string; url: string }[] = [];
  const seen = new Set<string>();
  for (const core of cores) {
    for (const slug of [`ind_${core}list`, `ind_${core}_list`]) {
      if (seen.has(slug)) continue;
      seen.add(slug);
      out.push({ slug, url: `${NSE_ARCHIVES_BASE}/${slug}.csv` });
    }
  }
  return out;
}

interface ProbeResult {
  status: number | "ERROR";
  rowCount: number;
}

async function probe(url: string): Promise<ProbeResult> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    let res: Response;
    try {
      res = await fetch(url, { headers: { "User-Agent": BROWSER_UA }, cache: "no-store", signal: controller.signal });
    } finally {
      clearTimeout(timeout);
    }
    if (!res.ok) return { status: res.status, rowCount: 0 };
    const text = await res.text();
    // Cheap sanity check: a real constituent CSV has a header + >=1 data row
    // with a "Symbol"-shaped 3rd column; NSE occasionally 200s a near-empty
    // or HTML error body for a dead slug, which must NOT count as a hit.
    const lines = text.split(/\r?\n/).filter((l) => l.trim());
    if (lines.length < 2) return { status: res.status, rowCount: 0 };
    const firstDataCols = lines[1].split(",");
    if (firstDataCols.length < 3 || !firstDataCols[2]?.trim()) return { status: res.status, rowCount: 0 };
    return { status: res.status, rowCount: lines.length - 1 };
  } catch {
    return { status: "ERROR", rowCount: 0 };
  }
}

interface DiscoveryHit {
  name: string;
  symbol: string;
  slug: string;
  rowCount: number;
}

interface DiscoveryMiss {
  name: string;
  symbol: string;
  candidatesTried: string[];
}

/** Optional `--limit=N` for a quick smoke test before the full ~130-index sweep. */
function parseLimitArg(): number | null {
  const arg = process.argv.find((a) => a.startsWith("--limit="));
  if (!arg) return null;
  const n = Number(arg.slice("--limit=".length));
  return Number.isFinite(n) && n > 0 ? n : null;
}

async function main() {
  const rows = await prisma.indexEodQuote.findMany({ distinct: ["indexName"], select: { indexName: true } });
  console.log(`[discover] ${rows.length} distinct index names in IndexEodQuote`);

  const toProbe: { name: string; symbol: string }[] = [];
  const skippedAlreadyVerified: string[] = [];
  const skippedByNature: string[] = [];

  for (const row of rows) {
    const name = row.indexName;
    const normalized = normalizeName(name);
    if (TRADABLE_INDEX_NSE_NAMES.has(normalized)) {
      skippedAlreadyVerified.push(name);
      continue;
    }
    const symbol = deriveIndexSymbol(name);
    if (ALREADY_VERIFIED.has(symbol) || isIndexUniverseSymbol(symbol)) {
      skippedAlreadyVerified.push(name);
      continue;
    }
    if (EXCLUDED_BY_NATURE.has(symbol)) {
      skippedByNature.push(name);
      continue;
    }
    toProbe.push({ name, symbol });
  }

  const limit = parseLimitArg();
  const probeList = limit ? toProbe.slice(0, limit) : toProbe;

  console.log(`[discover] ${skippedAlreadyVerified.length} already verified, ${skippedByNature.length} excluded by nature, ${toProbe.length} to probe${limit ? ` (limited to ${probeList.length} for this run)` : ""}`);

  const hits: DiscoveryHit[] = [];
  const misses: DiscoveryMiss[] = [];

  for (let i = 0; i < probeList.length; i++) {
    const { name, symbol } = probeList[i];
    const urls = candidateUrls(name);
    let found: DiscoveryHit | null = null;
    const tried: string[] = [];

    for (const { slug, url } of urls) {
      tried.push(slug);
      const result = await probe(url);
      await sleep(REQUEST_DELAY_MS);
      if (result.status === 200 && result.rowCount > 0) {
        found = { name, symbol, slug, rowCount: result.rowCount };
        break;
      }
    }

    if (found) {
      hits.push(found);
      console.log(`[${i + 1}/${probeList.length}] HIT  ${symbol.padEnd(28)} <- ${found.slug}.csv (${found.rowCount} rows)`);
    } else {
      misses.push({ name, symbol, candidatesTried: tried });
      console.log(`[${i + 1}/${toProbe.length}] miss ${symbol.padEnd(28)} (${tried.length} candidates tried)`);
    }
  }

  console.log("\n=== SUMMARY ===");
  console.log(`Total distinct indices: ${rows.length}`);
  console.log(`Already verified (existing 30): ${skippedAlreadyVerified.length}`);
  console.log(`Excluded by nature (India VIX): ${skippedByNature.length}`);
  console.log(`New hits this sweep: ${hits.length}`);
  console.log(`Verified misses this sweep: ${misses.length}`);
  console.log(`Coverage after this sweep: ${skippedAlreadyVerified.length - skippedByNature.length /* tradables+universe minus 0 */ + hits.length} of ${rows.length} (adjust for tradable/universe overlap in the write-up)`);

  console.log("\n=== NEW DICTIONARY ENTRIES (paste into CONSTITUENT_CSV_SLUG) ===");
  for (const h of [...hits].sort((a, b) => a.symbol.localeCompare(b.symbol))) {
    console.log(`  ${h.symbol}: "${h.slug}", // ${h.name} (${h.rowCount} rows)`);
  }

  console.log("\n=== VERIFIED-MISS SYMBOLS (paste into KNOWN_NO_CONSTITUENT_LIST) ===");
  for (const m of [...misses].sort((a, b) => a.symbol.localeCompare(b.symbol))) {
    console.log(`  "${m.symbol}", // ${m.name}`);
  }

  const fs = await import("node:fs");
  fs.writeFileSync(
    "/tmp/index-csv-discovery-report.json",
    JSON.stringify({ totalDistinct: rows.length, skippedAlreadyVerified, skippedByNature, hits, misses }, null, 2),
  );
  console.log("\nFull report written to /tmp/index-csv-discovery-report.json");
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
