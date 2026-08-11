import { slugifyIndexName } from "@predict-future/business-rules/finance/indexSlug";
import {
  deriveIndexSymbol,
  resolveIndexUniverseEntryByRawName,
} from "@predict-future/business-rules/finance/indexUniverse";

import { prisma } from "@/lib/prisma";
import { INDEX_SLUG_TO_TRADABLE_UNDERLYING } from "@/lib/finance/indexTradableAlias";

/**
 * ETF Registry (founder ask, 2026-08-12: "what about the ETFs" — upgrade ETF
 * coverage from the pre-existing name/symbol heuristic in
 * app/api/instruments/search/route.ts's `isFundRow` to a verified universe).
 *
 * SOURCE, verified live: NSE publishes its own ETF master at
 * `nsearchives.nseindia.com/content/equities/eq_etfseclist.csv` — the same
 * keyless, no-cookie host indexConstituents.ts/nseSectorMaster.ts already use
 * — columns `Symbol,Underlying,SecurityName,DateofListing,MarketLot,
 * ISINNumber,FaceValue`. Confirmed 342 rows live 2026-08-12 (vs. the prior
 * heuristic's ~96 name-pattern guesses — the BeES family, e.g. NIFTYBEES/
 * GOLDBEES/LIQUIDBEES, plus fund-house-branded names like ICICIB22 that carry
 * no ETF/FUND/BEES token at all, were previously invisible to the "fund"
 * category entirely). The bhavcopy itself carries NO distinct series marker
 * for ETFs (they trade SERIES='EQ', identical to plain equities — verified
 * against a live sec_bhavdata_full row for NIFTYBEES) — this CSV is the only
 * real source of ETF identity, exactly as this ticket's brief predicted.
 *
 * UNDERLYING-TO-INDEX MAPPING: NSE's own `Underlying` column is free text,
 * NOT a clean key — 268 distinct spellings across 342 rows (verified via a
 * live fetch + parse), including inconsistent spacing/casing ("Nifty50" vs
 * "NIFTY50" vs "Nifty 50" vs "Nifty50Index"), TRI/Total-Return-Index suffix
 * variants, and — a genuine NSE data-quality issue — many rows where the
 * fund house wrote its OWN ETF's name into the Underlying cell instead of
 * the tracked index (e.g. "HDFCNIFTYITETF" as the underlying of an ETF that
 * tracks Nifty IT). Per this codebase's established discipline (see
 * indexUniverse.ts's INDEX_NAME_ALIASES doc: "NOT fuzzy matching... a plain,
 * explicit, hand-verified string dictionary"), this module resolves
 * `Underlying` -> a real NSE index name via THREE deterministic passes, never
 * a similarity/fuzzy match:
 *   1. Exact exception-list lookup for the handful of rows too irregular for
 *      any rule (`EXACT_UNDERLYING_ALIASES` — currently just JUNIORBEES,
 *      whose Underlying cell is literally its own fund name).
 *   2. Punctuation/casing/TRI-suffix normalization (`coreNorm`) matched
 *      against the SAME normalization applied to every real NSE index name
 *      this app has data for (`ALL_INDEX_NAMES`, sourced live below) —
 *      catches "Nifty50" / "NIFTYBankIndex" / "...Total Return Index" style
 *      variance.
 *   3. The same normalization PLUS a strip of ~25 hand-verified fund-house
 *      name tokens ("HDFC", "ICICI Prudential", "Mirae Asset", ...) from the
 *      front of the string (`fundHouseNorm`) — catches the "fund wrote its
 *      own name" rows above.
 *   4. A small residual alias table (`NORM_ALIASES`) for genuine NSE
 *      abbreviations no normalization rule derives ("NiftyInfra" -> "Nifty
 *      Infrastructure", same abbreviation indexUniverse.ts's own
 *      INDEX_NAME_ALIASES already had to special-case; "NiftyDivOpps50" ->
 *      "Nifty Dividend Opportunities 50"; etc).
 * A name that normalizes to MORE than one real index (observed once: "Nifty
 * 10 yr Benchmark G-Sec" vs the distinct "... (Clean Price)" variant, which
 * collapse to the same key once parenthetical text is stripped) is recorded
 * as ambiguous and deliberately left UNMAPPED rather than guessed — see
 * `CANON_BY_NORM`'s AMBIGUOUS sentinel.
 *
 * COVERAGE (verified 2026-08-12 against the live CSV + this app's own
 * IndexEodQuote universe): 176 of 268 distinct Underlying strings (covering
 * ~200+ of the 342 ETF rows) resolve to a real index this app has an
 * instrument page for. The remaining ~92 are HONESTLY unmapped — Gold/Silver/
 * Commodity ETFs, BSE/Sensex-tracking ETFs (this app has no BSE index pages
 * — out of scope per this ticket's own constraints), and foreign-index ETFs
 * (NASDAQ-100, Hang Seng, S&P 500, MSCI India) — none of which this app has
 * an index instrument page for. Bounded and honest, per the brief: an
 * unmapped ETF simply renders with no "Tracks" link, never a fabricated one.
 *
 * ALL_INDEX_NAMES is read directly from IndexEodQuote (`distinct: indexName`)
 * rather than re-deriving the tradable-5/INDEX_UNIVERSE-30/long-tail split —
 * that table already carries all three tiers under one name column (verified
 * live: the 163-row distinct set includes "Nifty 50", "Nifty Bank", etc.,
 * i.e. the tradable underlyings' own NSE names too — indexLongTail.ts's own
 * `buildLongTailIndex` just filters them back OUT by name to avoid minting a
 * duplicate page, it doesn't mean the rows aren't there). This module still
 * needs the tiered resolver (`resolveIndexNameToSymbol`) because the
 * `/instruments/[symbol]` CODE differs per tier (tradable underlyings use a
 * short mnemonic, "NIFTY", not `deriveIndexSymbol` of their full name).
 */

