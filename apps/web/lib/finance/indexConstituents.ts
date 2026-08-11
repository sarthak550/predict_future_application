/**
 * Index composition (founder ask, 2026-08-12: "what are composition of
 * index... the composition and other metrics are necessary") — per-index
 * constituent lists sourced from NSE/NiftyIndices' own published CSVs
 * (nsearchives.nseindia.com/content/indices/ind_<name>list.csv family — the
 * SAME keyless, no-cookie-needed host lib/finance/nseSectorMaster.ts's NIFTY
 * Total Market fetch already uses; identical transport/parse/cache shape
 * reused verbatim here, just per-index instead of one fixed URL).
 *
 * LONG-TAIL SWEEP (founder follow-up, same day: "we had 100s of indices —
 * why are we talking about just 35"): the first pass above only covered the
 * 35 indices with a full `/instruments/[symbol]` page. This dictionary now
 * covers every index IndexEodQuote has history for — the full 163-index
 * long-tail universe indexLongTail.ts already resolves to instrument pages
 * (Index History Stage 2, 2026-08-11) — wherever nsearchives actually
 * publishes a list. Discovery was a two-round probe, never a runtime guess:
 * (1) `apps/api/scripts/discover-index-constituent-csvs.ts` generates a
 * candidate filename set per index from the grammar the ORIGINAL 30
 * hand-verified entries actually exhibit (drop/keep "INDIA", "&"->""/"AND",
 * "list"/"_list", "FINANCIAL SERVICES"->"FINANCE", "INFRASTRUCTURE"->"INFRA",
 * digit-ratio separators, an explicit "nifty_"+rest variant) and probes each
 * with a paced (400ms), cached-first-hit GET against nsearchives, verifying
 * every hit actually parses to >=1 real "Company Name,Industry,Symbol,..."
 * row (a 200 with an empty/malformed body never counts); (2) a manual
 * follow-up round hand-tried further variants against the ~30 misses that
 * looked most likely to have a list NSE just names unusually (this is how
 * NIFTYDIVIDENDOPPORTUNITIES50's real filename, `ind_niftydivopp50list.csv`
 * — an abbreviation ("divopp") no grammar rule would derive — was found).
 *
 * COVERAGE as of 2026-08-12 (every filename below verified live via a direct
 * fetch, one request per candidate — never assumed from a naming pattern):
 * 52 of 163 indices have a real, working constituent CSV (30 from the
 * original 35-index pass + 22 from this long-tail sweep). The filename does
 * NOT follow one single deterministic rule off the index's own display name
 * — e.g. "NIFTY INDIA MANUFACTURING" is `ind_niftyindiamanufacturing_list.csv`
 * (trailing underscore before "list"), "NIFTY AUTO" is `ind_niftyautolist.csv`
 * (no underscore at all), "NIFTY PRIVATE BANK" is
 * `ind_nifty_privatebanklist.csv` (underscore after "nifty" instead) — so,
 * same discipline as nseSectorMaster.ts and INDEX_UNIVERSE's own
 * `yahooTicker` field, this is a hand-verified dictionary, never
 * derived/guessed at request time (the discovery script's candidate
 * generator lives ONLY in that one-off script — this file never imports or
 * runs it). Two index pairs that LOOK like they'd share a file do NOT:
 * "NIFTY FINANCIAL SERVICES" (FINNIFTY's real underlying, 20 names,
 * `ind_niftyfinancelist.csv`) is a DIFFERENT, smaller universe than "NIFTY
 * FINANCIAL SERVICES 25/50" (`ind_niftyfinancialservices25_50list.csv`, a
 * concentration-capped variant with materially different membership,
 * confirmed by a real member-list diff) — the same ^CNXFIN-style trap this
 * codebase already hit once (see business-rules/finance/indexUniverse.ts's
 * own module doc on that ticker).
 *
 * 111 verified-absent indices (KNOWN_NO_CONSTITUENT_LIST below) — the
 * composition panel simply doesn't render for these, which is the honest
 * default per the brief ("design for partial coverage honestly"), not a bug
 * to chase. The set exists so a future pass never re-probes a symbol already
 * confirmed absent: 1 excluded by nature (INDIAVIX — a volatility index has
 * no equity constituents at all, never probed), 4 from the original 35-index
 * pass (NIFTYINDIAFPI150, NIFTYCHEMICALS, NIFTYREITSREALTY, NIFTYCEMENT —
 * ~15 hand-tried variants each, 2026-08-12, re-confirmed absent this round
 * too), and 106 from this long-tail sweep — overwhelmingly STRATEGY/THEMATIC
 * sub-indices (Alpha/Quality/Low-Volatility/Momentum/Equal-Weight factor
 * variants, the 4 fixed-income G-Sec indices, the 4 Bharat Bond target-
 * maturity indices, leveraged/inverse/TR variants, Shariah variants) that
 * either have no public NSE-hosted constituent CSV at all or publish one
 * under a filename no reasonable guess (grammar-driven or hand-tried)
 * reproduced. NSE may host some of these under a different path/host this
 * sweep didn't uncover live; a genuine gap, not a forgotten one.
 *
 * NO WEIGHTS: every verified CSV here is the "Company Name,Industry,Symbol,
 * Series,ISIN Code" shape (same 5 columns nseSectorMaster.ts's file uses) —
 * none of them carry an index weight column. Per the brief, weights are
 * NEVER computed/estimated locally; the column is simply omitted.
 */

