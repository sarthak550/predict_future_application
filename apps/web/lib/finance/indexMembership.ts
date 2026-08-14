/**
 * Index Membership — reverse of indexConstituents.ts/indexLiveWatch.ts AND
 * bseIndexConstituents.ts: "what indices is THIS stock a member of" (founder
 * ask, 2026-08-12, mirrors the ETF Layer's `EtfTrackingList` symmetry — "in
 * similar fashion like we show what funds track the indices, can we also add
 * the indices the stock is part of").
 *
 * SOURCE (NSE side): reuses `fetchIndexConstituents` (indexConstituents.ts)
 * — the SAME per-index cached fetcher the composition panels already call,
 * never a second transport. That function already layers CSV membership
 * (primary, 24h cache) with indexLiveWatch.ts's live free-float-mcap-share
 * weight overlay/gap-fill (15min cache, curl/Akamai transport) — see both
 * files' own module docs for the full sourcing story. Covers every index in
 * `ALL_INDEX_SYMBOLS_WITH_CONSTITUENTS` (~115 indices as of 2026-08-12).
 *
 * SOURCE (BSE side, BSE Index Membership Sweep 2026-08-14): reuses
 * `fetchBseIndexConstituents` (bseIndexConstituents.ts) — the SAME per-index
 * cached fetcher `IndexCompositionPanel`'s BSE branch already calls, over
 * all 133 `BSE_INDEX_CODE` names (122 return real constituent rows — the
 * other 11 are non-equity index shapes, see that file's own doc). Each row's
 * `symbol` is EXACTLY the same `/instruments/[symbol]` code the composition
 * panel already links to — bare NSE symbol for a dual-listed constituent
 * (resolved by company name against our own StockEodQuote), or a
 * `.BO`-suffixed symbol for a BSE-only constituent (resolved by exact
 * scrip-code join against BseEodQuote). A row with `symbol: null` (BSE-only
 * constituent this app can't yet link — see that file's "no dead links"
 * doc) contributes NO membership entry here: there is no known stock page to
 * attach it to. BSE's `weightPct` (from `NS_IndexWeight_SPDJ_ng`) is BSE's
 * own PUBLISHED weight, not an estimate — see `weightIsEstimate` below.
 *
 * WHY NOT A PER-REQUEST FAN-OUT: a stock page naively asking "which of the
 * ~250 covered NSE+BSE indices contain me" would mean up to ~250 fetches
 * (many of them curl subprocess + Akamai session-prime round trips, or
 * bseindices.com/bseindia.com round trips) on EVERY equity page view —
 * unacceptable. Instead this module builds ONE reverse map, module-level
 * cached for 24h (index membership changes at most quarterly, same
 * rebalance cadence both source files' own CACHE_TTL_MS already assumes),
 * and every stock page just reads a plain in-memory Map lookup.
 *
 * COLD VS WARM BUILD COST: when many index pages have already been visited
 * recently, every per-index fetch below resolves instantly from ITS OWN warm
 * in-module cache — a full reverse-map (re)build costs nothing new over what
 * already happened. A genuinely cold sweep (nothing cached yet — e.g. right
 * after a deploy) instead runs ~250 real network calls (bounded concurrency,
 * see `SWEEP_CONCURRENCY`) — the NSE and BSE sweeps run CONCURRENTLY with
 * each other (they hit entirely different hosts — nsearchives/NSE's
 * Akamai-gated live-watch vs bseindices.com/api.bseindia.com — so one
 * source's politeness bound never throttles the other), each internally
 * bounded to `SWEEP_CONCURRENCY` in-flight requests against its own host.
 * Measured locally 2026-08-14: NSE-only cold sweep ~8.6-9.6s (unchanged from
 * before this addition); full NSE+BSE concurrent cold sweep ~11-13s — see
 * `scripts/measure-index-membership-build.ts` for a reproducible number.
 * Still an order of magnitude over the "acceptable to await inside a page
 * request" bar this ticket set (~5s), so this module NEVER awaits its own
 * build inside a request: `getIndexMembership` always returns
 * synchronously-fast (a cache read, at worst empty), and silently kicks off
 * a background (fire-and-forget) build/refresh when the cache is missing or
 * stale — the exact same pattern enrichment.ts already uses for Yahoo
 * fundamentals (safe here for the identical reason: apps/web is a long-lived
 * Node process on EC2, never killed mid-request — see that file's own doc).
 * A stock page visited before the FIRST-EVER build completes simply shows no
 * "Index membership" section — honest and self-healing, not a bug: the very
 * next request (once the background build finishes) sees it.
 *
 * SINGLE-FLIGHT: `building` guards against two overlapping full sweeps (e.g.
 * two equity pages loading a split second apart, both finding a stale/absent
 * cache) — only one sweep ever runs at a time, exactly like etfRegistry.ts's
 * `inFlight` guard, just fire-and-forget instead of awaited (etfRegistry's
 * own build is a single CSV fetch, cheap enough to await; this one is not).
 *
 * CONCURRENT SHARED-MAP WRITES: `sweepNseIndices` and `sweepBseIndices` both
 * mutate the SAME `bySymbol` Map from within `Promise.all`-driven concurrent
 * workers. This is safe without a lock: JS is single-threaded and every
 * mutation (`bySymbol.get` immediately followed by `.push`/`.set`) happens
 * synchronously between two `await` points, so no two workers' read-modify-
 * write sequences can interleave — the exact same reasoning
 * `mapWithConcurrency`'s original single-source sweep already relied on,
 * just now shared across two concurrent sweep functions instead of one.
 */

