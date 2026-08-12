/**
 * BSE Index Composition — per-index constituent lists sourced from Asia
 * Index Private Limited's own site (`bseindices.com`, a JV between BSE Ltd
 * and S&P that computes/publishes every BSE index — the SAME entity whose
 * disclaimer appears on every BSE index factsheet: "Source: Asia Index
 * Private Limited"), traced live 2026-08-12 by the exact method that found
 * indexLiveWatch.ts's NSE source: loading the live page a user lands on
 * (`https://www.bseindices.com/indices-details/code/16`, reached via BSE
 * SENSEX's own `GRAPHNAME_NEW` field on api.bseindia.com's `GetLinknew`
 * endpoint) in headless real Chrome (`channel: "chrome"`) with network
 * capture, per the founder's standing ask to trace an index's own
 * "Constituents" surface rather than assume a source is dead.
 *
 * A prior pass (BSE Expansion Phase 2, 2026-08-12) concluded "BSE constituent
 * sources remain unverified (no honest data source found)" — that pass never
 * actually loaded a live BSE index detail page with network capture; this
 * one did, and found a real, working, per-index constituent feed.
 *
 * ENDPOINT: `GET https://www.bseindices.com/AsiaIndexAPI/api/Codewise_Indices/w?code=<code>`
 * — one row per constituent: `{ TransDate, SCRIP_CODE, index_Code, SCRIPNAME,
 * Industry_name }`. No cookie/session priming needed (same keyless pattern
 * `apps/api/lib/marketMoves/bse.ts` already documents for api.bseindia.com —
 * bseindices.com behaves identically: verified live with nothing more than a
 * standard UA + Origin/Referer). SCRIPNAME is BSE's own registered company
 * name (e.g. "MAHINDRA & MAHINDRA LTD."), NOT an NSE ticker — resolved to an
 * `/instruments/[symbol]` NSE symbol below via company-name matching, same
 * precision-over-recall discipline `apps/api/lib/marketMoves/
 * nseSymbolResolver.ts` already established for BSE announcement bylines
 * (this file duplicates that pure normalization function rather than
 * importing apps/api's server code — apps/web cannot import across that
 * boundary, see `lib/portfolios/displayName.ts`'s own module doc on this
 * exact restriction — but sources its inverted name index from our OWN
 * already-ingested `StockEodQuote.companyName`, not a second live NSE fetch).
 *
 * CODE DICTIONARY: `BSE_INDEX_CODE` below is a hand-verified
 * BseIndexEodQuote.indexName -> Asia Index numeric `code` map, built from
 * `GET https://www.bseindices.com/AsiaIndexAPI/api/AsiaIndexList/w` (Asia
 * Index's OWN name->code dictionary, 143 real entries) matched against all
 * 133 names this app has ever ingested via BseIndexEodQuote (Phase 1's
 * IndexArchDailyAll backfill) — 131 matched by exact normalized name, 2 more
 * (`BSE 200 EQUAL WEIGHT INDEX`, `BSE Diversified Financials Revenue Growth
 * Index`) hand-confirmed against AsiaIndexList's own "BSE 200 EQUAL WEIGHT"/
 * "BSE Diversified Financials Revenue Growth" entries — Asia Index's list
 * drops the trailing "Index"/"INDEX" word for those two only, verified by
 * inspecting the full 143-entry list rather than guessed. FULL 133/133
 * COVERAGE on the code mapping — every BSE index this app knows about has a
 * verified Asia Index code. (A DIFFERENT, more limited numeric code space
 * also exists on api.bseindia.com itself — `IndexList`/`GetLinknew`, the
 * source `bseIndexUniverse.ts`'s sibling investigation checked first — but
 * that only covered 77-80 of 133; Asia Index's own dictionary is the
 * complete, authoritative one and is used exclusively here.)
 *
 * CONSTITUENT COVERAGE (not the same as code coverage): every one of the 133
 * codes above was live-probed against Codewise_Indices 2026-08-12 — 122
 * returned >=1 real constituent row (counts sanity-checked: BSE SENSEX = 30,
 * BSE 100 = 100, BSE 1000 = 1003, BSE AllCap = 1527, BSE 500 Shariah = 261 —
 * all plausible for their known universe size). 11 returned an empty Table
 * live, EVERY ONE a genuine non-equity-constituent structure by nature, not a
 * mapping failure: 1X-inverse/leverage daily overlay products ("BSE 150
 * MidCap 1X Inverse Daily", "BSE 200 1X Inverse Daily", the two "...Long +
 * ...1X Inverse 80:20" blends), fixed-income indices ("BSE 4-8 Year G-Sec
 * Index", "BSE 8-13 Year G-Sec Index", the 2 Sovereign Bond indices), and
 * rate/overlay indices ("BSE ARBITRAGE RATE INDEX", "BSE LIQUID RATE INDEX",
 * "BSE 250 LARGEMIDCAP 65:35 INDEX"). `fetchBseIndexConstituents` returns
 * null for these and the composition panel simply doesn't render, same
 * honest-default discipline `indexConstituents.ts` already established for
 * NSE's own gaps.
 *
 * WEIGHTS (found in a follow-up pass, 2026-08-12, after the founder flagged
 * "the BSE composition misses weights"): Asia Index's own endpoints
 * (`Codewise_Indices`, `MarketCap/w`, `AsiaIndexDescriptionnew/w`) carry no
 * per-stock weight field — that finding from the first pass stands. But
 * BSE's OWN site, `www.bseindia.com` (a SEPARATE host from bseindices.com,
 * already used keyless by `apps/api/lib/marketMoves/bse.ts`), publishes a
 * live per-constituent weight page at
 * `bseindia.com/sensex/IndicesWatch_Weight.aspx?iname=<code>&index_Code=<n>`
 * — traced with the same headless-Chrome network-capture method, its Angular
 * shell calls `GET https://api.bseindia.com/BseIndiaAPI/api/
 * NS_IndexWeight_SPDJ_ng/w?iname=<Indx_Cd>`, returning one row per
 * constituent with `Scrip_code`/`Scrip_Name`/`No_of_shrs`/`close_price`/
 * `Adj_Factor`/`MKT_CAP`/`FreeFloat_MktCap`/**`Weightage`** — BSE's OWN
 * field, literally named "Weightage", not a value we derive. Verified live
 * 2026-08-12: SENSEX's 30 rows sum to 100.02% (rounding), BSE 100's 100 rows
 * and BSE 500's 501 rows both match their Asia Index `SCRIP_CODE` sets
 * EXACTLY (100/100 and 501/501 overlap, zero misses) — this is the real
 * published weight, not an ffmc-share estimate (unlike NSE's
 * `indexLiveWatch.ts`, which has to caveat its number as an estimate because
 * NSE's own capping factors aren't in that payload — BSE's `Weightage` here
 * needs no such caveat since it's BSE's own final number).
 *
 * COVERAGE: this lives on a DIFFERENT, smaller numeric-code universe than
 * Asia Index's 133/133 — `Indx_Cd` only exists on bseindia.com's legacy
 * `GetLinknew/w?Type=C&Category=Indices&Code=<n>` endpoint for indices that
 * predate Asia Index's newer factor/strategy launches. Every one of the 133
 * codes was probed live 2026-08-12: 77 resolved a real `Indx_Cd` AND a
 * non-empty, ~100%-summing weight table (hand-verified below in
 * `BSE_INDEX_WEIGHT_NAME`); the other 56 (mostly newer factor/quality/
 * momentum/value strategy indices, the 3 DOLLEX USD variants — which
 * resolved an `Indx_Cd` but returned zero weight rows, a genuine gap not a
 * mapping bug — and every fixed-income/inverse/leverage index already
 * excluded from `BSE_INDEX_CODE`'s constituent side) have NO honest weight
 * source and keep `weightPct: null`, same "never fabricate" default as
 * before. `IndexContri/w`, the point-contribution field dismissed by the
 * first pass, was re-probed this pass at its previously-recorded path and
 * now 404s — its exact live path wasn't rediscovered (not investigated
 * further since `NS_IndexWeight_SPDJ_ng` already supersedes it as a
 * genuine, non-estimate weight).
 *
 * TRANSPORT: `api.bseindia.com` — the SAME keyless host+pattern
 * `apps/api/lib/marketMoves/bse.ts` already uses (plain `fetch()`, no
 * cookie/session priming, standard UA + Origin/Referer to
 * `https://www.bseindia.com/`), verified live with a bare `curl` (no
 * subprocess dance needed, unlike NSE's Akamai-gated host).
 *
 * JOIN KEY: `Scrip_code` on this endpoint is the exact same BSE scrip code
 * as `Codewise_Indices`'s `SCRIP_CODE` (both plain numeric strings, no
 * leading-zero/format drift observed) — joined directly on that, NOT on
 * `SCRIPNAME`, so the 30-char SCRIPNAME truncation this file's symbol
 * resolver already works around (see `SCRIPNAME_TRUNCATION_LENGTH`) has zero
 * bearing on the weight join.
 *
 * CACHE: 15-minute TTL (`WEIGHT_CACHE_TTL_MS`), far shorter than the 24h
 * constituent-membership cache above — `Weightage` moves with every
 * constituent's live price, unlike membership which only changes on a
 * quarterly/semiannual reconstitution. Mirrors `indexLiveWatch.ts`'s
 * identical 15-minute choice for NSE's own live weight feed.
 *
 * SYMBOL RESOLUTION / NO DEAD LINKS: many BSE constituents are BSE-only
 * listings with no StockEodQuote row (NSE-only table) — `symbol` is null for
 * any SCRIPNAME the company-name resolver can't match, and the composition
 * panel (index-composition-panel.tsx) renders those rows as plain text
 * (never a Link) per the founder's explicit "no dead links" instruction.
 * BSE-only names stay unlinked until a future BSE-equity-pages phase gives
 * them a real `/instruments/[symbol]` destination.
 */

