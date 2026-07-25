/**
 * All-Indices informational layer — founder brief 2026-07-25 ("I can see
 * multiple indices like Nifty Auto, Metal or MidCap... we cant be limited to
 * few"). This is a BROWSING surface only: the five F&O-tradable underlyings
 * (see business-rules' INDEX_OPTION_UNDERLYINGS) remain the only ones the
 * options terminal will ever place an order against — market reality, not a
 * product choice. This module just makes every NSE-published index level
 * viewable.
 *
 * VERIFIED WORKING (2026-07-25, both from the production EC2 box per the
 * founder brief AND independently re-confirmed live from this sandbox):
 *   GET /api/allIndices → 139 rows, same cookie handshake as every other
 *   fetcher in this file's sibling nse.ts (primeNseSession + nseApiGet,
 *   reused here rather than reimplemented).
 *
 * NSE's own response already carries a `key` classification field grouping
 * every row (e.g. "SECTORAL INDICES", "BROAD MARKET INDICES") — the
 * directory page groups by this LIVE field, never a hardcoded index list.
 * Confirmed groups as of 2026-07-25: INDICES ELIGIBLE IN DERIVATIVES (5),
 * BROAD MARKET INDICES (19), SECTORAL INDICES (21), STRATEGY INDICES (42),
 * THEMATIC INDICES (41), FIXED INCOME INDICES (11) — 139 total. NSE may add
 * groups/rows over time; nothing here assumes this exact set.
 *
 * `variation` here IS a genuine rupee/points change (unlike the movers
 * endpoint's `net_price`, which is a percent-in-disguise trap — see nse.ts's
 * NseVariationRow doc). Verified: NIFTY 50 variation -102.15 / last 23767.45
 * ⇒ -0.43%, matching the row's own percentChange to 2dp. Different NSE
 * endpoint, no trap here — safe to use directly as changeAbs.
 */

import { nseApiGet, primeNseSession } from "./nse";

const ALL_INDICES_PATH = "/api/allIndices";
const ALL_INDICES_REFERER = "/market-data/live-market-indices";
const CACHE_TTL_MS = 60 * 1000;

/** Raw row shape from GET /api/allIndices. Every numeric field NSE sometimes omits or zeroes out for non-equity groups (e.g. FIXED INCOME rows carry no advances/declines/unchanged at all, and yearHigh/yearLow/pe/pb/dy come back as literal 0 — not a real reading). */
type NseAllIndicesRow = {
  key?: string | null;
  index?: string | null;
  last?: number | null;
  variation?: number | null;
  percentChange?: number | null;
  open?: number | null;
  high?: number | null;
  low?: number | null;
  previousClose?: number | null;
  yearHigh?: number | null;
  yearLow?: number | null;
  pe?: string | null;
  pb?: string | null;
  dy?: string | null;
  advances?: string | null;
  declines?: string | null;
  unchanged?: string | null;
};

type NseAllIndicesResponse = { data?: NseAllIndicesRow[] | null };

export type NormalizedIndexRow = {
  /** NSE's own display name, e.g. "NIFTY AUTO" — the single source of truth for both label and slug derivation. */
  name: string;
  /** URL-safe key derived from `name` via slugifyIndexName — see that function's doc for the exact rule. */
  slug: string;
  /** NSE's own classification, e.g. "SECTORAL INDICES" — verbatim, used for directory grouping. */
  group: string;
  last: number | null;
  changePercent: number | null;
  changeAbs: number | null;
  open: number | null;
  high: number | null;
  low: number | null;
  previousClose: number | null;
  yearHigh: number | null;
  yearLow: number | null;
  peRatio: number | null;
  pbRatio: number | null;
  dividendYield: number | null;
  advances: number | null;
  declines: number | null;
  unchanged: number | null;
};

/**
 * Derives a URL-safe, uppercase slug from NSE's index display name: any run
 * of non-alphanumeric characters (spaces, "&", "/", ":", "-", parentheses,
 * ...) collapses to a single hyphen, with leading/trailing hyphens trimmed.
 * E.g. "NIFTY AUTO" -> "NIFTY-AUTO", "NIFTY OIL & GAS" -> "NIFTY-OIL-GAS",
 * "NIFTY FINANCIAL SERVICES 25/50" -> "NIFTY-FINANCIAL-SERVICES-25-50".
 *
 * Not claimed to be mathematically invertible (multiple distinct names could
 * in principle collapse to the same slug — e.g. a "/" vs a " " both become
 * "-"), but empirically verified unique across all 139 live rows on
 * 2026-07-25. Detail-page lookups always resolve a slug against the live
 * name->slug map built by getAllIndices() below, never by parsing the slug
 * back into a name, so a hypothetical future collision would show as a 404
 * for the second name, not a mismatch.
 */