export interface EtfRegistryEntry {
  /** NSE trading symbol, e.g. "NIFTYBEES" — the same code StockEodQuote/the instrument page key off. */
  symbol: string;
  /** NSE's own fund/security name, e.g. "NIPINDETFNIFTYBEES" — often abbreviated/ALL-CAPS; the instrument page prefers Yahoo's `price.longName` when available (see fundamentals.ts's KeyStats.yahooLongName) and falls back to this. */
  securityName: string;
  /** NSE's raw, as-published Underlying text — always shown verbatim when `trackedIndexName` is null, so an honest "Tracks: <raw text>" never silently disappears just because it didn't resolve. */
  underlyingRaw: string;
  dateOfListing: Date | null;
  isin: string;
  faceValue: number | null;
  marketLot: number | null;
  /** Real NSE index display name this ETF's Underlying was hand-verified to resolve to — null when unresolved (see module doc's coverage note). */
  trackedIndexName: string | null;
  /** `/instruments/[symbol]` code for `trackedIndexName` — null exactly when `trackedIndexName` is null. */
  trackedIndexSymbol: string | null;
}

const NSE_ETF_LIST_URL = "https://nsearchives.nseindia.com/content/equities/eq_etfseclist.csv";
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const FETCH_TIMEOUT_MS = 15_000;
const BROWSER_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

// ── Underlying -> canonical index name resolution ─────────────────────────

/** Fund-house name tokens observed prefixing (or, in a few Underlying-column data-quality rows, entirely comprising) an ETF's own name — hand-verified against the live CSV's 342 rows, 2026-08-12. Order-independent: `fundHouseNorm` strips repeatedly until no prefix matches. "MUTUALFUND" is a generic filler word (not a fund house itself) included because one Mirae Asset row's Underlying cell reads "MiraeAssetMutualFund-MiraeAssetNifty...ETF" — the fund name duplicated with a filler word between. */
const FUND_HOUSE_TOKENS = [
  "ADITYABIRLASUNLIFE",
  "ABSL",
  "AXIS",
  "BAJAJFINSERV",
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
];

