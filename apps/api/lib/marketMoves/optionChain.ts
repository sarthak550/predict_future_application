/**
 * Paper Trading Phase 2 (NIFTY/BANKNIFTY index options) + Phase 3 (single-stock
 * F&O options) — option-chain fetcher.
 *
 * Built on the existing primeNseSession/nseApiGet cookie handshake in nse.ts
 * (same file/pattern precedent as fetchNseAnnouncements/fetchNseMovers) — does
 * NOT reimplement the Akamai cookie dance.
 *
 * VERIFICATION STATUS (2026-07-23, Phase 2): both endpoints below returned live
 * 200 JSON from this build sandbox at the time this file was written (NIFTY: 18
 * expiries, weekly cadence out to ~Sep-2026 then monthly/quarterly; BANKNIFTY:
 * monthly cadence throughout — confirmed empirically, never hardcoded here).
 * VERIFICATION STATUS (2026-07-24, Phase 3): `type=Equity` on the same
 * option-chain-v3 endpoint confirmed live against RELIANCE — 45 strike rows,
 * spot 1280.5, three listed monthly expiries (28-Jul/25-Aug/29-Sep-2026), same
 * cookie handshake and response shape as the index (`type=Indices`) path. Both
 * are a fragility caveat, not a guarantee: the brief flags this as the same
 * unofficial, Akamai-fronted endpoint class as the movers/announcements pipe
 * already running in production. Accepted risk — every function here returns
 * null/[] on any failure, never throws.
 *
 * Endpoints (all under https://www.nseindia.com):
 *   - GET /api/option-chain-contract-info?symbol=<underlying>
 *       -> { expiryDates: string[] ("28-Jul-2026" format), strikePrice: string[] }
 *     No `type` param needed for either index or stock underlyings — confirmed
 *     empirically to work unmodified for both (Phase 3 brief's "zero new code
 *     here" call-out).
 *   - GET /api/option-chain-v3?type=Indices|Equity&symbol=<underlying>&expiry=DD-MMM-YYYY
 *       -> { records: { data: [{ strikePrice, expiryDates, CE?: {...}, PE?: {...} }],
 *                        underlyingValue: number, timestamp: "DD-MMM-YYYY HH:mm:ss" (IST) } }
 *     `type=Indices` for NIFTY/BANKNIFTY, `type=Equity` for every single-stock
 *     F&O underlying (see isIndexUnderlying below). Passing `expiry` filters
 *     server-side to that expiry's rows only (verified empirically — every
 *     returned row's own expiryDates matches the query param).
 *
 * LOT SIZE — NOT carried by either endpoint above (verified empirically: neither
 * payload has a marketLot/lotSize field anywhere, contradicting the brief's
 * assumption that the chain payload carries it). Sourced instead from NSE's
 * separately published market-lot CSV, the same keyless-archives-host pattern
 * `fetchEquityNames()` already uses for EQUITY_L.csv:
 *   GET https://nsearchives.nseindia.com/content/fo/fo_mktlots.csv
 * This file lists lot size PER UNDERLYING PER CONTRACT MONTH (e.g. "NIFTY,65,65,65,...")
 * — lot sizes can differ between near and far months during a SEBI rebalancing
 * phase-in, so this module resolves lot size for the SPECIFIC requested expiry's
 * calendar month, not just "the underlying's lot size". See resolveLotSize below.
 *
 * PHASE 3 UNIVERSE — this CSV also lists every F&O-eligible single-stock
 * underlying (verified live 2026-07-24: 216 total rows, 5 index-derivative rows
 * — NIFTY, BANKNIFTY, FINNIFTY, MIDCPNIFTY, NIFTYNXT50 — leaving 211 stock
 * rows). Phase 2 originally parsed this into a hardcoded 2-entry map
 * (NIFTY/BANKNIFTY only), silently dropping every other row. This file now
 * retains every row and derives the tradable stock universe as "every row not
 * in the index-derivative denylist" — see INDEX_DERIVATIVE_DENYLIST and
 * fetchFnoStockUniverse below. The denylist is intentionally short and
 * hardcoded (new index derivatives are a rare regulatory event); the ~211-name
 * stock list is never hardcoded anywhere — it's derived fresh from this CSV on
 * every (cache-gated) fetch.
 */