import { getIndexUniverseEntry } from "@predict-future/business-rules/finance/indexUniverse";
import { BSE_INDEX_UNIVERSE_DISPLAY_NAME } from "@predict-future/business-rules/finance/bseIndexUniverse";

import { ALL_INDEX_SYMBOLS_WITH_CONSTITUENTS, fetchIndexConstituents } from "@/lib/finance/indexConstituents";
import { BSE_INDEX_CODE, fetchBseIndexConstituents } from "@/lib/finance/bseIndexConstituents";
import { resolveIndexNameToSymbol } from "@/lib/finance/indexNameResolver";
import { getLongTailIndexBySymbol } from "@/lib/finance/indexLongTail";

/** Every `BseIndexEodQuote.indexName` this app has a verified Asia Index code for (133 as of 2026-08-14) — the BSE-side sweep universe, mirroring `ALL_INDEX_SYMBOLS_WITH_CONSTITUENTS`'s role for NSE. Not every name returns real constituent rows (11 are non-equity index shapes — G-Sec/inverse/rate — see bseIndexConstituents.ts's own doc); `fetchBseIndexConstituents` returning null/empty for those is a normal, expected no-op for this sweep, not an error. */
export const ALL_BSE_INDEX_NAMES_WITH_CONSTITUENTS: readonly string[] = Object.keys(BSE_INDEX_CODE);

/**
 * The 5 F&O-tradable underlyings' own display names — duplicated (not
 * imported) from instrument.ts's INDEX_DISPLAY_NAME deliberately: instrument.ts
 * imports THIS module (to attach `indexMembership` onto InstrumentDetail), so
 * importing the other way would be circular. Same 5-entry list already
 * exists in indexLongTail.ts's TRADABLE_INDEX_NSE_NAMES (there as raw NSE
 * names, used to EXCLUDE these from the long tail) and indexTradableAlias.ts
 * (there as slugs) — a third small, static, hand-verified copy in the shape
 * this module needs is consistent with that existing precedent, not a new
 * duplication smell.
 */
const TRADABLE_INDEX_DISPLAY_NAME: Record<string, string> = {
  NIFTY: "Nifty 50",
  BANKNIFTY: "Nifty Bank",
  FINNIFTY: "Nifty Financial Services",
  MIDCPNIFTY: "Nifty Midcap Select",
  NIFTYNXT50: "Nifty Next 50",
};

/** Resolves an index's own `/instruments/[symbol]` code to its human display name, reusing the SAME three sources instrument.ts's own resolution already trusts (tradable-5 hardcode, INDEX_UNIVERSE's displayName, the long-tail's DB-derived NSE name) — never re-derived from the symbol itself. Falls back to the bare symbol only in the (unexpected — every symbol in ALL_INDEX_SYMBOLS_WITH_CONSTITUENTS originates from the same long-tail-covered universe) case none of the three resolve, so a lookup gap degrades to an ugly-but-honest label rather than a crash or a silent drop. */
async function resolveIndexDisplayName(indexSymbol: string): Promise<string> {
  const tradableName = TRADABLE_INDEX_DISPLAY_NAME[indexSymbol];
  if (tradableName) return tradableName;
  const universeEntry = getIndexUniverseEntry(indexSymbol);
  if (universeEntry) return universeEntry.displayName;
  const longTailEntry = await getLongTailIndexBySymbol(indexSymbol);
  if (longTailEntry) return longTailEntry.name;
  return indexSymbol;
}

