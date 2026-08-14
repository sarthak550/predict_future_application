import type { InstrumentResolutionSource, PrismaClient } from "@prisma/client";

import { normalizeCompanyName } from "@/lib/marketMoves/nseSymbolResolver";
import { fetchEquityNames } from "@/lib/marketMoves/nse";

/**
 * Company-NAME → instrument identity matcher over the COMBINED listed
 * universe (NSE equity master + BSE-exclusive equities), for the
 * InstrumentAlias self-healing layer (founder, 2026-08-15: instruments in
 * Opinions "mapped but not clickable... needs to [be] handled at database
 * level and not always code, as we can't change the code every time a new
 * instrument comes in" — live example: "Kalyan Jewellers" opinions carrying
 * extraction-mangled tickers KALYAN.NS / KAJARI.NS that no ticker lookup
 * can ever fix, while the LABEL identifies the company unambiguously).
 *
 * PRECISION OVER RECALL, same law as nseSymbolResolver.ts (whose
 * normalization this reuses): a wrong link is strictly worse than no link.
 * Two match modes only, both requiring uniqueness across the ENTIRE
 * combined universe:
 *   1. EXACT — normalized label equals a normalized listed name
 *      ("NTPC" → NTPC Limited).
 *   2. UNIQUE TOKEN-PREFIX — the label's tokens (≥2, on token boundaries)
 *      are the leading tokens of exactly ONE listed name ("KALYAN
 *      JEWELLERS" → "KALYAN JEWELLERS INDIA LIMITED"; "KALYANI STEELS"
 *      shares no such prefix so can never collide). Single-token prefixes
 *      ("TATA") are categorically rejected — only the exact mode may match
 *      a single-token name. Ambiguity in either mode → no match.
 *
 * BSE-exclusive names resolve to their `.BO` page symbol with
 * resolutionSource BSE_EOD_QUOTE; NSE master matches use NSE_EQUITY_MASTER.
 * A name colliding ACROSS the two universes is ambiguous → never matched
 * (BseEodQuote is dual-listing-deduped at ingest, so this is a same-name-
 * different-company signal, exactly the case the identity law forbids
 * guessing on).
 */

export interface InstrumentNameMatch {
  symbol: string;
  canonicalName: string;
  resolutionSource: InstrumentResolutionSource;
}

type UniverseEntry = { key: string; tokens: string[]; match: InstrumentNameMatch };

let cache: { at: number; exact: Map<string, InstrumentNameMatch | null>; entries: UniverseEntry[] } | null = null;
const CACHE_TTL_MS = 12 * 60 * 60 * 1000;

async function buildUniverse(prisma: PrismaClient): Promise<NonNullable<typeof cache>> {
  const now = Date.now();
  if (cache && now - cache.at < CACHE_TTL_MS) return cache;

  const raw: Array<{ name: string; match: InstrumentNameMatch }> = [];

  const nseMaster = await fetchEquityNames().catch(() => new Map<string, string>());
  for (const [symbol, companyName] of nseMaster) {
    raw.push({ name: companyName, match: { symbol, canonicalName: companyName, resolutionSource: "NSE_EQUITY_MASTER" } });
  }

  // BSE-exclusive names (latest companyName per ticker) — raw DISTINCT ON,
  // Prisma's findMany distinct is client-side emulation (latestQuotes.ts doc).
  try {
    const bseRows = await prisma.$queryRaw<Array<{ tickerSymbol: string; companyName: string }>>`
      SELECT DISTINCT ON ("tickerSymbol") "tickerSymbol", "companyName"
      FROM "BseEodQuote"
      ORDER BY "tickerSymbol" ASC, "sessionDate" DESC
    `;
    for (const r of bseRows) {
      raw.push({
        name: r.companyName,
        match: {
          symbol: `${r.tickerSymbol.toUpperCase()}.BO`,
          canonicalName: r.companyName,
          resolutionSource: "BSE_EOD_QUOTE",
        },
      });
    }
  } catch {
    // Table missing in a fresh DB — degrade to NSE-only, same convention as
    // instrumentAlias.ts's own BSE fallback.
  }

  const exact = new Map<string, InstrumentNameMatch | null>();
  const entries: UniverseEntry[] = [];
  for (const { name, match } of raw) {
    const key = normalizeCompanyName(name);
    if (!key) continue;
    exact.set(key, exact.has(key) ? null : match); // collision → ambiguous → never resolve
    entries.push({ key, tokens: key.split(" "), match });
  }

  cache = { at: now, exact, entries };
  return cache;
}

/** Resolves a display label to a listed instrument, or null unless the match is exact or a unique ≥2-token prefix — see module doc. Never throws. */
export async function matchInstrumentByName(prisma: PrismaClient, label: string): Promise<InstrumentNameMatch | null> {
  try {
    const key = normalizeCompanyName(label);
    if (!key) return null;
    const { exact, entries } = await buildUniverse(prisma);

    const exactHit = exact.get(key);
    if (exactHit) return exactHit;
    if (exactHit === null) return null; // known-ambiguous exact name

    const labelTokens = key.split(" ");
    if (labelTokens.length < 2) return null;
    const prefixHits = entries.filter(
      (e) => e.tokens.length > labelTokens.length && labelTokens.every((t, i) => e.tokens[i] === t)
    );
    if (prefixHits.length === 1) return prefixHits[0].match;
    return null;
  } catch {
    return null;
  }
}
