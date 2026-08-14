/**
 * Shared index-name normalization + resolution (factored out of
 * etfRegistry.ts, 2026-08-14, BSE Phase 3B task 1 — "extend the NSE ETF
 * registry's underlying-resolution tiers to ALSO match against BSE index
 * names"). Pure extraction of etfRegistry.ts's own `coreNorm`/`fundHouseNorm`
 * normalization pipeline and `resolveIndexNameToSymbol` tiered resolver —
 * verified byte-identical logic, zero behavior change for etfRegistry.ts's
 * existing NSE-only resolution (see the shipping ticket's regression check:
 * 0 of 236 previously-mapped NSE ETF Underlyings changed resolution after
 * this refactor + the BSE merge below).
 *
 * WHAT CHANGED FUNCTIONALLY (both live-verified 2026-08-14):
 *   1. `fetchAllIndexNames()` now merges NSE's IndexEodQuote names WITH
 *      BSE's BseIndexEodQuote names (was NSE-only) — so an ETF/fund whose
 *      Underlying/name resolves to a BSE index (e.g. "S&P BSE Sensex") now
 *      gets a real `/instruments/[symbol]` link instead of rendering
 *      unmapped. Verified live: 133 BSE index names + 163 NSE index names,
 *      zero coreNorm-key collisions between the two sets (a name colliding
 *      would simply resolve to neither, per `buildCanonIndex`'s existing
 *      AMBIGUOUS-sentinel rule — not a new failure mode, already handled).
 *   2. `FUND_HOUSE_TOKENS` gained one new hand-verified prefix, "SANDP"
 *      ("S&P" after the `&`->AND normalization) — BSE's own official index
 *      names are frequently co-branded "S&P BSE ..." by ETF houses in their
 *      own fund names (e.g. "Axis S&P BSE Sensex ETF") even though this
 *      app's own ingested `BseIndexEodQuote.indexName` values never carry
 *      that prefix (verified: all 133 read "BSE ...", never "S&P BSE...").
 *      Stripping "S&P" as a co-branding token (same treatment as a fund
 *      house name) resolved 8 more of the 33 newly-BSE-mapped Underlyings
 *      below that would otherwise have stayed unmapped despite a real BSE
 *      index existing for them. Safe by construction: no NSE or BSE index
 *      name in this app's data legitimately differs from another ONLY by an
 *      "S&P" prefix (verified: zero regressions).
 *
 * NET RESULT (live-verified 2026-08-14 against the current NSE eq_etfseclist
 * 342-row CSV + the current IndexEodQuote/BseIndexEodQuote universes): of
 * the 106 NSE ETF Underlying strings that were unmapped before this change,
 * 33 now resolve (mostly BSE/Sensex-family ETFs — SENSEX/SENSEX Next 50/
 * SENSEX Next 30/BSE 500/BSE Healthcare/BSE Quality/BSE Enhanced Value/BSE
 * Liquid Rate/BSE PSU Bank/BSE Power/BSE Top 10 Banks/BSE Insurance/BSE
 * India Infrastructure/BSE India Defence/BSE MidSmall Private Banks/BSE
 * Select IPO/BSE 200 Equal Weight/BSE Midcap 150 Momentum 30/BSE Capital
 * Markets & Insurance). The remaining 73 are genuinely out of this app's
 * data (Gold/Silver physical-commodity ETFs, G-Sec/Gilt ETFs, liquid-rate
 * ETFs with no matching index page, and foreign indices — NASDAQ-100, Hang
 * Seng, S&P 500, MSCI India — none of which this app tracks) plus a handful
 * of malformed Underlying cells (literal "Index"/"Liquid"/"Commodity" with
 * no identifying text at all) — left honestly unmapped, never guessed.
 */

import { slugifyIndexName } from "@predict-future/business-rules/finance/indexSlug";
import {
  deriveIndexSymbol,
  resolveIndexUniverseEntryByRawName,
} from "@predict-future/business-rules/finance/indexUniverse";

import { prisma } from "@/lib/prisma";
import { INDEX_SLUG_TO_TRADABLE_UNDERLYING } from "@/lib/finance/indexTradableAlias";