const CONSTITUENT_CSV_SLUG: Record<string, string> = {
  // 5 F&O-tradable underlyings (apps/web/lib/finance/indexTradableAlias.ts)
  NIFTY: "ind_nifty50list",
  BANKNIFTY: "ind_niftybanklist",
  FINNIFTY: "ind_niftyfinancelist",
  MIDCPNIFTY: "ind_niftymidcapselect_list",
  NIFTYNXT50: "ind_niftynext50list",

  // INDEX_UNIVERSE — Broad Market (8 of 10; INDIAVIX and NIFTYINDIAFPI150 excluded, see module doc)
  NIFTY100: "ind_nifty100list",
  NIFTY200: "ind_nifty200list",
  NIFTY500: "ind_nifty500list",
  NIFTYMIDCAP50: "ind_niftymidcap50list",
  NIFTYMIDCAP100: "ind_niftymidcap100list",
  NIFTYMIDCAP150: "ind_niftymidcap150list",
  NIFTYTOTALMARKET: "ind_niftytotalmarket_list",
  NIFTYMICROCAP250: "ind_niftymicrocap250_list",

  // INDEX_UNIVERSE — Sectoral (11 of 14; CHEMICALS/REITSREALTY/CEMENT excluded, see module doc)
  NIFTYAUTO: "ind_niftyautolist",
  NIFTYFMCG: "ind_niftyfmcglist",
  NIFTYIT: "ind_niftyitlist",
  NIFTYMEDIA: "ind_niftymedialist",
  NIFTYMETAL: "ind_niftymetallist",
  NIFTYPHARMA: "ind_niftypharmalist",
  NIFTYPSUBANK: "ind_niftypsubanklist",
  NIFTYPRIVATEBANK: "ind_nifty_privatebanklist",
  NIFTYREALTY: "ind_niftyrealtylist",
  NIFTYHEALTHCAREINDEX: "ind_niftyhealthcarelist",
  NIFTYOILGAS: "ind_niftyoilgaslist",

  // Thematic override (see INDEX_UNIVERSE's module doc)
  NIFTYINFRASTRUCTURE: "ind_niftyinfralist",

  // Index Identity Audit five (2026-08-10) — all 5 verified
  NIFTYENERGY: "ind_niftyenergylist",
  NIFTYINDIACONSUMPTION: "ind_niftyconsumptionlist",
  NIFTYINDIAMANUFACTURING: "ind_niftyindiamanufacturing_list",
  NIFTYINDIADEFENCE: "ind_niftyindiadefence_list",
  NIFTYSMALLCAP250: "ind_niftysmallcap250list",

  // Long-tail sweep (2026-08-12) — 22 verified via
  // discover-index-constituent-csvs.ts (21 grammar-driven auto-probe hits +
  // 1 manual follow-up, NIFTYDIVIDENDOPPORTUNITIES50). See module doc.
  NIFTY200ALPHA30: "ind_nifty200alpha30_list", // Nifty200 Alpha 30
  NIFTYCOMMODITIES: "ind_niftycommoditieslist", // Nifty Commodities
  NIFTYCONSUMERDURABLES: "ind_niftyconsumerdurableslist", // Nifty Consumer Durables
  NIFTYCOREHOUSING: "ind_niftycorehousing_list", // Nifty Core Housing
  NIFTYCPSE: "ind_niftycpselist", // Nifty CPSE
  NIFTYDIVIDENDOPPORTUNITIES50: "ind_niftydivopp50list", // Nifty Dividend Opportunities 50 (manual follow-up — abbreviated "divopp", no grammar rule derives it)
  NIFTYFINANCIALSERVICESEXBANK: "ind_niftyfinancialservicesexbank_list", // Nifty Financial Services Ex-Bank
  NIFTYINDIADIGITAL: "ind_niftyindiadigital_list", // Nifty India Digital
  NIFTYINDIATOURISM: "ind_niftyindiatourism_list", // Nifty India Tourism
  NIFTYLARGEMIDCAP250: "ind_niftylargemidcap250list", // NIFTY LargeMidcap 250
  NIFTYMIDCAP150MOMENTUM50: "ind_niftymidcap150momentum50_list", // Nifty Midcap150 Momentum 50
  NIFTYMIDCAP150QUALITY50: "ind_niftymidcap150quality50list", // NIFTY Midcap150 Quality 50
  NIFTYMIDSMALLCAP400: "ind_niftymidsmallcap400list", // Nifty MidSmallcap 400
  NIFTYMIDSMALLHEALTHCARE: "ind_niftymidsmallhealthcare_list", // Nifty MidSmall Healthcare
  NIFTYMIDSMALLINDIACONSUMPTION: "ind_niftymidsmallindiaconsumption_list", // Nifty MidSmall India Consumption
  NIFTYMNC: "ind_niftymnclist", // Nifty MNC
  NIFTYMOBILITY: "ind_niftymobility_list", // Nifty Mobility
  NIFTYPSE: "ind_niftypselist", // Nifty PSE
  NIFTYSMALLCAP100: "ind_niftysmallcap100list", // NIFTY Smallcap 100
  NIFTYSMALLCAP250QUALITY50: "ind_niftysmallcap250quality50_list", // Nifty Smallcap250 Quality 50
  NIFTYSMALLCAP50: "ind_niftysmallcap50list", // Nifty Smallcap 50
  NIFTYTRANSPORTATIONLOGISTICS: "ind_niftytransportationandlogistics_list", // Nifty Transportation & Logistics
};

