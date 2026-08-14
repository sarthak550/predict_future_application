/**
 * INDEX_UNIVERSE — single source of truth for every NSE index upgraded from
 * the slim `/indices/[slug]` browsing page to a full instrument page
 * (`/instruments/[symbol]`: quote header, live 1D chart, analyst opinions).
 *
 * CTO Assignment Brief — Index Universe Expansion, Sprint A (2026-08-09),
 * founder ask: "fetch all indices which are not there right now, like Nifty
 * Infra or Nifty IT."
 *
 * DELIBERATELY DECOUPLED from `isIndexOptionUnderlying`/
 * `INDEX_OPTION_UNDERLYINGS` (papertrading/optionContract.ts) — that flag
 * stays narrowly scoped to "can this be traded on the options/futures
 * terminal" (5 symbols: NIFTY, BANKNIFTY, FINNIFTY, MIDCPNIFTY, NIFTYNXT50).
 * This registry answers a DIFFERENT question — "does this index have a
 * verified-live Yahoo candle feed and therefore qualify for a full,
 * view-only instrument page" — and intentionally has ZERO overlap with the
 * tradable five (those already have their own page treatment; adding them
 * here would be redundant, not additive). A symbol is EITHER in
 * INDEX_OPTION_UNDERLYINGS (tradable) OR in INDEX_UNIVERSE (view-only) or
 * in neither (stays on the slim `/indices/[slug]` page) — never both.
 *
 * TIERING RULE (why only 25 of the 40 BROAD MARKET + SECTORAL candidates,
 * plus one explicit THEMATIC override, qualify): an index only enters this
 * registry once a runtime check against the real Yahoo Finance chart API
 * confirmed BOTH (a) a live 1-minute intraday tick series for the current
 * session — the actual data source `/instruments/[symbol]`'s chart renders
 * for every index today, tradable or not, since indices have no
 * StockEodQuote row and therefore no daily "spark" series on ANY timeframe
 * but 1D — AND (b) the returned session price matches NSE's own live
 * `/api/allIndices` `last` value for that index to within a fraction of a
 * percent (catches Yahoo search false-positives that resolve to the WRONG
 * index under a plausible-looking ticker, and catches "quote meta present
 * but zero real series" stub tickers). Verification captured live
 * 2026-08-09; a per-index log with the actual response evidence lives in
 * this ticket's report, not restated here to avoid drift between a comment
 * and reality. FAILED candidates (many BROAD MARKET multi-factor variants —
 * "NIFTY500 MULTICAP 50:25:25", "NIFTY SMALLCAP 50/100/250/500",
 * "NIFTY MIDSMALLCAP 400", etc. — and a handful of SECTORAL sub-indices with
 * no independent Yahoo tracker — "NIFTY CONSUMER DURABLES",
 * "NIFTY FINANCIAL SERVICES 25/50", "NIFTY FINANCIAL SERVICES EX-BANK",
 * "NIFTY MIDSMALL HEALTHCARE", "NIFTY MIDSMALL FINANCIAL SERVICES",
 * "NIFTY MIDSMALL IT & TELECOM", "NIFTY500 HEALTHCARE") are NOT downgraded
 * or removed from anywhere — they simply stay on `/indices/[slug]`, exactly
 * where they already are, until a real Yahoo feed exists for them.
 *
 * ONE DELIBERATE OVERRIDE OF THE GROUP-SCOPE RULE: "NIFTY INFRASTRUCTURE" is
 * classified by NSE as a THEMATIC INDEX, not BROAD MARKET/SECTORAL (verified
 * live against /api/allIndices 2026-08-09 — the assigning brief assumed it
 * sat in one of those two groups, which is factually wrong; flagged back in
 * this ticket's report). It is included anyway because (1) the founder
 * named it explicitly as one of the two required examples ("like Nifty
 * Infra or Nifty IT") and (2) it clears the SAME live Yahoo verification bar
 * every other entry here does (^CNXINFRA — deep multi-year daily history,
 * live intraday, exact price match against NSE). No other THEMATIC or
 * STRATEGY index is included; those groups stay explicitly out of scope
 * per the brief.
 *
 * FIELDS, each a pure function of NSE's own live display `name` (never
 * hand-picked independently):
 *   - `slug`        = slugifyIndexName(name) (./indexSlug.ts) — the SAME
 *                      function apps/api's `/indices/[slug]` directory uses,
 *                      so this registry's slug always agrees with that page.
 *   - `symbol`       = deriveIndexSymbol(name) (this file) — the
 *                      `/instruments/[symbol]` URL segment.
 *   - `yahooTicker`  = the verified-live Yahoo ticker; doubles as the
 *                      ExpertOpinion.instrumentTicker value opinions on this
 *                      index resolve under (same pattern NIFTY/BANKNIFTY's
 *                      `^NSEI`/`^NSEBANK` already use in apps/web's
 *                      INDEX_OPINION_TICKER) — one identity, two jobs, never
 *                      a second value invented per index.
 *   - `displayName`  = hand-written human-casing for UI display (Title Case
 *                      with acronyms preserved — "Nifty IT", "India VIX"),
 *                      since naively title-casing the ALL-CAPS `name` breaks
 *                      acronyms ("IT" -> "It").
 *
 * COLLISION CHECK (acceptance-blocking per the brief): every `symbol` below
 * was checked against local dev StockEodQuote (`SELECT DISTINCT symbol FROM
 * "StockEodQuote" WHERE symbol IN (...)`) on 2026-08-09 — zero collisions.
 * The coordinator MUST re-run the identical query against the PRODUCTION
 * database before deploy; a new equity listing colliding with one of these
 * codes between now and then, while unlikely, is not something this
 * registry can detect on its own.
 */

