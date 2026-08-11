/**
 * NSE Live Index Watch — per-constituent LIVE data (price + free-float
 * market cap) traced live from NSE's own site, not the archived CSV family
 * indexConstituents.ts already uses.
 *
 * ORIGIN (founder ask, 2026-08-12: "On NSE's page each Index has the Index
 * Constituents — from there we can easily get the constituents"). A prior
 * investigation (.claude/agent-memory/cto-lead-developer/
 * reference_index_weight_data_sources_dead_2026_08_12.md) found the OLD
 * `/api/equity-stockIndices` endpoint every scraping guide documents is a
 * genuine 404 (casualty of NSE's early-2026 Next.js rebuild) and that
 * niftyindices.com's constituent-level JSON feeds are frozen since January
 * 2026. This file uses a DIFFERENT, previously-undocumented endpoint found
 * by literally loading the live page a user would land on
 * (`https://www.nseindia.com/market-data/live-equity-market?symbol=NIFTY%20CEMENT`
 * — the exact founder example) in headless Chrome with network capture:
 *
 *   GET /api/NextApi/apiClient/marketWatchApi?functionName=getIndicesData&symbol=<NSE QUERY SYMBOL>
 *
 * This is the feed powering the constituent table on that live page (verified
 * 2026-08-12 by matching every row against the on-page screenshot for NIFTY
 * CEMENT). It returns one row per constituent (`priority: 0`) plus one
 * summary row for the index itself (`priority: 1`, `companyName`/`ffmc` both
 * null — filtered out below) with `ffmc` = free-float market capitalisation,
 * a REAL NSE-published number (not derived/estimated) that the OLD dead
 * `equity-stockIndices` endpoint also carried under the same field name.
 *
 * WEIGHT HONESTY (per this codebase's "never fabricate weights" law —
 * indexConstituents.ts's own module doc): `weightPct` below is computed as
 * `ffmc_i / sum(ffmc)` across a request's constituent rows — a genuine,
 * industry-standard free-float-market-cap-share estimate built from NSE's
 * own live numbers, NOT invented from shares-outstanding math. It is
 * disclosed as an ESTIMATE, not asserted to be NSE's own published index
 * weight: NSE additionally applies per-index capping factors (single-stock/
 * sector concentration caps, e.g. 33%/20% on some indices) before publishing
 * an official weight, and those capping factors are not present in this
 * payload (same gap the dead niftyindices.com heatmap feed had — see the
 * prior investigation doc). A single-stock weight computed here that lands
 * NEAR a typical cap threshold (observed live: NIFTY CEMENT's ULTRACEMCO at
 * ~34.7%) should be read as "this stock's free-float market-cap share",
 * which may differ slightly from NSE's own post-capping published weight for
 * the small set of indices where a cap actually binds. The UI must label
 * this accordingly (see index-composition-panel.tsx).
 *
 * TRANSPORT: this endpoint lives on www.nseindia.com (Akamai-gated), NOT the
 * keyless nsearchives host indexConstituents.ts's CSVs use — so it needs the
 * SAME cookie-priming + curl-subprocess dance apps/api/lib/marketMoves/nse.ts
 * already implements (Node's native fetch/undici TLS fingerprint is
 * 403-blocked by NSE's Akamai from server IPs; curl's is not — verified live
 * from this dev box AND cross-confirmed against nse.ts's own prod incident
 * note). apps/web CANNOT import apps/api's server code (see
 * lib/portfolios/displayName.ts's own module doc on this exact boundary), so
 * the transport is duplicated here rather than shared — same tradeoff that
 * file already accepted. Requires `curl` in the runtime image (added to
 * apps/web/Dockerfile's runner stage alongside this change).
 *
 * SCOPE: `LIVE_INDEX_WATCH_SYMBOL` below is a hand-verified dictionary
 * (internal `/instruments/[symbol]` code -> NSE's own abbreviated query
 * symbol), sourced directly from NSE's OWN published name->symbol map
 * (`functionName=getIndexList`, fetched live 2026-08-12 — 122 real index
 * entries, not guessed/derived) — never a runtime guess. Two roles:
 *   1. WEIGHT OVERLAY for indices indexConstituents.ts already has a CSV
 *      for (membership stays CSV-sourced/primary; this only adds weightPct).
 *   2. GAP-FILL for indices in indexConstituents.ts's KNOWN_NO_CONSTITUENT_LIST
 *      (verified-absent from the CSV family) — 68 of the 111 recovered this
 *      way, full constituent list + weight, live-verified.
 * The remaining 43 of 111 are NOT in NSE's own getIndexList dictionary
 * either (mostly G-Sec/fixed-income indices, PR/TR futures & leverage/
 * inverse variants, the Bharat Bond target-maturity series, a USD variant,
 * and a handful of real equity-sector gaps like NIFTY CAPITAL GOODS/POWER/
 * NBFC/INSURANCE/RETAIL) — a genuine gap in what this Market Watch category
 * covers, not a mapping failure; they stay absent, same honest-default
 * discipline as indexConstituents.ts.
 */