import { primeNseSession, nseApiGet } from "./nse";
import { fetchEquityNames } from "./nse";

/**
 * Widened from a closed "NIFTY" | "BANKNIFTY" literal union (Phase 2) to a
 * plain string (Phase 3) — the stock half of the tradable universe changes
 * over time (quarterly F&O-eligibility reviews), so it can never be a
 * compile-time type. Every call site validates membership at runtime instead
 * — see isIndexUnderlying / isTradableOptionUnderlying below.
 */
export type OptionUnderlying = string;
export type OptionType = "CE" | "PE";

/** Index underlyings — `type=Indices` on the chain endpoint, cash-settled-at-intrinsic on expiry. Every other tradable underlying (the stock universe) is `type=Equity` and forced-square-off on expiry. All 5 F&O indices since 2026-07-25 (chains verified live from EC2: FINNIFTY 135 / MIDCPNIFTY 154 / NIFTYNXT50 199 strike rows) — sourced from the shared registry, never a local list. */
export { isIndexOptionUnderlying as isIndexUnderlying } from "@predict-future/business-rules/papertrading/optionContract";
import { isIndexOptionUnderlying as isIndexUnderlying } from "@predict-future/business-rules/papertrading/optionContract";

/**
 * Recognized index-derivative SYMBOL values in fo_mktlots.csv that must NEVER
 * be treated as part of the Phase 3 stock universe — confirmed against the
 * live file 2026-07-24. Only NIFTY/BANKNIFTY are actually tradable as index
 * options in this app (see isIndexUnderlying); FINNIFTY/MIDCPNIFTY/NIFTYNXT50
 * are excluded from the stock universe too even though this app doesn't offer
 * them as index options either — they are categorically not single-stock
 * names and must not appear in the stock combobox.
 */
export const INDEX_DERIVATIVE_DENYLIST = new Set(["NIFTY", "BANKNIFTY", "FINNIFTY", "MIDCPNIFTY", "NIFTYNXT50"]);

export interface OptionQuote {
  lastPrice: number | null;
  bidPrice: number | null;
  askPrice: number | null;
  openInterest: number | null;
  impliedVolatility: number | null;
}

export interface OptionStrikeRow {
  strikePrice: number;
  CE: OptionQuote | null;
  PE: OptionQuote | null;
}

export interface OptionChainSnapshot {
  underlying: OptionUnderlying;
  expiry: string; // "DD-MMM-YYYY", echoes the requested expiry
  underlyingValue: number;
  /** Parsed from the upstream response's own `records.timestamp` (IST wall-clock) — the honest "as of" label for market-closed rendering. Null if the upstream omitted/mangled it (falls back to fetch time at the call site). */
  asOf: Date | null;
  lotSize: number | null;
  strikes: OptionStrikeRow[];
}

const REFERER_PATH = "/option-chain";
const NSE_ARCHIVES_ORIGIN = "https://nsearchives.nseindia.com";
const MKTLOTS_URL = `${NSE_ARCHIVES_ORIGIN}/content/fo/fo_mktlots.csv`;
const BROWSER_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

/** Same 60s in-module TTL convention as marketMoves/intraday.ts's fetchIntradaySeries cache — both fetchOptionChainExpiries and fetchOptionChain below are wrapped in this so the internal apps/api route (and, transitively, every apps/web caller polling through the loopback proxy) never hammers NSE more than once per underlying(+expiry) per minute. */
const CHAIN_CACHE_TTL_MS = 60 * 1000;

// ─── Expiry list ──────────────────────────────────────────────────────────────

type ContractInfoResponse = { expiryDates?: unknown };

const expiriesCache = new Map<OptionUnderlying, { at: number; data: string[] }>();