import { prisma } from "@/lib/prisma";

const ASIA_INDEX_API_BASE = "https://www.bseindices.com/AsiaIndexAPI/api";

const BROWSER_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

const ASIA_INDEX_HEADERS = {
  "User-Agent": BROWSER_UA,
  Accept: "application/json, text/plain, */*",
  Origin: "https://www.bseindices.com/",
  Referer: "https://www.bseindices.com/",
};

const FETCH_TIMEOUT_MS = 15_000;
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
/** Company-name -> NSE-symbol inverted index, rebuilt from StockEodQuote at most this often — mirrors nseSymbolResolver.ts's 12h TTL for the analogous live-NSE-sourced map. */
const NAME_INDEX_TTL_MS = 12 * 60 * 60 * 1000;

/**
 * `BseIndexEodQuote.indexName` (verbatim, e.g. "BSE SENSEX") -> Asia Index's
 * own numeric `code` param for Codewise_Indices/AsiaIndicesGraphData/etc.
 * Hand-verified against AsiaIndexList live 2026-08-12 — see module doc.
 */
export const BSE_INDEX_CODE: Record<string, string> = {
  "BSE 100": "22",
  "BSE 100 ESG Index": "101",
  "BSE 100 LargeCap TMC Index": "113",
  "BSE 1000": "142",
  "BSE 1000 MULTICAP EQUAL SIZE WEIGHTED (25%)": "146",
  "BSE 150 MidCap 1X Inverse Daily": "185",
  "BSE 150 MidCap Index": "102",
  "BSE 200": "23",
  "BSE 200 1X Inverse Daily": "186",
  "BSE 200 EQUAL WEIGHT INDEX": "128",
  "BSE 250 LARGEMIDCAP 65:35 INDEX": "1047",
  "BSE 250 LargeMidCap Index": "104",
  "BSE 250 MICROCAP": "144",
  "BSE 250 SmallCap Index": "103",
  "BSE 4-8 Year G-Sec Index": "176",
  "BSE 400 MidSmallCap Index": "105",
  "BSE 500": "17",
  "BSE 500 Dividend Leaders 50": "150",
  "BSE 500 Enhanced Value 50": "148",
  "BSE 500 EQUAL WEIGHT": "166",
  "BSE 500 Long + 150 MidCap 1X Inverse 80:20": "184",
  "BSE 500 Long + 200 1X Inverse 80:20": "183",
  "BSE 500 Low Volatility 50": "151",
  "BSE 500 Momentum 50": "152",
  "BSE 500 Momentum Quality 50": "200",
  "BSE 500 Momentum Value 50": "199",
  "BSE 500 Quality 50": "147",
  "BSE 500 Shariah": "1012",
  "BSE 8-13 Year G-Sec Index": "175",
  "BSE All Derivative Stocks Index": "167",
  "BSE AllCap": "87",
  "BSE ARBITRAGE RATE INDEX": "1048",
  "BSE AUTO": "42",
  "BSE BANKEX": "53",
  "BSE Bharat 22 Index": "100",
  "BSE CAPITAL GOODS": "25",
  "BSE CAPITAL MARKETS": "156",
  "BSE CAPITAL MARKETS & INSURANCE": "133",
  "BSE Clean Environment": "172",
  "BSE Commodities": "88",
  "BSE Consumer Discretionary": "89",
  "BSE CONSUMER DURABLES": "27",
  "BSE CPSE": "80",
  "BSE Diversified Financials Revenue Growth Index": "111",
  "BSE Dividend Stability Index": "106",
  "BSE DOLLEX 100": "65",
  "BSE DOLLEX 200": "48",
  "BSE DOLLEX 30": "47",
  "BSE Energy": "90",
  "BSE Enhanced Value Index": "107",
  "BSE Fast Moving Consumer Goods": "83",
  "BSE Financial Services": "91",
  "BSE Financials Ex-Banks 30 Index": "1051",
  "BSE Focused IT": "134",
  "BSE FOCUSED MIDCAP": "137",
  "BSE Healthcare": "84",
  "BSE Hospitals": "158",
  "BSE Housing Finance": "190",
  "BSE Housing Index": "1052",
  "BSE India 10 Year Sovereign Bond": "1029",
  "BSE India 150": "149",
  "BSE India 5 Year Sovereign Bond Index": "193",
  "BSE India Defence": "155",
  "BSE India Infrastructure Index": "79",
  "BSE India Manufacturing Index": "86",
  "BSE INDIA SECTOR LEADERS": "141",
  "BSE Industrials": "92",
  "BSE Information Technology": "85",
  "BSE Insurance": "154",
  "BSE INTERNET ECONOMY": "132",
  "BSE IPO": "72",
  "BSE LargeCap": "93",
  "BSE LARGECAP 100 ENHANCED VALUE 30": "164",
  "BSE LARGECAP 100 LOW VOLATILITY 30": "163",
  "BSE LARGECAP 100 MOMENTUM 30": "162",
  "BSE LARGECAP 100 QUALITY 30": "165",
  "BSE LargeMid (60:40) Stable Dividend 50": "195",
  "BSE LargeMidCap": "1003",
  "BSE LIQUID RATE INDEX": "1046",
  "BSE Low Volatility Index": "108",
  "BSE METAL": "35",
  "BSE MidCap": "81",
  "BSE Midcap 150 Enhanced Value 30": "169",
  "BSE Midcap 150 Low Volatility 30": "170",
  "BSE Midcap 150 Momentum 30": "168",
  "BSE Midcap 150 Quality 30": "171",
  "BSE MidCap Select Index": "94",
  "BSE MidSmall IT": "198",
  "BSE MidSmall Private Banks": "196",
  "BSE MidSmall Private Banks Quality Tilt": "177",
  "BSE MidSmallCap": "1004",
  "BSE Momentum Index": "109",
  "BSE Multicap Consumption (50:30:20)": "160",
  "BSE Next 250 MICROCAP": "145",
  "BSE NEXT 500": "143",
  "BSE OIL & GAS": "37",
  "BSE POWER": "69",
  "BSE POWER & ENERGY": "131",
  "BSE PREMIUM CONSUMPTION": "135",
  "BSE Private Banks Index": "114",
  "BSE PSU": "44",
  "BSE PSU BANK": "140",
  "BSE Quality Index": "110",
  "BSE REALTY": "67",
  "BSE REITS": "187",
  "BSE REITS and Commercial Real Estate": "192",
  "BSE REITs and InvITs Index": "1053",
  "BSE Saatvik 100": "194",
  "BSE SELECT BUSINESS GROUPS": "136",
  "BSE SELECT IPO": "139",
  "BSE SENSEX": "16",
  "BSE SENSEX 50": "98",
  "BSE SENSEX 50 TMC": "1050",
  "BSE SENSEX EQUAL WEIGHT": "138",
  "BSE SENSEX NEXT 30": "127",
  "BSE SENSEX Next 50": "99",
  "BSE SENSEX Next 50 TMC": "1049",
  "BSE SENSEX SIXTY": "129",
  "BSE SENSEX SIXTY 65:35": "130",
  "BSE Services": "121",
  "BSE SmallCap": "82",
  "BSE Smallcap 500": "178",
  "BSE Smallcap 500 Enhanced Value 50": "182",
  "BSE Smallcap 500 Low Volatility 50": "181",
  "BSE Smallcap 500 Momentum 50": "180",
  "BSE Smallcap 500 Quality 50": "179",
  "BSE SmallCap Select Index": "95",
  "BSE SME IPO": "76",
  "BSE TECK": "45",
  "BSE Telecommunication": "96",
  "BSE Top 10 Banks": "161",
  "BSE Total Market": "197",
  "BSE Utilities": "97",
};

