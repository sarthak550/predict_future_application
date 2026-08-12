/**
 * BSE_INDEX_UNIVERSE — the BSE-side sibling of `indexUniverse.ts`'s
 * `INDEX_UNIVERSE`: every BSE index promoted from the DB-derived "long tail"
 * (apps/web/lib/finance/bseIndexLongTail.ts) to a full `/instruments/[symbol]`
 * page WITH a live 1D intraday pipe and QuoteHeader live overlay, because a
 * real Yahoo Finance ticker was verified live to (a) serve a genuine 1-minute
 * intraday series for the current session and (b) price-match this app's own
 * `BseIndexEodQuote` latest close — the IDENTICAL two-part bar
 * `indexUniverse.ts`'s own module doc documents for NSE, just run against BSE
 * `IndexArchDailyAll` as the reference instead of NSE's `/api/allIndices`.
 *
 * BSE Expansion Phase 2 (2026-08-12), CTO assignment brief section "Phase 2 —
 * BSE Index Full Instrument Pages". Verified live 2026-08-12 against the same
 * local dev BseIndexEodQuote snapshot Phase 1 backfilled (sessionDate
 * 2026-08-10, the latest ingested at verification time): every entry below
 * returned HTTP 200, a real 376-bar 1-minute intraday series
 * (`range=1d&interval=1m`), AND a `chart.result[0].meta.regularMarketPrice`
 * EXACTLY equal (not just "close enough") to this app's own stored
 * `BseIndexEodQuote.close` for the same index/session — same evidence bar as
 * `INDEX_UNIVERSE`'s own per-index log, restated here rather than in a
 * separate ticket-report file per this module's own convention of keeping
 * the check reproducible from the comment alone.
 *
 * CANDIDATES CHECKED BUT EXCLUDED (do not re-add without fresh verification):
 *   - "BSE-MIDCAP.BO" (44246.27) and "BSE-SMLCAP.BO" (46825.31) both resolve
 *     to a REAL, live, intraday-backed Yahoo series — but the price matches
 *     NEITHER "BSE MidCap" (49275.29) NOR "BSE MidCap Select Index"
 *     (18844.65), and likewise for SmallCap ("BSE SmallCap" 57793.26 vs
 *     "BSE SmallCap Select Index" 9114.79). These are real Yahoo tickers for
 *     SOME BSE-adjacent series, just not verifiably any of our 133 ingested
 *     index names — exactly the "quote meta present but wrong index" false
 *     positive `INDEX_UNIVERSE`'s own module doc warns about. Excluded.
 *   - "BSE-BANKEX.BO" 404s (confirmed dead, matches Phase 1's own finding) —
 *     but BANKEX itself IS live, just under ticker "BSE-BANK.BO" (a wrong
 *     ticker guess, not a genuinely absent feed — see the BANKEX entry
 *     below).
 *   - Sensex 50, PSU Bank, Energy, Telecommunication, Industrials, Financial
 *     Services, and every strategy/factor index (Momentum/Quality/Low
 *     Volatility/Enhanced Value/Dividend Leaders/...) — every plausible
 *     ticker guess (BSE-SENSEX50.BO, ^BSE50, BSE-PSUBNK.BO, BSE-ENGY.BO,
 *     BSE-TEL.BO, BSE-INDUS.BO, BSE-FIN.BO, BSE-DOLLEX*.BO, ...) 404s. These
 *     stay on the long-tail tier (self-owned daily history only, no live
 *     pipe) — not downgraded or removed from anywhere, simply never
 *     promoted, same non-negotiable rule as `INDEX_UNIVERSE`'s own tiering.
 *
 * FIELDS — same shape/derivation discipline as `IndexUniverseEntry`:
 *   - `name`         = BseIndexEodQuote.indexName verbatim (BSE's own
 *                      "I_name", e.g. "BSE SENSEX") — join key for the daily
 *                      OHLC query AND (aliased) for opinion-ticker resolution.
 *   - `displayName`  = hand-written human-casing for UI headers.
 *   - `slug`         = slugifyIndexName(name) — REUSED from ./indexSlug, not
 *                      reimplemented (same function NSE's registry uses; it's
 *                      generic over any display name, not NSE-specific).
 *   - `symbol`       = deriveIndexSymbol(name) — REUSED from ./indexUniverse
 *                      for the identical reason. Every BSE index name is
 *                      itself "BSE "/"S&P BSE "-prefixed (verified across all
 *                      133 ingested names, 2026-08-12), so every derived code
 *                      here is BSE-prefixed by construction — collision-free
 *                      against NSE's "NIFTY"-prefixed/unprefixed convention
 *                      without any special-casing. Acceptance-blocking
 *                      collision check: apps/api/scripts/check-bse-collisions.ts
 *                      (already covers every BseIndexEodQuote-derived code,
 *                      this tier included — it doesn't distinguish "will get
 *                      a live pipe" from "long-tail only", both derive the
 *                      same way). Re-run locally 2026-08-12: zero collisions
 *                      across all 133 names. COORDINATOR MUST RE-RUN AGAINST
 *                      PROD IMMEDIATELY BEFORE DEPLOY, same standing rule as
 *                      `INDEX_UNIVERSE`'s own module doc.
 *   - `yahooTicker`  = the verified-live Yahoo ticker; doubles as the
 *                      ExpertOpinion.instrumentTicker this index's opinions
 *                      resolve under (same one-identity-two-jobs pattern as
 *                      `INDEX_UNIVERSE`).
 */