export interface IndexMembershipEntry {
  /** `/instruments/[symbol]` code — link target, reused verbatim from ALL_INDEX_SYMBOLS_WITH_CONSTITUENTS (NSE) or resolveIndexNameToSymbol (BSE), never re-derived. */
  indexSymbol: string;
  indexName: string;
  /**
   * Weight (0-100) for THIS stock in THIS index. For an NSE index: a
   * free-float-mcap-share ESTIMATE straight from fetchIndexConstituents's
   * own live-watch overlay — null when that index has no live-watch
   * coverage (CSV-only membership, still shown, just unweighted). For a BSE
   * index: BSE's own PUBLISHED `Weightage` from fetchBseIndexConstituents —
   * not an estimate. Same honesty convention as
   * IndexConstituentQuoteRow/IndexCompositionPanel. See `weightIsEstimate`
   * to distinguish the two sources when rendering a caveat.
   */
  weightPct: number | null;
  /** true for an NSE ffmc-share estimate, false for a BSE published weight, undefined when weightPct is null (nothing to caveat). Mirrors IndexConstituentQuoteRow.weightIsEstimate's exact convention. */
  weightIsEstimate?: boolean;
}

interface MembershipCache {
  at: number;
  bySymbol: Map<string, IndexMembershipEntry[]>;
}

const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
/** Bounded concurrency for the cold sweep — politeness against nsearchives (plain CSV host) and, more importantly, www.nseindia.com's Akamai-gated live-watch endpoint (curl subprocess + session-prime per call, indexLiveWatch.ts's own transport). Unbounded parallel would mean ~100+ simultaneous curl child processes and a burst of Akamai-gated requests from one IP — a real risk of getting session-priming itself rate-limited, not just slow. */
const SWEEP_CONCURRENCY = 5;

let cache: MembershipCache | null = null;
let building = false;