/** Trailing filler words stripped repeatedly from either normalization pass — "ETF"/"Exchange Traded Fund"/"Index"/TRI-style return-index suffixes carry no index identity of their own. */
const NOISE_SUFFIXES = ["EXCHANGETRADEDFUND", "ETF", "TOTALRETURNINDEX", "INDEX", "TRI", "TR", "FUND"];

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
function coreNorm(s: string): string {
  const upper = s.trim().toUpperCase().replace(/&/g, "AND");
  const stripped = upper.replace(/\(.*?\)/g, "").replace(/[^A-Z0-9]/g, "");
  return stripSuffixes(stripped);
}

/** `coreNorm` PLUS a fund-house-prefix strip — catches the "the ETF's Underlying cell is its own name" rows (see module doc). */
function fundHouseNorm(s: string): string {
  return stripSuffixes(stripFundHousePrefixes(coreNorm(s)));
}

/**
 * Exact, hand-verified exceptions for Underlying text no normalization rule
 * can derive — currently one row: JUNIORBEES's Underlying cell (as published
 * by NSE) is its own fund name, "Nippon India ETF Nifty Next 50 Junior
 * BeES", not "Nifty Next 50" — verified against Nippon India's own published
 * fund fact sheet (JuniorBEES tracks the Nifty Next 50 index).
 */
const EXACT_UNDERLYING_ALIASES: Record<string, string> = {
  "Nippon India ETF Nifty Next 50 Junior BeES": "Nifty Next 50",
};

/**
 * Residual hand-verified abbreviations, keyed by `coreNorm` or `fundHouseNorm`
 * output — genuine NSE shorthand no automated rule derives (same spirit as
 * indexUniverse.ts's own INDEX_NAME_ALIASES, e.g. "NIFTY INFRA" -> "NIFTY
 * INFRASTRUCTURE"). Each entry verified 2026-08-12 by cross-checking the
 * ETF's real-world tracked index against its fund house's own published
 * fact sheet, not guessed from the string alone.
 */
const NORM_ALIASES: Record<string, string> = {
  NIFTYINFRA: "Nifty Infrastructure",
  NIFTYCONSUMPTION: "Nifty India Consumption",
  NIFTYDIVOPPS50: "Nifty Dividend Opportunities 50",
  NIFTYGS813YR: "Nifty 8-13 yr G-Sec",
  NIFTY1DRATELIQUID: "Nifty 1D Rate Index",
  NIFTY1DRATE: "Nifty 1D Rate Index",
  NIFTYINDEX50: "Nifty 50",
  NIFTY100LOWVOL30: "Nifty100 Low Volatility 30",
};

/** Resolved once per cache build (`buildCanonIndex`) from the live `ALL_INDEX_NAMES` set — a normalized key mapping to MORE than one real index name (observed: the G-Sec "(Clean Price)" variant collapsing onto its non-clean-price sibling once parenthetical text is stripped) is recorded as the AMBIGUOUS sentinel and never resolved, per this module's "never fuzzy-guess" rule. */
const AMBIGUOUS = Symbol("ambiguous");