import { slugifyIndexName } from "./indexSlug";

export interface IndexUniverseEntry {
  /** NSE's own live display name, verbatim — the join key back to `/indices/[slug]` (via `slug`) and to raw ExpertOpinion.instrument text (via INDEX_NAME_ALIASES-aware matching). */
  name: string;
  /** Human-friendly display name (acronyms preserved) for instrument-page headers and opinion resolution copy. */
  displayName: string;
  /** slugifyIndexName(name) — asserted to match at module load, never hand-typed independently. */
  slug: string;
  /** `/instruments/[symbol]` URL segment — deriveIndexSymbol(name), asserted to match at module load. */
  symbol: string;
  /** Verified-live Yahoo Finance ticker (see module doc for the verification bar). Also the ExpertOpinion.instrumentTicker this index's opinions resolve under. */
  yahooTicker: string;
}

/**
 * Deterministic `/instruments/[symbol]` code from an NSE index display name:
 * uppercase, strip everything but letters/digits. Deliberately does NOT
 * strip a leading "NIFTY" — "NIFTY IT" -> "NIFTYIT" rather than "IT", both
 * because it matches the founder's own vocabulary and this ticket's own
 * success-metric examples (`/instruments/NIFTYIT`, `/instruments/NIFTYINFRA`
 * -ish), and because stripping it would risk short, collision-prone codes
 * ("NIFTY IT" -> "IT" collides with a real NSE-listed equity ticker, "IT.NS"
 * — Kotak Mahindra AMC's Nifty IT ETF, confirmed live via Yahoo search
 * 2026-08-09).
 */
export function deriveIndexSymbol(name: string): string {
  return name.trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
}