/**
 * Fetches the live list of tradeable expiries for `underlying`, in NSE's own
 * "DD-MMM-YYYY" string order (nearest first). Never throws — returns [] on any
 * upstream failure. Callers must read cadence (weekly vs monthly) FROM this
 * list's own spacing, never assume it from the underlying's name. Cached
 * in-module for CHAIN_CACHE_TTL_MS (60s).
 */
export async function fetchOptionChainExpiries(underlying: OptionUnderlying): Promise<string[]> {
  const cached = expiriesCache.get(underlying);
  if (cached && Date.now() - cached.at < CHAIN_CACHE_TTL_MS) return cached.data;

  const data = await fetchOptionChainExpiriesUncached(underlying);
  // Never overwrite a good cached result with an empty upstream hiccup — an
  // expiry list going empty mid-session is always a fetch failure, never a
  // real product state (an index option chain never has zero expiries).
  if (data.length > 0) expiriesCache.set(underlying, { at: Date.now(), data });
  return data.length > 0 ? data : (cached?.data ?? []);
}

async function fetchOptionChainExpiriesUncached(underlying: string): Promise<string[]> {
  const cookie = await primeNseSession("/");
  if (!cookie) return [];

  const raw = (await nseApiGet(
    `/api/option-chain-contract-info?symbol=${underlying}`,
    cookie,
    REFERER_PATH
  )) as ContractInfoResponse | null;

  if (!raw || !Array.isArray(raw.expiryDates)) return [];
  return raw.expiryDates.filter((d): d is string => typeof d === "string" && d.length > 0);
}

// ─── Lot size + universe (fo_mktlots.csv) ─────────────────────────────────────

/** underlying SYMBOL -> ordered list of { monthLabel ("JUL-26"), lotSize } parsed from the CSV header/row. Phase 3: retains EVERY row (not just NIFTY/BANKNIFTY) — this table doubles as the source of the F&O stock universe, see fetchFnoStockUniverse below. */
type MktLotsTable = Map<string, { monthLabel: string; lotSize: number }[]>;

const MKTLOTS_TTL_MS = 6 * 60 * 60 * 1000; // 6h — lot sizes change on regulatory events (most recently Jan 2026), not daily; short enough to pick up a same-day SEBI change without refetching every request.
let mktLotsCache: { at: number; table: MktLotsTable } | null = null;

/**
 * Parses fo_mktlots.csv: header row's month columns (e.g. "JUL-26", "AUG-26", …)
 * map to each data row's per-month lot size for that row's SYMBOL column.
 * Format (verified live 2026-07-24):
 *   UNDERLYING,SYMBOL,JUL-26,AUG-26,SEP-26,DEC-26,...
 *   NIFTY 50  ,NIFTY ,65    ,65    ,65    ,65    ,...
 *   NIFTY BANK,BANKNIFTY,30 ,30    ,30    ,30    ,...
 *   RELIANCE INDUSTRIES,RELIANCE,500,500,500,,...
 * Trailing/leading whitespace padding in every field is stripped. Blank cells
 * (a contract month not yet listed for that underlying) are skipped, not
 * zero-filled. Phase 3: every row with a non-empty SYMBOL column and at least
 * one valid lot-size entry is retained (216 rows confirmed live 2026-07-24,
 * 211 of them single-stock) — the index-derivative vs. stock split happens at
 * READ time (isIndexUnderlying / INDEX_DERIVATIVE_DENYLIST), not at parse time,
 * so this function never silently drops a row.
 */
function parseMktLotsCsv(csv: string): MktLotsTable {
  const table: MktLotsTable = new Map();
  const lines = csv.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length < 2) return table;

  const header = lines[0].split(",").map((c) => c.trim());
  const monthColumns = header.slice(2); // columns 0,1 are UNDERLYING,SYMBOL

  for (let i = 1; i < lines.length; i++) {
    const cells = lines[i].split(",").map((c) => c.trim());
    if (cells.length < 2) continue;
    const symbol = cells[1];
    if (!symbol) continue;

    const entries: { monthLabel: string; lotSize: number }[] = [];
    for (let col = 0; col < monthColumns.length; col++) {
      const raw = cells[2 + col];
      const lotSize = raw ? Number(raw) : NaN;
      if (monthColumns[col] && Number.isFinite(lotSize) && lotSize > 0) {
        entries.push({ monthLabel: monthColumns[col], lotSize });
      }
    }
    if (entries.length > 0) table.set(symbol, entries);
  }
  return table;
}