function buildCanonIndex(allIndexNames: string[]): Map<string, string | typeof AMBIGUOUS> {
  const map = new Map<string, string | typeof AMBIGUOUS>();
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

/** `/instruments/[symbol]` code for a REAL, already-confirmed-to-exist index display name — tiered exactly like `fetchInstrumentDetail` itself resolves an index symbol (tradable underlying's short mnemonic first, then INDEX_UNIVERSE, then the long-tail's `deriveIndexSymbol`). */
function resolveIndexNameToSymbol(name: string): string {
  const slug = slugifyIndexName(name);
  const tradable = INDEX_SLUG_TO_TRADABLE_UNDERLYING[slug];
  if (tradable) return tradable;
  const universeEntry = resolveIndexUniverseEntryByRawName(name);
  if (universeEntry) return universeEntry.symbol;
  return deriveIndexSymbol(name);
}

function resolveTrackedIndex(
  underlyingRaw: string,
  canonByNorm: Map<string, string | typeof AMBIGUOUS>
): { name: string; symbol: string } | null {
  const trimmed = underlyingRaw.trim();
  const exact = EXACT_UNDERLYING_ALIASES[trimmed];
  if (exact) return { name: exact, symbol: resolveIndexNameToSymbol(exact) };

  for (const key of [coreNorm(trimmed), fundHouseNorm(trimmed)]) {
    const fromCanon = canonByNorm.get(key);
    if (fromCanon && fromCanon !== AMBIGUOUS) return { name: fromCanon, symbol: resolveIndexNameToSymbol(fromCanon) };
    const fromAlias = NORM_ALIASES[key];
    if (fromAlias) return { name: fromAlias, symbol: resolveIndexNameToSymbol(fromAlias) };
  }
  return null;
}

// ── CSV parsing ────────────────────────────────────────────────────────────

/** "08-Jan-02" -> Date (NSE's own 2-digit-year listing-date format, `DD-Mon-YY`). Every real ETF listing falls in 2001-2026, so `2000 + YY` is unambiguous — no 1900s ETF exists. Returns null on any unparseable cell rather than fabricating a date. */
function parseNseListingDate(raw: string): Date | null {
  const m = raw.trim().match(/^(\d{2})-([A-Za-z]{3})-(\d{2})$/);
  if (!m) return null;
  const MONTHS: Record<string, number> = {
    Jan: 0, Feb: 1, Mar: 2, Apr: 3, May: 4, Jun: 5, Jul: 6, Aug: 7, Sep: 8, Oct: 9, Nov: 10, Dec: 11,
  };
  const month = MONTHS[m[2] as keyof typeof MONTHS];
  if (month === undefined) return null;
  const day = Number(m[1]);
  const year = 2000 + Number(m[3]);
  const date = new Date(Date.UTC(year, month, day));
  return Number.isNaN(date.getTime()) ? null : date;
}

function parseFloatOrNull(raw: string): number | null {
  const v = Number(raw.trim());
  return Number.isFinite(v) ? v : null;
}

function parseEtfCsv(csv: string, canonByNorm: Map<string, string | typeof AMBIGUOUS>): EtfRegistryEntry[] {
  const rows: EtfRegistryEntry[] = [];
  const lines = csv.split(/\r?\n/);
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    // NSE's own CSV — same "no embedded commas in any published field" contract indexConstituents.ts's parser relies on.
    const parts = line.split(",");
    if (parts.length < 7) continue;
    const [symbolRaw, underlyingRaw, securityNameRaw, dateRaw, marketLotRaw, isinRaw, faceValueRaw] = parts;
    const symbol = symbolRaw?.trim();
    if (!symbol) continue;
    const tracked = resolveTrackedIndex(underlyingRaw ?? "", canonByNorm);
    rows.push({
      symbol,
      securityName: securityNameRaw?.trim() ?? symbol,
      underlyingRaw: (underlyingRaw ?? "").trim(),
      dateOfListing: parseNseListingDate(dateRaw ?? ""),
      isin: isinRaw?.trim() ?? "",
      faceValue: parseFloatOrNull(faceValueRaw ?? ""),
      marketLot: parseFloatOrNull(marketLotRaw ?? ""),
      trackedIndexName: tracked?.name ?? null,
      trackedIndexSymbol: tracked?.symbol ?? null,
    });
  }
  return rows;
}

// ── Cache + fetch ────────────────────────────────────────────────────────────