/**
 * Small, hand-verified alias map for instrument-label text that doesn't
 * textually match its NSE display name after normalization — e.g.
 * apps/api's extractInstrument.ts historically wrote the shorthand
 * "Nifty Infra" (not the full official "Nifty Infrastructure") for
 * ^CNXINFRA opinions, so existing ExpertOpinion rows carry
 * instrument="Nifty Infra", which normalizes to "NIFTY INFRA" — NOT
 * "NIFTY INFRASTRUCTURE" (this registry's verbatim NSE name for that
 * index). Without this alias, the founder's own named example (Nifty
 * Infra) would silently fail the backfill's exact-match requirement.
 *
 * NOT fuzzy matching: a plain, explicit, hand-verified string dictionary —
 * same spirit as extractInstrument.ts's own TICKER_REMAP — checked as a
 * fallback ONLY after a direct normalized-name match misses. Every new
 * keyword-map entry authored alongside this registry (see
 * apps/api/lib/ai/extractInstrument.ts) sets its `instrument` label to the
 * exact NSE display name specifically so it never needs an entry here going
 * forward — this map exists to close the gap in ALREADY-PERSISTED opinions
 * and the one pre-existing extraction entry ("nifty infra") that predates
 * this registry.
 */
export const INDEX_NAME_ALIASES: Record<string, string> = {
  "NIFTY INFRA": "NIFTY INFRASTRUCTURE",
};

/** Uppercase + trim + collapse-whitespace — the exact-match (never fuzzy) normalization both the opinion backfill (apps/api/scripts) and any future consumer must use to compare a raw ExpertOpinion.instrument string against this registry's `name`/INDEX_NAME_ALIASES keys. */
export function normalizeIndexDisplayName(raw: string): string {
  return raw.trim().toUpperCase().replace(/\s+/g, " ");
}

/**
 * The 5 F&O-tradable underlyings: page symbol ↔ NSE's own display name.
 * SINGLE SOURCE (founder, 2026-08-15: mappings live in one place, never
 * re-hardcoded per consumer) — these five need a registry at all only
 * because their `/instruments/[symbol]` code is a short exchange mnemonic
 * ("NIFTY", "BANKNIFTY") that `deriveIndexSymbol(name)` can never produce
 * from the NSE name, unlike every other index. Names verified live
 * 2026-07-25 (see apps/web/lib/finance/indexTradableAlias.ts's module doc,
 * the original source of the list).
 *
 * Consumers: apps/api/lib/finance/instrumentNameMatch.ts (alias healer).
 * KNOWN DUPLICATES to migrate here when next touched (each predates this
 * registry and is live-verified in place — migrate WITH a QA pass, not
 * mechanically): apps/web instrument.ts INDEX_DISPLAY_NAME's tradable-5
 * head, indexLongTail.ts TRADABLE_INDEX_NSE_NAMES,
 * app/api/instruments/search TRADABLE_INDEX_ENTRIES.
 */
export const TRADABLE_INDEX_IDENTITIES: ReadonlyArray<{ symbol: string; nseName: string }> = [
  { symbol: "NIFTY", nseName: "NIFTY 50" },
  { symbol: "BANKNIFTY", nseName: "NIFTY BANK" },
  { symbol: "FINNIFTY", nseName: "NIFTY FINANCIAL SERVICES" },
  { symbol: "MIDCPNIFTY", nseName: "NIFTY MIDCAP SELECT" },
  { symbol: "NIFTYNXT50", nseName: "NIFTY NEXT 50" },
];

