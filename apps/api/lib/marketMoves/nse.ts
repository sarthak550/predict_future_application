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
 */
async function primeNseSession(warmUpPath: string): Promise<string | null> {
  try {
    const res = await fetch(`${NSE_ORIGIN}${warmUpPath}`, { headers: HTML_HEADERS });
    // Do NOT bail on a non-200 warm-up: NSE's Akamai serves a 403 challenge to
    // the HTML page but STILL sets the session cookie the /api/* routes need.
    // Capture the cookie regardless of status. (Verified from EC2 2026-07-10.)
    const cookie = cookieHeaderFrom(res);
    if (!cookie) {
      console.warn(`[marketMoves/nse] warm-up ${warmUpPath} set no cookie (status ${res.status})`);
      return null;
    }
    return cookie;
  } catch (err) {
    console.warn(`[marketMoves/nse] warm-up ${warmUpPath} network error: ${err instanceof Error ? err.message : err}`);
    return null;
  }
}

/** GETs an NSE API path with a primed cookie + matching referer. Never throws. */
async function nseApiGet(apiPath: string, cookie: string, refererPath: string): Promise<unknown | null> {
  try {
    const res = await fetch(`${NSE_ORIGIN}${apiPath}`, {
      headers: {
        ...API_HEADERS_BASE,
        Cookie: cookie,
        Referer: `${NSE_ORIGIN}${refererPath}`,
        Origin: NSE_ORIGIN,
      },
    });
    if (!res.ok) {
      console.warn(`[marketMoves/nse] API ${apiPath} returned ${res.status} (likely Akamai block)`);
      return null;
    }
    return await res.json();
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
  net_price?: number | null;   // absolute change
  trade_quantity?: number | null;
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
 */
async function fetchEquityNames(): Promise<Map<string, string>> {
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

/**
 * Fetches today's top gainers + losers from NSE's own variations endpoint.
 * The response groups movers by index (NIFTY, NIFTYNEXT50, allSec, ...); we rank
 * across the NIFTY 100 (NIFTY 50 + NIFTY Next 50) so the strip matches the
 * large-cap universe mainstream apps (Groww, etc.) show by default, without the
 * illiquid microcap noise in allSec/SecGtr20. Never throws. `isUnusualVolume` is
 * computed downstream in the cron (a same-day cross-sectional heuristic; see
 * MarketMoverSnapshot doc).
 */
export async function fetchNseMovers(): Promise<FetchedMarketMover[]> {
  const cookie = await primeNseSession("/");
  if (!cookie) return [];

  // Full company names for every NSE-listed equity (cached). The variations feed
  // has none, so this is the authoritative label source — the movers cron only
  // falls back to announcement-derived names / the raw ticker when a symbol
  // somehow misses here (e.g. master fetch failed and no cache yet).
  const nameBySymbol = await fetchEquityNames();

  const pull = async (index: "gainers" | "losers"): Promise<FetchedMarketMover[]> => {
    // NSE's API spells losers "loosers" (double-o); "losers" returns
    // {data:"Missing index or key"}. Both return the same grouped shape (NIFTY.data).
    const nseIndexParam = index === "gainers" ? "gainers" : "loosers";
    const raw = await nseApiGet(
      `/api/live-analysis-variations?index=${nseIndexParam}`,
      cookie,
      "/market-data/top-gainers-losers"
    );
    if (!raw || typeof raw !== "object") return [];
    const groups = raw as Record<string, NseVariationGroup | unknown>;
    // Rank across the NIFTY 100 (NIFTY 50 + NIFTY Next 50) — the large-cap
    // universe mainstream apps (Groww, etc.) use for their DEFAULT Top Gainers/
    // Losers. Using only the NIFTY 50 group hid every Next-50 mover: e.g. ABB
    // (Next 50, +4.9%) was the session's real top gainer but never surfaced
    // because ULTRACEMCO (+2.9%) topped the NIFTY-50-only list — which is exactly
    // the "we show UltraTech, Groww shows ABB" mismatch. We deliberately do NOT
    // use allSec/SecGtr20 as the primary source: their tops are illiquid,
    // circuit-locked microcaps (e.g. HIRECT +19.99%) that no retail app shows as
    // a "top mover". NIFTY 50 and Next 50 are disjoint, so no dedup is needed
    // (and the movers cron upserts by (sessionDate, tickerSymbol) anyway).
    const nifty50 = (groups.NIFTY as NseVariationGroup | undefined)?.data ?? [];
    const niftyNext50 = (groups.NIFTYNEXT50 as NseVariationGroup | undefined)?.data ?? [];
    const merged = [...nifty50, ...niftyNext50];
    const rows =
      merged.length > 0
        ? merged
        : (groups.allSec as NseVariationGroup | undefined)?.data ?? [];
    const direction = index === "gainers" ? "GAINER" : "LOSER";
    return rows
      .filter((r) => r.symbol && typeof r.perChange === "number" && r.perChange !== 0)
      .map((r) => {
        const sym = (r.symbol as string).trim();
        return {
        tickerSymbol: sym,
        companyName: nameBySymbol.get(sym) ?? sym, // full NIFTY 100 name; ticker only if unmapped
        changePercent: r.perChange as number,
        changeAbs: r.net_price ?? 0,
        volume: r.trade_quantity ?? 0,
        direction: direction as "GAINER" | "LOSER",
        };
      });
  };

  const [gainers, losers] = await Promise.all([pull("gainers"), pull("losers")]);
  return [...gainers, ...losers];
}
