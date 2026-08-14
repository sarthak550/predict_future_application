/**
 * Extraction-time instrument-identity resolution — the instrument-side
 * mirror of findOrCreateExpert (lib/finance/expertMatch.ts).
 *
 * Root problem this solves: ExpertOpinion.instrument/instrumentTicker are
 * AI-extracted (lib/ai/extractInstrument.ts — keyword map first, Groq
 * fallback) and can be wrong, stale, or hallucinated. Grouping/linking
 * directly off that raw string (or even off instrumentTicker as-is) launders
 * extraction error into a clean-looking but INCORRECT merge. Founder ask,
 * 2026-08-09: "each instrument needs to be understood properly... mapping of
 * names we found in article and what is the exact instrument they refer to."
 *
 * resolveInstrumentAlias is LOOKUP-FIRST + self-extending, exactly like
 * findOrCreateExpert: check InstrumentAlias by normalized rawName; on a hit,
 * return it (no re-verification). On a miss, resolve against REAL
 * authoritative sources only — never guess from the raw string — and persist
 * the result EITHER WAY (resolved or not) so the same raw name never
 * re-attempts a known-failing lookup. See InstrumentAlias's own doc comment
 * (prisma/schema.prisma) for why false rows are kept, not deleted.
 */

import type { InstrumentAlias, InstrumentResolutionSource, PrismaClient } from "@prisma/client";

import { normalizeInstrumentRawName } from "@predict-future/business-rules/instruments/instrumentDedup";
import { INDEX_UNIVERSE } from "@predict-future/business-rules/finance/indexUniverse";
import { BSE_INDEX_UNIVERSE } from "@predict-future/business-rules/finance/bseIndexUniverse";
import { sanitizeExtractedValue } from "@/lib/ai/sanitizeExtractedValue";
import { fetchEquityNames } from "@/lib/marketMoves/nse";
import { matchInstrumentByName } from "@/lib/finance/instrumentNameMatch";

/**
 * Small, stable, hand-verified index-identity map — the only non-equity
 * instruments this resolver ever resolves. Originally a 2-entry set mirroring
 * apps/web's now-retired instrumentLink.ts (FINNIFTY/MIDCPNIFTY/NIFTYNXT50
 * opinions haven't been observed in the wild yet — expand here if that
 * changes). Extended 2026-08-09 (Index Universe Expansion, Sprint A) with
 * every INDEX_UNIVERSE entry (business-rules) — generated from that registry
 * rather than hand-duplicated, per the assigning brief's own warning against
 * two disagreeing index-identity registries. `INDEX_UNIVERSE` was found
 * ALREADY LIVE in this DB (163 InstrumentAlias rows present) when this
 * ticket was picked up, not still dormant as the brief assumed — see this
 * ticket's report.
 */
const KNOWN_INDEX_IDENTITIES: Record<string, { symbol: string; canonicalName: string }> = {
  "^NSEI": { symbol: "NIFTY", canonicalName: "NIFTY 50" },
  "^NSEBANK": { symbol: "BANKNIFTY", canonicalName: "NIFTY BANK" },
  // Index Identity Audit (2026-08-10) — mirrors apps/web's
  // lib/finance/instrument.ts INDEX_OPINION_TICKER addition of the same 3
  // tradable-underlying symbols (see that file's comment for the live
  // Yahoo-vs-NSE verification evidence). Keys are the verified Yahoo
  // tickers (this map is keyed by ticker, same as ^NSEI/^NSEBANK above —
  // NOT by the F&O symbol code, which is a different string entirely).
  "NIFTY_FIN_SERVICE.NS": { symbol: "FINNIFTY", canonicalName: "NIFTY FINANCIAL SERVICES" },
  "NIFTY_MID_SELECT.NS": { symbol: "MIDCPNIFTY", canonicalName: "NIFTY MIDCAP SELECT" },
  "^NSMIDCP": { symbol: "NIFTYNXT50", canonicalName: "NIFTY NEXT 50" },
  ...Object.fromEntries(
    INDEX_UNIVERSE.map((e) => [e.yahooTicker, { symbol: e.symbol, canonicalName: e.displayName }]),
  ),
  // BSE Expansion Phase 2 (2026-08-12) — the founder-visible win this phase
  // ships: prod has real SENSEX opinions carrying "^BSESN" with nowhere to
  // resolve (see business-rules/bseIndexUniverse.ts's own module doc for the
  // live verification). Generated from BSE_INDEX_UNIVERSE, never
  // hand-duplicated, same discipline as the INDEX_UNIVERSE spread above.
  ...Object.fromEntries(
    BSE_INDEX_UNIVERSE.map((e) => [e.yahooTicker, { symbol: e.symbol, canonicalName: e.displayName }]),
  ),
};

