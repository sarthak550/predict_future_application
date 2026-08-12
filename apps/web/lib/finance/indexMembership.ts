/**
 * Index Membership — reverse of indexConstituents.ts/indexLiveWatch.ts:
 * "what indices is THIS stock a member of" (founder ask, 2026-08-12, mirrors
 * the ETF Layer's `EtfTrackingList` symmetry — "in similar fashion like we
 * show what funds track the indices, can we also add the indices the stock
 * is part of").
 *
 * SOURCE: reuses `fetchIndexConstituents` (indexConstituents.ts) — the SAME
 * per-index cached fetcher the composition panels already call, never a
 * second transport. That function already layers CSV membership (primary,
 * 24h cache) with indexLiveWatch.ts's live free-float-mcap-share weight
 * overlay/gap-fill (15min cache, curl/Akamai transport) — see both files'
 * own module docs for the full sourcing story. This module only inverts
 * "index -> members" into "member -> indices" across every index in
 * `ALL_INDEX_SYMBOLS_WITH_CONSTITUENTS` (~115 indices as of 2026-08-12).
 *
 * WHY NOT A PER-REQUEST FAN-OUT: a stock page naively asking "which of the
 * ~115 covered indices contain me" would mean up to ~115 fetches (many of
 * them curl subprocess + Akamai session-prime round trips) on EVERY equity
 * page view — unacceptable. Instead this module builds ONE reverse map,
 * module-level cached for 24h (index membership changes at most quarterly,
 * same rebalance cadence indexConstituents.ts's own CACHE_TTL_MS already
 * assumes), and every stock page just reads a plain in-memory Map lookup.
 *
 * COLD VS WARM BUILD COST: when many index pages have already been visited
 * recently, every `fetchIndexConstituents` call below resolves instantly
 * from ITS OWN warm in-module cache — a full reverse-map (re)build costs
 * nothing new over what already happened. A genuinely cold sweep (nothing
 * cached yet — e.g. right after a deploy) instead runs ~115 real network
 * calls (bounded concurrency, see `SWEEP_CONCURRENCY`) — measured locally at
 * ~30-60s wall time, an order of magnitude over the "acceptable to await
 * inside a page request" bar this ticket set (~5s). So this module NEVER
 * awaits its own build inside a request: `getIndexMembership` always returns
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
 */

import { getIndexUniverseEntry } from "@predict-future/business-rules/finance/indexUniverse";

import { ALL_INDEX_SYMBOLS_WITH_CONSTITUENTS, fetchIndexConstituents } from "@/lib/finance/indexConstituents";
import { getLongTailIndexBySymbol } from "@/lib/finance/indexLongTail";

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
  /** `/instruments/[symbol]` code — link target, reused verbatim from ALL_INDEX_SYMBOLS_WITH_CONSTITUENTS, never re-derived. */
  indexSymbol: string;
  indexName: string;
  /** Free-float-mcap-share weight estimate (0-100) for THIS stock in THIS index, straight from fetchIndexConstituents's own live-watch overlay — null when this index has no live-watch coverage (CSV-only membership, still shown, just unweighted). Same honesty convention as IndexConstituentQuoteRow/IndexCompositionPanel: an estimate, never NSE's own published (possibly capped) weight. */
  weightPct: number | null;
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

/**
 * Full reverse-map sweep — exported (not just called internally) so a one-off
 * timing script can measure real cold-build wall time without duplicating
 * this logic (see apps/web/scripts/measure-index-membership-build.ts).
 * Never throws: a single index's fetch failure just means that index
 * contributes no memberships this round (fetchIndexConstituents itself
 * never throws either — see that function's own doc — so this is purely
 * defensive).
 */
export async function buildIndexMembershipMap(): Promise<Map<string, IndexMembershipEntry[]>> {
  const bySymbol = new Map<string, IndexMembershipEntry[]>();

  await mapWithConcurrency(ALL_INDEX_SYMBOLS_WITH_CONSTITUENTS, SWEEP_CONCURRENCY, async (indexSymbol) => {
    try {
      const rows = await fetchIndexConstituents(indexSymbol);
      if (!rows || rows.length === 0) return;
      const indexName = await resolveIndexDisplayName(indexSymbol);
      for (const row of rows) {
        const list = bySymbol.get(row.symbol);
        const entry: IndexMembershipEntry = { indexSymbol, indexName, weightPct: row.weightPct };
        if (list) list.push(entry);
        else bySymbol.set(row.symbol, [entry]);
      }
    } catch (err) {
      console.warn(`[indexMembership] sweep failed for ${indexSymbol}:`, err instanceof Error ? err.message : err);
    }
  });

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