export const INDEX_UNIVERSE: readonly IndexUniverseEntry[] = [
  // --- BROAD MARKET INDICES (10 of 19 candidates verified live) ---
  { name: "NIFTY 100", displayName: "Nifty 100", slug: "NIFTY-100", symbol: "NIFTY100", yahooTicker: "^CNX100" },
  { name: "NIFTY 200", displayName: "Nifty 200", slug: "NIFTY-200", symbol: "NIFTY200", yahooTicker: "^CNX200" },
  { name: "NIFTY 500", displayName: "Nifty 500", slug: "NIFTY-500", symbol: "NIFTY500", yahooTicker: "^CRSLDX" },
  {
    name: "NIFTY MIDCAP 50",
    displayName: "Nifty Midcap 50",
    slug: "NIFTY-MIDCAP-50",
    symbol: "NIFTYMIDCAP50",
    yahooTicker: "^NSEMDCP50",
  },
  {
    name: "NIFTY MIDCAP 100",
    displayName: "Nifty Midcap 100",
    slug: "NIFTY-MIDCAP-100",
    symbol: "NIFTYMIDCAP100",
    yahooTicker: "NIFTY_MIDCAP_100.NS",
  },
  { name: "INDIA VIX", displayName: "India VIX", slug: "INDIA-VIX", symbol: "INDIAVIX", yahooTicker: "^INDIAVIX" },
  {
    name: "NIFTY MIDCAP 150",
    displayName: "Nifty Midcap 150",
    slug: "NIFTY-MIDCAP-150",
    symbol: "NIFTYMIDCAP150",
    yahooTicker: "NIFTYMIDCAP150.NS",
  },
  {
    name: "NIFTY TOTAL MARKET",
    displayName: "Nifty Total Market",
    slug: "NIFTY-TOTAL-MARKET",
    symbol: "NIFTYTOTALMARKET",
    yahooTicker: "NIFTY_TOTAL_MKT.NS",
  },
  {
    name: "NIFTY MICROCAP 250",
    displayName: "Nifty Microcap 250",
    slug: "NIFTY-MICROCAP-250",
    symbol: "NIFTYMICROCAP250",
    yahooTicker: "NIFTY_MICROCAP250.NS",
  },
  {
    name: "NIFTY INDIA FPI 150",
    displayName: "Nifty India FPI 150",
    slug: "NIFTY-INDIA-FPI-150",
    symbol: "NIFTYINDIAFPI150",
    yahooTicker: "NIFTY_FPI_150.NS",
  },

  // --- SECTORAL INDICES (14 of 21 candidates verified live) ---
  { name: "NIFTY AUTO", displayName: "Nifty Auto", slug: "NIFTY-AUTO", symbol: "NIFTYAUTO", yahooTicker: "^CNXAUTO" },
  { name: "NIFTY FMCG", displayName: "Nifty FMCG", slug: "NIFTY-FMCG", symbol: "NIFTYFMCG", yahooTicker: "^CNXFMCG" },
  { name: "NIFTY IT", displayName: "Nifty IT", slug: "NIFTY-IT", symbol: "NIFTYIT", yahooTicker: "^CNXIT" },
  { name: "NIFTY MEDIA", displayName: "Nifty Media", slug: "NIFTY-MEDIA", symbol: "NIFTYMEDIA", yahooTicker: "^CNXMEDIA" },
  { name: "NIFTY METAL", displayName: "Nifty Metal", slug: "NIFTY-METAL", symbol: "NIFTYMETAL", yahooTicker: "^CNXMETAL" },
  {
    name: "NIFTY PHARMA",
    displayName: "Nifty Pharma",
    slug: "NIFTY-PHARMA",
    symbol: "NIFTYPHARMA",
    yahooTicker: "^CNXPHARMA",
  },
  {
    name: "NIFTY PSU BANK",
    displayName: "Nifty PSU Bank",
    slug: "NIFTY-PSU-BANK",
    symbol: "NIFTYPSUBANK",
    yahooTicker: "^CNXPSUBANK",
  },
  {
    name: "NIFTY PRIVATE BANK",
    displayName: "Nifty Private Bank",
    slug: "NIFTY-PRIVATE-BANK",
    symbol: "NIFTYPRIVATEBANK",
    yahooTicker: "NIFTY_PVT_BANK.NS",
  },
  {
    name: "NIFTY REALTY",
    displayName: "Nifty Realty",
    slug: "NIFTY-REALTY",
    symbol: "NIFTYREALTY",
    yahooTicker: "^CNXREALTY",
  },
  {
    name: "NIFTY HEALTHCARE INDEX",
    displayName: "Nifty Healthcare",
    slug: "NIFTY-HEALTHCARE-INDEX",
    symbol: "NIFTYHEALTHCAREINDEX",
    yahooTicker: "NIFTY_HEALTHCARE.NS",
  },
  {
    name: "NIFTY OIL & GAS",
    displayName: "Nifty Oil & Gas",
    slug: "NIFTY-OIL-GAS",
    symbol: "NIFTYOILGAS",
    yahooTicker: "NIFTY_OIL_AND_GAS.NS",
  },
  {
    name: "NIFTY CHEMICALS",
    displayName: "Nifty Chemicals",
    slug: "NIFTY-CHEMICALS",
    symbol: "NIFTYCHEMICALS",
    yahooTicker: "NIFTY_CHEMICALS.NS",
  },
  {
    name: "NIFTY REITS & REALTY",
    displayName: "Nifty REITs & Realty",
    slug: "NIFTY-REITS-REALTY",
    symbol: "NIFTYREITSREALTY",
    yahooTicker: "NIFTY_REITS_REALTY.NS",
  },
  {
    name: "NIFTY CEMENT",
    displayName: "Nifty Cement",
    slug: "NIFTY-CEMENT",
    symbol: "NIFTYCEMENT",
    yahooTicker: "NIFTY_CEMENT.NS",
  },

  // --- THEMATIC override (founder-named example; see module doc) ---
  {
    name: "NIFTY INFRASTRUCTURE",
    displayName: "Nifty Infrastructure",
    slug: "NIFTY-INFRASTRUCTURE",
    symbol: "NIFTYINFRASTRUCTURE",
    yahooTicker: "^CNXINFRA",
  },

  // --- Index Identity Audit (2026-08-10), founder ask: "did you look for all
  // other indices as well and see if any other is mismatched or not there
  // with us." Five more entries verified live against Yahoo's chart API
  // (real intraday 1-minute series, 376 bars) AND cross-checked against NSE
  // /api/allIndices `last` value to an exact match — same bar as every entry
  // above. Real, non-trivial prod ExpertOpinion demand existed for each
  // BEFORE this audit (opinions carrying either the correct ticker with no
  // page to link to, or a dead/wrong ticker for the same real index) — see
  // this ticket's audit table (.scratch/index-audit-verdicts.md) for the
  // exact rows. THEMATIC/SECTORAL grouping below is NSE's own
  // classification, not re-derived — kept loose since (per the module doc
  // above) NIFTY INFRASTRUCTURE's own group was already found to be
  // mis-assumed by an earlier brief; treat the section comments as
  // organizational, not load-bearing.
  {
    name: "NIFTY ENERGY",
    displayName: "Nifty Energy",
    slug: "NIFTY-ENERGY",
    symbol: "NIFTYENERGY",
    yahooTicker: "^CNXENERGY",
  },
  {
    name: "NIFTY INDIA CONSUMPTION",
    displayName: "Nifty India Consumption",
    slug: "NIFTY-INDIA-CONSUMPTION",
    symbol: "NIFTYINDIACONSUMPTION",
    yahooTicker: "^CNXCONSUM",
  },
  {
    name: "NIFTY INDIA MANUFACTURING",
    displayName: "Nifty India Manufacturing",
    slug: "NIFTY-INDIA-MANUFACTURING",
    symbol: "NIFTYINDIAMANUFACTURING",
    yahooTicker: "NIFTY_INDIA_MFG.NS",
  },
  {
    name: "NIFTY INDIA DEFENCE",
    displayName: "Nifty India Defence",
    slug: "NIFTY-INDIA-DEFENCE",
    symbol: "NIFTYINDIADEFENCE",
    yahooTicker: "NIFTY_IND_DEFENCE.NS",
  },
  {
    name: "NIFTY SMALLCAP 250",
    displayName: "Nifty Smallcap 250",
    slug: "NIFTY-SMALLCAP-250",
    symbol: "NIFTYSMALLCAP250",
    yahooTicker: "NIFTYSMLCAP250.NS",
  },
] as const;