import { slugifyIndexName } from "./indexSlug";
import { deriveIndexSymbol } from "./indexUniverse";

export interface BseIndexUniverseEntry {
  /** BseIndexEodQuote.indexName verbatim — join key back to that table and to raw ExpertOpinion.instrument text. */
  name: string;
  /** Human-friendly display name for instrument-page headers. */
  displayName: string;
  /** slugifyIndexName(name) — asserted to match at module load. */
  slug: string;
  /** `/instruments/[symbol]` URL segment — deriveIndexSymbol(name), asserted to match at module load. */
  symbol: string;
  /** Verified-live Yahoo Finance ticker (see module doc for the verification bar). Also the ExpertOpinion.instrumentTicker this index's opinions resolve under. */
  yahooTicker: string;
}

export const BSE_INDEX_UNIVERSE: readonly BseIndexUniverseEntry[] = [
  { name: "BSE SENSEX", displayName: "BSE Sensex", slug: "BSE-SENSEX", symbol: "BSESENSEX", yahooTicker: "^BSESN" },
  { name: "BSE 100", displayName: "BSE 100", slug: "BSE-100", symbol: "BSE100", yahooTicker: "BSE-100.BO" },
  { name: "BSE 200", displayName: "BSE 200", slug: "BSE-200", symbol: "BSE200", yahooTicker: "BSE-200.BO" },
  { name: "BSE 500", displayName: "BSE 500", slug: "BSE-500", symbol: "BSE500", yahooTicker: "BSE-500.BO" },
  { name: "BSE AUTO", displayName: "BSE Auto", slug: "BSE-AUTO", symbol: "BSEAUTO", yahooTicker: "BSE-AUTO.BO" },
  { name: "BSE TECK", displayName: "BSE Teck", slug: "BSE-TECK", symbol: "BSETECK", yahooTicker: "BSE-TECK.BO" },
  {
    name: "BSE Healthcare",
    displayName: "BSE Healthcare",
    slug: "BSE-HEALTHCARE",
    symbol: "BSEHEALTHCARE",
    yahooTicker: "BSE-HC.BO",
  },
  {
    name: "BSE Information Technology",
    displayName: "BSE Information Technology",
    slug: "BSE-INFORMATION-TECHNOLOGY",
    symbol: "BSEINFORMATIONTECHNOLOGY",
    yahooTicker: "BSE-IT.BO",
  },
  { name: "BSE PSU", displayName: "BSE PSU", slug: "BSE-PSU", symbol: "BSEPSU", yahooTicker: "BSE-PSU.BO" },
  { name: "BSE METAL", displayName: "BSE Metal", slug: "BSE-METAL", symbol: "BSEMETAL", yahooTicker: "BSE-METAL.BO" },
  {
    name: "BSE OIL & GAS",
    displayName: "BSE Oil & Gas",
    slug: "BSE-OIL-GAS",
    symbol: "BSEOILGAS",
    yahooTicker: "BSE-OILGAS.BO",
  },
  { name: "BSE REALTY", displayName: "BSE Realty", slug: "BSE-REALTY", symbol: "BSEREALTY", yahooTicker: "BSE-REALTY.BO" },
  { name: "BSE POWER", displayName: "BSE Power", slug: "BSE-POWER", symbol: "BSEPOWER", yahooTicker: "BSE-POWER.BO" },
  {
    name: "BSE CAPITAL GOODS",
    displayName: "BSE Capital Goods",
    slug: "BSE-CAPITAL-GOODS",
    symbol: "BSECAPITALGOODS",
    yahooTicker: "BSE-CG.BO",
  },
  {
    name: "BSE Fast Moving Consumer Goods",
    displayName: "BSE FMCG",
    slug: "BSE-FAST-MOVING-CONSUMER-GOODS",
    symbol: "BSEFASTMOVINGCONSUMERGOODS",
    yahooTicker: "BSE-FMCG.BO",
  },
  // BANKEX: "BSE-BANKEX.BO" (the obvious ticker guess) 404s — confirms Phase
  // 1's own finding — but the index IS live under "BSE-BANK.BO" instead
  // (exact price match verified 2026-08-12: 65050.1 both sides). Not a dead
  // feed, a wrong ticker guess.
  { name: "BSE BANKEX", displayName: "BSE Bankex", slug: "BSE-BANKEX", symbol: "BSEBANKEX", yahooTicker: "BSE-BANK.BO" },
  {
    name: "BSE CONSUMER DURABLES",
    displayName: "BSE Consumer Durables",
    slug: "BSE-CONSUMER-DURABLES",
    symbol: "BSECONSUMERDURABLES",
    yahooTicker: "BSE-CD.BO",
  },
  { name: "BSE IPO", displayName: "BSE IPO", slug: "BSE-IPO", symbol: "BSEIPO", yahooTicker: "BSE-IPO.BO" },
] as const;

