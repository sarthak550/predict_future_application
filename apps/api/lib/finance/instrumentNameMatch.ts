import type { InstrumentResolutionSource, PrismaClient } from "@prisma/client";

import { deriveIndexSymbol, INDEX_UNIVERSE } from "@predict-future/business-rules/finance/indexUniverse";
import { BSE_INDEX_UNIVERSE } from "@predict-future/business-rules/finance/bseIndexUniverse";
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

let cache: {
  at: number;
  exact: Map<string, InstrumentNameMatch | null>;
  entries: UniverseEntry[];
  indexExact: Map<string, InstrumentNameMatch | null>;
} | null = null;
const CACHE_TTL_MS = 12 * 60 * 60 * 1000;

/**
 * Index-name identities the healer may map a label onto (2026-08-15 second
 * pass — the linkability sweep found sector/index labels like "Capital Goods
 * sector", "Nifty Consumer Durables", "PSU Bank Index" naming REAL index
 * pages this app hosts, invisible to the equity-only matcher above). Sourced
 * from the SAME self-owned IndexEodQuote/BseIndexEodQuote name sets the
 * instrument pages themselves resolve from (indexLongTail.ts's design), with
 * symbols derived by the same deriveIndexSymbol — so a matched label links
 * to a page that provably exists. `known` overrides (caller-supplied, from
 * KNOWN_INDEX_IDENTITIES' canonical names) win over derivation for the
 * indices whose page symbol is a short mnemonic ("NIFTY", "BANKNIFTY")
 * deriveIndexSymbol would never produce.
 *
 * EXACT MATCH ONLY — no prefix mode for indices ("NIFTY BANK" is a prefix
 * of half the sectoral family). The caller tries suffix/prefix VARIANTS of
 * the label ("capital goods sector" → "nifty capital goods"), but each
 * variant must land an exact index-name hit; identity law: a label links to
 * the index bearing that name, never a "closest" one.
 */
async function fetchIndexNameRows(prisma: PrismaClient): Promise<Array<{ name: string }>> {
  const rows: Array<{ name: string }> = [];
  for (const table of ['"IndexEodQuote"', '"BseIndexEodQuote"'] as const) {
    try {
      const r = await prisma.$queryRawUnsafe<Array<{ indexName: string }>>(
        `SELECT DISTINCT "indexName" FROM ${table}`
      );
      rows.push(...r.map((x) => ({ name: x.indexName })));
    } catch {
      // Table missing in a fresh DB — degrade, same convention as the BSE block below.
    }
  }
  return rows;
}

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

  // Index-name map (see fetchIndexNameRows' doc). Registry symbols win over
  // derivation — the tradable 5 + Yahoo-verified universes use page symbols
  // deriveIndexSymbol can't produce from the name alone.
  const knownIndexSymbolByName = new Map<string, string>([
    ["NIFTY 50", "NIFTY"],
    ["NIFTY BANK", "BANKNIFTY"],
    ["NIFTY FINANCIAL SERVICES", "FINNIFTY"],
    ["NIFTY MIDCAP SELECT", "MIDCPNIFTY"],
    ["NIFTY NEXT 50", "NIFTYNXT50"],
    ...INDEX_UNIVERSE.map((e): [string, string] => [normalizeCompanyName(e.name), e.symbol]),
    ...BSE_INDEX_UNIVERSE.map((e): [string, string] => [normalizeCompanyName(e.name), e.symbol]),
  ]);
  const indexExact = new Map<string, InstrumentNameMatch | null>();
  for (const { name } of await fetchIndexNameRows(prisma)) {
    const key = normalizeCompanyName(name);
    if (!key) continue;
    const symbol = knownIndexSymbolByName.get(key) ?? deriveIndexSymbol(name);
    const match: InstrumentNameMatch = { symbol, canonicalName: name, resolutionSource: "KNOWN_INDEX" };
    indexExact.set(key, indexExact.has(key) ? null : match);
  }

  cache = { at: now, exact, entries, indexExact };
  return cache;
}

/** Trailing label tokens carrying no identity ("Capital Goods SECTOR", "PSU Bank INDEX") — stripped when building index-name variants, never for equity matching. */
const INDEX_LABEL_SUFFIX_TOKENS = new Set(["SECTOR", "SECTORS", "INDEX", "SEGMENT", "SEGMENTS"]);

/**
 * Resolves a display label to a listed instrument, or null unless the match
 * is exact, a unique ≥2-token equity prefix, or an exact index name (tried
 * verbatim, suffix-stripped, and "NIFTY "-prefixed — each variant must land
 * a full exact hit). See module doc. Never throws.
 */
export async function matchInstrumentByName(prisma: PrismaClient, label: string): Promise<InstrumentNameMatch | null> {
  try {
    const key = normalizeCompanyName(label);
    if (!key) return null;
    const { exact, entries, indexExact } = await buildUniverse(prisma);

    const exactHit = exact.get(key);
    if (exactHit) return exactHit;
    if (exactHit === null) return null; // known-ambiguous exact name

    const labelTokens = key.split(" ");
    if (labelTokens.length >= 2) {
      const prefixHits = entries.filter(
        (e) => e.tokens.length > labelTokens.length && labelTokens.every((t, i) => e.tokens[i] === t)
      );
      if (prefixHits.length === 1) return prefixHits[0].match;
      if (prefixHits.length > 1) return null;
    }

    // Index variants — exact-only, see fetchIndexNameRows' doc. Verbatim
    // first ("Nifty Consumer Durables"), then suffix-stripped ("PSU Bank
    // Index" → "PSU BANK"), then "NIFTY "-prefixed on the stripped form
    // ("Capital Goods sector" → "NIFTY CAPITAL GOODS").
    const stripped = [...labelTokens];
    while (stripped.length > 1 && INDEX_LABEL_SUFFIX_TOKENS.has(stripped[stripped.length - 1])) stripped.pop();
    const variants = [key, stripped.join(" "), `NIFTY ${stripped.join(" ")}`];
    for (const variant of variants) {
      const hit = indexExact.get(variant);
      if (hit) return hit;
    }
    return null;
  } catch {
    return null;
  }
}