/** Fund-house/co-branding name tokens observed prefixing (or, in a few Underlying-column data-quality rows, entirely comprising) an ETF's own name — hand-verified against NSE's live eq_etfseclist.csv AND BSE-only funds' AMFI names, 2026-08-12/2026-08-14. Order-independent: `stripFundHousePrefixes` strips repeatedly until no prefix matches, so a fund-house token and "SANDP" can appear in either order (e.g. "Axis S&P BSE Sensex ETF" strips AXIS then SANDP). */
const FUND_HOUSE_TOKENS = [
  "ADITYABIRLASUNLIFE",
  "ABSL",
  "AXIS",
  "BAJAJFINSERV",
  "BANDHAN", // BSE Phase 3B (2026-08-14) — Bandhan Mutual Fund's own BSE Sensex ETF ("BANDHAN BSE Sensex ETF")
  "BARODABNPPARIBAS",
  "DSP",
  "EDELWEISS",
  "GROWW",
  "HDFC",
  "ICICIPRUDENTIAL",
  "INVESCOINDIA",
  "INVESCO",
  "IVZIN",
  "KOTAKMAHINDRA",
  "KOTAK",
  "LICMF",
  "LIC",
  "MIRAEASSET",
  "MOTILALOSWAL",
  "MUTUALFUND",
  "NIPPONINDIA",
  "QUANTUM",
  "SBI",
  "SHRIRAM",
  "TATA",
  "UTI",
  "ZERODHA",
  // BSE Phase 3B (2026-08-14) — "S&P" (post `&`->AND normalization) is a
  // licensing co-brand prefix on several fund houses' own BSE-tracking ETF
  // names ("Axis S&P BSE Sensex ETF", "Motilal Oswal S&P BSE Healthcare
  // ETF"), never part of an index's own identity — this app's own ingested
  // BSE index names never carry it (verified: all 133 read "BSE ...").
  "SANDP",
];

/** Trailing filler words stripped repeatedly from either normalization pass — "ETF"/"Exchange Traded Fund"/"Index"/TRI-style return-index suffixes carry no index identity of their own. */
const NOISE_SUFFIXES = ["EXCHANGETRADEDFUND", "ETF", "TOTALRETURNINDEX", "INDEX", "TRI", "TR", "FUND"];

/**
 * ETF-alias fix-round (2026-08-14): GROWWDEFNC's Underlying cell reads
 * "Nifty India Defence Index- Total Return Inde" — cut off one character
 * short of "...Total Return Index". Verified NOT a fixed-width CSV
 * truncation (this app's longest live Underlying cell is 64 chars, this one
 * is 45 — plenty of headroom) — a genuine one-off NSE data-entry typo,
 * confirmed by its own correctly-spelled sibling row ("Nifty India Defence
 * Total Return Index"). Rather than hand-alias just this one row, tolerate
 * the general case: for the two NOISE_SUFFIXES that end in "INDEX"
 * ("TOTALRETURNINDEX", "INDEX" itself), also accept the same suffix with its
 * final "X" dropped, end-anchored. Requires the FULL preceding text (all of
 * "TOTALRETURNINDE", not just "INDE" in isolation), so the false-positive
 * surface is a real index name that legitimately ends in "...Total Return
 * Inde" or a bare "...Inde" with no "x" — verified: no such name exists
 * anywhere in this app's NSE+BSE index universe or ETF Underlying set (only
 * one live row exhibits this truncation at all). Composes with the normal
 * NOISE_SUFFIXES loop across iterations so a truncated COMPOUND suffix still
 * fully unwinds (e.g. this row: strip "TOTALRETURNINDE" first, which exposes
 * a now-untruncated "...Index" that the ordinary INDEX suffix strips next).
 */
const TRUNCATED_INDEX_SUFFIXES = ["TOTALRETURNINDEX", "INDEX"]
  .map((suf) => suf.slice(0, -1))
  .filter((suf) => suf.length > 0);

function stripSuffixes(s: string): string {
  let out = s;
  let changed = true;
  while (changed) {
    changed = false;
    for (const suf of NOISE_SUFFIXES) {
      if (out.endsWith(suf) && out.length > suf.length) {
        out = out.slice(0, -suf.length);
        changed = true;
      }
    }
    for (const suf of TRUNCATED_INDEX_SUFFIXES) {
      if (out.endsWith(suf) && out.length > suf.length) {
        out = out.slice(0, -suf.length);
        changed = true;
      }
    }
  }
  return out;
}

function stripFundHousePrefixes(s: string): string {
  let out = s;
  let changed = true;
  while (changed) {
    changed = false;
    for (const fh of FUND_HOUSE_TOKENS) {
      if (out.startsWith(fh) && out.length > fh.length) {
        out = out.slice(fh.length);
        changed = true;
      }
    }
  }
  return out;
}

/** Punctuation/casing/suffix-only normalization — matches "Nifty50" / "NiftyBankIndex" / "Nifty 50 Index - TRI" style spelling variance without touching fund-house identity. */
export function coreNorm(s: string): string {
  const upper = s.trim().toUpperCase().replace(/&/g, "AND");
  const stripped = upper.replace(/\(.*?\)/g, "").replace(/[^A-Z0-9]/g, "");
  return stripSuffixes(stripped);
}

/** `coreNorm` PLUS a fund-house/co-brand-prefix strip — catches "the fund's own name embeds the index name" rows (see module doc). */
export function fundHouseNorm(s: string): string {
  return stripSuffixes(stripFundHousePrefixes(coreNorm(s)));
}