/**
 * `BseIndexEodQuote.indexName` -> bseindia.com's own `Indx_Cd` (the `iname`
 * query param `NS_IndexWeight_SPDJ_ng/w` needs) for every index that endpoint
 * covers. Built 2026-08-12 by resolving `Indx_Cd` from bseindia.com's legacy
 * `GetLinknew/w?Type=C&Category=Indices&Code=<n>` (keyed off `BSE_INDEX_CODE`'s
 * SAME numeric codes above) for all 133 known indices, then live-probing
 * `NS_IndexWeight_SPDJ_ng/w?iname=<Indx_Cd>` for each resolved code — only
 * the 77 below returned both a real `Indx_Cd` AND a non-empty weight table
 * summing to ~100%; see module doc for why the other 56 have none. A future
 * pass can re-probe the 56 (a bseindia.com backend expansion could add
 * coverage) but this list should NOT be hand-extended without a live check —
 * `Indx_Cd` existing does not by itself guarantee a non-empty weight table
 * (the 3 DOLLEX indices are the proof: they resolve an `Indx_Cd` but return
 * zero weight rows).
 */
export const BSE_INDEX_WEIGHT_NAME: Record<string, string> = {
  "BSE 100": "BSE100",
  "BSE 100 ESG Index": "ESG100",
  "BSE 100 LargeCap TMC Index": "LCTMCI",
  "BSE 1000": "BS1000",
  "BSE 150 MidCap Index": "MID150",
  "BSE 200": "BSE200",
  "BSE 200 EQUAL WEIGHT INDEX": "200EQW",
  "BSE 250 LargeMidCap Index": "LMI250",
  "BSE 250 SmallCap Index": "SML250",
  "BSE 400 MidSmallCap Index": "MSL400",
  "BSE 500": "BSE500",
  "BSE 500 Dividend Leaders 50": "DIVY50",
  "BSE 500 Momentum 50": "MOME50",
  "BSE 500 Quality 50": "QUAL50",
  "BSE AUTO": "AUTO",
  "BSE BANKEX": "BANKEX",
  "BSE Bharat 22 Index": "BHRT22",
  "BSE CAPITAL GOODS": "BSECG",
  "BSE CAPITAL MARKETS & INSURANCE": "CAPINS",
  "BSE CONSUMER DURABLES": "BSECD",
  "BSE CPSE": "CPSE",
  "BSE Commodities": "COMDTY",
  "BSE Consumer Discretionary": "CONDIS",
  "BSE Diversified Financials Revenue Growth Index": "DFRGRI",
  "BSE Dividend Stability Index": "BSEDSI",
  "BSE Energy": "ENERGY",
  "BSE Enhanced Value Index": "BSEEVI",
  "BSE FOCUSED MIDCAP": "FOCMID",
  "BSE Fast Moving Consumer Goods": "BSEFMCG",
  "BSE Financial Services": "FINSER",
  "BSE Focused IT": "FOCIT",
  "BSE Healthcare": "BSEHC",
  "BSE Hospitals": "BSHOSP",
  "BSE Housing Finance": "BSHFIN",
  "BSE INDIA SECTOR LEADERS": "INSLDR",
  "BSE INTERNET ECONOMY": "INTECO",
  "BSE IPO": "BSEIPO",
  "BSE India 150": "IND150",
  "BSE India Defence": "INDDEF",
  "BSE India Infrastructure Index": "INFRA",
  "BSE India Manufacturing Index": "MFG",
  "BSE Industrials": "INDSTR",
  "BSE Information Technology": "BSEIT",
  "BSE Insurance": "INSURE",
  "BSE LargeMid (60:40) Stable Dividend 50": "BLMD50",
  "BSE Low Volatility Index": "BSELVI",
  "BSE METAL": "METAL",
  "BSE MidCap Select Index": "MIDSEL",
  "BSE MidSmall Private Banks": "BSEMSP",
  "BSE MidSmall Private Banks Quality Tilt": "BSMSPB",
  "BSE Midcap 150 Momentum 30": "MMOM30",
  "BSE Momentum Index": "BSEMOI",
  "BSE OIL & GAS": "OILGAS",
  "BSE POWER": "POWER",
  "BSE POWER & ENERGY": "POWENE",
  "BSE PREMIUM CONSUMPTION": "PRECON",
  "BSE PSU": "BSEPSU",
  "BSE PSU BANK": "PSUBNK",
  "BSE Private Banks Index": "BSEPBI",
  "BSE Quality Index": "BSEQUI",
  "BSE REALTY": "REALTY",
  "BSE SELECT BUSINESS GROUPS": "BBGEFS",
  "BSE SELECT IPO": "SELIPO",
  "BSE SENSEX": "BSE30",
  "BSE SENSEX 50": "SNSX50",
  "BSE SENSEX EQUAL WEIGHT": "SENEQW",
  "BSE SENSEX NEXT 30": "SNXN30",
  "BSE SENSEX Next 50": "SNXT50",
  "BSE SENSEX SIXTY": "SNSX60",
  "BSE SENSEX SIXTY 65:35": "SS6535",
  "BSE SME IPO": "SMEIPO",
  "BSE Services": "BSESER",
  "BSE SmallCap Select Index": "SMLSEL",
  "BSE TECK": "TECK",
  "BSE Telecommunication": "TELCOM",
  "BSE Top 10 Banks": "T10BNK",
  "BSE Utilities": "UTILS",
};

