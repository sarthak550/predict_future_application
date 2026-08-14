import { fetchAmfiIsinMap, cleanAmfiName } from "@/lib/finance/amfi";
import {
  coreNorm,
  fundHouseNorm,
  buildCanonIndex,
  resolveIndexNameToSymbol,
  fetchAllIndexNames,
  NORM_ALIASES,
  AMBIGUOUS,
  type CanonIndex,
} from "@/lib/finance/indexNameResolver";

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
 *
 * AMFI DISPLAY-NAME JOIN (2026-08-12 addendum, founder ask: fund search
 * results show ugly abbreviated names, e.g. "BIRLASLAMC - ABGSEC" — upgrade
 * every ETF display name to its REAL full name via an exact-ISIN join
 * against AMFI's public scheme master). NSE's own `SecurityName` column is
 * an internal abbreviation, barely better than the raw ticker. AMFI
 * publishes every registered scheme's real name at
 * `portal.amfiindia.com/spages/NAVAll.txt` (semicolon-delimited,
 * `SchemeCode;ISIN Div Payout/Growth;ISIN Div Reinvestment;SchemeName;NAV;
 * Date`, with bare section-header lines interspersed — parsed defensively:
 * exactly 6 `;`-fields AND a numeric scheme code, or the line is skipped).
 * `parseAmfiIsinMap` builds an ISIN -> scheme-name map from BOTH ISIN
 * columns (either can be "-"), and `parseEtfCsv` exact-joins it against each
 * ETF's own `ISINNumber` from NSE's eq_etfseclist.csv. Verified live
 * 2026-08-12 against the full ~14.2k-row AMFI file and all 342 ETF ISINs:
 * 339/342 resolve (99.1%) — the 3 misses (HDFCNIMEG, MOOILGAS, MOMETAL,
 * apparently not AMFI-registered under this ISIN) are left on
 * `securityName`, never guessed. `cleanAmfiName` strips a trailing
 * plan-only suffix ("- Growth" / "- Growth Option" / "GROWTH", any
 * casing/spacing — end-anchored regex, 33 of the 339 matches carry one) that
 * AMFI's NAV-file convention appends but the exchange-listed unit doesn't
 * carry; an IDCW suffix is NEVER stripped — several liquid/overnight ETFs
 * (e.g. "Aditya Birla Sun Life CRISIL Liquid Overnight ETF - IDCW Daily
 * Reinvestment with Weekly Payout") are IDCW-only funds where that suffix
 * IS the real name, not plan noise. `displayName` = this cleaned AMFI name,
 * falling back to `securityName` for the 3 misses.
 *
 * AMFI-vs-Yahoo-longName quality check (used by instrument.ts's
 * `companyName` resolution): the only 3 ETFs with a cached Yahoo `longName`
 * available locally 2026-08-12 (NIFTYBEES/BANKBEES/GOLDBEES) matched AMFI's
 * name byte-for-byte. Given equal quality, AMFI wins outright — 99.1%
 * instant coverage from this same fetch vs. Yahoo's crumb-gated call this
 * app only caches for ~1.5% of instruments locally (see fundamentals.ts's
 * KeyStats.yahooLongName doc). Yahoo's longName is kept ONLY as the
 * fallback for the ~1% AMFI doesn't resolve.
 */

export interface EtfRegistryEntry {
  /** NSE trading symbol, e.g. "NIFTYBEES" — the same code StockEodQuote/the instrument page key off. */
  symbol: string;
  /** NSE's own fund/security name, e.g. "NIPINDETFNIFTYBEES" — often abbreviated/ALL-CAPS. Superseded as the default display name by `displayName` below (AMFI addendum, 2026-08-12); kept as the honest final fallback for the ~1% AMFI doesn't resolve. */
  securityName: string;
  /** Best available REAL fund name — AMFI's own scheme-master name (exact ISIN join against the daily NAVAll.txt, mechanical plan-suffix trim applied) when resolved, else this entry's own `securityName`. This is what `getEtfNameMap`/`searchEtfRegistryByName` and every search/list surface show — see module doc's 2026-08-12 AMFI-join addendum. Equal to `securityName` exactly when AMFI didn't resolve (the signal instrument.ts's companyName resolution uses to still consider Yahoo's longName). */
  displayName: string;
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
// coreNorm/fundHouseNorm/buildCanonIndex/NORM_ALIASES/resolveIndexNameToSymbol
// moved to lib/finance/indexNameResolver.ts (2026-08-14, BSE Phase 3B task 1)
// — shared with bseFundRegistry.ts. See that module's own doc for what
// changed functionally (BSE names merged into the canon + the new "S&P"
// co-branding token).

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

function resolveTrackedIndex(
  underlyingRaw: string,
  canonByNorm: CanonIndex
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

function parseEtfCsv(
  csv: string,
  canonByNorm: CanonIndex,
  amfiIsinMap: Map<string, string>
): EtfRegistryEntry[] {
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
    const securityName = securityNameRaw?.trim() ?? symbol;
    const isin = isinRaw?.trim() ?? "";
    const amfiName = isin ? amfiIsinMap.get(isin.toUpperCase()) : undefined;
    rows.push({
      symbol,
      securityName,
      displayName: amfiName ? cleanAmfiName(amfiName) : securityName,
      underlyingRaw: (underlyingRaw ?? "").trim(),
      dateOfListing: parseNseListingDate(dateRaw ?? ""),
      isin,
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
  const [csv, allIndexNames, amfiIsinMap] = await Promise.all([
    fetchCsv(),
    // BSE Phase 3B (2026-08-14) — merges in BSE's own index names too, see
    // indexNameResolver.ts's own module doc for what this changes.
    fetchAllIndexNames(),
    fetchAmfiIsinMap(),
  ]);

  if (!csv) {
    // Stale-serve on a failed refetch, same discipline as indexConstituents.ts.
    if (cache) return cache;
    return { at: now, bySymbol: new Map(), byTrackedIndexSymbol: new Map() };
  }

  const canonByNorm = buildCanonIndex(allIndexNames);
  const entries = parseEtfCsv(csv, canonByNorm, amfiIsinMap ?? new Map());

  // AMFI join hit-rate — reported honestly every build, per this ticket's
  // brief ("report the join hit-rate ... report misses honestly").
  if (amfiIsinMap) {
    const matched = entries.filter((e) => e.isin && amfiIsinMap.has(e.isin.toUpperCase())).length;
    const pct = entries.length > 0 ? ((matched / entries.length) * 100).toFixed(1) : "0.0";
    console.info(`[etfRegistry] AMFI display-name join: ${matched}/${entries.length} ETFs (${pct}%) resolved a real fund name`);
  } else {
    console.warn("[etfRegistry] AMFI NAVAll.txt unavailable this build — displayName falls back to NSE securityName for every ETF.");
  }

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

/**
 * Founder 2026-08-12: "funds do not have their original names, only ticker
 * names — make them searchable using their names." StockEodQuote's
 * companyName for an ETF is just the ticker duplicated (bhavcopy carries no
 * real fund name), so name queries can never match through the equity
 * fuzzy path. This searches the registry's OWN displayName/securityName/
 * underlying ("Aditya Birla Sun Life Nifty 50 ETF", "NIFTY 50") so real-name,
 * fund-house-name (the AMFI name naturally contains the fund house, e.g.
 * "aditya birla" now matches without any separate normalization table), and
 * underlying-name queries surface funds.
 */
export async function searchEtfRegistryByName(q: string, limit = 12): Promise<EtfRegistryEntry[]> {
  const needle = q.trim().toUpperCase();
  if (!needle) return [];
  const { bySymbol } = await getCache();
  const hits: EtfRegistryEntry[] = [];
  for (const entry of bySymbol.values()) {
    if (
      entry.displayName.toUpperCase().includes(needle) ||
      entry.securityName.toUpperCase().includes(needle) ||
      entry.underlyingRaw.toUpperCase().includes(needle) ||
      (entry.trackedIndexName ?? "").toUpperCase().includes(needle) ||
      entry.symbol.toUpperCase().includes(needle)
    ) {
      hits.push(entry);
      if (hits.length >= limit) break;
    }
  }
  return hits;
}

/** symbol -> best-available real fund name (registry `displayName` — AMFI's scheme-master name when resolved, else `securityName`), for labeling fund results wherever StockEodQuote's ticker-as-name would otherwise show. */
export async function getEtfNameMap(): Promise<Map<string, string>> {
  const { bySymbol } = await getCache();
  return new Map([...bySymbol.values()].map((e) => [e.symbol, e.displayName]));
}