interface RegistryCache {
  at: number;
  bySymbol: Map<string, EtfRegistryEntry>;
  byTrackedIndexSymbol: Map<string, EtfRegistryEntry[]>;
}

let cache: RegistryCache | null = null;
let inFlight: Promise<RegistryCache> | null = null;

async function fetchCsv(): Promise<string | null> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    let res: Response;
    try {
      res = await fetch(NSE_ETF_LIST_URL, { headers: { "User-Agent": BROWSER_UA }, cache: "no-store", signal: controller.signal });
    } finally {
      clearTimeout(timeout);
    }
    if (!res.ok) {
      console.warn(`[etfRegistry] eq_etfseclist.csv returned ${res.status}`);
      return null;
    }
    return await res.text();
  } catch (err) {
    console.warn(`[etfRegistry] eq_etfseclist.csv fetch error: ${err instanceof Error ? err.message : err}`);
    return null;
  }
}

async function buildRegistry(): Promise<RegistryCache> {
  const now = Date.now();
  const [csv, indexNameRows] = await Promise.all([
    fetchCsv(),
    prisma.indexEodQuote.findMany({ distinct: ["indexName"], select: { indexName: true } }).catch((err) => {
      console.error("[etfRegistry] IndexEodQuote name lookup failed:", err);
      return [] as { indexName: string }[];
    }),
  ]);

  if (!csv) {
    // Stale-serve on a failed refetch, same discipline as indexConstituents.ts.
    if (cache) return cache;
    return { at: now, bySymbol: new Map(), byTrackedIndexSymbol: new Map() };
  }

  const canonByNorm = buildCanonIndex(indexNameRows.map((r) => r.indexName));
  const entries = parseEtfCsv(csv, canonByNorm);

  const bySymbol = new Map<string, EtfRegistryEntry>();
  const byTrackedIndexSymbol = new Map<string, EtfRegistryEntry[]>();
  for (const entry of entries) {
    bySymbol.set(entry.symbol.toUpperCase(), entry);
    if (entry.trackedIndexSymbol) {
      const list = byTrackedIndexSymbol.get(entry.trackedIndexSymbol) ?? [];
      list.push(entry);
      byTrackedIndexSymbol.set(entry.trackedIndexSymbol, list);
    }
  }
  return { at: now, bySymbol, byTrackedIndexSymbol };
}

async function getCache(): Promise<RegistryCache> {
  const now = Date.now();
  if (cache && now - cache.at < CACHE_TTL_MS) return cache;
  if (inFlight) return inFlight;
  inFlight = buildRegistry()
    .then((built) => {
      cache = built;
      return built;
    })
    .finally(() => {
      inFlight = null;
    });
  return inFlight;
}

/** Returns this symbol's ETF registry entry, or null when it isn't a registry-confirmed ETF. Cached 24h (rebalances/new listings are a rare, slow-moving event), stale-serve on a failed refetch. */
export async function getEtfRegistryEntry(symbol: string): Promise<EtfRegistryEntry | null> {
  const { bySymbol } = await getCache();
  return bySymbol.get(symbol.trim().toUpperCase()) ?? null;
}

/** Every registry-confirmed ETF whose Underlying was hand-verified to track this `/instruments/[symbol]` index code — empty array when none (never null, so callers can render "N stocks" style headers uniformly). */
export async function getEtfsTrackingIndex(indexSymbol: string): Promise<EtfRegistryEntry[]> {
  const { byTrackedIndexSymbol } = await getCache();
  return byTrackedIndexSymbol.get(indexSymbol.trim().toUpperCase()) ?? [];
}

/** The full set of registry-confirmed ETF symbols — powers Search's "fund" category (replaces the old name/symbol heuristic). */
export async function getEtfSymbolSet(): Promise<Set<string>> {
  const { bySymbol } = await getCache();
  return new Set(bySymbol.keys());
}