async function fetchMktLotsTable(): Promise<MktLotsTable> {
  const now = Date.now();
  if (mktLotsCache && now - mktLotsCache.at < MKTLOTS_TTL_MS) return mktLotsCache.table;

  try {
    const res = await fetch(MKTLOTS_URL, { headers: { "User-Agent": BROWSER_UA }, cache: "no-store" });
    if (!res.ok) {
      console.warn(`[marketMoves/optionChain] fo_mktlots.csv returned ${res.status}`);
      return mktLotsCache?.table ?? new Map();
    }
    const table = parseMktLotsCsv(await res.text());
    if (table.size > 0) mktLotsCache = { at: now, table };
    return mktLotsCache?.table ?? table;
  } catch (err) {
    console.warn(`[marketMoves/optionChain] fo_mktlots.csv fetch error: ${err instanceof Error ? err.message : err}`);
    return mktLotsCache?.table ?? new Map();
  }
}

const MONTH_ABBR = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];

/** "28-Jul-2026" -> "JUL-26" (fo_mktlots.csv's header label format). Returns null on an unparseable input. */
function expiryToMonthLabel(expiryDdMmmYyyy: string): string | null {
  const parts = expiryDdMmmYyyy.split("-");
  if (parts.length !== 3) return null;
  const mon = parts[1].toUpperCase();
  const year = parts[2];
  if (!MONTH_ABBR.includes(mon) || year.length < 2) return null;
  return `${mon}-${year.slice(-2)}`;
}

/**
 * Resolves the lot size for `underlying`'s contract expiring `expiry`
 * ("DD-MMM-YYYY"). Primary path: exact contract-month column match in
 * fo_mktlots.csv. Fallback: the underlying's nearest EARLIER listed month's lot
 * size (a lot-size change is announced ahead of the contract month it takes
 * effect in, so the nearest prior known value is the best available estimate
 * for a far-dated contract not yet individually listed). Returns null only when
 * the underlying has no lot-size data at all (upstream fetch failed).
 */
export async function resolveLotSize(underlying: string, expiry: string): Promise<number | null> {
  const table = await fetchMktLotsTable();
  const entries = table.get(underlying);
  if (!entries || entries.length === 0) return null;

  const targetLabel = expiryToMonthLabel(expiry);
  if (targetLabel) {
    const exact = entries.find((e) => e.monthLabel === targetLabel);
    if (exact) return exact.lotSize;
  }
  // Fallback: nearest listed month (the CSV lists nearest-first) — the most
  // recent known lot size is the best available estimate for a month not yet
  // individually published.
  return entries[0].lotSize;
}

// ─── Phase 3 — F&O stock universe ─────────────────────────────────────────────

export interface FnoStockUniverseEntry {
  symbol: string;
  companyName: string;
}

/**
 * Every F&O-eligible single-stock underlying, with a display company name
 * attached via fetchEquityNames() (the same symbol->name map Phase 1's equity
 * search already relies on). Derived fresh from fetchMktLotsTable() on every
 * call — never a separate cache layer here, since fetchMktLotsTable's own 6h
 * TTL already gates the network call this depends on (re-deriving the ~211-row
 * array from an already-cached Map is cheap). Sorted alphabetically by symbol
 * for a stable combobox order. A stock with no equity-master name match falls
 * back to its own symbol as the display name rather than being dropped.
 */
