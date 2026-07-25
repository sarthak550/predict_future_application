/**
 * Market Pulse — NSE unofficial JSON endpoint fetchers.
 *
 * VERIFICATION STATUS (2026-07-10): VERIFIED WORKING from the production EC2 box.
 * Key subtlety: NSE's Akamai serves an HTTP 403 challenge to the HTML homepage
 * (`GET /`) even from EC2 — BUT it still sets the session cookie in that 403
 * response, and the `/api/*` routes then return real 200 JSON when that cookie
 * is replayed with a full browser header set. So we do NOT treat a non-200
 * warm-up as failure — we capture the cookie regardless of status. Confirmed
 * live from EC2: /api/corporate-announcements → 200 (726 rows) and
 * /api/live-analysis-variations?index=gainers → 200 with real movers.
 *
 * Endpoints used (all under https://www.nseindia.com):
 *   - GET  /                                          (cookie priming; 403 body, cookie still set)
 *   - GET  /api/corporate-announcements?index=equities&from_date=DD-MM-YYYY&to_date=DD-MM-YYYY
 *   - GET  /api/live-analysis-variations?index=gainers  (and ?index=losers)
 *
 * Cookie handshake: GET the homepage with browser-realistic headers, capture
 * every `Set-Cookie` via `Headers.getSetCookie()` (Node 18.14+/undici — this
 * repo runs Node 23) EVEN ON A 403, then replay the `name=value` pairs as a
 * single `Cookie` header on the API GET, with `Referer` + `X-Requested-With` +
 * `Sec-Fetch-*` (NSE's Akamai checks these, not just the cookie).
 */

import { classifyMarketMoveEventType, isIndexSymbol } from "./classify";
import type { FetchedMarketMoveEvent, FetchedMarketMover } from "./types";

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

/**
 * TRANSPORT NOTE (2026-07-26, prod incident): www.nseindia.com's Akamai began
 * 403-ing Node's native fetch/undici TLS fingerprint from servers — verified
 * on EC2 that a stock node:20 container gets 403-no-cookie on the homepage
 * while curl from the SAME host/IP gets 200+cookies; Chrome-cipher spoofing
 * via node:https did NOT help (the fingerprinting is deeper than cipher
 * order). All www.nseindia.com requests therefore go through a curl
 * SUBPROCESS below (curl ships in the runner image — see apps/api/Dockerfile).
 * nsearchives.nseindia.com is NOT affected (plain fetch still fine there —
 * bhavcopy/equity-master/fo_mktlots keep their existing transport).
 */
import { execFile } from "node:child_process";

interface CurlResponse {
  status: number;
  setCookies: string[];
  body: string;
}

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
      // -D - interleaves one header block per hop before the body; walk any
      // leading HTTP/ blocks (1xx etc.), keeping the LAST status + every
      // Set-Cookie seen.
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

/** Extracts a `name=value; name2=value2` Cookie header from a Set-Cookie response. */
function cookieHeaderFrom(res: Response): string {
  // Node 18.14+/undici exposes getSetCookie(); fall back to the single-header
  // getter (only captures one cookie) for older runtimes as defense-in-depth.
  const headers = res.headers as Headers & { getSetCookie?: () => string[] };
  const rawCookies = typeof headers.getSetCookie === "function"
    ? headers.getSetCookie()
    : (res.headers.get("set-cookie") ? [res.headers.get("set-cookie") as string] : []);

  return rawCookies
    .map((c) => c.split(";")[0]) // strip Path/Expires/HttpOnly/etc — keep name=value
    .filter(Boolean)
    .join("; ");
}

/**
 * Primes an NSE session: GET the given warm-up path, return the Cookie header
 * to replay on the follow-up API call. Never throws — returns null on any
 * failure so callers can log-and-skip rather than crash the cron.
 *
 * Exported so other NSE fetchers (e.g. intraday.ts) can reuse the same
 * handshake instead of reimplementing the Akamai cookie dance.
 */
/**
 * The HOMEPAGE "/" is hard-403'd (no cookies) even for curl since 2026-07-26 —
 * but SECTION pages still 200 with full cookies (nsit + _abck). Any caller
 * still warming up via "/" gets silently remapped to a verified-good section
 * page rather than failing.
 */
const HOMEPAGE_WARMUP_SUBSTITUTE = "/market-data/live-market-indices";