async function mapWithConcurrency<T>(items: readonly T[], limit: number, fn: (item: T) => Promise<void>): Promise<void> {
  let nextIndex = 0;
  async function worker() {
    for (;;) {
      const current = nextIndex++;
      if (current >= items.length) return;
      await fn(items[current]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => worker()));
}

/** Resolves a BSE index's own `/instruments/[symbol]` code to its human display name — BSE_INDEX_UNIVERSE's hand-written displayName for the 18 Yahoo-verified indices, else BSE's own verbatim indexName (already display-worthy, e.g. "BSE MidCap Select Index") for the long tail. Synchronous: unlike the NSE resolver, no DB long-tail lookup is needed — `bseIndexName` IS the exact string a BSE long-tail entry's own `name` field would resolve to, by construction (bseIndexLongTail.ts derives its `name` straight from BseIndexEodQuote.indexName, the same value `bseIndexName` already is here). */
function resolveBseIndexDisplayName(bseIndexName: string, indexSymbol: string): string {
  return BSE_INDEX_UNIVERSE_DISPLAY_NAME[indexSymbol] ?? bseIndexName;
}

function addMembership(bySymbol: Map<string, IndexMembershipEntry[]>, symbol: string, entry: IndexMembershipEntry): void {
  const list = bySymbol.get(symbol);
  if (list) list.push(entry);
  else bySymbol.set(symbol, [entry]);
}

/** NSE-side sweep — unchanged logic from before the BSE addition, just factored into its own function so it can run concurrently with `sweepBseIndices` (see module doc on the shared-map concurrency safety). Never throws: a single index's fetch failure just means that index contributes no memberships this round (fetchIndexConstituents itself never throws either — see that function's own doc — so this is purely defensive). */
async function sweepNseIndices(bySymbol: Map<string, IndexMembershipEntry[]>): Promise<void> {
  await mapWithConcurrency(ALL_INDEX_SYMBOLS_WITH_CONSTITUENTS, SWEEP_CONCURRENCY, async (indexSymbol) => {
    try {
      const rows = await fetchIndexConstituents(indexSymbol);
      if (!rows || rows.length === 0) return;
      const indexName = await resolveIndexDisplayName(indexSymbol);
      for (const row of rows) {
        addMembership(bySymbol, row.symbol, {
          indexSymbol,
          indexName,
          weightPct: row.weightPct,
          weightIsEstimate: row.weightPct != null ? true : undefined,
        });
      }
    } catch (err) {
      console.warn(`[indexMembership] NSE sweep failed for ${indexSymbol}:`, err instanceof Error ? err.message : err);
    }
  });
}

/**
 * BSE-side sweep (BSE Index Membership Sweep, 2026-08-14) — same shape as
 * `sweepNseIndices`, sourced from `fetchBseIndexConstituents` over every
 * `BSE_INDEX_CODE` name instead. A constituent row with `symbol: null`
 * (unresolved BSE-only member — see bseIndexConstituents.ts's "no dead
 * links" doc) is skipped: there's no known `/instruments/[symbol]` page to
 * attach a membership entry to. Never throws, same defensive discipline as
 * the NSE sweep (fetchBseIndexConstituents itself never throws either).
 */
async function sweepBseIndices(bySymbol: Map<string, IndexMembershipEntry[]>): Promise<void> {
  await mapWithConcurrency(ALL_BSE_INDEX_NAMES_WITH_CONSTITUENTS, SWEEP_CONCURRENCY, async (bseIndexName) => {
    try {
      const rows = await fetchBseIndexConstituents(bseIndexName);
      if (!rows || rows.length === 0) return;
      const indexSymbol = resolveIndexNameToSymbol(bseIndexName);
      const indexName = resolveBseIndexDisplayName(bseIndexName, indexSymbol);
      for (const row of rows) {
        if (!row.symbol) continue;
        addMembership(bySymbol, row.symbol, {
          indexSymbol,
          indexName,
          weightPct: row.weightPct,
          weightIsEstimate: row.weightPct != null ? false : undefined,
        });
      }
    } catch (err) {
      console.warn(`[indexMembership] BSE sweep failed for ${bseIndexName}:`, err instanceof Error ? err.message : err);
    }
  });
}

/**
 * Full reverse-map sweep — exported (not just called internally) so a one-off
 * timing script can measure real cold-build wall time without duplicating
 * this logic (see apps/web/scripts/measure-index-membership-build.ts). Runs
 * the NSE and BSE sweeps CONCURRENTLY (see module doc on why this is safe
 * and why it doesn't breach either source's own politeness bound) and merges
 * both into the same reverse map — a stock dual-listed and index-eligible on
 * both exchanges (e.g. RELIANCE) simply accumulates membership entries from
 * both sweeps under its one NSE symbol key.
 */
export async function buildIndexMembershipMap(): Promise<Map<string, IndexMembershipEntry[]>> {
  const bySymbol = new Map<string, IndexMembershipEntry[]>();
  await Promise.all([sweepNseIndices(bySymbol), sweepBseIndices(bySymbol)]);
  return bySymbol;
}

/** Kicks off a background rebuild when the cache is missing/stale, guarded so only one sweep ever runs concurrently. Never awaited by a caller — see module doc. */
function triggerBuildIfNeeded(): void {
  const now = Date.now();
  if (cache && now - cache.at < CACHE_TTL_MS) return;
  if (building) return;
  building = true;
  buildIndexMembershipMap()
    .then((bySymbol) => {
      cache = { at: Date.now(), bySymbol };
    })
    .catch((err) => {
      console.error("[indexMembership] background build failed unexpectedly:", err);
    })
    .finally(() => {
      building = false;
    });
}

/**
 * Every index-membership entry for this stock symbol — empty array when the
 * reverse map isn't warm yet (first-ever cold start, before the background
 * sweep this call just triggered has finished) OR when the stock genuinely
 * belongs to none of the ~115 covered indices. Always resolves immediately
 * (a Map lookup, at most) — never blocks on network I/O.
 */
export async function getIndexMembership(symbol: string): Promise<IndexMembershipEntry[]> {
  triggerBuildIfNeeded();
  if (!cache) return [];
  return cache.bySymbol.get(symbol.trim().toUpperCase()) ?? [];
}