/**
 * Every index confirmed to have NO working constituent CSV under nsearchives
 * — see the module doc's "111 verified-absent indices" section for the full
 * breakdown (1 excluded by nature, 4 from the original 35-index pass, 106
 * from the 2026-08-12 long-tail sweep). Purely a documentation/audit set: a
 * symbol's absence from CONSTITUENT_CSV_SLUG already makes
 * `hasIndexConstituentList` return false on its own, so nothing at request
 * time reads this constant. Its only job is to stop a future pass from
 * re-probing a symbol already confirmed absent, and to make that absence a
 * recorded fact instead of a silent gap. Never used to SUPPRESS anything
 * that would otherwise render — there's nothing to suppress, since none of
 * these symbols are in CONSTITUENT_CSV_SLUG in the first place.
 */
export const KNOWN_NO_CONSTITUENT_LIST: ReadonlySet<string> = new Set([
  // Excluded by nature — a volatility index has no equity constituents at
  // all; never probed, on any pass.
  "INDIAVIX", // India VIX

  // Original 35-index pass (2026-08-10/12) — ~15 hand-tried filename
  // variants each; re-confirmed absent again during the 2026-08-12 sweep.
  "NIFTYINDIAFPI150", // Nifty India FPI 150
  "NIFTYCHEMICALS", // Nifty Chemicals
  "NIFTYREITSREALTY", // Nifty REITs & Realty
  "NIFTYCEMENT", // Nifty Cement

  // Long-tail sweep (2026-08-12) — exhaustively probed (grammar-driven
  // auto-probe via discover-index-constituent-csvs.ts + a manual targeted
  // second pass on the most plausible-looking misses); no working
  // ind_*list.csv found under nsearchives for any of these 106.
  "NIFTY100ALPHA30", // NIFTY100 Alpha 30
  "NIFTY100ENHANCEDESG", // NIFTY100 Enhanced ESG
  "NIFTY100EQUALWEIGHT", // Nifty100 Equal Weight
  "NIFTY100ESG", // NIFTY100 ESG
  "NIFTY100ESGSECTORLEADERS", // Nifty100 ESG Sector Leaders
  "NIFTY100LIQUID15", // Nifty100 Liquid 15
  "NIFTY100LOWVOLATILITY30", // Nifty100 Low Volatility 30
  "NIFTY100QUALITY30", // NIFTY100 Quality 30
  "NIFTY10YRBENCHMARKGSEC", // Nifty 10 yr Benchmark G-Sec
  "NIFTY10YRBENCHMARKGSECCLEANPRICE", // Nifty 10 yr Benchmark G-Sec (Clean Price)
  "NIFTY1115YRGSECINDEX", // Nifty 11-15 yr G-Sec Index
  "NIFTY15YRANDABOVEGSECINDEX", // Nifty 15 yr and above G-Sec Index
  "NIFTY1DRATEINDEX", // Nifty 1D Rate Index
  "NIFTY200MOMENTUM30", // Nifty200 Momentum 30
  "NIFTY200QUALITY30", // NIFTY200 Quality 30
  "NIFTY200VALUE30", // Nifty200 Value 30
  "NIFTY48YRGSECINDEX", // Nifty 4-8 yr G-Sec Index
  "NIFTY500AHIMSA", // Nifty500 Ahimsa
  "NIFTY500EQUALWEIGHT", // Nifty500 Equal Weight
  "NIFTY500FLEXICAPQUALITY30", // Nifty500 Flexicap Quality 30
  "NIFTY500HEALTHCARE", // Nifty500 Healthcare
  "NIFTY500LARGEMIDSMALLEQUALCAPWEIGHTED", // Nifty500 LargeMidSmall Equal-Cap Weighted
  "NIFTY500LOWVOLATILITY50", // Nifty500 Low Volatility 50
  "NIFTY500MOMENTUM50", // Nifty500 Momentum 50
  "NIFTY500MULTICAP502525", // Nifty500 Multicap 50:25:25
  "NIFTY500MULTICAPINDIAMANUFACTURING503020", // Nifty500 Multicap India Manufacturing 50:30:20
  "NIFTY500MULTICAPINFRASTRUCTURE503020", // Nifty500 Multicap Infrastructure 50:30:20
  "NIFTY500MULTICAPMOMENTUMQUALITY50", // Nifty500 Multicap Momentum Quality 50
  "NIFTY500MULTIFACTORMQVLV50", // Nifty500 Multifactor MQVLv 50
  "NIFTY500QUALITY50", // Nifty500 Quality 50
  "NIFTY500SHARIAH", // Nifty500 Shariah
  "NIFTY500VALUE50", // NIFTY500 Value 50
  "NIFTY50ARBITRAGE", // Nifty 50 Arbitrage
  "NIFTY50EQUALWEIGHT", // NIFTY50 Equal Weight
  "NIFTY50FUTURESINDEX", // Nifty 50 Futures Index
  "NIFTY50FUTURESTRINDEX", // Nifty 50 Futures TR Index
  "NIFTY50PR1XINVERSE", // Nifty50 PR 1x Inverse
  "NIFTY50PR2XLEVERAGE", // Nifty50 PR 2x Leverage
  "NIFTY50SHARIAH", // Nifty50 Shariah
  "NIFTY50TR1XINVERSE", // Nifty50 TR 1x Inverse
  "NIFTY50TR2XLEVERAGE", // Nifty50 TR 2x Leverage
  "NIFTY50USD", // Nifty50 USD
  "NIFTY50VALUE20", // Nifty50 Value 20
  "NIFTY813YRGSEC", // Nifty 8-13 yr G-Sec
  "NIFTYALPHA50", // Nifty Alpha 50
  "NIFTYALPHALOWVOLATILITY30", // NIFTY Alpha Low-Volatility 30
  "NIFTYALPHAQUALITYLOWVOLATILITY30", // NIFTY Alpha Quality Low-Volatility 30
  "NIFTYALPHAQUALITYVALUELOWVOLATILITY30", // NIFTY Alpha Quality Value Low-Volatility 30
  "NIFTYBHARATBONDINDEXAPRIL2030", // Nifty BHARAT Bond Index - April 2030
  "NIFTYBHARATBONDINDEXAPRIL2031", // Nifty BHARAT Bond Index - April 2031
  "NIFTYBHARATBONDINDEXAPRIL2032", // Nifty BHARAT Bond Index - April 2032
  "NIFTYBHARATBONDINDEXAPRIL2033", // Nifty BHARAT Bond Index - April 2033
  "NIFTYCAPITALGOODS", // Nifty Capital Goods
  "NIFTYCAPITALMARKETS", // Nifty Capital Markets
  "NIFTYCOMMERCIALTRANSPORTSERVICES", // Nifty Commercial & Transport Services
  "NIFTYCOMPOSITEGSECINDEX", // Nifty Composite G-sec Index
  "NIFTYCONGLOMERATE50", // Nifty Conglomerate 50
  "NIFTYCONSTRUCTION", // Nifty Construction
  "NIFTYCONSUMERSERVICES", // Nifty Consumer Services
  "NIFTYEVNEWAGEAUTOMOTIVE", // Nifty EV & New Age Automotive
  "NIFTYFINANCIALSERVICES2550", // Nifty Financial Services 25/50
  "NIFTYGROWTHSECTORS15", // Nifty Growth Sectors 15
  "NIFTYHIGHBETA50", // Nifty High Beta 50
  "NIFTYHOSPITALS", // Nifty Hospitals
  "NIFTYHOUSING", // Nifty Housing
  "NIFTYHOUSINGFINANCE", // Nifty Housing Finance
  "NIFTYINDIACORPORATEGROUPINDEXADITYABIRLAGROUP", // Nifty India Corporate Group Index - Aditya Birla Group
  "NIFTYINDIACORPORATEGROUPINDEXMAHINDRAGROUP", // Nifty India Corporate Group Index - Mahindra Group
  "NIFTYINDIACORPORATEGROUPINDEXTATAGROUP", // Nifty India Corporate Group Index - Tata Group
  "NIFTYINDIACORPORATEGROUPINDEXTATAGROUP25CAP", // Nifty India Corporate Group Index - Tata Group 25% Cap
  "NIFTYINDIADEFENCEEQUALWEIGHT", // Nifty India Defence Equal Weight
  "NIFTYINDIAINFRASTRUCTURELOGISTICS", // Nifty India Infrastructure & Logistics
  "NIFTYINDIAINTERNET", // Nifty India Internet
  "NIFTYINDIANEWAGECONSUMPTION", // Nifty India New Age Consumption
  "NIFTYINDIARAILWAYSPSU", // Nifty India Railways PSU
  "NIFTYINDIASELECT5CORPORATEGROUPSMAATR", // Nifty India Select 5 Corporate Groups (MAATR)
  "NIFTYINSURANCE", // Nifty Insurance
  "NIFTYIPO", // Nifty IPO
  "NIFTYLOWVOLATILITY50", // Nifty Low Volatility 50
  "NIFTYMIDCAPLIQUID15", // Nifty Midcap Liquid 15
  "NIFTYMIDSMALLCAP4005050", // Nifty MidSmallcap400 50:50
  "NIFTYMIDSMALLCAP400MOMENTUMQUALITY100", // Nifty MidSmallcap400 Momentum Quality 100
  "NIFTYMIDSMALLFINANCIALSERVICES", // Nifty MidSmall Financial Services
  "NIFTYMIDSMALLITTELECOM", // Nifty MidSmall IT & Telecom
  "NIFTYNBFC", // Nifty NBFC
  "NIFTYNEXT100", // Nifty Next 100
  "NIFTYNONCYCLICALCONSUMER", // Nifty Non-Cyclical Consumer
  "NIFTYPOWER", // Nifty Power
  "NIFTYQUALITYLOWVOLATILITY30", // NIFTY Quality Low-Volatility 30
  "NIFTYREITSINVITS", // Nifty REITs & InvITs
  "NIFTYREITSINVITS9010", // Nifty REITs & InvITs 90:10
  "NIFTYRETAIL", // Nifty Retail
  "NIFTYRURAL", // Nifty Rural
  "NIFTYSERVICESSECTOR", // Nifty Services Sector
  "NIFTYSHARIAH25", // Nifty Shariah 25
  "NIFTYSMALLCAP250MOMENTUMQUALITY100", // Nifty Smallcap250 Momentum Quality 100
  "NIFTYSMALLCAP500", // Nifty Smallcap 500
  "NIFTYSMALLFINANCEBANKSMICROFINANCEINSTITUTIONS", // Nifty Small Finance Banks & Microfinance Institutions
  "NIFTYSMEEMERGE", // NIFTY SME EMERGE
  "NIFTYSUGARETHANOL", // Nifty Sugar & Ethanol
  "NIFTYTELECOMMUNICATIONS", // Nifty Telecommunications
  "NIFTYTOP10EQUALWEIGHT", // Nifty Top 10 Equal Weight
  "NIFTYTOP15EQUALWEIGHT", // Nifty Top 15 Equal Weight
  "NIFTYTOP20EQUALWEIGHT", // Nifty Top 20 Equal Weight
  "NIFTYTOTALMARKETMOMENTUMQUALITY50", // Nifty Total Market Momentum Quality 50
  "NIFTYWAVES", // Nifty Waves
]);

