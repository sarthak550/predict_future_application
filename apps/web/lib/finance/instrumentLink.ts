/**
 * Resolves ExpertOpinion.instrument/instrumentTicker values to the bare NSE
 * symbol their /instruments/[symbol] page would use, and to the
 * authoritative company/index display name — founder ask, 2026-08-09: "make
 * the Instrument in Opinions clickable... this will also help with proper
 * mapping of instruments and removal of duplicate naming," sharpened the
 * same day to "each instrument needs to be understood properly for this."
 *
 * READS ONLY from `InstrumentAlias` (apps/api/prisma/schema.prisma) — the
 * persistent, self-extending resolution table populated at extraction time
 * by apps/api's resolveInstrumentAlias (lib/finance/instrumentAlias.ts) and
 * backfilled by scripts/backfill-instrument-alias.ts. This file does NOT
 * re-resolve against StockEodQuote/NSE data itself (that would duplicate the
 * exact logic apps/api already owns, and apps/web has no business deciding
 * instrument identity independently) — it only looks up rows apps/api has
 * already verified against a real authoritative source. See
 * InstrumentAlias's own doc comment for why a row only exists there once
 * something has genuinely been checked (never a guess).
 *
 * The lookup key (`rawName`) is computed via the SAME normalizeInstrumentRawName
 * both apps share (@predict-future/business-rules/instruments/instrumentDedup)
 * — ticker-first, falling back to a normalized label only when no ticker was
 * extracted — so a row here always matches what apps/api wrote for the exact
 * same raw (instrument, instrumentTicker) pair.
 *
 * DEFENSIVE: InstrumentAlias is a brand-new table that may not exist in a
 * given database yet (the founder runs `prisma db push` on their own
 * schedule — same convention as every schema change in this codebase). Every
 * function here degrades to "nothing resolved" rather than throwing if the
 * table is missing (Prisma error code P2021), so this page keeps working
 * exactly as it did before this feature shipped until the push happens, and
 * self-heals the moment it does — no redeploy needed.
 *
 * Deliberately conservative about WHAT gets a link/canonical name: only rows
 * apps/api has marked `resolved: true` qualify. Everything else — commodity
 * futures ("GC=F"), FX pairs ("INR=X"), delisted/renamed/mistyped tickers,
 * or a raw name InstrumentAlias hasn't seen yet (pre-dates this feature,
 * backfill hasn't reached it) — resolves to nothing. Callers render plain
 * text for those; see ExpandableCallsTable / opinionsQuery.ts.
 */

import type { Prisma } from "@prisma/client";

import { normalizeInstrumentRawName } from "@predict-future/business-rules/instruments/instrumentDedup";
import { prisma } from "@/lib/prisma";

export interface ResolvedInstrumentIdentity {
  /** Bare NSE symbol for /instruments/[symbol] ("RELIANCE", "NIFTY"). */
  symbol: string;
  /** Authoritative display name (never the raw AI-extracted string). */
  canonicalName: string;
}

/** True for a Prisma "table does not exist" error — see this file's own DEFENSIVE note above. */
function isMissingTableError(err: unknown): boolean {
  return typeof err === "object" && err !== null && "code" in err && (err as { code?: string }).code === "P2021";
}

/**
 * Batch-resolves a list of (instrumentTicker, instrument) pairs — as they
 * appear on a page of calls, duplicates and nulls included — against
 * InstrumentAlias. One indexed `IN (...)` query regardless of page size.
 * Rows with `resolved: false` (or missing from the table entirely) are
 * simply absent from the returned map.
 */
export async function resolveInstrumentIdentities(
  rows: { instrumentTicker: string | null | undefined; instrument: string | null | undefined }[],
): Promise<Map<string, ResolvedInstrumentIdentity>> {
  const rawNameByTicker = new Map<string, string>();
  for (const row of rows) {
    const rawName = normalizeInstrumentRawName(row.instrumentTicker, row.instrument);
    if (rawName && row.instrumentTicker) rawNameByTicker.set(row.instrumentTicker, rawName);
  }
  if (rawNameByTicker.size === 0) return new Map();

  try {
    const aliases = await prisma.instrumentAlias.findMany({
      where: { rawName: { in: [...new Set(rawNameByTicker.values())] }, resolved: true },
      select: { rawName: true, symbol: true, canonicalName: true },
    });
    const bySymbolRawName = new Map(aliases.map((a) => [a.rawName, a]));

    const result = new Map<string, ResolvedInstrumentIdentity>();
    for (const [ticker, rawName] of rawNameByTicker) {
      const alias = bySymbolRawName.get(rawName);
      if (alias?.symbol && alias.canonicalName) {
        result.set(ticker, { symbol: alias.symbol, canonicalName: alias.canonicalName });
      }
    }
    return result;
  } catch (err) {
    if (isMissingTableError(err)) return new Map();
    throw err;
  }
}

/** Back-compat shape for ExpandableCallsTable's `instrumentPageSymbol` prop — ticker -> bare symbol only. */
export async function resolveInstrumentPageSymbols(
  tickers: (string | null | undefined)[],
): Promise<Map<string, string>> {
  const identities = await resolveInstrumentIdentities(tickers.map((t) => ({ instrumentTicker: t, instrument: null })));
  const result = new Map<string, string>();
  for (const [ticker, identity] of identities) result.set(ticker, identity.symbol);
  return result;
}

/** Re-exported so opinionsQuery.ts can build a canonicalName -> InstrumentAlias.rawName[] index without importing Prisma types itself. */
export type InstrumentAliasWhereInput = Prisma.InstrumentAliasWhereInput;
export { isMissingTableError };
