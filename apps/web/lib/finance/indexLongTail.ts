/**
 * Index History Stage 2 (2026-08-11) — resolves a `/instruments/[symbol]`
 * code to a "long tail" index: any NSE index this app has self-owned daily
 * history for (IndexEodQuote, apps/api/lib/marketMoves/indexEod.ts) that
 * ISN'T already one of the 35 symbols with a verified Yahoo feed
 * (INDEX_OPTION_UNDERLYINGS' 5 tradable underlyings + business-rules'
 * INDEX_UNIVERSE's 30 view-only indices — see that registry's own module doc
 * for why those stay hand-curated with a real Yahoo ticker, never
 * DB-derived).
 *
 * DELIBERATELY DB-DERIVED, not a second hand-typed registry: unlike
 * INDEX_UNIVERSE (which needed per-index live Yahoo verification before
 * inclusion), a long-tail index's identity is a PURE function of its own
 * name in the CSV NSE already publishes daily — `deriveIndexSymbol`/
 * `slugifyIndexName` (business-rules/finance) are exactly the same
 * functions INDEX_UNIVERSE itself uses to derive `symbol`/`slug` from
 * `name`, just applied here at read-time against whatever IndexEodQuote
 * currently contains rather than a hand-maintained list. This means the
 * long-tail universe self-updates as the backfill/cron ingest more index
 * names — no code change needed when NSE adds a new index NSE itself begins
 * publishing this file for.
 *
 * Two names are EXCLUDED from the long tail even though they'd otherwise
 * derive a valid symbol, both documented at their exclusion below: the 30
 * INDEX_UNIVERSE names (symbol-equal by construction, so `isIndexUniverseSymbol`
 * catches them) and the 5 tradable underlyings' own NSE names (which use
 * SHORT mnemonic codes — "NIFTY", "BANKNIFTY" — NOT `deriveIndexSymbol` of
 * their full name, so they need an explicit name-based exclusion instead).
 * Without both exclusions, e.g. "Nifty 50" would mint a redundant second
 * "NIFTYNXT... /instruments/NIFTY50" page alongside the real, live
 * `/instruments/NIFTY` — two pages for one index, never both per
 * INDEX_UNIVERSE's own "never both" rule (see that file's module doc).
 */

import { deriveIndexSymbol, isIndexUniverseSymbol } from "@predict-future/business-rules/finance/indexUniverse";
import { slugifyIndexName } from "@predict-future/business-rules/finance/indexSlug";

import { prisma } from "@/lib/prisma";

export interface LongTailIndexEntry {
  /** NSE's own display name, verbatim as captured in IndexEodQuote.indexName (Title Case, e.g. "Nifty NBFC"). Canonical join key back to the live /api/allIndices snapshot (via normalizeIndexDisplayName-style uppercase comparison) and to IndexEodQuote rows. */
  name: string;
  /** slugifyIndexName(name) — the /indices/[slug] this index already has today. */
  slug: string;
  /** deriveIndexSymbol(name) — the NEW /instruments/[symbol] code this index gets. */
  symbol: string;
}

/** The 5 F&O-tradable underlyings' own NSE display names (verified live 2026-07-25 — see apps/web/lib/finance/indexTradableAlias.ts's module doc, the original source of this exact list). Excluded by NAME (not symbol) because their /instruments/ code is a short mnemonic ("NIFTY") that deriveIndexSymbol would never independently produce from the full name ("Nifty 50" -> "NIFTY50"). */
const TRADABLE_INDEX_NSE_NAMES = new Set([
  "NIFTY 50",
  "NIFTY BANK",
  "NIFTY FINANCIAL SERVICES",
  "NIFTY MIDCAP SELECT",
  "NIFTY NEXT 50",
]);

function normalizeName(raw: string): string {
  return raw.trim().toUpperCase().replace(/\s+/g, " ");
}

const CACHE_TTL_MS = 5 * 60 * 1000;
let cache: { at: number; bySymbol: Map<string, LongTailIndexEntry>; bySlug: Map<string, LongTailIndexEntry> } | null =
  null;

async function buildLongTailIndex(): Promise<{
  bySymbol: Map<string, LongTailIndexEntry>;
  bySlug: Map<string, LongTailIndexEntry>;
}> {
  const rows = await prisma.indexEodQuote.findMany({
    distinct: ["indexName"],
    select: { indexName: true },
  });

  const bySymbol = new Map<string, LongTailIndexEntry>();
  const bySlug = new Map<string, LongTailIndexEntry>();
  for (const row of rows) {
    const name = row.indexName;
    if (TRADABLE_INDEX_NSE_NAMES.has(normalizeName(name))) continue;
    const symbol = deriveIndexSymbol(name);
    if (isIndexUniverseSymbol(symbol)) continue;
    // Defensive: two distinct spellings deriving the same code would be a
    // silent identity collision — keep the first seen rather than throwing
    // at request time (a startup-time assertion, like INDEX_UNIVERSE's own,
    // isn't possible here since this is built from live DB content, not a
    // static list). Not observed across the real 164-name universe verified
    // 2026-08-11 (zero symbol collisions — see the ticket report).
    if (bySymbol.has(symbol)) continue;

    const entry: LongTailIndexEntry = { name, slug: slugifyIndexName(name), symbol };
    bySymbol.set(symbol, entry);
    bySlug.set(entry.slug, entry);
  }
  return { bySymbol, bySlug };
}

async function getCache() {
  const now = Date.now();
  if (!cache || now - cache.at > CACHE_TTL_MS) {
    const { bySymbol, bySlug } = await buildLongTailIndex();
    cache = { at: now, bySymbol, bySlug };
  }
  return cache;
}

/** Resolves a `/instruments/[symbol]` code to its long-tail index entry, or null if it isn't one (a plain equity, or an index outside the two backing sets above — e.g. IndexEodQuote hasn't been backfilled for it yet). Cached 5 min; near-zero cost on repeat calls. */
export async function getLongTailIndexBySymbol(symbol: string): Promise<LongTailIndexEntry | null> {
  const { bySymbol } = await getCache();
  return bySymbol.get(symbol.trim().toUpperCase()) ?? null;
}

/** Resolves an `/indices/[slug]` directory slug to its long-tail index entry (i.e. "does this index also have a full instrument page now"), or null. Used by the /indices/[slug] page to link out to /instruments/[symbol]. */
export async function getLongTailIndexBySlug(slug: string): Promise<LongTailIndexEntry | null> {
  const { bySlug } = await getCache();
  return bySlug.get(slug.trim().toUpperCase()) ?? null;
}
