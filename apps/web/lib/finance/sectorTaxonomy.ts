/**
 * Sector/industry label taxonomy for the /opinions Sector filter (founder
 * ask, 2026-08-09: "Energy, Automobile, Pharmacy, Banking, FMCG, IT, Metals,
 * etc."). Pure mapping logic, no IO — see nseSectorMaster.ts for the NSE CSV
 * fetch and opinionsQuery.ts's buildSectorIndex for how a ticker's final
 * label gets resolved end to end.
 *
 * TWO SOURCES, ONE OUTPUT VOCABULARY (hybrid, decided after live
 * investigation — see nseSectorMaster.ts's doc comment for why NSE's richer
 * per-stock endpoint is off the table):
 *
 *   1. PRIMARY — NSE's own "Industry" column from the NIFTY Total Market CSV
 *      (nseSectorMaster.ts). Authoritative, NSE-native naming, covers ~90% of
 *      real opinion-referenced equities. Used AS-IS for every value except
 *      "Financial Services" and "Healthcare" — see refineNseIndustry below.
 *
 *   2. FALLBACK — Yahoo's assetProfile sector+industry (already fetched and
 *      stored in InstrumentEnrichment.keyStats by the existing warm-
 *      enrichment pipeline — see fundamentals.ts's fetchKeyStats). Yahoo's
 *      `sector` is GICS-broad (11 buckets: "Energy", "Financial Services",
 *      "Consumer Cyclical", ...) — too coarse to show directly (a founder
 *      asking for "Automobile" shouldn't land on a bucket also containing
 *      apparel and hotels), so mapYahooToSectorLabel refines it using the
 *      more granular `industry` string wherever Yahoo's own naming makes
 *      that possible. Live-verified 2026-08-09 against 6 large-caps across
 *      different sectors AND 5 small/micro-caps outside NSE Total Market
 *      coverage (GARFIBRES, ROLEXRINGS, SYMPHONY, INDSWFTLAB, HEXAGON) — all
 *      returned clean sector+industry pairs.
 *
 * Both sources are normalized to the SAME output label set below, so a
 * "Banking" pick lights up NSE-primary banks and Yahoo-fallback banks
 * identically — this mapping is what makes that possible, and it's an
 * inspectable constant, not a black box: extend the switch statements below
 * when a new Yahoo industry string is observed that doesn't refine cleanly.
 */

/** Canonical output labels — NSE's own Industry vocabulary, plus Banking/Pharmaceuticals split out from Financial Services/Healthcare (founder named both explicitly; NSE's own macro buckets lump banks in with insurers/AMCs/NBFCs and pharma in with hospitals/diagnostics, which is too broad for what "Banking"/"Pharmacy" mean colloquially). */
export const CANONICAL_SECTOR_LABELS = [
  "Automobile and Auto Components",
  "Banking",
  "Financial Services",
  "Capital Goods",
  "Chemicals",
  "Construction",
  "Construction Materials",
  "Consumer Durables",
  "Consumer Services",
  "Diversified",
  "Fast Moving Consumer Goods",
  "Forest Materials",
  "Healthcare",
  "Information Technology",
  "Media Entertainment & Publication",
  "Metals & Mining",
  "Oil Gas & Consumable Fuels",
  "Pharmaceuticals",
  "Power",
  "Realty",
  "Services",
  "Telecommunication",
  "Textiles",
  "Utilities",
] as const;

export type CanonicalSector = (typeof CANONICAL_SECTOR_LABELS)[number];

/**
 * Refines NSE's own two broadest buckets using Yahoo's more granular
 * `industry` string when available (from InstrumentEnrichment.keyStats —
 * absent for a symbol enrichment hasn't reached yet, in which case the
 * coarse NSE bucket is kept rather than guessing). Every other NSE Industry
 * value passes through unchanged — it's already NSE-native and specific
 * enough (e.g. "Metals & Mining", "Fast Moving Consumer Goods").
 */
