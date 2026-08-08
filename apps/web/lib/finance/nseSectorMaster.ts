/**
 * NSE's own "NIFTY Total Market" constituent list — a keyless CSV published
 * on the same nsearchives host as EQUITY_L.csv (see apps/api/lib/marketMoves/
 * nse.ts's transport note: nsearchives.nseindia.com is NOT Akamai-gated,
 * plain `fetch()` works fine there — only www.nseindia.com needs the
 * curl-subprocess + cookie dance).
 *
 * INVESTIGATION (Sector filter, 2026-08-09): NSE's per-stock quote-equity API
 * (GET /api/quote-equity?symbol=X on www.nseindia.com), which would carry the
 * richer macro/sector/industry/basic-industry 4-tier classification, is
 * HARD-BLOCKED by Akamai's WAF — verified live from this box: the SAME primed
 * session that gets a clean 200 from /api/live-analysis-variations and
 * /api/corporate-announcements gets a 403 "Access Denied ... on this server"
 * from errors.edgesuite.net on /api/quote-equity specifically. This is a
 * PATH-LEVEL WAF rule, not the cookie-challenge pattern nse.ts already routes
 * around (that pattern still returns real data after the cookie replay; this
 * one refuses outright regardless of cookie/headers). Getting around a WAF
 * path rule would need browser automation / different IP reputation — not
 * justified for a filter feature. So the single-stock endpoint is off the
 * table as a source.
 *
 * This CSV is the best available alternative: NSE's OWN "Industry" label
 * (their own naming convention — "Metals & Mining", "Automobile and Auto
 * Components", "Fast Moving Consumer Goods", etc, not GICS) for every
 * constituent of the NIFTY Total Market index — NSE's broadest "cover
 * everything liquid" index (~750 names), not a narrow sectoral index like
 * NIFTY AUTO/PHARMA (correctly rejected earlier for the same reason NSE
 * index-membership was rejected as the taxonomy source generally — those
 * narrow indices only cover 15-50 curated names each). Verified live
 * 2026-08-09: covers 107/119 (90%) of real, currently-listed NSE-equity
 * tickers referenced in ExpertOpinion.instrumentTicker (dev DB). The residual
 * ~10% (small/micro-caps below the Total Market cutoff) fall back to Yahoo's
 * sector/industry via sectorTaxonomy.ts's mapYahooToSectorLabel — see
 * opinionsQuery.ts's buildSectorIndex for how the two sources combine.
 */

const NSE_TOTAL_MARKET_CSV_URL = "https://nsearchives.nseindia.com/content/indices/ind_niftytotalmarket_list.csv";
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const FETCH_TIMEOUT_MS = 15_000;

const BROWSER_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

let cache: { at: number; map: Map<string, string> } | null = null;

/** Parses "Company Name,Industry,Symbol,Series,ISIN Code" → symbol→industry. NSE's published files have no commas inside a field (same assumption EQUITY_L.csv's parser makes), so a plain split is safe. */
function parseNseTotalMarketCsv(csv: string): Map<string, string> {
  const map = new Map<string, string>();
  const lines = csv.split(/\r?\n/);
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    const parts = line.split(",");
    if (parts.length < 3) continue;
    const industry = parts[1]?.trim();
    const symbol = parts[2]?.trim();
    if (symbol && industry) map.set(symbol, industry);
  }
  return map;
}

/**
 * Returns a bare-NSE-symbol → NSE-native industry-label map, cached 24h
 * in-module (this classification changes only on index reconstitution —
 * far less often than the 12h TTL nse.ts uses for the equity-name master).
 * On any fetch/parse failure returns the last good cache (or an empty map)
 * so a sector lookup never blocks or breaks the /opinions page — callers
 * degrade to "unclassified" for affected symbols. Never throws.
 */
export async function getNseIndustryMap(): Promise<Map<string, string>> {
  const now = Date.now();
  if (cache && now - cache.at < CACHE_TTL_MS) return cache.map;

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    let res: Response;
    try {
      res = await fetch(NSE_TOTAL_MARKET_CSV_URL, {
        headers: { "User-Agent": BROWSER_UA },
        cache: "no-store",
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timeout);
    }
    if (!res.ok) {
      console.warn(`[nseSectorMaster] NIFTY Total Market CSV returned ${res.status}`);
      return cache?.map ?? new Map();
    }
    const map = parseNseTotalMarketCsv(await res.text());
    if (map.size > 0) cache = { at: now, map };
    return cache?.map ?? map;
  } catch (err) {
    console.warn(`[nseSectorMaster] NIFTY Total Market CSV fetch error: ${err instanceof Error ? err.message : err}`);
    return cache?.map ?? new Map();
  }
}