export interface BseIndexConstituentRow {
  /** Resolved `/instruments/[symbol]` NSE code, or null when SCRIPNAME has no unambiguous match in our own StockEodQuote (BSE-only listing) — see module doc on "no dead links". */
  symbol: string | null;
  companyName: string;
  industry: string | null;
  /** BSE's own published `Weightage` from `NS_IndexWeight_SPDJ_ng` (see module doc) — null when this index has no entry in `BSE_INDEX_WEIGHT_NAME` or the live weight fetch failed/didn't cover this specific constituent. NOT an estimate (unlike NSE's `indexLiveWatch.ts` ffmc-share number) — this is BSE's own final weight. */
  weightPct: number | null;
}

/** Cheap sync check — true whenever this BSE index name has a verified Asia Index code, regardless of whether that code's constituent fetch has been attempted yet (a genuinely-empty code, e.g. "BSE 250 LARGEMIDCAP 65:35 INDEX", is only discovered on fetch — see module doc). */
export function hasBseIndexConstituents(bseIndexName: string): boolean {
  return bseIndexName in BSE_INDEX_CODE;
}

// ─── Company-name -> NSE symbol resolver (DB-sourced duplicate of apps/api/lib/marketMoves/nseSymbolResolver.ts's pure normalization — see module doc on the apps/web/apps/api server-code boundary) ───