// Defensive at-import assertions — same convention as
// apps/web/lib/finance/indexTradableAlias.ts's own boot-time check: a
// hand-typo'd slug/symbol would otherwise only surface as a silent 404 or
// (worse) a mismatched route, not a compile-time or even a first-request
// error.
for (const entry of INDEX_UNIVERSE) {
  const expectedSlug = slugifyIndexName(entry.name);
  if (entry.slug !== expectedSlug) {
    throw new Error(
      `[indexUniverse] "${entry.name}" has slug "${entry.slug}" but slugifyIndexName computes "${expectedSlug}"`,
    );
  }
  const expectedSymbol = deriveIndexSymbol(entry.name);
  if (entry.symbol !== expectedSymbol) {
    throw new Error(
      `[indexUniverse] "${entry.name}" has symbol "${entry.symbol}" but deriveIndexSymbol computes "${expectedSymbol}"`,
    );
  }
}
{
  const symbols = INDEX_UNIVERSE.map((e) => e.symbol);
  const dupes = symbols.filter((s, i) => symbols.indexOf(s) !== i);
  if (dupes.length > 0) {
    throw new Error(`[indexUniverse] duplicate symbol code(s): ${[...new Set(dupes)].join(", ")}`);
  }
}

const BY_SYMBOL = new Map(INDEX_UNIVERSE.map((e) => [e.symbol, e]));
const BY_SLUG = new Map(INDEX_UNIVERSE.map((e) => [e.slug, e]));
const BY_NORMALIZED_NAME = new Map(INDEX_UNIVERSE.map((e) => [normalizeIndexDisplayName(e.name), e]));