// Defensive at-import assertions — same convention as indexUniverse.ts's own
// boot-time check.
for (const entry of BSE_INDEX_UNIVERSE) {
  const expectedSlug = slugifyIndexName(entry.name);
  if (entry.slug !== expectedSlug) {
    throw new Error(
      `[bseIndexUniverse] "${entry.name}" has slug "${entry.slug}" but slugifyIndexName computes "${expectedSlug}"`,
    );
  }
  const expectedSymbol = deriveIndexSymbol(entry.name);
  if (entry.symbol !== expectedSymbol) {
    throw new Error(
      `[bseIndexUniverse] "${entry.name}" has symbol "${entry.symbol}" but deriveIndexSymbol computes "${expectedSymbol}"`,
    );
  }
}
{
  const symbols = BSE_INDEX_UNIVERSE.map((e) => e.symbol);
  const dupes = symbols.filter((s, i) => symbols.indexOf(s) !== i);
  if (dupes.length > 0) {
    throw new Error(`[bseIndexUniverse] duplicate symbol code(s): ${[...new Set(dupes)].join(", ")}`);
  }
}

const BY_SYMBOL = new Map(BSE_INDEX_UNIVERSE.map((e) => [e.symbol, e]));
const BY_SLUG = new Map(BSE_INDEX_UNIVERSE.map((e) => [e.slug, e]));

/** True for any `/instruments/[symbol]` code minted by this registry. */
export function isBseIndexUniverseSymbol(symbol: string): boolean {
  return BY_SYMBOL.has(symbol.trim().toUpperCase());
}

export function getBseIndexUniverseEntry(symbol: string): BseIndexUniverseEntry | null {
  return BY_SYMBOL.get(symbol.trim().toUpperCase()) ?? null;
}

export function getBseIndexUniverseEntryBySlug(slug: string): BseIndexUniverseEntry | null {
  return BY_SLUG.get(slug.trim().toUpperCase()) ?? null;
}

/** `{ symbol -> yahooTicker }` — for merging into apps/web's BSE opinion-ticker map and apps/api's KNOWN_INDEX_IDENTITIES, mirroring INDEX_UNIVERSE_OPINION_TICKER's role for NSE. */
export const BSE_INDEX_UNIVERSE_OPINION_TICKER: Record<string, string> = Object.fromEntries(
  BSE_INDEX_UNIVERSE.map((e) => [e.symbol, e.yahooTicker]),
);

/** `{ symbol -> displayName }` — mirrors INDEX_UNIVERSE_DISPLAY_NAME's role for NSE. */
export const BSE_INDEX_UNIVERSE_DISPLAY_NAME: Record<string, string> = Object.fromEntries(
  BSE_INDEX_UNIVERSE.map((e) => [e.symbol, e.displayName]),
);