const TRAILING_SUFFIX_TOKENS = new Set(["LIMITED", "LTD", "PRIVATE", "PVT"]);

function normalizeCompanyName(raw: string): string {
  const tokens = raw
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (tokens.length > 1 && tokens[0] === "THE") tokens.shift();
  while (tokens.length > 1 && TRAILING_SUFFIX_TOKENS.has(tokens[tokens.length - 1])) {
    tokens.pop();
  }
  return tokens.join(" ");
}

interface ResolvedName {
  symbol: string;
  companyName: string;
}

let nameIndex: { at: number; map: Map<string, ResolvedName | null> } | null = null;

/** Builds (or returns the cached) normalized-company-name -> {symbol, companyName} map from our own StockEodQuote — ambiguous names (two symbols sharing one normalized key) resolve to null and are never linked, same precision-over-recall rule nseSymbolResolver.ts uses. */
async function getNameIndex(): Promise<Map<string, ResolvedName | null>> {
  const now = Date.now();
  if (nameIndex && now - nameIndex.at < NAME_INDEX_TTL_MS) return nameIndex.map;

  const rows = await prisma.stockEodQuote.findMany({
    distinct: ["symbol"],
    select: { symbol: true, companyName: true },
  });
  const map = new Map<string, ResolvedName | null>();
  for (const r of rows) {
    if (!r.companyName) continue;
    const key = normalizeCompanyName(r.companyName);
    if (!key) continue;
    map.set(key, map.has(key) ? null : { symbol: r.symbol, companyName: r.companyName });
  }
  nameIndex = { at: now, map };
  return map;
}