/** Yahoo-style NSE equity ticker only ("RELIANCE.NS" -> "RELIANCE"). */
function bareEquitySymbol(ticker: string): string | null {
  const m = /^([A-Z0-9&-]+)\.NS$/i.exec(ticker);
  return m ? m[1].toUpperCase() : null;
}

/**
 * BSE Expansion Phase 3A (2026-08-12) — the `.BO` sibling of
 * `bareEquitySymbol`. Kept as a SEPARATE function (not a generalized
 * "any suffix" parser) deliberately: a `.BO` ticker's resolution path is NOT
 * symmetric with `.NS` (see `resolveAuthoritatively`'s own comment) — NSE
 * resolution is always tried FIRST for a `.BO` ticker too (dual-listed
 * regression law), and only a genuine miss falls through to the BSE-only
 * fallback below. Collapsing both into one "parse suffix" helper would
 * obscure that asymmetry at the call site.
 */
function bareBseTicker(ticker: string): string | null {
  const m = /^([A-Z0-9&-]+)\.BO$/i.exec(ticker);
  return m ? m[1].toUpperCase() : null;
}

/**
 * Yahoo-style canonical ticker for an alias-resolved EQUITY symbol — the
 * exact shape instrument pages' `startsWith('<symbol>.')` opinion matching
 * expects. A BSE-only symbol already carries its ".BO" page suffix; a bare
 * NSE symbol gets ".NS". Never call for an index resolution (index pages
 * match verbatim Yahoo tickers via INDEX_OPINION_TICKER maps instead).
 */
export function canonicalEquityTicker(symbol: string): string {
  return symbol.includes(".") ? symbol.toUpperCase() : `${symbol.toUpperCase()}.NS`;
}

export interface InstrumentAliasResolution {
  resolved: boolean;
  symbol: string | null;
  canonicalName: string | null;
  resolutionSource: InstrumentResolutionSource | null;
}

function toResolution(row: InstrumentAlias): InstrumentAliasResolution {
  return {
    resolved: row.resolved,
    symbol: row.symbol,
    canonicalName: row.canonicalName,
    resolutionSource: row.resolutionSource,
  };
}

