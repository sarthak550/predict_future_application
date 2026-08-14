/**
 * BSE Expansion Phase 3B (2026-08-14) — BSE-EXCLUSIVE funds/ETFs. Founder
 * addendum: "Phase 3 MUST also ship funds... linked with indices like we did
 * for NSE." Sibling of lib/finance/etfRegistry.ts (the NSE ETF registry),
 * but built very differently — see below.
 *
 * ── WHY THIS ISN'T "read BSE's own fund series" (live-verified 2026-08-14,
 * corrects this program's own original assumption) ─────────────────────────
 *
 * The BSE Phase 3A brief and this program's own initial plan assumed BSE's
 * UDiFF bhavcopy's `SctySrs` E/F values are a fund/ETF marker (bseBhavcopy.ts
 * originally excluded them on exactly that assumption). A live full-file
 * scan (2026-08-14) disproves this as a classification rule:
 *   - `E` carries physical-commodity ETFs (Gold/Silver) — but EVERY one
 *     found (GOLDBEES, GOLDIETF, SILVERADD, GOLDADD, QGOLDHALF, ...) is
 *     dual-listed on NSE with a matching ISIN, so the EXISTING dual-listing
 *     dedup in bseBhavcopy.ts already excludes all of them from BseEodQuote
 *     — zero E-series survivors, fund or otherwise.
 *   - `F` is overwhelmingly corporate NCDs/bonds/InvIT units (361 of 368
 *     rows on the verification day — "PFC-7.52%-...-BOND", "REC-...-NCD",
 *     "NHAI-...-TAXFREENCD") plus a handful of mutual-fund "segregated
 *     portfolio" wind-down units (side-pocketed units created after a bond
 *     default, not a normal purchasable fund) — zero genuine ETFs survive
 *     dedup under F either.
 *   - Meanwhile the BULK of real BSE-listed ETFs (Nippon India *BEES, ICICI
 *     Prudential *IETF, DSP *ADD, SBI/Kotak/Bandhan Sensex ETFs, ...) trade
 *     under `SctySrs` `B` — the SAME series BseEodQuote's existing
 *     EQUITY_SERIES already ingests, indistinguishable from a plain stock by
 *     series alone.
 *
 * There is therefore NO usable SctySrs-based fund/ETF marker in BSE's own
 * file, unlike NSE's separate eq_etfseclist.csv master. Per this program's
 * own documented fallback ("if BSE publishes no usable fund master, fall
 * back to AMFI-ISIN-presence as the fund signal — decide by evidence"):
 *
 * ── THE SIGNAL USED: AMFI ISIN presence, over the EXISTING BseEodQuote rows
 * (no ingestion/schema change) ───────────────────────────────────────────
 *
 * Every BseEodQuote row (already written by bseBhavcopy.ts's unchanged
 * EQUITY_SERIES ingestion) whose `isin` matches AMFI's registered scheme
 * master (NAVAll.txt, the SAME shared join etfRegistry.ts uses — see
 * amfi.ts) is a real, registered fund unit -> classified as a fund here.
 * This is a pure PRESENTATION-layer computation: no new table, no new cron,
 * no change to what bseBhavcopy.ts ingests. Verified live 2026-08-14: 27
 * BseEodQuote rows match an AMFI ISIN, of which 7 are genuine BSE-only
 * SENSEX/BSE-index-tracking ETFs (SENSEX1/Kotak, SBISENSEX/SBI, SENSEXBEES/
 * Nippon India, SETFBSE100/SBI BSE 100, IDFSENSEXE/Bandhan, SETFSN50/SBI
 * Sensex Next 50, SNXT50BEES/Nippon India Sensex Next 50 — every one of
 * these was ALREADY sitting in BseEodQuote today as a mislabeled plain
 * "BSE equity" page before this module existed) and 20 are mutual-fund
 * "segregated portfolio" wind-down units (AMFI name literally contains
 * "SEGREGATED PORTFOLIO"). The latter are kept as funds too rather than
 * special-cased out — they genuinely ARE AMFI-registered fund units, just a
 * niche instrument type; their AMFI display name ("Nippon India Aggressive
 * Hybrid Fund - Segregated Portfolio 2 - Growth Plan") self-explains what
 * they are, and `trackedIndex` correctly resolves to null for them (no
 * fabricated link) rather than needing a bespoke exclusion rule.
 *
 * ── "TRACKS" RESOLUTION — DIFFERENT ALGORITHM from etfRegistry.ts, honestly
 * weaker guarantee (BSE's bhavcopy has no Underlying-style column at all) ──
 *
 * NSE's eq_etfseclist.csv carries an explicit `Underlying` column,
 * exact-matched against a real index name (see etfRegistry.ts). BSE's UDiFF
 * bhavcopy has NO equivalent field for cash-market rows. The only signal
 * available is the fund's OWN name (BSE's `FinInstrmNm`, upgraded to AMFI's
 * real scheme name when the join resolves) — which for an index-tracking
 * ETF typically EMBEDS the tracked index's full name somewhere in the
 * string (e.g. "SBI BSE SENSEX ETF", "Nippon India ETF BSE Sensex Next 50").
 * `resolveTrackedIndexByEmbedding` therefore does a LONGEST-match-wins
 * containment check: does any real index's `coreNorm` key (NSE + BSE
 * merged, from indexNameResolver.ts — the SAME canon etfRegistry.ts now
 * uses) appear as a normalized substring of the fund's own
 * `fundHouseNorm`'d name? Longest-candidate-first prevents a short index
 * name ("BSE 100") from shadowing a longer one that's also a substring match
 * ("BSE 1000") when both are real. A minimum key length
 * (`MIN_EMBEDDED_INDEX_KEY_LEN`) guards against a trivially short/generic
 * match. This is a WEAKER guarantee than etfRegistry's exact-Underlying-
 * column match — documented honestly, not presented as equally certain —
 * but verified live 2026-08-14 to correctly resolve all 7 genuine BSE-only
 * ETFs above to their real tracked index (SENSEX ×5, BSE 100 ×1, BSE Sensex
 * Next 50 ×1), zero false positives observed among the 20 segregated-
 * portfolio rows (none contain any index-name substring, correctly resolve
 * to null).
 */

