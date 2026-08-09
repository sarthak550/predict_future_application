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
import { sanitizeExtractedValue } from "@/lib/ai/sanitizeExtractedValue";
import { fetchEquityNames } from "@/lib/marketMoves/nse";

/**
 * Small, stable, hand-verified index-identity map — the only non-equity
 * instruments this resolver ever resolves. Mirrors the same 2-entry set
 * apps/web's now-retired instrumentLink.ts hardcoded (FINNIFTY/MIDCPNIFTY/
 * NIFTYNXT50 opinions haven't been observed in the wild yet — expand here if
 * that changes).
 */
const KNOWN_INDEX_IDENTITIES: Record<string, { symbol: string; canonicalName: string }> = {
  "^NSEI": { symbol: "NIFTY", canonicalName: "NIFTY 50" },
  "^NSEBANK": { symbol: "BANKNIFTY", canonicalName: "NIFTY BANK" },
};

/** Yahoo-style NSE equity ticker only ("RELIANCE.NS" -> "RELIANCE"). */
function bareEquitySymbol(ticker: string): string | null {
  const m = /^([A-Z0-9&-]+)\.NS$/i.exec(ticker);
  return m ? m[1].toUpperCase() : null;
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
 * Commodity futures, FX pairs, sectoral indices, and any ticker matching
 * none of the above return null — genuinely unresolvable, not a gap in this
 * function.
 */
async function resolveAuthoritatively(
  prisma: PrismaClient,
  ticker: string | null,
): Promise<{ symbol: string; canonicalName: string; resolutionSource: InstrumentResolutionSource } | null> {
  if (!ticker) return null;

  const known = KNOWN_INDEX_IDENTITIES[ticker];
  if (known) return { ...known, resolutionSource: "KNOWN_INDEX" };

  const bare = bareEquitySymbol(ticker);
  if (!bare) return null;

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

  return null;
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
  const resolution = await resolveAuthoritatively(prisma, sanitizedTicker);
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

  const resolution = await resolveAuthoritatively(prisma, sanitizedTicker);
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