/** BSE's own SCRIPNAME field is hard-capped at exactly 30 raw characters (verified live 2026-08-12: "ADANI PORTS AND SPECIAL ECONOM" / "POWER GRID CORPORATION OF INDI" both cut off mid-word at 30 chars, vs. our own full "Adani Ports and Special Economic Zone Limited"/"Power Grid Corporation of India Limited") — an exact-name match against our full company name fails for any constituent whose full name is >=30 characters, which silently dropped 2 of SENSEX's own 30 members (ADANIPORTS, POWERGRID) before this fallback existed. */
const SCRIPNAME_TRUNCATION_LENGTH = 30;

/**
 * Resolves a (possibly BSE-truncated) SCRIPNAME to our own NSE symbol. Exact
 * normalized match first (covers every non-truncated name, the vast
 * majority). Only when the RAW string looks truncated (>= 30 chars — see
 * `SCRIPNAME_TRUNCATION_LENGTH`'s doc) does this fall back to a prefix scan:
 * every StockEodQuote company name whose normalized form STARTS WITH the
 * truncated key is a candidate, and the match is accepted ONLY when every
 * candidate agrees on a single symbol (an unambiguous single company) —
 * exactly the same "ambiguous -> never resolve" precision-over-recall rule
 * `nseSymbolResolver.ts` established, extended to handle truncation rather
 * than loosened.
 */