export async function primeNseSession(warmUpPath: string): Promise<string | null> {
  const effectivePath = warmUpPath === "/" ? HOMEPAGE_WARMUP_SUBSTITUTE : warmUpPath;
  try {
    // curl transport — see TRANSPORT NOTE above (Node's TLS fingerprint is
    // 403-blocked by NSE's Akamai since 2026-07-26; curl's passes).
    const res = await curlRequest(`${NSE_ORIGIN}${effectivePath}`, HTML_HEADERS);
    if (!res) {
      console.warn(`[marketMoves/nse] warm-up ${effectivePath} curl transport failed`);
      return null;
    }
    // Do NOT bail on a non-200 warm-up: NSE's Akamai serves a 403 challenge to
    // the HTML page but STILL sets the session cookie the /api/* routes need.
    // Capture the cookie regardless of status. (Verified from EC2 2026-07-10.)
    const cookie = res.setCookies
      .map((c) => c.split(";")[0])
      .filter(Boolean)
      .join("; ");
    if (!cookie) {
      console.warn(`[marketMoves/nse] warm-up ${effectivePath} set no cookie (status ${res.status})`);
      return null;
    }
    return cookie;
  } catch (err) {
    console.warn(`[marketMoves/nse] warm-up ${effectivePath} network error: ${err instanceof Error ? err.message : err}`);
    return null;
  }
}

/**
 * GETs an NSE API path with a primed cookie + matching referer. Never throws.
 *
 * Exported so other NSE fetchers (e.g. intraday.ts) can reuse the same
 * no-store + cache-busting + full-browser-header GET instead of
 * reimplementing it.
 */
export async function nseApiGet(apiPath: string, cookie: string, refererPath: string): Promise<unknown | null> {
  try {
    // cache: "no-store" + a cache-busting param: a long-lived server process
    // once served stale NSE responses over a persistent connection (the strip
    // froze a full session behind). Freshness must be guaranteed per-fetch.
    const bust = `${apiPath.includes("?") ? "&" : "?"}_=${Date.now()}`;
    // curl transport — see TRANSPORT NOTE above. A fresh subprocess per call
    // also inherently satisfies the no-stale-persistent-connection rule the
    // old `cache: "no-store"` guarded against.
    const res = await curlRequest(`${NSE_ORIGIN}${apiPath}${bust}`, {
      ...API_HEADERS_BASE,
      Cookie: cookie,
      Referer: `${NSE_ORIGIN}${refererPath}`,
      Origin: NSE_ORIGIN,
    });
    if (!res || res.status < 200 || res.status >= 300) {
      console.warn(`[marketMoves/nse] API ${apiPath} returned ${res?.status ?? "no-response"} (likely Akamai block)`);
      return null;
    }
    return JSON.parse(res.body);
  } catch (err) {
    console.warn(`[marketMoves/nse] API ${apiPath} network/parse error: ${err instanceof Error ? err.message : err}`);
    return null;
  }
}

/** Raw shape of one row from GET /api/corporate-announcements?index=equities. */
type NseAnnouncementRow = {
  symbol?: string | null;
  desc?: string | null;
  sm_name?: string | null;
  an_dt?: string | null;
  sort_date?: string | null; // "YYYY-MM-DD HH:mm:ss", IST wall-clock, no offset
  seq_id?: string | number | null;
  attchmntFile?: string | null;
  attchmntText?: string | null;
};