/** Resolved once per cache build from the live index-name set — a normalized key mapping to MORE than one real index name is recorded as the AMBIGUOUS sentinel and never resolved, per this module's "never fuzzy-guess" rule. */
export const AMBIGUOUS = Symbol("ambiguous");
export type CanonIndex = Map<string, string | typeof AMBIGUOUS>;

export function buildCanonIndex(allIndexNames: string[]): CanonIndex {
  const map: CanonIndex = new Map();
  for (const name of allIndexNames) {
    const key = coreNorm(name);
    if (map.has(key) && map.get(key) !== name) {
      map.set(key, AMBIGUOUS);
    } else {
      map.set(key, name);
    }
  }
  return map;
}

/**
 * Residual hand-verified abbreviations, keyed by `coreNorm`/`fundHouseNorm`
 * output — genuine exchange shorthand no automated rule derives (same spirit
 * as indexUniverse.ts's own INDEX_NAME_ALIASES).
 */
export const NORM_ALIASES: Record<string, string> = {
  // Founder-reported live 2026-08-14: HDFCSENSEX/SENSEXIETF/SENSEXBETA/
  // LICNETFSEN publish their Underlying as literally the bare word "SENSEX"
  // (verified in eq_etfseclist.csv) — no normalization rule can reach
  // "BSE SENSEX" from it, so those four rendered "not yet linked" while
  // long-form underlyings ("S&PBSESensexIndex") resolved fine. "SENSEX"
  // unambiguously means exactly one index.
  SENSEX: "BSE SENSEX",
  NIFTYINFRA: "Nifty Infrastructure",
  NIFTYCONSUMPTION: "Nifty India Consumption",
  NIFTYDIVOPPS50: "Nifty Dividend Opportunities 50",
  NIFTYGS813YR: "Nifty 8-13 yr G-Sec",
  NIFTY1DRATELIQUID: "Nifty 1D Rate Index",
  NIFTY1DRATE: "Nifty 1D Rate Index",
  NIFTYINDEX50: "Nifty 50",
  NIFTY100LOWVOL30: "Nifty100 Low Volatility 30",

  // ETF-alias fix-round (2026-08-14, 59-underlying resolver audit follow-up
  // to the SENSEX fix) — five more real indices behind singular/plural or
  // shortened NSE Underlying spellings, each hand-verified against this
  // app's own IndexEodQuote/BseIndexEodQuote names live 2026-08-14.

  // CEMNTGROWW's Underlying is "Nifty Cements Index TRI" (plural "Cements")
  // — this app's own index is singular "Nifty Cement".
  NIFTYCEMENTS: "Nifty Cement",
  // MOCAPITAL's Underlying is "Nifty Capital Market Total Return Index"
  // (singular "Market") — this app's own index is plural "Nifty Capital
  // Markets".
  NIFTYCAPITALMARKET: "Nifty Capital Markets",
  // DIVIDEND's Underlying is "BSE 500 Dividend Leaders" — the real BSE index
  // carries a trailing "50" this fund's Underlying cell dropped ("BSE 500
  // Dividend Leaders 50").
  BSE500DIVIDENDLEADERS: "BSE 500 Dividend Leaders 50",
  // EBANK10's Underlying is "Index (BSE Top 10 Bank)" (singular "Bank") —
  // after the paren-unwrap in etfRegistry.ts's `extractIndexParenWrapper`,
  // the real BSE index is plural "BSE Top 10 Banks".
  BSETOP10BANK: "BSE Top 10 Banks",
  // SHARIABEES's Underlying is the bare word "Shariah" — verified via its
  // AMFI scheme-master name ("Nippon India ETF Nifty 50 Shariah BeES",
  // ISIN INF732E01128) that it tracks "Nifty50 Shariah" specifically, not
  // the also-real "Nifty500 Shariah" / "Nifty Shariah 25" / "BSE 500
  // Shariah" this app also has pages for — never guessed from the bare word
  // alone.
  SHARIAH: "Nifty50 Shariah",

  // Resolves the pre-existing "Nifty 10 yr Benchmark G-Sec" vs "... (Clean
  // Price)" AMBIGUOUS-sentinel collision (see etfRegistry.ts's module doc)
  // for the 3 ETFs that collide on it — SETF10GILT ("Nifty10yrBenchmarkG-
  // SecIndex"), GSEC10IETF ("ICICIPrudentialNifty10yrBenchmarkG-SecETF"),
  // GILT10BETA ("UTINifty10yrBenchmarkG-SecETF"). Verified live 2026-08-14
  // against SBI Mutual Fund's own official ETF factsheet (December 2025,
  // sbimf.com) for SETF10GILT: both its "Benchmark/Underlying Index" AND
  // "Scheme Benchmark" fields read plain "NIFTY 10-Yr Benchmark G-Sec" /
  // "Nifty 10 yr Benchmark G-Sec" — "Clean Price" appears nowhere in the
  // document (the factsheet separately notes performance is benchmarked to
  // "the Total Return variant of the Index", a third, distinct variant this
  // app doesn't carry either — irrelevant to which of the two EOD-price
  // indices is the right link target). GSEC10IETF and GILT10BETA are
  // corroborated (not primary-source-confirmed) via each AMC's own publicly
  // stated scheme investment objective, both worded identically to SBI's
  // ("...returns...of NIFTY 10 yr Benchmark G-Sec Index", no "Clean Price"
  // qualifier) — standard SEBI scheme-information-document language, and
  // all three gilt ETFs in this product category following the same
  // benchmark choice is the expected outcome, not a coincidence.
  NIFTY10YRBENCHMARKGSEC: "Nifty 10 yr Benchmark G-Sec",

  // LICNETFGSC's Underlying cell reads "GSEC10NSEIndex" (implying a 10yr
  // G-Sec fund) — but its AMFI scheme-master name (ISIN INF767K01MV5) is
  // "LIC MF Nifty 8-13 yr G-Sec ETF". The Underlying cell is simply wrong,
  // not merely oddly formatted (NSE data-quality issue, same class of bug as
  // the SENSEX-bare-word one this fix-round follows up on) — resolved via
  // the fund's own real name, not the cell's text, exactly per this app's
  // "never guess, only hand-verified evidence" discipline. "Nifty 8-13 yr
  // G-Sec" is unambiguous in this app's index universe (already has its own
  // NORM_ALIASES entry above, NIFTYGS813YR, for a differently-abbreviated
  // Underlying spelling on other ETFs).
  GSEC10NSE: "Nifty 8-13 yr G-Sec",
};