/**
 * Resolves a ticker against REAL authoritative sources only, in order of
 * strength:
 *   1. KNOWN_INDEX — the hardcoded index map above.
 *   2. STOCK_EOD_QUOTE — a real EOD-traded quote row exists for this bare
 *      symbol (proof it actually traded; carries its real company name from
 *      the exchange feed itself).
 *   3. NSE_EQUITY_MASTER — nse.ts's fetchEquityNames() (NSE's own full
 *      listed-equity roster, already fetched/cached for BSE-name matching in
 *      nseSymbolResolver.ts) carries this symbol. Used when no EOD quote row
 *      exists yet, e.g. a freshly-listed symbol our bhavcopy ingestion
 *      hasn't caught up to.
 *   4. BSE_EOD_QUOTE (BSE Expansion Phase 3A, 2026-08-12) — ONLY reached for
 *      a `.BO`-suffixed ticker that missed BOTH of the above. Real BseEodQuote
 *      row exists for this bare ticker (the /instruments/[symbol] page is
 *      `${tickerSymbol}.BO` — see BseEodQuote's own schema doc on the
 *      namespace decision).
 *
 * DUAL-LISTED REGRESSION LAW (critical, do not reorder): a `.BO`-suffixed
 * ticker is NOT special-cased to skip straight to BSE_EOD_QUOTE — it is
 * checked against STOCK_EOD_QUOTE/NSE_EQUITY_MASTER FIRST, identically to a
 * `.NS` ticker, using the exact same bare symbol. This is what makes
 * "RELIANCE.BO" resolve to NSE's real RELIANCE row (STOCK_EOD_QUOTE) rather
 * than ever reaching the BSE-only fallback — BseEodQuote is populated ONLY
 * with rows that already failed an NSE dual-listing check at ingestion time
 * (see bseBhavcopy.ts), so in practice a dual-listed `.BO` ticker would
 * never match a BseEodQuote row anyway, but resolving via the stronger NSE
 * signal first (when both theoretically could match) is the correct,
 * intentional precedence, not an accident of ordering.
 *
 *   5. NAME MATCH (2026-08-15, founder: instruments "mapped but not
 *      clickable... handled at database level") — when every ticker path
 *      missed but the opinion carried a display LABEL, match the label
 *      against the combined NSE+BSE listed-name universe (exact or unique
 *      ≥2-token prefix ONLY — see instrumentNameMatch.ts's precision law).
 *      This is what resolves an extraction-mangled ticker ("KALYAN.NS",
 *      "KAJARI.NS") whose label ("Kalyan Jewellers") identifies the company
 *      unambiguously — the ticker paths above can never fix those.
 *
 * Commodity futures, FX pairs, sectoral indices, and any ticker matching
 * none of the above return null — genuinely unresolvable, not a gap in this
 * function.
 */
async function resolveAuthoritatively(
  prisma: PrismaClient,
  ticker: string | null,
  label: string | null = null,
): Promise<{ symbol: string; canonicalName: string; resolutionSource: InstrumentResolutionSource } | null> {
  const nameFallback = async () => (label ? matchInstrumentByName(prisma, label) : null);
  if (!ticker) return nameFallback();

  const known = KNOWN_INDEX_IDENTITIES[ticker];
  if (known) return { ...known, resolutionSource: "KNOWN_INDEX" };

  const bseBareTicker = bareBseTicker(ticker);
  const bare = bareEquitySymbol(ticker) ?? bseBareTicker;
  if (!bare) return nameFallback();

  const eodRows = await prisma.stockEodQuote.findMany({
    where: { symbol: bare },
    orderBy: { sessionDate: "desc" },
    take: 1,
    select: { companyName: true },
  });
  if (eodRows[0]?.companyName) {
    return { symbol: bare, canonicalName: eodRows[0].companyName, resolutionSource: "STOCK_EOD_QUOTE" };
  }

  const equityNames = await fetchEquityNames();
  const companyName = equityNames.get(bare);
  if (companyName) {
    return { symbol: bare, canonicalName: companyName, resolutionSource: "NSE_EQUITY_MASTER" };
  }

  // BSE Expansion Phase 3A (2026-08-12) — BSE-only fallback, ONLY for a
  // `.BO`-suffixed ticker that missed both NSE paths above (see this
  // function's own doc on why the check order matters). Defensive against
  // BseEodQuote not existing yet in a given database (prod push is the
  // coordinator's own call, same convention as InstrumentAlias's own
  // "ADDITIVE, NOT YET PUSHED" schema doc) — a P2021 here degrades this ONE
  // branch to "not found," it must never crash the extraction pipeline this
  // function is called from mid-persist.
  if (bseBareTicker) {
    try {
      const bseRows = await prisma.bseEodQuote.findMany({
        where: { tickerSymbol: { equals: bseBareTicker, mode: "insensitive" } },
        orderBy: { sessionDate: "desc" },
        take: 1,
        select: { tickerSymbol: true, companyName: true },
      });
      if (bseRows[0]) {
        return {
          symbol: `${bseRows[0].tickerSymbol.toUpperCase()}.BO`,
          canonicalName: bseRows[0].companyName,
          resolutionSource: "BSE_EOD_QUOTE",
        };
      }
    } catch (err) {
      const isMissingTable = typeof err === "object" && err !== null && "code" in err && (err as { code?: string }).code === "P2021";
      if (!isMissingTable) throw err;
    }
  }

  return nameFallback();
}