export function refineNseIndustry(nseIndustry: string, yahooIndustry?: string | null): string {
  if (nseIndustry === "Financial Services") {
    if (yahooIndustry && /bank/i.test(yahooIndustry)) return "Banking";
    return "Financial Services";
  }
  if (nseIndustry === "Healthcare") {
    if (yahooIndustry && /(drug manufactur|pharmaceutical|biotechnolog)/i.test(yahooIndustry)) return "Pharmaceuticals";
    return "Healthcare";
  }
  return nseIndustry;
}

/**
 * Maps Yahoo's GICS-style sector+industry to a CANONICAL_SECTOR_LABELS value.
 * Used only for tickers NSE's own Total Market CSV doesn't cover (see
 * nseSectorMaster.ts). Returns null when `yahooSector` itself is absent
 * (enrichment never fetched, or fetch failed) — callers treat null as
 * "unclassified" and exclude the ticker from every sector's bucket rather
 * than guessing.
 */
export function mapYahooToSectorLabel(yahooSector?: string | null, yahooIndustry?: string | null): string | null {
  if (!yahooSector) return null;
  const industry = yahooIndustry ?? "";

  switch (yahooSector) {
    case "Energy":
      return "Oil Gas & Consumable Fuels";
    case "Basic Materials":
      if (/steel|aluminum|aluminium|copper|mining|metal/i.test(industry)) return "Metals & Mining";
      if (/chemical/i.test(industry)) return "Chemicals";
      if (/paper|lumber|wood/i.test(industry)) return "Forest Materials";
      if (/building materials|cement|construction materials/i.test(industry)) return "Construction Materials";
      return "Metals & Mining"; // Basic Materials' largest sub-bucket for NSE names — safe default
    case "Financial Services":
      if (/bank/i.test(industry)) return "Banking";
      return "Financial Services";
    case "Healthcare":
      if (/(drug manufactur|pharmaceutical|biotechnolog)/i.test(industry)) return "Pharmaceuticals";
      return "Healthcare";
    case "Consumer Cyclical":
      if (/auto/i.test(industry)) return "Automobile and Auto Components";
      if (/real estate|reit/i.test(industry)) return "Realty";
      if (/textile|apparel|footwear/i.test(industry)) return "Textiles";
      if (/furnishing|appliance|home improvement|household.*durable/i.test(industry)) return "Consumer Durables";
      if (/restaurant|resort|travel|lodging|leisure|gambling|personal services|department store|specialty retail|internet retail/i.test(industry)) return "Consumer Services";
      return "Consumer Services"; // Consumer Cyclical's residual — mostly retail/discretionary services for NSE names
    case "Consumer Defensive":
      return "Fast Moving Consumer Goods";
    case "Technology":
      return "Information Technology";
    case "Communication Services":
      if (/telecom/i.test(industry)) return "Telecommunication";
      return "Media Entertainment & Publication";
    case "Industrials":
      if (/construction|engineering/i.test(industry)) return "Construction";
      return "Capital Goods";
    case "Real Estate":
      return "Realty";
    case "Utilities":
      if (/power|electric/i.test(industry)) return "Power";
      return "Utilities";
    default:
      return "Diversified";
  }
}

/**
 * Single entry point combining both sources: NSE's own Industry (refined)
 * when the symbol is covered by the Total Market CSV, else Yahoo's
 * sector/industry mapped to the same vocabulary. Returns null when neither
 * source has anything for this symbol (enrichment never fetched AND not in
 * NSE's Total Market universe) — the symbol is simply excluded from every
 * sector bucket rather than shown under a fabricated "Other."
 */
export function resolveSectorLabel(input: {
  nseIndustry?: string | null;
  yahooSector?: string | null;
  yahooIndustry?: string | null;
}): string | null {
  if (input.nseIndustry) return refineNseIndustry(input.nseIndustry, input.yahooIndustry);
  return mapYahooToSectorLabel(input.yahooSector, input.yahooIndustry);
}