/** True for any `/instruments/[symbol]` code minted by this registry (view-only indices only — NOT the 5 tradable underlyings, which have their own page treatment via isIndexOptionUnderlying). */
export function isIndexUniverseSymbol(symbol: string): boolean {
  return BY_SYMBOL.has(symbol.trim().toUpperCase());
}

export function getIndexUniverseEntry(symbol: string): IndexUniverseEntry | null {
  return BY_SYMBOL.get(symbol.trim().toUpperCase()) ?? null;
}

export function getIndexUniverseEntryBySlug(slug: string): IndexUniverseEntry | null {
  return BY_SLUG.get(slug.trim().toUpperCase()) ?? null;
}

/**
 * Resolves a raw ExpertOpinion.instrument label to its INDEX_UNIVERSE entry:
 * exact normalized match against `name` first, then INDEX_NAME_ALIASES.
 * Never fuzzy — returns null (not a best-effort guess) when neither hits.
 * Used by the opinion backfill script (apps/api/scripts) and available for
 * any future consumer needing the same exact-match resolution.
 */
export function resolveIndexUniverseEntryByRawName(rawInstrument: string): IndexUniverseEntry | null {
  const normalized = normalizeIndexDisplayName(rawInstrument);
  const direct = BY_NORMALIZED_NAME.get(normalized);
  if (direct) return direct;
  const aliasTarget = INDEX_NAME_ALIASES[normalized];
  if (!aliasTarget) return null;
  return BY_NORMALIZED_NAME.get(normalizeIndexDisplayName(aliasTarget)) ?? null;
}

/** `{ symbol -> yahooTicker }`, e.g. for merging into apps/web's INDEX_OPINION_TICKER without hand-duplicating this registry's data. */
export const INDEX_UNIVERSE_OPINION_TICKER: Record<string, string> = Object.fromEntries(
  INDEX_UNIVERSE.map((e) => [e.symbol, e.yahooTicker]),
);

/** `{ symbol -> displayName }`, e.g. for merging into apps/web's INDEX_DISPLAY_NAME. */
export const INDEX_UNIVERSE_DISPLAY_NAME: Record<string, string> = Object.fromEntries(
  INDEX_UNIVERSE.map((e) => [e.symbol, e.displayName]),
);