/** Parses NSE's `sort_date` ("YYYY-MM-DD HH:mm:ss", IST wall-clock) into a UTC Date. */
function parseNseIstTimestamp(sortDate: string | null | undefined): Date | null {
  if (!sortDate) return null;
  const isoIst = `${sortDate.replace(" ", "T")}+05:30`;
  const d = new Date(isoIst);
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * Fetches today's NSE corporate announcements (equities segment only).
 * Drops any row missing a symbol/company — the "ticker-first" invariant is
 * enforced here, before anything reaches the DB. Never throws.
 */
export async function fetchNseAnnouncements(): Promise<FetchedMarketMoveEvent[]> {
  const cookie = await primeNseSession("/");
  if (!cookie) return [];

  const fmt = (d: Date) => {
    const dd = String(d.getUTCDate()).padStart(2, "0");
    const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
    const yyyy = d.getUTCFullYear();
    return `${dd}-${mm}-${yyyy}`;
  };
  const today = new Date();
  const dateParam = fmt(today);

  const raw = await nseApiGet(
    `/api/corporate-announcements?index=equities&from_date=${dateParam}&to_date=${dateParam}`,
    cookie,
    "/companies-listing/corporate-filings-announcements"
  );
  if (!raw || !Array.isArray(raw)) return [];

  const out: FetchedMarketMoveEvent[] = [];
  for (const row of raw as NseAnnouncementRow[]) {
    const symbol = row.symbol?.trim();
    const companyName = row.sm_name?.trim();
    const seqId = row.seq_id != null ? String(row.seq_id) : null;
    // Drop rule: no resolved ticker/company/id → not ingestable into Market Pulse.
    if (!symbol || !companyName || !seqId) continue;

    const announcedAt = parseNseIstTimestamp(row.sort_date) ?? new Date();
    const headline = row.attchmntText?.trim() || row.desc?.trim() || symbol;

    out.push({
      source: "NSE",
      sourceId: seqId,
      tickerSymbol: symbol,
      tickerType: isIndexSymbol(symbol) ? "INDEX" : "STOCK",
      companyName,
      eventType: classifyMarketMoveEventType(row.desc, row.attchmntText),
      headline,
      detailUrl: row.attchmntFile?.trim() || null,
      rawText: row.attchmntText?.trim() || null,
      announcedAt,
    });
  }
  return out;
}

/** Raw row shape from GET /api/live-analysis-variations?index=gainers|losers. */
type NseVariationRow = {
  symbol?: string | null;
  perChange?: number | null;   // percent change
  /** MISLEADINGLY NAMED BY NSE: net_price carries the PERCENT change again
   *  (verified: an ₹11,830 stock shows net_price 2.91 == perChange 2.91).
   *  Never use it as a rupee change — compute from ltp - prev_price. */
  net_price?: number | null;
  prev_price?: number | null;  // previous close (₹)
  trade_quantity?: number | null;
  ltp?: number | null;         // last traded price
};

/** One variation group (NIFTY / NIFTYNEXT50 / allSec / ...) carries a `data` array. */
type NseVariationGroup = { data?: NseVariationRow[] };

/**
 * NSE's variations rows carry only the ticker `symbol`, never the full company
 * name. To label movers ("ABB India Limited" not "ABB") we join against NSE's
 * complete published equity master (EQUITY_L.csv) — every ~2,400 NSE-listed
 * company, keyless, no session cookie (served from the archives host), refreshed
 * by NSE on every new listing/rename. This is a full market map, not a fixed
 * index list, so it labels any symbol we could ever show — including anything
 * beyond the NIFTY 100 if the movers universe is ever broadened. Cached in-module
 * for 12h since the master changes only on listing/corporate-name events.
 */
const NSE_EQUITY_MASTER_URL =
  "https://nsearchives.nseindia.com/content/equities/EQUITY_L.csv";
const EQUITY_NAME_TTL_MS = 12 * 60 * 60 * 1000;
let equityNameCache: { at: number; map: Map<string, string> } | null = null;

/** Parses EQUITY_L.csv ("SYMBOL,NAME OF COMPANY,SERIES,...") → symbol→name. */
function parseEquityMasterCsv(csv: string): Map<string, string> {
  const map = new Map<string, string>();
  const lines = csv.split(/\r?\n/);
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    // NSE's master has no quoted fields and no commas inside any field, so a
    // plain split is safe: column 0 = SYMBOL, column 1 = NAME OF COMPANY.
    const parts = line.split(",");
    if (parts.length < 2) continue;
    const symbol = parts[0].trim();
    const name = parts[1].trim();
    if (symbol && name) map.set(symbol, name);
  }
  return map;
}

/**
 * Returns a symbol→company-name map for all NSE-listed equities. Cached 12h. On
 * any fetch/parse failure returns the last good cache (or an empty map) so a name
 * lookup never blocks or breaks the movers pipeline — callers fall back to the
 * ticker symbol when a name is missing.
 *
 * Exported so the EOD bhavcopy fetcher (bhavcopy.ts) can reuse the same cache
 * to label full-market movers, rather than duplicating the fetch+parse+cache.
 */
export async function fetchEquityNames(): Promise<Map<string, string>> {
  const now = Date.now();
  if (equityNameCache && now - equityNameCache.at < EQUITY_NAME_TTL_MS) {
    return equityNameCache.map;
  }
  try {
    const res = await fetch(NSE_EQUITY_MASTER_URL, { headers: HTML_HEADERS });
    if (!res.ok) {
      console.warn(`[marketMoves/nse] equity master CSV returned ${res.status}`);
      return equityNameCache?.map ?? new Map();
    }
    const map = parseEquityMasterCsv(await res.text());
    if (map.size > 0) equityNameCache = { at: now, map };
    return equityNameCache?.map ?? map;
  } catch (err) {
    console.warn(`[marketMoves/nse] equity master CSV fetch error: ${err instanceof Error ? err.message : err}`);
    return equityNameCache?.map ?? new Map();
  }
}

/** Two parallel movers universes, fetched from the same NSE response in one pass. */
export type FetchedMoversByUniverse = {
  /** Every listed security — union of NSE's allSec/SecGtr20/SecLwr20/FOSec/index groups, deduped. */
  all: FetchedMarketMover[];
  /** Large-cap names only — union of the NIFTY, BANKNIFTY and NIFTYNEXT50 groups, deduped. */
  popular: FetchedMarketMover[];
};