// Defensive at-import assertion — same convention as
// business-rules/finance/indexUniverse.ts's own boot-time checks: a symbol
// hand-typed into BOTH sets would silently contradict itself (claims a
// working CSV and a verified-absent one at once), a bug this codebase's own
// "one source of truth, checked at load time" discipline exists to catch
// before it ships, not after.
for (const symbol of Object.keys(CONSTITUENT_CSV_SLUG)) {
  if (KNOWN_NO_CONSTITUENT_LIST.has(symbol)) {
    throw new Error(`[indexConstituents] "${symbol}" is in both CONSTITUENT_CSV_SLUG and KNOWN_NO_CONSTITUENT_LIST`);
  }
}

const NSE_ARCHIVES_BASE = "https://nsearchives.nseindia.com/content/indices";
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const FETCH_TIMEOUT_MS = 15_000;

const BROWSER_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

export interface IndexConstituentRow {
  symbol: string;
  companyName: string;
  /** NSE's own industry label (their own naming convention, not GICS — same source nseSectorMaster.ts uses for opinion sector filtering). Null on a malformed row (never observed live, defensive only). */
  industry: string | null;
}

/** "Company Name,Industry,Symbol,Series,ISIN Code" -> rows, same parser shape as nseSectorMaster.ts's parseNseTotalMarketCsv (no embedded commas in any published field). */
function parseConstituentCsv(csv: string): IndexConstituentRow[] {
  const rows: IndexConstituentRow[] = [];
  const lines = csv.split(/\r?\n/);
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    const parts = line.split(",");
    if (parts.length < 3) continue;
    const companyName = parts[0]?.trim();
    const industry = parts[1]?.trim() || null;
    const symbol = parts[2]?.trim();
    if (symbol && companyName) rows.push({ symbol, companyName, industry });
  }
  return rows;
}

