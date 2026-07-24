/**
 * Paper Trading Phase 2 — NIFTY/BANKNIFTY index option-chain fetcher.
 *
 * Built on the existing primeNseSession/nseApiGet cookie handshake in nse.ts
 * (same file/pattern precedent as fetchNseAnnouncements/fetchNseMovers) — does
 * NOT reimplement the Akamai cookie dance.
 *
 * VERIFICATION STATUS (2026-07-23): both endpoints below returned live 200 JSON
 * from this build sandbox at the time this file was written (NIFTY: 18 expiries,
 * weekly cadence out to ~Sep-2026 then monthly/quarterly; BANKNIFTY: monthly
 * cadence throughout — confirmed empirically, never hardcoded here). This is a
 * fragility caveat, not a guarantee: the brief flags this as the same
 * unofficial, Akamai-fronted endpoint class as the movers/announcements pipe
 * already running in production. Accepted risk — every function here returns
 * null/[] on any failure, never throws.
 *
 * Endpoints (all under https://www.nseindia.com):
 *   - GET /api/option-chain-contract-info?symbol=NIFTY|BANKNIFTY
 *       -> { expiryDates: string[] ("28-Jul-2026" format), strikePrice: string[] }
 *   - GET /api/option-chain-v3?type=Indices&symbol=NIFTY|BANKNIFTY&expiry=DD-MMM-YYYY
 *       -> { records: { data: [{ strikePrice, expiryDates, CE?: {...}, PE?: {...} }],
 *                        underlyingValue: number, timestamp: "DD-MMM-YYYY HH:mm:ss" (IST) } }
 *     Passing `expiry` filters server-side to that expiry's rows only (verified
 *     empirically — every returned row's own expiryDates matches the query param).
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
 */

import { primeNseSession, nseApiGet } from "./nse";

export type OptionUnderlying = "NIFTY" | "BANKNIFTY";
export type OptionType = "CE" | "PE";

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

async function fetchOptionChainExpiriesUncached(underlying: OptionUnderlying): Promise<string[]> {
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

// ─── Lot size (fo_mktlots.csv) ────────────────────────────────────────────────

/** underlying -> ordered list of { monthLabel ("JUL-26"), lotSize } parsed from the CSV header/row. */
type MktLotsTable = Map<OptionUnderlying, { monthLabel: string; lotSize: number }[]>;

const MKTLOTS_TTL_MS = 6 * 60 * 60 * 1000; // 6h — lot sizes change on regulatory events (most recently Jan 2026), not daily; short enough to pick up a same-day SEBI change without refetching every request.
let mktLotsCache: { at: number; table: MktLotsTable } | null = null;

/** Header row's underlying label -> our OptionUnderlying enum. NSE's SYMBOL column (2nd column) is the authoritative short code. */
const SYMBOL_TO_UNDERLYING: Record<string, OptionUnderlying> = { NIFTY: "NIFTY", BANKNIFTY: "BANKNIFTY" };

/**
 * Parses fo_mktlots.csv: header row's month columns (e.g. "JUL-26", "AUG-26", …)
 * map to each data row's per-month lot size for that row's SYMBOL column.
 * Format (verified live 2026-07-23):
 *   UNDERLYING,SYMBOL,JUL-26,AUG-26,SEP-26,DEC-26,...
 *   NIFTY 50  ,NIFTY ,65    ,65    ,65    ,65    ,...
 *   NIFTY BANK,BANKNIFTY,30 ,30    ,30    ,30    ,...
 * Trailing/leading whitespace padding in every field is stripped. Blank cells
 * (a contract month not yet listed for that underlying) are skipped, not
 * zero-filled.
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
    const underlying = SYMBOL_TO_UNDERLYING[symbol];
    if (!underlying) continue; // not one of the two underlyings this feature supports

    const entries: { monthLabel: string; lotSize: number }[] = [];
    for (let col = 0; col < monthColumns.length; col++) {
      const raw = cells[2 + col];
      const lotSize = raw ? Number(raw) : NaN;
      if (monthColumns[col] && Number.isFinite(lotSize) && lotSize > 0) {
        entries.push({ monthLabel: monthColumns[col], lotSize });
      }
    }
    if (entries.length > 0) table.set(underlying, entries);
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
export async function resolveLotSize(underlying: OptionUnderlying, expiry: string): Promise<number | null> {
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
 * Fetches the full strike ladder for `underlying`'s `expiry` contract, plus the
 * live underlying spot value and the snapshotted lot size for that specific
 * contract month. Never throws — returns null on any upstream failure or an
 * empty/malformed response, so the route layer can render an honest
 * "unavailable" state rather than a 500 or an infinite spinner. Cached
 * in-module for CHAIN_CACHE_TTL_MS (60s) per (underlying, expiry) pair.
 */
export async function fetchOptionChain(underlying: OptionUnderlying, expiry: string): Promise<OptionChainSnapshot | null> {
  const cacheKey = `${underlying}::${expiry}`;
  const cached = chainCache.get(cacheKey);
  if (cached && Date.now() - cached.at < CHAIN_CACHE_TTL_MS) return cached.data;

  const result = await fetchOptionChainUncached(underlying, expiry);
  chainCache.set(cacheKey, { at: Date.now(), data: result });
  return result;
}

async function fetchOptionChainUncached(underlying: OptionUnderlying, expiry: string): Promise<OptionChainSnapshot | null> {
  const cookie = await primeNseSession("/");
  if (!cookie) return null;

  const [raw, lotSize] = await Promise.all([
    nseApiGet(
      `/api/option-chain-v3?type=Indices&symbol=${underlying}&expiry=${encodeURIComponent(expiry)}`,
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