import { execFile } from "node:child_process";

const NSE_ORIGIN = "https://www.nseindia.com";

const BROWSER_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

const HTML_HEADERS = {
  "User-Agent": BROWSER_UA,
  Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "Accept-Language": "en-US,en;q=0.9",
};

const API_HEADERS_BASE = {
  "User-Agent": BROWSER_UA,
  Accept: "application/json, text/plain, */*",
  "Accept-Language": "en-US,en;q=0.9",
  "X-Requested-With": "XMLHttpRequest",
  "Sec-Fetch-Dest": "empty",
  "Sec-Fetch-Mode": "cors",
  "Sec-Fetch-Site": "same-origin",
};

interface CurlResponse {
  status: number;
  setCookies: string[];
  body: string;
}

/** Mirrors apps/api/lib/marketMoves/nse.ts's curlRequest exactly — see that file's TRANSPORT NOTE for why a curl subprocess is required against www.nseindia.com. */
function curlRequest(url: string, headers: Record<string, string>, timeoutSecs = 25): Promise<CurlResponse | null> {
  return new Promise((resolve) => {
    const args = ["-s", "-D", "-", "--compressed", "--max-time", String(timeoutSecs)];
    for (const [k, v] of Object.entries(headers)) args.push("-H", `${k}: ${v}`);
    args.push(url);
    execFile("curl", args, { maxBuffer: 64 * 1024 * 1024 }, (err, stdout) => {
      if (err || !stdout) {
        resolve(null);
        return;
      }
      let rest = stdout;
      let status = 0;
      const setCookies: string[] = [];
      while (/^HTTP\//.test(rest)) {
        const sep = rest.indexOf("\r\n\r\n");
        if (sep < 0) break;
        const lines = rest.slice(0, sep).split("\r\n");
        status = Number(lines[0]?.split(/\s+/)[1] ?? 0);
        for (const line of lines) {
          if (/^set-cookie:/i.test(line)) setCookies.push(line.slice(line.indexOf(":") + 1).trim());
        }
        rest = rest.slice(sep + 4);
      }
      resolve({ status, setCookies, body: rest });
    });
  });
}

/** Mirrors nse.ts's primeNseSession — warms up an NSE session page and returns the Cookie header to replay. Never throws. */
async function primeSession(warmUpPath: string): Promise<string | null> {
  try {
    const res = await curlRequest(`${NSE_ORIGIN}${warmUpPath}`, HTML_HEADERS);
    if (!res) return null;
    const cookie = res.setCookies
      .map((c) => c.split(";")[0])
      .filter(Boolean)
      .join("; ");
    return cookie || null;
  } catch {
    return null;
  }
}

/** Mirrors nse.ts's nseApiGet — GETs an NSE API path with a primed cookie + matching referer. Never throws. */
async function apiGet(apiPath: string, cookie: string, refererPath: string): Promise<unknown | null> {
  try {
    const bust = `${apiPath.includes("?") ? "&" : "?"}_=${Date.now()}`;
    const res = await curlRequest(`${NSE_ORIGIN}${apiPath}${bust}`, {
      ...API_HEADERS_BASE,
      Cookie: cookie,
      Referer: `${NSE_ORIGIN}${refererPath}`,
      Origin: NSE_ORIGIN,
    });
    if (!res || res.status < 200 || res.status >= 300) return null;
    return JSON.parse(res.body);
  } catch {
    return null;
  }
}

/**
 * Internal symbol -> NSE's abbreviated live-market-indices query symbol.
 * Hand-verified against NSE's own `getIndexList` dictionary, live-fetched
 * 2026-08-12 (see this file's module doc). Two groups, both real: CSV-overlap
 * entries add weight on top of indexConstituents.ts's existing membership;
 * gap-fill entries are the sole constituent source for those symbols.
 */