/**
 * Fetches today's top gainers + losers from NSE's own variations endpoint, shaped
 * into BOTH movers universes the Top Movers toggle needs (Popular default vs. All
 * market) from a single set of API calls:
 *   - `all`: union of every variation group NSE publishes (allSec + SecGtr20 +
 *     SecLwr20 + FOSec + the index groups), deduped by symbol — NSE caps each
 *     group at ~20 rows/direction, so the union is what lifts depth past 20.
 *   - `popular`: NIFTY + BANKNIFTY + NIFTYNEXT50 union — the recognizable
 *     large-cap names users expect from apps like Groww, as opposed to the
 *     small/mid-caps hitting circuit limits.
 * Never throws. `isUnusualVolume` is computed downstream in the cron (a same-day
 * cross-sectional heuristic; see MarketMoverSnapshot doc).
 */
export async function fetchNseMovers(): Promise<FetchedMoversByUniverse> {
  const cookie = await primeNseSession("/");
  if (!cookie) return { all: [], popular: [] };

  // Full company names for every NSE-listed equity (cached). The variations feed
  // has none, so this is the authoritative label source — the movers cron only
  // falls back to announcement-derived names / the raw ticker when a symbol
  // somehow misses here (e.g. master fetch failed and no cache yet).
  const nameBySymbol = await fetchEquityNames();

  // Sign must MATCH the direction: on a deeply red (or green) day NSE pads its
  // own top-gainers (top-losers) table with the least-bad movers of the opposite
  // sign — a negative "gainer" is never something we should show. Applied
  // identically to both universes so the guard can't silently drift between them.
  const shapeRows = (rows: NseVariationRow[], direction: "GAINER" | "LOSER"): FetchedMarketMover[] =>
    rows
      .filter((r) =>
        r.symbol &&
        typeof r.perChange === "number" &&
        (direction === "GAINER" ? r.perChange > 0 : r.perChange < 0)
      )
      .map((r) => {
        const sym = (r.symbol as string).trim();
        return {
          tickerSymbol: sym,
          companyName: nameBySymbol.get(sym) ?? sym, // full company name; ticker only if unmapped
          changePercent: r.perChange as number,
          // Rupee change computed from real prices — NSE's net_price is a trap
          // (it repeats the percentage; see NseVariationRow doc above).
          changeAbs: r.ltp != null && r.prev_price != null ? r.ltp - r.prev_price : 0,
          volume: r.trade_quantity ?? 0,
          lastPrice: typeof r.ltp === "number" ? r.ltp : null,
          direction: direction as "GAINER" | "LOSER",
        };
      });

  const pull = async (index: "gainers" | "losers"): Promise<FetchedMoversByUniverse> => {
    // NSE's API spells losers "loosers" (double-o); "losers" returns
    // {data:"Missing index or key"}. Both return the same grouped shape (NIFTY.data).
    const nseIndexParam = index === "gainers" ? "gainers" : "loosers";
    const raw = await nseApiGet(
      `/api/live-analysis-variations?index=${nseIndexParam}`,
      cookie,
      "/market-data/top-gainers-losers"
    );
    if (!raw || typeof raw !== "object") return { all: [], popular: [] };
    const groups = raw as Record<string, NseVariationGroup | unknown>;
    const direction = index === "gainers" ? "GAINER" : "LOSER";

    const rowsOf = (key: string): NseVariationRow[] =>
      (groups[key] as NseVariationGroup | undefined)?.data ?? [];

    // NSE caps EVERY group at ~20 rows per direction, so any single group
    // yields a shallow list. Union all seven groups (deduped by symbol,
    // first occurrence wins — a symbol repeats with identical numbers) to
    // lift intraday depth to ~60–90 distinct movers per direction.
    const dedupBySymbol = (rows: NseVariationRow[]): NseVariationRow[] => {
      const seen = new Set<string>();
      return rows.filter((r) => {
        const sym = typeof r.symbol === "string" ? r.symbol.trim() : "";
        if (!sym || seen.has(sym)) return false;
        seen.add(sym);
        return true;
      });
    };

    const popularRows = dedupBySymbol([
      ...rowsOf("NIFTY"),
      ...rowsOf("BANKNIFTY"),
      ...rowsOf("NIFTYNEXT50"),
    ]);
    const allRows = dedupBySymbol([
      ...rowsOf("allSec"),
      ...rowsOf("SecGtr20"),
      ...rowsOf("SecLwr20"),
      ...rowsOf("FOSec"),
      ...rowsOf("NIFTY"),
      ...rowsOf("BANKNIFTY"),
      ...rowsOf("NIFTYNEXT50"),
    ]);

    return {
      all: shapeRows(allRows, direction),
      popular: shapeRows(popularRows, direction),
    };
  };

  const [gainers, losers] = await Promise.all([pull("gainers"), pull("losers")]);
  return {
    all: [...gainers.all, ...losers.all],
    popular: [...gainers.popular, ...losers.popular],
  };
}