/**
 * Read-only preview of what resolveAuthoritatively (below) WOULD find for a
 * given ticker — does not touch InstrumentAlias at all (no read, no write).
 * Exists so scripts/backfill-instrument-alias.ts's `--dry-run` mode (the
 * default) can report real, live resolution results before the
 * InstrumentAlias table itself has been pushed to any database — a plain
 * `resolveInstrumentAlias` call would fail outright (table doesn't exist
 * yet) even in a would-be-dry-run, since its lookup-first step reads the
 * table unconditionally.
 */
export async function previewInstrumentResolution(
  prisma: PrismaClient,
  instrumentLabel: string | null | undefined,
  ticker: string | null | undefined,
): Promise<{ rawName: string | null; resolution: Awaited<ReturnType<typeof resolveAuthoritatively>> }> {
  // Guard against AI junk sentinels ("null"/"NULL"/"None"/"N/A"/"undefined")
  // ever becoming a rawName lookup key — see sanitizeExtractedValue's doc
  // comment for the founder-reported prod bug this closes (a junk
  // rawName="NULL" InstrumentAlias row).
  const sanitizedLabel = sanitizeExtractedValue(instrumentLabel);
  const sanitizedTicker = sanitizeExtractedValue(ticker);
  const rawName = normalizeInstrumentRawName(sanitizedTicker, sanitizedLabel);
  const resolution = await resolveAuthoritatively(prisma, sanitizedTicker, sanitizedLabel);
  return { rawName, resolution };
}

/**
 * Lookup-first, self-extending. Returns null only when neither a ticker nor
 * an instrument label was supplied (nothing to key on) — every other case
 * returns a resolution, `resolved: false` included, and persists it.
 *
 * Never throws on the happy path — a resolution failure degrades to
 * `resolved: false` rather than propagating, so a caller in the middle of
 * persisting an opinion (extractExpertOpinions.ts) can await this without
 * its own try/catch duplicating this one. Genuine infrastructure errors
 * (DB unreachable) DO propagate — silently swallowing those would let a
 * transient outage get permanently misrecorded as "unresolvable."
 */
export async function resolveInstrumentAlias(
  prisma: PrismaClient,
  instrumentLabel: string | null | undefined,
  ticker: string | null | undefined,
): Promise<InstrumentAliasResolution | null> {
  // Permanent write-boundary guard (founder-reported prod bug, 2026-08-09): a
  // junk rawName="NULL" InstrumentAlias row was created here because callers
  // could pass through an AI-emitted literal "null" string uncaught. Callers
  // now sanitize before calling this function too (extractExpertOpinions.ts),
  // but this is the permanent stop, mirroring findOrCreateExpert's hard guard
  // for blank Expert names — this function must never persist a junk rawName
  // even if a future caller regresses the upstream sanitization.
  const sanitizedLabel = sanitizeExtractedValue(instrumentLabel);
  const sanitizedTicker = sanitizeExtractedValue(ticker);
  const rawName = normalizeInstrumentRawName(sanitizedTicker, sanitizedLabel);
  if (!rawName) return null;

  const existing = await prisma.instrumentAlias.findUnique({ where: { rawName } });
  if (existing) return toResolution(existing);

  const resolution = await resolveAuthoritatively(prisma, sanitizedTicker, sanitizedLabel);
  const now = new Date();

  // Upsert, not create+catch — a concurrent extraction can race this exact
  // rawName between our findUnique and write (two stories about the same
  // stock landing in parallel crons). Mirrors findOrCreateExpert's own
  // defensive-upsert convention (expertMatch.ts).
  const saved = await prisma.instrumentAlias.upsert({
    where: { rawName },
    update: {},
    create: {
      rawName,
      resolved: resolution !== null,
      symbol: resolution?.symbol ?? null,
      canonicalName: resolution?.canonicalName ?? null,
      resolutionSource: resolution?.resolutionSource ?? null,
      resolvedAt: resolution !== null ? now : null,
    },
  });

  return toResolution(saved);
}