export async function fetchFnoStockUniverse(): Promise<FnoStockUniverseEntry[]> {
  const [table, names] = await Promise.all([fetchMktLotsTable(), fetchEquityNames()]);
  const universe: FnoStockUniverseEntry[] = [];
  for (const symbol of table.keys()) {
    if (INDEX_DERIVATIVE_DENYLIST.has(symbol)) continue;
    universe.push({ symbol, companyName: names.get(symbol) ?? symbol });
  }
  universe.sort((a, b) => a.symbol.localeCompare(b.symbol));
  return universe;
}

/**
 * Runtime membership check used at every boundary that used to trust the
 * compile-time "NIFTY" | "BANKNIFTY" union (route validation, order
 * placement) — true for the two supported index underlyings or any live
 * member of today's F&O stock universe, false for anything else (including a
 * plausible-looking but non-F&O-eligible stock symbol). Always re-derives the
 * stock universe from the (cache-backed) live table — never hardcodes the
 * stock half of this check.
 */
export async function isTradableOptionUnderlying(symbol: string): Promise<boolean> {
  if (isIndexUnderlying(symbol)) return true;
  const universe = await fetchFnoStockUniverse();
  return universe.some((entry) => entry.symbol === symbol);
}

// ─── Option chain snapshot ─────────────────────────────────────────────────────

type RawOptionLeg = {
  lastPrice?: number | null;
  buyPrice1?: number | null;
  sellPrice1?: number | null;
  openInterest?: number | null;
  impliedVolatility?: number | null;
};

type RawChainRow = { strikePrice?: number | null; expiryDates?: string | null; CE?: RawOptionLeg | null; PE?: RawOptionLeg | null };

type RawChainResponse = {
  records?: {
    data?: RawChainRow[] | null;
    underlyingValue?: number | null;
    timestamp?: string | null;
  } | null;
};

function toQuote(leg: RawOptionLeg | null | undefined): OptionQuote | null {
  if (!leg) return null;
  return {
    lastPrice: typeof leg.lastPrice === "number" ? leg.lastPrice : null,
    bidPrice: typeof leg.buyPrice1 === "number" ? leg.buyPrice1 : null,
    askPrice: typeof leg.sellPrice1 === "number" ? leg.sellPrice1 : null,
    openInterest: typeof leg.openInterest === "number" ? leg.openInterest : null,
    impliedVolatility: typeof leg.impliedVolatility === "number" ? leg.impliedVolatility : null
  };
}

/** Parses NSE's `records.timestamp` ("DD-MMM-YYYY HH:mm:ss", IST wall-clock) into a UTC Date. Null on any unparseable input. */
function parseNseChainTimestamp(raw: string | null | undefined): Date | null {
  if (!raw) return null;
  const match = raw.match(/^(\d{2})-([A-Za-z]{3})-(\d{4})\s+(\d{2}):(\d{2}):(\d{2})$/);
  if (!match) return null;
  const [, dd, mon, yyyy, hh, mm, ss] = match;
  const monthIndex = MONTH_ABBR.indexOf(mon.toUpperCase());
  if (monthIndex < 0) return null;
  // IST wall-clock -> UTC instant.
  const d = new Date(Date.UTC(Number(yyyy), monthIndex, Number(dd), Number(hh) - 5, Number(mm) - 30, Number(ss)));
  return Number.isNaN(d.getTime()) ? null : d;
}

const chainCache = new Map<string, { at: number; data: OptionChainSnapshot | null }>();

/**
 * Trading Terminal UI Overhaul (Sprint A, T3) — "recently viewed" tracking for
 * the premium-capture cron's candidate set. A SEPARATE map from chainCache
 * (not a field bolted onto its entries): a contract stays "recently viewed"
 * for RECENTLY_VIEWED_WINDOW_MS regardless of the 60s chainCache TTL, and
 * recording a request must never be skipped just because chainCache already
 * had a fresh entry (a cache HIT is still a real view). Process-local, lost on
 * restart, single-instance-only — the same accepted limitation as
 * chainCache's own 60s TTL, not a new risk class.
 */
const recentlyViewedCache = new Map<string, { underlying: OptionUnderlying; expiry: string; lastRequestedAt: number }>();