export function slugifyIndexName(name: string): string {
  return name
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** Parses an NSE numeric-as-string field ("30.92", "0", "", null) into a real number, treating non-positive values as "not applicable" rather than a genuine zero reading (NSE zeroes out pe/pb/dy/yearHigh/yearLow for non-equity index groups like Fixed Income instead of omitting them). */
function parsePositiveNumericString(raw: string | null | undefined): number | null {
  if (raw == null) return null;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** Same non-positive-means-absent treatment for the raw numeric (not string) fields — yearHigh/yearLow come back as a real 0 for groups where NSE doesn't track a 52-week band. */
function parsePositiveNumber(raw: number | null | undefined): number | null {
  return typeof raw === "number" && Number.isFinite(raw) && raw > 0 ? raw : null;
}

function normalizeRow(row: NseAllIndicesRow): NormalizedIndexRow | null {
  const name = row.index?.trim();
  if (!name) return null;

  return {
    name,
    slug: slugifyIndexName(name),
    group: row.key?.trim() || "OTHER INDICES",
    last: typeof row.last === "number" && Number.isFinite(row.last) ? row.last : null,
    changePercent: typeof row.percentChange === "number" && Number.isFinite(row.percentChange) ? row.percentChange : null,
    // Genuine rupee/points change on this endpoint — see file header doc.
    changeAbs: typeof row.variation === "number" && Number.isFinite(row.variation) ? row.variation : null,
    open: typeof row.open === "number" && Number.isFinite(row.open) ? row.open : null,
    high: typeof row.high === "number" && Number.isFinite(row.high) ? row.high : null,
    low: typeof row.low === "number" && Number.isFinite(row.low) ? row.low : null,
    previousClose: typeof row.previousClose === "number" && Number.isFinite(row.previousClose) ? row.previousClose : null,
    yearHigh: parsePositiveNumber(row.yearHigh),
    yearLow: parsePositiveNumber(row.yearLow),
    peRatio: parsePositiveNumericString(row.pe),
    pbRatio: parsePositiveNumericString(row.pb),
    dividendYield: parsePositiveNumericString(row.dy),
    advances: parsePositiveNumericString(row.advances) ?? (row.advances === "0" ? 0 : null),
    declines: parsePositiveNumericString(row.declines) ?? (row.declines === "0" ? 0 : null),
    unchanged: parsePositiveNumericString(row.unchanged) ?? (row.unchanged === "0" ? 0 : null),
  };
}

async function fetchAllIndicesUncached(): Promise<NormalizedIndexRow[] | null> {
  const cookie = await primeNseSession(ALL_INDICES_REFERER);
  if (!cookie) return null;

  const raw = await nseApiGet(ALL_INDICES_PATH, cookie, ALL_INDICES_REFERER);
  if (!raw || typeof raw !== "object") return null;

  const rows = (raw as NseAllIndicesResponse).data;
  if (!Array.isArray(rows)) return null;

  const normalized = rows
    .map(normalizeRow)
    .filter((r): r is NormalizedIndexRow => r != null);

  return normalized.length > 0 ? normalized : null;
}

type CacheEntry = { at: number; rows: NormalizedIndexRow[] };
let cache: CacheEntry | null = null;

export type AllIndicesSnapshot = { asOf: string; rows: NormalizedIndexRow[] };

/**
 * Returns every NSE index NSE's own /api/allIndices publishes, 60s TTL
 * in-module cache. On a fresh-fetch failure, falls back to the last good
 * snapshot (stale-if-error, matching fetchEquityNames' convention) rather
 * than a hard failure — `asOf` always reflects the ACTUAL fetch time of the
 * data being returned, never fabricated as "now", so a stale fallback is
 * still honestly labeled. Returns null only when there has never been a
 * successful fetch (e.g. first request after boot lands on an NSE block).
 */
export async function getAllIndices(): Promise<AllIndicesSnapshot | null> {
  const now = Date.now();
  if (cache && now - cache.at < CACHE_TTL_MS) {
    return { asOf: new Date(cache.at).toISOString(), rows: cache.rows };
  }

  const fresh = await fetchAllIndicesUncached();
  if (fresh) {
    cache = { at: now, rows: fresh };
    return { asOf: new Date(now).toISOString(), rows: fresh };
  }

  if (cache) {
    console.warn("[marketMoves/allIndices] live fetch failed, serving stale cache");
    return { asOf: new Date(cache.at).toISOString(), rows: cache.rows };
  }

  return null;
}

/** Case-insensitive slug lookup against the live snapshot. Null when the slug matches no current index. */
export async function getIndexBySlug(slug: string): Promise<{ asOf: string; row: NormalizedIndexRow } | null> {
  const snapshot = await getAllIndices();
  if (!snapshot) return null;

  const needle = slug.trim().toUpperCase();
  const row = snapshot.rows.find((r) => r.slug === needle);
  return row ? { asOf: snapshot.asOf, row } : null;
}