/**
 * Self-healing retry over every `resolved: false` InstrumentAlias row
 * (founder, 2026-08-15: unresolved instruments must fix themselves "at
 * database level... we can't change the code every time a new instrument
 * comes in"). Run daily by /api/cron/refresh-instrument-aliases; also
 * replaces the manual scripts/refresh-stale-index-aliases.ts chore.
 *
 * Two retry angles per stale row, in order:
 *   1. TICKER RETRY — re-run the full authoritative chain on the rawName
 *      itself (ticker-keyed rows). This is what flips a negative row the
 *      day a NEW instrument starts trading (fresh IPO, BSE universe growth,
 *      index-registry addition) — the sources GROW, the old verdict doesn't.
 *   2. LABEL CONSENSUS — collect the display labels of every live opinion
 *      whose (ticker, label) pair normalizes to this row's key (the alias
 *      row itself never stored the label for ticker-keyed rows), plus the
 *      rawName itself for label-keyed rows, and name-match each
 *      (instrumentNameMatch.ts, exact/unique-prefix only). Resolves ONLY on
 *      unanimous agreement — labels matching two different symbols, or none,
 *      leave the row untouched. This is what fixes extraction-mangled
 *      tickers ("KALYAN.NS"/"KAJARI.NS" → the "Kalyan Jewellers" label →
 *      KALYANKJIL) that a ticker retry can never reach.
 *
 * A row that stays unresolved is simply retried again next run — cheap
 * (the table holds ~100 negative rows) and the honest steady state for
 * genuinely unlinkable instruments (commodities, FX, delisted names).
 */