/** Records that `underlying`'s `expiry` chain was just requested — called on EVERY fetchOptionChain call (cache hit or miss), so the capture cron's "viewed in roughly the last 15 minutes" signal reflects real traffic, not just cache misses. */
function recordChainRequest(underlying: OptionUnderlying, expiry: string): void {
  recentlyViewedCache.set(`${underlying}::${expiry}`, { underlying, expiry, lastRequestedAt: Date.now() });
}

/**
 * Every (underlying, expiry) pair whose chain was requested within the last
 * `windowMs` (default 15 minutes) — one half of the premium-capture cron's
 * candidate set (the other half is "has an open position", scanned directly
 * from PaperOrder). Stale entries are read-time filtered, not proactively
 * evicted — this map is small (bounded by the number of distinct contracts
 * actually browsed) and never needs its own eviction policy.
 */
export function getRecentlyViewedContracts(windowMs = 15 * 60_000): Array<{ underlying: OptionUnderlying; expiry: string }> {
  const cutoff = Date.now() - windowMs;
  const result: Array<{ underlying: OptionUnderlying; expiry: string }> = [];
  for (const entry of recentlyViewedCache.values()) {
    if (entry.lastRequestedAt >= cutoff) result.push({ underlying: entry.underlying, expiry: entry.expiry });
  }
  return result;
}

/**
 * Fetches the full strike ladder for `underlying`'s `expiry` contract, plus the
 * live underlying spot value and the snapshotted lot size for that specific
 * contract month. Never throws — returns null on any upstream failure or an
 * empty/malformed response, so the route layer can render an honest
 * "unavailable" state rather than a 500 or an infinite spinner. Cached
 * in-module for CHAIN_CACHE_TTL_MS (60s) per (underlying, expiry) pair.
 */
export async function fetchOptionChain(underlying: string, expiry: string): Promise<OptionChainSnapshot | null> {
  recordChainRequest(underlying, expiry);

  const cacheKey = `${underlying}::${expiry}`;
  const cached = chainCache.get(cacheKey);
  if (cached && Date.now() - cached.at < CHAIN_CACHE_TTL_MS) return cached.data;

  const result = await fetchOptionChainUncached(underlying, expiry);
  chainCache.set(cacheKey, { at: Date.now(), data: result });
  return result;
}

async function fetchOptionChainUncached(underlying: string, expiry: string): Promise<OptionChainSnapshot | null> {
  const cookie = await primeNseSession("/");
  if (!cookie) return null;

  // NIFTY/BANKNIFTY (Phase 2) use `type=Indices`; every single-stock F&O
  // underlying (Phase 3) uses `type=Equity` — verified live 2026-07-24 against
  // RELIANCE (45 strike rows, real premiums). Same endpoint, same cookie
  // handshake, same referer — only this one query param differs.
  const chainType = isIndexUnderlying(underlying) ? "Indices" : "Equity";

  const [raw, lotSize] = await Promise.all([
    nseApiGet(
      `/api/option-chain-v3?type=${chainType}&symbol=${underlying}&expiry=${encodeURIComponent(expiry)}`,
      cookie,
      REFERER_PATH
    ) as Promise<RawChainResponse | null>,
    resolveLotSize(underlying, expiry)
  ]);

  const records = raw?.records;
  if (!records || !Array.isArray(records.data) || records.data.length === 0) return null;
  if (typeof records.underlyingValue !== "number") return null;

  const strikes: OptionStrikeRow[] = records.data
    .filter((row): row is RawChainRow & { strikePrice: number } => typeof row.strikePrice === "number")
    .map((row) => ({ strikePrice: row.strikePrice, CE: toQuote(row.CE), PE: toQuote(row.PE) }))
    .sort((a, b) => a.strikePrice - b.strikePrice);

  if (strikes.length === 0) return null;

  return {
    underlying,
    expiry,
    underlyingValue: records.underlyingValue,
    asOf: parseNseChainTimestamp(records.timestamp),
    lotSize,
    strikes
  };
}