function resolveScripName(scripName: string, map: Map<string, ResolvedName | null>): ResolvedName | null {
  const key = normalizeCompanyName(scripName);
  const exact = map.get(key);
  if (exact) return exact;
  if (map.has(key)) return null; // exact key present but ambiguous (two symbols share it) — never guess

  if (scripName.trim().length < SCRIPNAME_TRUNCATION_LENGTH) return null;

  let candidate: ResolvedName | null = null;
  for (const [k, v] of map) {
    if (!v || k === key || !k.startsWith(key)) continue;
    if (candidate && candidate.symbol !== v.symbol) return null; // >1 distinct company shares this prefix — ambiguous, never guess
    candidate = v;
  }
  return candidate;
}

/** Strips a trailing "LTD."/"LIMITED"/etc-style period and title-cases best-effort, for the display name of a BSE-only constituent this resolver can't link (e.g. "MAHINDRA & MAHINDRA LTD." -> "Mahindra & Mahindra Ltd"). Cosmetic only — never used for matching. */
function titleCaseCompanyName(raw: string): string {
  return raw
    .trim()
    .replace(/\.$/, "")
    .toLowerCase()
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .replace(/\bLtd\b/g, "Ltd")
    .replace(/&\s*/g, "& ");
}

interface CodewiseIndicesRow {
  SCRIP_CODE?: string | number | null;
  SCRIPNAME?: string | null;
  Industry_name?: string | null;
}

interface CodewiseIndicesResponse {
  Table?: CodewiseIndicesRow[];
}

const constituentCache = new Map<string, { at: number; rows: BaseConstituentRow[] | null }>();