export async function retryUnresolvedInstrumentAliases(
  prisma: PrismaClient,
): Promise<{
  scanned: number;
  seeded: number;
  seededResolved: number;
  resolvedByTicker: number;
  resolvedByLabel: number;
  opinionTickersRepaired: number;
}> {
  // One bounded pass over live opinions builds the key → labels map (the
  // alias table is keyed by normalized rawName; ticker-keyed rows dropped
  // their label at write time, so it's recovered from the opinions here).
  const opinions = await prisma.expertOpinion.findMany({
    where: { suppressedAt: null },
    select: { id: true, instrument: true, instrumentTicker: true },
  });
  const labelsByKey = new Map<string, Set<string>>();
  const pairByKey = new Map<string, { ticker: string | null; label: string | null }>();
  for (const o of opinions) {
    const ticker = sanitizeExtractedValue(o.instrumentTicker);
    const label = sanitizeExtractedValue(o.instrument);
    const key = normalizeInstrumentRawName(ticker, label);
    if (!key) continue;
    if (!pairByKey.has(key)) pairByKey.set(key, { ticker, label });
    if (!label) continue;
    if (!labelsByKey.has(key)) labelsByKey.set(key, new Set());
    labelsByKey.get(key)!.add(label);
  }

  // SEED pass (2026-08-15 second sweep, founder: "run the analysis on all
  // instruments which are currently non-clickable"): an opinion whose
  // extraction PREDATED the alias system has no alias row at all — the
  // retry passes below can only flip rows that exist, so those opinions
  // stayed permanently unlinked and invisible to this healer. Every live
  // opinion key missing a row gets one created here via the standard
  // resolver (which now carries the label fallback), so the nightly run
  // covers the entire live-opinion surface, past and future.
  const existingKeys = new Set(
    (await prisma.instrumentAlias.findMany({ select: { rawName: true } })).map((r) => r.rawName)
  );
  let seeded = 0;
  let seededResolved = 0;
  for (const [key, pair] of pairByKey) {
    if (existingKeys.has(key)) continue;
    const res = await resolveInstrumentAlias(prisma, pair.label, pair.ticker).catch(() => null);
    seeded++;
    if (res?.resolved) seededResolved++;
  }

  const stale = await prisma.instrumentAlias.findMany({ where: { resolved: false } });

  let resolvedByTicker = 0;
  let resolvedByLabel = 0;
  const now = new Date();

  for (const row of stale) {
    let resolution = await resolveAuthoritatively(prisma, row.rawName).catch(() => null);
    let via: "ticker" | "label" = "ticker";

    if (!resolution) {
      const labels = new Set(labelsByKey.get(row.rawName) ?? []);
      // A label-keyed row's rawName IS its (normalized) label — always a candidate.
      if (!/\.(NS|BO)$/i.test(row.rawName)) labels.add(row.rawName);
      const matches: Array<NonNullable<Awaited<ReturnType<typeof matchInstrumentByName>>>> = [];
      for (const label of labels) {
        const m = await matchInstrumentByName(prisma, label);
        if (m) matches.push(m);
      }
      const symbols = new Set(matches.map((m) => m.symbol));
      if (matches.length > 0 && symbols.size === 1) {
        resolution = matches[0];
        via = "label";
      }
    }

    if (!resolution) continue;
    await prisma.instrumentAlias.update({
      where: { rawName: row.rawName },
      data: {
        resolved: true,
        symbol: resolution.symbol,
        canonicalName: resolution.canonicalName,
        resolutionSource: resolution.resolutionSource,
        resolvedAt: now,
      },
    });
    if (via === "ticker") resolvedByTicker++;
    else resolvedByLabel++;
  }

  // REPAIR pass (2026-08-15, founder: "we have opinions on many instruments
  // but still the stocks instrument page are not showing them"): the alias
  // maps an opinion's mangled ticker to the right company, but instrument
  // pages find their opinions via a `instrumentTicker startsWith
  // '<symbol>.'` prefix on the STORED ticker — so a "KALYAN.NS" opinion
  // never surfaced on /instruments/KALYANKJIL no matter what the alias said.
  // Every live opinion whose key maps to an EQUITY-resolved alias gets its
  // stored ticker rewritten to the canonical form the page matches
  // (extraction now writes canonical tickers up front — this pass repairs
  // the backlog and any row that slips through). Index-resolved aliases are
  // deliberately excluded: index pages match verbatim Yahoo tickers via
  // their own INDEX_OPINION_TICKER maps, which a rewrite would break. Same
  // precedent as the ~45 opinions repaired during the index-identity audit
  // (2026-08-10) — fix the stored data, don't post-hoc fuzzy-match around it.
  const resolvedAliases = await prisma.instrumentAlias.findMany({
    where: { resolved: true, resolutionSource: { not: "KNOWN_INDEX" }, symbol: { not: null } },
    select: { rawName: true, symbol: true },
  });
  const equityAliasByKey = new Map(resolvedAliases.map((a) => [a.rawName, a.symbol as string]));
  let opinionTickersRepaired = 0;
  for (const o of opinions) {
    const ticker = sanitizeExtractedValue(o.instrumentTicker);
    const label = sanitizeExtractedValue(o.instrument);
    const key = normalizeInstrumentRawName(ticker, label);
    if (!key) continue;
    const symbol = equityAliasByKey.get(key);
    if (!symbol) continue;
    const canonical = canonicalEquityTicker(symbol);
    if ((ticker ?? "").toUpperCase() === canonical) continue;
    await prisma.expertOpinion.update({ where: { id: o.id }, data: { instrumentTicker: canonical } });
    opinionTickersRepaired++;
  }

  return { scanned: stale.length, seeded, seededResolved, resolvedByTicker, resolvedByLabel, opinionTickersRepaired };
}