const cache = new Map<string, { at: number; rows: IndexConstituentRow[] }>();

/** Cheap sync check — lets a caller skip any network/DB work entirely for the ~130+ indices with no verified list (every long-tail index, plus the 5 documented misses). */
export function hasIndexConstituentList(symbol: string): boolean {
  return symbol.trim().toUpperCase() in CONSTITUENT_CSV_SLUG;
}

/**
 * Returns this index's constituent list, or null when unverified/unavailable.
 * Cached 24h per index in-module (rebalances are quarterly-or-rarer events,
 * far less often than this TTL) with stale-serve on a failed refetch —
 * mirrors nseSectorMaster.ts's getNseIndustryMap exactly. Never throws.
 */
export async function fetchIndexConstituents(symbol: string): Promise<IndexConstituentRow[] | null> {
  const key = symbol.trim().toUpperCase();
  const csvSlug = CONSTITUENT_CSV_SLUG[key];
  if (!csvSlug) return null;

  const now = Date.now();
  const cached = cache.get(key);
  if (cached && now - cached.at < CACHE_TTL_MS) return cached.rows;

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    let res: Response;
    try {
      res = await fetch(`${NSE_ARCHIVES_BASE}/${csvSlug}.csv`, {
        headers: { "User-Agent": BROWSER_UA },
        cache: "no-store",
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timeout);
    }
    if (!res.ok) {
      console.warn(`[indexConstituents] ${key} (${csvSlug}.csv) returned ${res.status}`);
      return cached?.rows ?? null;
    }
    const rows = parseConstituentCsv(await res.text());
    if (rows.length === 0) return cached?.rows ?? null;
    cache.set(key, { at: now, rows });
    return rows;
  } catch (err) {
    console.warn(`[indexConstituents] ${key} (${csvSlug}.csv) fetch error: ${err instanceof Error ? err.message : err}`);
    return cached?.rows ?? null;
  }
}