export const LIVE_INDEX_WATCH_SYMBOL: Record<string, string> = {
  // Weight overlay for CSV-covered indices (47) — same membership as
  // indexConstituents.ts's CONSTITUENT_CSV_SLUG, this only adds weight%.
  BANKNIFTY: "NIFTY BANK",
  FINNIFTY: "NIFTY FIN SERVICE",
  MIDCPNIFTY: "NIFTY MID SELECT",
  NIFTY: "NIFTY 50",
  NIFTY100: "NIFTY 100",
  NIFTY200: "NIFTY 200",
  NIFTY200ALPHA30: "NIFTY200 ALPHA 30",
  NIFTY500: "NIFTY 500",
  NIFTYAUTO: "NIFTY AUTO",
  NIFTYCOMMODITIES: "NIFTY COMMODITIES",
  NIFTYCONSUMERDURABLES: "NIFTY CONSR DURBL",
  NIFTYCOREHOUSING: "NIFTY COREHOUSING",
  NIFTYCPSE: "NIFTY CPSE",
  NIFTYDIVIDENDOPPORTUNITIES50: "NIFTY DIV OPPS 50",
  NIFTYENERGY: "NIFTY ENERGY",
  NIFTYFINANCIALSERVICESEXBANK: "NIFTY FINSEREXBNK",
  NIFTYFMCG: "NIFTY FMCG",
  NIFTYHEALTHCAREINDEX: "NIFTY HEALTHCARE",
  NIFTYINDIACONSUMPTION: "NIFTY CONSUMPTION",
  NIFTYINDIADEFENCE: "NIFTY IND DEFENCE",
  NIFTYINDIADIGITAL: "NIFTY IND DIGITAL",
  NIFTYINDIAMANUFACTURING: "NIFTY INDIA MFG",
  NIFTYINDIATOURISM: "NIFTY IND TOURISM",
  NIFTYIT: "NIFTY IT",
  NIFTYLARGEMIDCAP250: "NIFTY LARGEMID250",
  NIFTYMEDIA: "NIFTY MEDIA",
  NIFTYMETAL: "NIFTY METAL",
  NIFTYMIDCAP100: "NIFTY MIDCAP 100",
  NIFTYMIDCAP150: "NIFTY MIDCAP 150",
  NIFTYMIDCAP150MOMENTUM50: "NIFTYM150MOMNTM50",
  NIFTYMIDCAP150QUALITY50: "NIFTY M150 QLTY50",
  NIFTYMIDCAP50: "NIFTY MIDCAP 50",
  NIFTYMIDSMALLCAP400: "NIFTY MIDSML 400",
  NIFTYMIDSMALLHEALTHCARE: "NIFTY MIDSML HLTH",
  NIFTYMIDSMALLINDIACONSUMPTION: "NIFTY MS IND CONS",
  NIFTYMNC: "NIFTY MNC",
  NIFTYMOBILITY: "NIFTY MOBILITY",
  NIFTYPHARMA: "NIFTY PHARMA",
  NIFTYPRIVATEBANK: "NIFTY PVT BANK",
  NIFTYPSE: "NIFTY PSE",
  NIFTYPSUBANK: "NIFTY PSU BANK",
  NIFTYREALTY: "NIFTY REALTY",
  NIFTYSMALLCAP100: "NIFTY SMLCAP 100",
  NIFTYSMALLCAP250QUALITY50: "NIFTY SML250 Q50",
  NIFTYSMALLCAP50: "NIFTY SMLCAP 50",
  NIFTYTOTALMARKET: "NIFTY TOTAL MKT",
  NIFTYTRANSPORTATIONLOGISTICS: "NIFTY TRANS LOGIS",

  // Gap-fill for CSV-absent indices (68 of indexConstituents.ts's
  // KNOWN_NO_CONSTITUENT_LIST, 111 total) — this endpoint is the ONLY
  // constituent source for these; hasIndexConstituentList() now returns
  // true for them via hasIndexLiveWatch() below.
  NIFTY100ALPHA30: "NIFTY100 ALPHA 30",
  NIFTY100ENHANCEDESG: "NIFTY100 ENH ESG",
  NIFTY100EQUALWEIGHT: "NIFTY100 EQL WGT",
  NIFTY100ESG: "NIFTY100 ESG",
  NIFTY100LIQUID15: "NIFTY100 LIQ 15",
  NIFTY100LOWVOLATILITY30: "NIFTY100 LOWVOL30",
  NIFTY100QUALITY30: "NIFTY100 QUALTY30",
  NIFTY200MOMENTUM30: "NIFTY200MOMENTM30",
  NIFTY200QUALITY30: "NIFTY200 QUALTY30",
  NIFTY200VALUE30: "NIFTY200 VALUE 30",
  NIFTY500EQUALWEIGHT: "NIFTY500 EW",
  NIFTY500FLEXICAPQUALITY30: "NIFTY500 FLEXICAP",
  NIFTY500HEALTHCARE: "NIFTY500 HEALTH",
  NIFTY500LARGEMIDSMALLEQUALCAPWEIGHTED: "NIFTY500 LMS EQL",
  NIFTY500LOWVOLATILITY50: "NIFTY500 LOWVOL50",
  NIFTY500MOMENTUM50: "NIFTY500MOMENTM50",
  NIFTY500MULTICAP502525: "NIFTY500 MULTICAP",
  NIFTY500MULTICAPINDIAMANUFACTURING503020: "NIFTY MULTI MFG",
  NIFTY500MULTICAPINFRASTRUCTURE503020: "NIFTY MULTI INFRA",
  NIFTY500MULTICAPMOMENTUMQUALITY50: "NIFTY MULTI MQ 50",
  NIFTY500MULTIFACTORMQVLV50: "NIFTY500 MQVLV50",
  NIFTY500QUALITY50: "NIFTY500 QLTY50",
  NIFTY500SHARIAH: "NIFTY500 SHARIAH",
  NIFTY500VALUE50: "NIFTY500 VALUE 50",
  NIFTY50EQUALWEIGHT: "NIFTY50 EQL WGT",
  NIFTY50SHARIAH: "NIFTY50 SHARIAH",
  NIFTY50VALUE20: "NIFTY50 VALUE 20",
  NIFTYALPHA50: "NIFTY ALPHA 50",
  NIFTYALPHALOWVOLATILITY30: "NIFTY ALPHALOWVOL",
  NIFTYALPHAQUALITYLOWVOLATILITY30: "NIFTY AQL 30",
  NIFTYALPHAQUALITYVALUELOWVOLATILITY30: "NIFTY AQLV 30",
  NIFTYCAPITALMARKETS: "NIFTY CAPITAL MKT",
  NIFTYCEMENT: "NIFTY CEMENT",
  NIFTYCHEMICALS: "NIFTY CHEMICALS",
  NIFTYCONGLOMERATE50: "NIFTYCONGLOMERATE",
  NIFTYEVNEWAGEAUTOMOTIVE: "NIFTY EV",
  NIFTYFINANCIALSERVICES2550: "NIFTY FINSRV25 50",
  NIFTYGROWTHSECTORS15: "NIFTY GROWSECT 15",
  NIFTYHIGHBETA50: "NIFTY HIGHBETA 50",
  NIFTYHOUSING: "NIFTY HOUSING",
  NIFTYINDIACORPORATEGROUPINDEXTATAGROUP25CAP: "NIFTY TATA 25 CAP",
  NIFTYINDIAFPI150: "NIFTY FPI 150",
  NIFTYINDIAINFRASTRUCTURELOGISTICS: "NIFTY INFRALOG",
  NIFTYINDIAINTERNET: "NIFTY INTERNET",
  NIFTYINDIANEWAGECONSUMPTION: "NIFTY NEW CONSUMP",
  NIFTYINDIARAILWAYSPSU: "NIFTY RAILWAYSPSU",
  NIFTYINDIASELECT5CORPORATEGROUPSMAATR: "NIFTY CORP MAATR",
  NIFTYIPO: "NIFTY IPO",
  NIFTYLOWVOLATILITY50: "NIFTY LOW VOL 50",
  NIFTYMIDCAPLIQUID15: "NIFTY MID LIQ 15",
  NIFTYMIDSMALLCAP4005050: "NIFTY MIDSMALL 50 50",
  NIFTYMIDSMALLCAP400MOMENTUMQUALITY100: "NIFTYMS400 MQ 100",
  NIFTYMIDSMALLFINANCIALSERVICES: "NIFTY MS FIN SERV",
  NIFTYMIDSMALLITTELECOM: "NIFTY MS IT TELCM",
  NIFTYNONCYCLICALCONSUMER: "NIFTY NONCYC CONS",
  NIFTYQUALITYLOWVOLATILITY30: "NIFTY QLTY LV 30",
  NIFTYREITSREALTY: "NIFTY REITS REALTY",
  NIFTYRURAL: "NIFTY RURAL",
  NIFTYSERVICESSECTOR: "NIFTY SERV SECTOR",
  NIFTYSHARIAH25: "NIFTY SHARIAH 25",
  NIFTYSMALLCAP250MOMENTUMQUALITY100: "NIFTYSML250MQ 100",
  NIFTYSMALLCAP500: "NIFTY SMALLCAP 500",
  NIFTYSMEEMERGE: "NIFTY SME EMERGE",
  NIFTYTOP10EQUALWEIGHT: "NIFTY TOP 10 EW",
  NIFTYTOP15EQUALWEIGHT: "NIFTY TOP 15 EW",
  NIFTYTOP20EQUALWEIGHT: "NIFTY TOP 20 EW",
  NIFTYTOTALMARKETMOMENTUMQUALITY50: "NIFTY TMMQ 50",
  NIFTYWAVES: "NIFTY WAVES",
};