import { prisma } from "@/lib/prisma";
import { fetchAmfiIsinMap, cleanAmfiName } from "@/lib/finance/amfi";
import { coreNorm, fundHouseNorm, fetchAllIndexNames, resolveIndexNameToSymbol } from "@/lib/finance/indexNameResolver";
import { bseEquityPageSymbol } from "@/lib/finance/bseEquity";

export interface BseFundRegistryEntry {
  /** `/instruments/[symbol]` page code — `${tickerSymbol}.BO`, same namespace bseEquity.ts's plain BSE-only equities use. */
  symbol: string;
  /** Bare BSE ticker (no ".BO" suffix) — BseEodQuote.tickerSymbol's own value. */
  tickerSymbol: string;
  scripCode: string;
  isin: string;
  /** BSE's own FinInstrmNm, as stored in BseEodQuote.companyName. */
  companyName: string;
  /** Best-available real fund name — AMFI's scheme-master name (exact ISIN join, mechanical plan-suffix trim) when resolved, else `companyName`. Mirrors EtfRegistryEntry.displayName's role. */
  displayName: string;
  /** BSE's own SctySrs for this row ("B" for every genuine ETF found live; "F" for the segregated-portfolio wind-down units) — kept for transparency, never filtered on (see module doc: series is NOT the fund signal here). */
  securityGroup: string;
  /** Real NSE-or-BSE index display name this fund's own name was found to embed — null when unresolved (see module doc's honesty note on this weaker match). */
  trackedIndexName: string | null;
  /** `/instruments/[symbol]` code for `trackedIndexName` — null exactly when `trackedIndexName` is null. */
  trackedIndexSymbol: string | null;
}

/** Below this normalized length, a containment match is too generic to trust (e.g. a bare "50" or "TR" embedded incidentally) — hand-tuned against the live 2026-08-14 verification set, where the shortest genuine match was "BSE100" (6 chars). */
const MIN_EMBEDDED_INDEX_KEY_LEN = 6;

function resolveTrackedIndexByEmbedding(
  fundName: string,
  allIndexNames: string[]
): { name: string; symbol: string } | null {
  const hay = fundHouseNorm(fundName);
  const candidates = allIndexNames
    .map((name) => ({ name, key: coreNorm(name) }))
    .filter((c) => c.key.length >= MIN_EMBEDDED_INDEX_KEY_LEN)
    .sort((a, b) => b.key.length - a.key.length); // longest first — see module doc
  for (const c of candidates) {
    if (hay.includes(c.key)) return { name: c.name, symbol: resolveIndexNameToSymbol(c.name) };
  }
  return null;
}

interface RegistryCache {
  at: number;
  bySymbol: Map<string, BseFundRegistryEntry>;
  byTrackedIndexSymbol: Map<string, BseFundRegistryEntry[]>;
}

const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
let cache: RegistryCache | null = null;
let inFlight: Promise<RegistryCache> | null = null;

