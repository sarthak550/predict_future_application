/**
 * BSE Expansion Phase 2 (2026-08-12) — the BSE-side sibling of
 * lib/finance/indexLongTail.ts: resolves a `/instruments/[symbol]` code to
 * any BSE index this app has self-owned daily history for (BseIndexEodQuote,
 * apps/api/lib/marketMoves/bseIndexEod.ts) that ISN'T already one of the 18
 * BSE_INDEX_UNIVERSE indices with a verified Yahoo feed (business-rules'
 * bseIndexUniverse.ts) — the founder's "if not tradable then at least their
 * history" principle applied to the remaining ~115 BSE indices.
 *
 * DELIBERATELY DB-DERIVED, not a second hand-typed registry — identical
 * reasoning to indexLongTail.ts's own module doc: a BSE index's identity is a
 * pure function of its own name in the JSON BSE already publishes daily
 * (`deriveIndexSymbol`/`slugifyIndexName`, the SAME generic functions
 * business-rules already exports and NSE's own long tail reuses — no second
 * matcher). Self-updates as the cron ingests new BSE index names.
 *
 * Excludes BSE_INDEX_UNIVERSE symbols via `isBseIndexUniverseSymbol` — same
 * "never both" rule as the NSE long tail's exclusion of INDEX_UNIVERSE.
 */

import { isBseIndexUniverseSymbol } from "@predict-future/business-rules/finance/bseIndexUniverse";
import { deriveIndexSymbol } from "@predict-future/business-rules/finance/indexUniverse";
import { slugifyIndexName } from "@predict-future/business-rules/finance/indexSlug";

import { prisma } from "@/lib/prisma";

export interface BseLongTailIndexEntry {
  /** BSE's own display name, verbatim as captured in BseIndexEodQuote.indexName (e.g. "BSE MidCap Select Index"). Canonical join key back to BseIndexEodQuote rows and to raw ExpertOpinion.instrument text. */
  name: string;
  /** slugifyIndexName(name). */
  slug: string;
  /** deriveIndexSymbol(name) — the `/instruments/[symbol]` code this index gets. */
  symbol: string;
}

const CACHE_TTL_MS = 5 * 60 * 1000;
let cache: { at: number; bySymbol: Map<string, BseLongTailIndexEntry>; bySlug: Map<string, BseLongTailIndexEntry> } | null =
  null;

async function buildBseLongTailIndex(): Promise<{
  bySymbol: Map<string, BseLongTailIndexEntry>;
  bySlug: Map<string, BseLongTailIndexEntry>;
}> {
  const rows = await prisma.bseIndexEodQuote.findMany({
    distinct: ["indexName"],
    select: { indexName: true },
  });

  const bySymbol = new Map<string, BseLongTailIndexEntry>();
  const bySlug = new Map<string, BseLongTailIndexEntry>();
  for (const row of rows) {
    const name = row.indexName;
    const symbol = deriveIndexSymbol(name);
    if (isBseIndexUniverseSymbol(symbol)) continue;
    // Defensive, same as indexLongTail.ts: keep the first-seen name on a
    // hypothetical derived-code collision rather than throwing at request
    // time. Not observed across the real 133-name universe verified
    // 2026-08-12 (check-bse-collisions.ts also reports zero internal
    // self-collisions).
    if (bySymbol.has(symbol)) continue;

    const entry: BseLongTailIndexEntry = { name, slug: slugifyIndexName(name), symbol };
    bySymbol.set(symbol, entry);
    bySlug.set(entry.slug, entry);
  }
  return { bySymbol, bySlug };
}

async function getCache() {
  const now = Date.now();
  if (!cache || now - cache.at > CACHE_TTL_MS) {
    const { bySymbol, bySlug } = await buildBseLongTailIndex();
    cache = { at: now, bySymbol, bySlug };
  }
  return cache;
}

/** Resolves a `/instruments/[symbol]` code to its BSE long-tail index entry, or null if it isn't one. Cached 5 min. */
export async function getBseLongTailIndexBySymbol(symbol: string): Promise<BseLongTailIndexEntry | null> {
  const { bySymbol } = await getCache();
  return bySymbol.get(symbol.trim().toUpperCase()) ?? null;
}

/** Resolves a slug (same slugifyIndexName convention /bse-indices could link through) to its BSE long-tail index entry, or null. */
export async function getBseLongTailIndexBySlug(slug: string): Promise<BseLongTailIndexEntry | null> {
  const { bySlug } = await getCache();
  return bySlug.get(slug.trim().toUpperCase()) ?? null;
}