export interface IndexLiveWatchRow {
  symbol: string;
  companyName: string;
  /** Free-float market cap (₹), straight from NSE's own live payload. Null only ever seen on the index's own summary row, which is filtered out before rows reach a caller. */
  ffmc: number;
  /** ffmc_i / sum(ffmc) across this response, as a percent (0-100). An HONEST ESTIMATE, not NSE's own published (possibly capped) weight — see this file's module doc. */
  weightPct: number;
  lastPrice: number | null;
  changePercent: number | null;
}

/** Raw shape of one row from getIndicesData. */
interface RawIndicesDataRow {
  priority?: number | null;
  symbol?: string | null;
  companyName?: string | null;
  ffmc?: number | null;
  lastPrice?: number | null;
  pChange?: number | null;
}

const CACHE_TTL_MS = 15 * 60 * 1000; // live prices + weight — much shorter than the 24h CSV cache
const FETCH_TIMEOUT_MS = 25_000;
const cache = new Map<string, { at: number; rows: IndexLiveWatchRow[] }>();

/** Cheap sync check — the composition path's gate for "does a live-watch source exist for this symbol at all" (either overlay or gap-fill). */
export function hasIndexLiveWatch(symbol: string): boolean {
  return symbol.trim().toUpperCase() in LIVE_INDEX_WATCH_SYMBOL;
}