/** `/instruments/[symbol]` code for a REAL, already-confirmed-to-exist index display name — tiered exactly like `fetchInstrumentDetail` itself resolves an index symbol (NSE tradable underlying's short mnemonic first, then NSE INDEX_UNIVERSE, then `deriveIndexSymbol` — which ALSO derives every BSE index's own symbol, tradable or long-tail, by construction: `bseIndexUniverse.ts`'s BSE_INDEX_UNIVERSE entries assert `symbol === deriveIndexSymbol(name)` at module load, and the BSE long tail derives its symbol the identical way — so a BSE index name reaches the correct code via this SAME final fallback with no extra branch needed here). */
export function resolveIndexNameToSymbol(name: string): string {
  const slug = slugifyIndexName(name);
  const tradable = INDEX_SLUG_TO_TRADABLE_UNDERLYING[slug];
  if (tradable) return tradable;
  const universeEntry = resolveIndexUniverseEntryByRawName(name);
  if (universeEntry) return universeEntry.symbol;
  return deriveIndexSymbol(name);
}

const ALL_INDEX_NAMES_TTL_MS = 5 * 60 * 1000;
let allIndexNamesCache: { at: number; names: string[] } | null = null;

/**
 * Every real index name this app has EOD history for, NSE + BSE merged
 * (`IndexEodQuote.indexName` distinct ∪ `BseIndexEodQuote.indexName`
 * distinct) — the canon-matching universe for both etfRegistry.ts (NSE ETF
 * Underlying resolution) and bseFundRegistry.ts (BSE fund name-embedding
 * resolution). Cached 5 minutes (matches bseIndexLongTail.ts's own TTL for
 * the same underlying table — new BSE indices arrive via a daily cron, not
 * intraday, so this is generous headroom, not a staleness risk). Never
 * throws: a failed query on either table degrades to an empty list for that
 * side, same "stale-serve on failure, empty universe on total absence never
 * blocks the caller" discipline as this module's sibling caches.
 */
export async function fetchAllIndexNames(): Promise<string[]> {
  const now = Date.now();
  if (allIndexNamesCache && now - allIndexNamesCache.at < ALL_INDEX_NAMES_TTL_MS) return allIndexNamesCache.names;

  const [nseRows, bseRows] = await Promise.all([
    prisma.indexEodQuote.findMany({ distinct: ["indexName"], select: { indexName: true } }).catch((err) => {
      console.error("[indexNameResolver] IndexEodQuote name lookup failed:", err);
      return [] as { indexName: string }[];
    }),
    prisma.bseIndexEodQuote.findMany({ distinct: ["indexName"], select: { indexName: true } }).catch((err) => {
      console.error("[indexNameResolver] BseIndexEodQuote name lookup failed:", err);
      return [] as { indexName: string }[];
    }),
  ]);

  const names = [...nseRows.map((r) => r.indexName), ...bseRows.map((r) => r.indexName)];
  allIndexNamesCache = { at: now, names };
  return names;
}