async function buildRegistry(): Promise<RegistryCache> {
  const now = Date.now();
  const empty: RegistryCache = { at: now, bySymbol: new Map(), byTrackedIndexSymbol: new Map() };

  const latest = await prisma.bseEodQuote
    .findFirst({ orderBy: { sessionDate: "desc" }, select: { sessionDate: true } })
    .catch((err) => {
      console.error("[bseFundRegistry] latest-session lookup failed:", err);
      return null;
    });
  if (!latest) return cache ?? empty;

  const [rows, amfiIsinMap, allIndexNames] = await Promise.all([
    prisma.bseEodQuote.findMany({
      where: { sessionDate: latest.sessionDate, isin: { not: null } },
      select: { tickerSymbol: true, scripCode: true, isin: true, companyName: true, securityGroup: true },
    }),
    fetchAmfiIsinMap(),
    fetchAllIndexNames(),
  ]);

  if (!amfiIsinMap) {
    // AMFI unreachable this build — stale-serve rather than silently
    // classifying every BSE-only row as "not a fund" (would wrongly demote
    // every fund page back to plain-equity presentation for a transient
    // network failure).
    return cache ?? empty;
  }

  const bySymbol = new Map<string, BseFundRegistryEntry>();
  const byTrackedIndexSymbol = new Map<string, BseFundRegistryEntry[]>();
  let amfiMatched = 0;

  for (const row of rows) {
    const isin = (row.isin ?? "").toUpperCase();
    if (!isin) continue;
    const amfiName = amfiIsinMap.get(isin);
    if (!amfiName) continue; // not a registered fund unit — a plain BSE-only equity, handled by bseEquity.ts as today
    amfiMatched++;

    const displayName = cleanAmfiName(amfiName);
    const tracked = resolveTrackedIndexByEmbedding(displayName, allIndexNames);
    const entry: BseFundRegistryEntry = {
      symbol: bseEquityPageSymbol(row.tickerSymbol),
      tickerSymbol: row.tickerSymbol,
      scripCode: row.scripCode,
      isin,
      companyName: row.companyName,
      displayName,
      securityGroup: row.securityGroup,
      trackedIndexName: tracked?.name ?? null,
      trackedIndexSymbol: tracked?.symbol ?? null,
    };
    bySymbol.set(row.tickerSymbol.toUpperCase(), entry);
    if (entry.trackedIndexSymbol) {
      const list = byTrackedIndexSymbol.get(entry.trackedIndexSymbol) ?? [];
      list.push(entry);
      byTrackedIndexSymbol.set(entry.trackedIndexSymbol, list);
    }
  }

  console.info(`[bseFundRegistry] ${amfiMatched}/${rows.length} BSE-only rows with an ISIN matched an AMFI scheme -> classified as funds`);
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

/** Returns this BARE BSE ticker's fund registry entry, or null when it isn't a registry-confirmed BSE-only fund (either a plain BSE-only equity, or dual-listed/not BSE-only at all). Cached 24h. */
export async function getBseFundRegistryEntry(tickerSymbol: string): Promise<BseFundRegistryEntry | null> {
  const { bySymbol } = await getCache();
  return bySymbol.get(tickerSymbol.trim().toUpperCase()) ?? null;
}

/** Every registry-confirmed BSE-only fund hand-verified (via name-embedding, see module doc) to track this `/instruments/[symbol]` index code — empty array when none. Symmetric with etfRegistry.ts's `getEtfsTrackingIndex`, merged alongside it by instrument.ts so an index page shows funds from BOTH exchanges. */
export async function getBseFundsTrackingIndex(indexSymbol: string): Promise<BseFundRegistryEntry[]> {
  const { byTrackedIndexSymbol } = await getCache();
  return byTrackedIndexSymbol.get(indexSymbol.trim().toUpperCase()) ?? [];
}

/** Every registry-confirmed BSE-only fund's PAGE symbol (`.BO`-suffixed) — powers Search's "fund" category split (a BSE-only fund must not appear as a "stock" result) and the sitemap/browse exclusion of non-fund BSE equities from fund listings. */
export async function getBseFundSymbolSet(): Promise<Set<string>> {
  const { bySymbol } = await getCache();
  return new Set([...bySymbol.values()].map((e) => e.symbol));
}

/** Name/ticker/tracked-index fuzzy search over the registry — mirrors etfRegistry.ts's `searchEtfRegistryByName`. */
export async function searchBseFundRegistryByName(q: string, limit = 12): Promise<BseFundRegistryEntry[]> {
  const needle = q.trim().toUpperCase();
  if (!needle) return [];
  const { bySymbol } = await getCache();
  const hits: BseFundRegistryEntry[] = [];
  for (const entry of bySymbol.values()) {
    if (
      entry.displayName.toUpperCase().includes(needle) ||
      entry.companyName.toUpperCase().includes(needle) ||
      (entry.trackedIndexName ?? "").toUpperCase().includes(needle) ||
      entry.tickerSymbol.toUpperCase().includes(needle)
    ) {
      hits.push(entry);
      if (hits.length >= limit) break;
    }
  }
  return hits;
}

/** PAGE symbol (`.BO`-suffixed) -> best-available real fund name, mirrors etfRegistry.ts's `getEtfNameMap`. */
export async function getBseFundNameMap(): Promise<Map<string, string>> {
  const { bySymbol } = await getCache();
  return new Map([...bySymbol.values()].map((e) => [e.symbol, e.displayName]));
}