/**
 * Fetches this index's live constituent watch (price + free-float-mcap-share
 * weight), or null when unmapped/unavailable. Cached 15 min with stale-serve
 * on a failed refetch. Never throws — a caller always gets rows or null, on
 * NSE's own error behavior.
 */
export async function fetchIndexLiveWatch(symbol: string): Promise<IndexLiveWatchRow[] | null> {
  const key = symbol.trim().toUpperCase();
  const nseSymbol = LIVE_INDEX_WATCH_SYMBOL[key];
  if (!nseSymbol) return null;

  const now = Date.now();
  const cached = cache.get(key);
  if (cached && now - cached.at < CACHE_TTL_MS) return cached.rows;

  try {
    const cookie = await primeSession("/market-data/live-equity-market");
    if (!cookie) {
      console.warn(`[indexLiveWatch] ${key} (${nseSymbol}) session priming failed (no cookie)`);
      return cached?.rows ?? null;
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    let result: unknown;
    try {
      result = await apiGet(
        `/api/NextApi/apiClient/marketWatchApi?functionName=getIndicesData&symbol=${encodeURIComponent(nseSymbol)}`,
        cookie,
        `/market-data/live-equity-market?symbol=${encodeURIComponent(nseSymbol)}`
      );
    } finally {
      clearTimeout(timeout);
    }

    const rawRows = (result as { data?: { data?: RawIndicesDataRow[] } } | null)?.data?.data;
    if (!Array.isArray(rawRows)) {
      console.warn(`[indexLiveWatch] ${key} (${nseSymbol}) API returned no usable data (likely a transient Akamai block)`);
      return cached?.rows ?? null;
    }

    // priority:1 is the index's own summary row (companyName/ffmc both null)
    // — a constituent, never the index itself.
    const constituents = rawRows.filter(
      (r): r is RawIndicesDataRow & { symbol: string; companyName: string; ffmc: number } =>
        typeof r.symbol === "string" && typeof r.companyName === "string" && typeof r.ffmc === "number"
    );
    if (constituents.length === 0) return cached?.rows ?? null;

    const totalFfmc = constituents.reduce((sum, r) => sum + r.ffmc, 0);
    const rows: IndexLiveWatchRow[] = constituents
      .map((r) => ({
        symbol: r.symbol,
        companyName: r.companyName,
        ffmc: r.ffmc,
        weightPct: totalFfmc > 0 ? (r.ffmc / totalFfmc) * 100 : 0,
        lastPrice: typeof r.lastPrice === "number" ? r.lastPrice : null,
        changePercent: typeof r.pChange === "number" ? r.pChange : null,
      }))
      .sort((a, b) => b.weightPct - a.weightPct);

    cache.set(key, { at: now, rows });
    return rows;
  } catch (err) {
    console.warn(`[indexLiveWatch] ${key} (${nseSymbol}) fetch error: ${err instanceof Error ? err.message : err}`);
    return cached?.rows ?? null;
  }
}