async function fetchJson(baseUrl: string, path: string, headers: Record<string, string>): Promise<unknown | null> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    let res: Response;
    try {
      res = await fetch(`${baseUrl}${path}`, {
        headers,
        cache: "no-store",
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timeout);
    }
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

async function fetchAsiaIndexApi(path: string): Promise<unknown | null> {
  return fetchJson(ASIA_INDEX_API_BASE, path, ASIA_INDEX_HEADERS);
}

// ─── Live per-constituent weight (bseindia.com, NOT bseindices.com — see module doc) ───

const BSE_INDIA_API_BASE = "https://api.bseindia.com/BseIndiaAPI/api";

const BSE_INDIA_HEADERS = {
  "User-Agent": BROWSER_UA,
  Accept: "application/json, text/plain, */*",
  Origin: "https://www.bseindia.com",
  Referer: "https://www.bseindia.com/",
};

/** Real published weight is refreshed live all session — 15-minute TTL, matching indexLiveWatch.ts's identical choice for the analogous NSE feed (far shorter than constituentCache's 24h membership TTL above). */
const WEIGHT_CACHE_TTL_MS = 15 * 60 * 1000;

interface IndexWeightRow {
  Scrip_code?: string | number | null;
  Weightage?: number | null;
}

interface IndexWeightResponse {
  Table?: IndexWeightRow[];
}

const weightCache = new Map<string, { at: number; weights: Map<string, number> | null }>();

/**
 * Live per-constituent BSE-published weight (`Weightage`), keyed by BSE scrip
 * code (matches `Codewise_Indices`'s `SCRIP_CODE` exactly — see module doc).
 * Returns null when this index isn't in `BSE_INDEX_WEIGHT_NAME` or the live
 * fetch fails/returns no rows. Never throws.
 */
async function fetchBseIndexWeights(bseIndexName: string): Promise<Map<string, number> | null> {
  const iname = BSE_INDEX_WEIGHT_NAME[bseIndexName];
  if (!iname) return null;

  const now = Date.now();
  const cached = weightCache.get(iname);
  if (cached && now - cached.at < WEIGHT_CACHE_TTL_MS) return cached.weights;

  const raw = (await fetchJson(
    BSE_INDIA_API_BASE,
    `/NS_IndexWeight_SPDJ_ng/w?iname=${encodeURIComponent(iname)}`,
    BSE_INDIA_HEADERS,
  )) as IndexWeightResponse | null;
  if (!raw) return cached?.weights ?? null;

  const table = raw.Table ?? [];
  const weights = new Map<string, number>();
  for (const r of table) {
    if (r.Scrip_code == null || r.Weightage == null) continue;
    weights.set(String(r.Scrip_code).trim(), r.Weightage);
  }
  if (weights.size === 0) return cached?.weights ?? null;

  weightCache.set(iname, { at: now, weights });
  return weights;
}

/** Membership row shape cached for 24h — deliberately WITHOUT weightPct, which needs its own much-shorter TTL (see fetchBseIndexConstituents's doc on why the two are cached separately rather than one merged 24h-cached array). */
interface BaseConstituentRow {
  scripCode: string;
  symbol: string | null;
  companyName: string;
  industry: string | null;
}

/**
 * Returns this BSE index's constituent list (member stocks resolved against
 * our own StockEodQuote where possible), or null when this index has no
 * verified code, the live fetch fails, or the code returned zero rows (e.g.
 * "BSE 250 LARGEMIDCAP 65:35 INDEX" — see module doc). Membership (symbol/
 * companyName/industry) is cached 24h, mirroring indexConstituents.ts's CSV
 * cache — BSE index membership rebalances at most quarterly, far slower than
 * this TTL. `weightPct` is deliberately NOT part of that 24h cache: it's
 * merged in on EVERY call from `fetchBseIndexWeights`'s own independent
 * 15-minute-TTL cache, so a page view 2 hours into the 24h membership-cache
 * window still gets a weight no more than 15 minutes stale — caching the two
 * together at 24h would have silently frozen weights for a full day. Never
 * throws.
 */
export async function fetchBseIndexConstituents(bseIndexName: string): Promise<BseIndexConstituentRow[] | null> {
  const code = BSE_INDEX_CODE[bseIndexName];
  if (!code) return null;

  const now = Date.now();
  const cached = constituentCache.get(code);
  const haveFreshBase = !!cached && now - cached.at < CACHE_TTL_MS;

  // Membership and live weight table are fully independent live fetches
  // (different hosts, different code spaces, different TTLs — see module
  // doc) — run concurrently rather than sequentially awaited whenever both
  // are needed, same latency-parity reasoning instrument.ts's own
  // Promise.all already applies one level up. Weight is always (re)fetched
  // regardless of the membership-cache state; membership is skipped when
  // still fresh.
  const [raw, weights] = await Promise.all([
    haveFreshBase
      ? Promise.resolve(null)
      : (fetchAsiaIndexApi(`/Codewise_Indices/w?code=${code}`) as Promise<CodewiseIndicesResponse | null>),
    fetchBseIndexWeights(bseIndexName),
  ]);

  let base: BaseConstituentRow[] | null;
  if (haveFreshBase) {
    base = cached!.rows;
  } else if (!raw) {
    base = cached?.rows ?? null;
  } else {
    const table = raw.Table ?? [];
    if (table.length === 0) {
      // A genuinely empty code (verified live 2026-08-12, see module doc) is
      // a real, stable finding — cache it as null so future requests don't
      // re-fetch every time, but never overwrite a previously-successful
      // stale-serve with an empty result (a transient backend hiccup should
      // fall back to last-known-good, not blank the panel).
      base = cached?.rows ?? null;
      if (!cached?.rows) constituentCache.set(code, { at: now, rows: null });
    } else {
      const nameMap = await getNameIndex();
      const seen = new Set<string>();
      const built: BaseConstituentRow[] = [];
      for (const r of table) {
        const scripName = r.SCRIPNAME?.trim();
        if (!scripName) continue;
        const scripCode = String(r.SCRIP_CODE ?? scripName);
        if (seen.has(scripCode)) continue;
        seen.add(scripCode);

        const resolved = resolveScripName(scripName, nameMap);
        built.push({
          scripCode,
          symbol: resolved?.symbol ?? null,
          companyName: resolved?.companyName ?? titleCaseCompanyName(scripName),
          industry: r.Industry_name?.trim() || null,
        });
      }
      base = built.length > 0 ? built : (cached?.rows ?? null);
      if (built.length > 0) constituentCache.set(code, { at: now, rows: built });
    }
  }

  if (!base) return null;
  return base.map((b) => ({
    symbol: b.symbol,
    companyName: b.companyName,
    industry: b.industry,
    weightPct: weights?.get(b.scripCode) ?? null,
  }));
}
