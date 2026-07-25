/**
 * Paper Trading Phase 4 — index-futures live quote fetcher, with a put-call-
 * parity fallback for any of the 5 registry indices whose direct live
 * endpoint doesn't resolve.
 *
 * ─── VERIFICATION STATUS — EC2-VERIFIED 2026-07-25 (all 5 indices) ─────────
 *
 * `GET /api/liveEquity-derivatives?index=<param>` on the standard
 * `primeNseSession`/`nseApiGet` handshake, referer
 * `/market-data/equity-derivatives-watch`, confirmed LIVE from EC2 for all 5
 * registry indices — each returns exactly 3 monthly contracts. The `index=`
 * param per underlying (enumerated from the equity-derivatives-watch page's
 * own source, not guessed — wrong guesses like "banknifty_fut"/
 * "midcpnifty_fut" return errors) is `INDEX_FUTURES_QUOTE_PARAM` below.
 *
 * Real captured row shape (nse50_fut, 2026-07-25), aligned exactly by
 * `RawFuturesRow`/`parseRawFuturesRows`:
 * `{"underlying":"NIFTY","identifier":"FUTIDXNIFTY28-07-2026XX0.00",
 * "instrumentType":"FUTIDX","instrument":"Index Futures","contract":"NIFTY
 * 28-Jul-2026","expiryDate":"28-Jul-2026","optionType":"-","strikePrice":0,
 * "lastPrice":23830,"change":-43.6,"pChange":-0.18,"openPrice":23700,
 * "highPrice":23854,"lowPrice":23640,"closePrice":23806.5,
 * "volume":4235530,...}` — `expiryDate` is "DD-MMM-YYYY" (matches
 * `OptionChainSnapshot.expiry`'s convention, no reparsing needed). Note this
 * live endpoint's own `instrumentType` value ("FUTIDX") is UNRELATED to the
 * F&O bhavcopy's `FinInstrmTp` codes in foBhavcopy.ts (that file uses the
 * newer ISO UDiFF codes, "IDF" not "FUTIDX" — two independent NSE systems,
 * confirmed to use two different vocabularies, do not assume they match).
 */

import { fetchOptionChain, fetchOptionChainExpiries } from "./optionChain";
import { nseApiGet, primeNseSession } from "./nse";
import {
  INDEX_OPTION_UNDERLYINGS,
  isIndexOptionUnderlying,
  type IndexOptionUnderlying
} from "@predict-future/business-rules/papertrading/optionContract";

export type { IndexOptionUnderlying };
export { INDEX_OPTION_UNDERLYINGS, isIndexOptionUnderlying };

export type FuturesQuoteSource = "LIVE" | "PCP_DERIVED";

export interface IndexFuturesContractQuote {
  /** "DD-MMM-YYYY", NSE's own expiry string format — same convention as OptionChainSnapshot.expiry. */
  expiry: string;
  price: number;
  openInterest: number | null;
  changePercent: number | null;
}

export interface IndexFuturesQuote {
  underlying: IndexOptionUnderlying;
  /** The near-month contract's price — the one order placement/margin math should use as "the" futures price for this underlying. */
  price: number;
  expiry: string;
  asOf: Date;
  source: FuturesQuoteSource;
  openInterest: number | null;
  changePercent: number | null;
  /** Every contract month returned by the live endpoint (near/next/far), when source is LIVE. Empty for a PCP_DERIVED quote (PCP only estimates the near-month price). */
  allContracts: IndexFuturesContractQuote[];
}

/**
 * NSE's `index=` query-param value per registry index for
 * `/api/liveEquity-derivatives` — ALL 5 EC2-VERIFIED 2026-07-25, enumerated
 * from the equity-derivatives-watch page's own source (not guessed — the
 * naive "index-name + _fut" pattern would have gotten BANKNIFTY and
 * MIDCPNIFTY wrong: NSE's real params are "nifty_bank_fut" and
 * "niftymidcap_fut", not "niftybank_fut"/"niftymidcapselect_fut"; both wrong
 * guesses were confirmed to return errors, not just empty/different data).
 */
const INDEX_FUTURES_QUOTE_PARAM: Record<IndexOptionUnderlying, string> = {
  NIFTY: "nse50_fut",
  BANKNIFTY: "nifty_bank_fut",
  FINNIFTY: "finnifty_fut",
  MIDCPNIFTY: "niftymidcap_fut",
  NIFTYNXT50: "niftynxt50_fut"
};

const LIVE_QUOTE_REFERER = "/market-data/equity-derivatives-watch";
const LIVE_QUOTE_CACHE_TTL_MS = 60 * 1000; // same in-module TTL convention as optionChain.ts's chainCache

const liveQuoteCache = new Map<string, { at: number; data: IndexFuturesQuote | null }>();

/**
 * One row of the `liveEquity-derivatives?index=` response — field names
 * EC2-VERIFIED 2026-07-25 against a real captured `nse50_fut` payload (see
 * the module doc for the exact sample row). `expiryDate` is "DD-MMM-YYYY".
 * The response envelope (a top-level `data` array, per
 * `RawFuturesResponse` below) matches this codebase's other
 * `liveEquity-derivatives`-shaped endpoints and is consistent with "each
 * index returns exactly 3 monthly contracts" — not independently
 * byte-verified as a top-level wrapper key, but `parseRawFuturesRows`
 * degrades to an empty result (never a throw) if that assumption is ever
 * wrong, same fail-closed posture as every other gap this module handles.
 */
type RawFuturesRow = {
  underlying?: string | null;
  instrumentType?: string | null;
  expiryDate?: string | null;
  lastPrice?: number | string | null;
  change?: number | string | null;
  pChange?: number | string | null;
  openPrice?: number | string | null;
  highPrice?: number | string | null;
  lowPrice?: number | string | null;
  closePrice?: number | string | null;
  volume?: number | string | null;
  openInterest?: number | string | null;
};

type RawFuturesResponse = { data?: RawFuturesRow[] | null } | RawFuturesRow[];

function toNumber(v: number | string | null | undefined): number | null {
  if (v === null || v === undefined) return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

/** MMM-DD-YYYY / DD-MMM-YYYY tolerant-enough parse purely for near-month SORTING (not stored) — reuses no external date lib, matches the two-or-three-token "DD-MMM-YYYY" shape every other NSE fetcher in this codebase already assumes. */
function expirySortKey(expiry: string): number {
  const MONTHS = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];
  const match = expiry.trim().match(/^(\d{1,2})-([A-Za-z]{3})-(\d{4})$/);
  if (!match) return Number.MAX_SAFE_INTEGER;
  const [, dd, mon, yyyy] = match;
  const monthIndex = MONTHS.indexOf(mon.toUpperCase());
  if (monthIndex < 0) return Number.MAX_SAFE_INTEGER;
  return Date.UTC(Number(yyyy), monthIndex, Number(dd));
}

function parseRawFuturesRows(raw: RawFuturesResponse | null): IndexFuturesContractQuote[] {
  if (!raw) return [];
  const rows = Array.isArray(raw) ? raw : Array.isArray(raw.data) ? raw.data : [];
  const parsed: IndexFuturesContractQuote[] = [];
  for (const row of rows) {
    const expiry = row.expiryDate?.trim();
    // closePrice fallback covers a pre-market/no-trade tick where lastPrice
    // may be absent — kept as a defensive fallback, not itself part of the
    // EC2-verified sample (which always carried a real lastPrice).
    const price = toNumber(row.lastPrice) ?? toNumber(row.closePrice);
    if (!expiry || price === null || price <= 0) continue;
    parsed.push({
      expiry,
      price,
      openInterest: toNumber(row.openInterest),
      changePercent: toNumber(row.pChange)
    });
  }
  parsed.sort((a, b) => expirySortKey(a.expiry) - expirySortKey(b.expiry));
  return parsed;
}

async function fetchLiveIndexFuturesQuote(underlying: IndexOptionUnderlying): Promise<IndexFuturesQuote | null> {
  const param = INDEX_FUTURES_QUOTE_PARAM[underlying];
  const cookie = await primeNseSession("/");
  if (!cookie) return null;

  const raw = (await nseApiGet(
    `/api/liveEquity-derivatives?index=${param}`,
    cookie,
    LIVE_QUOTE_REFERER
  )) as RawFuturesResponse | null;

  const contracts = parseRawFuturesRows(raw);
  if (contracts.length === 0) return null;

  const nearMonth = contracts[0];
  return {
    underlying,
    price: nearMonth.price,
    expiry: nearMonth.expiry,
    asOf: new Date(),
    source: "LIVE",
    openInterest: nearMonth.openInterest,
    changePercent: nearMonth.changePercent,
    allContracts: contracts
  };
}

/**
 * Put-call-parity fallback: F ≈ K + C_mid − P_mid, averaged over the 2-3
 * strikes nearest the current spot, for the underlying's nearest monthly
 * expiry — built entirely on `fetchOptionChain`, already live and liquid for
 * all 5 registry indices since the Trading Terminal UI ship (see
 * optionContract.ts's doc comment on all-5-verified option chains).
 *
 * `C_mid`/`P_mid` is the bid/ask midpoint when both quotes exist, falling
 * back to `lastPrice` when the chain has no live two-sided quote for that
 * leg (the same "a trade price is still usable, a one-sided quote is not"
 * posture optionsCosts.ts's resolveSquareOffPrice already established for a
 * closely related honesty question). A strike is skipped from the average
 * entirely if NEITHER leg has a usable price — this keeps the average from
 * being silently dragged by a stale/zero quote on an illiquid deep strike.
 */
async function fetchPcpDerivedQuote(underlying: IndexOptionUnderlying): Promise<IndexFuturesQuote | null> {
  const expiries = await fetchOptionChainExpiries(underlying);
  const nearestExpiry = expiries[0];
  if (!nearestExpiry) return null;

  const chain = await fetchOptionChain(underlying, nearestExpiry);
  if (!chain || chain.strikes.length === 0) return null;

  const spot = chain.underlyingValue;
  const sortedByProximity = [...chain.strikes].sort(
    (a, b) => Math.abs(a.strikePrice - spot) - Math.abs(b.strikePrice - spot)
  );

  const legMid = (q: { lastPrice: number | null; bidPrice: number | null; askPrice: number | null } | null): number | null => {
    if (!q) return null;
    if (q.bidPrice !== null && q.askPrice !== null && q.bidPrice > 0 && q.askPrice > 0) return (q.bidPrice + q.askPrice) / 2;
    return q.lastPrice !== null && q.lastPrice > 0 ? q.lastPrice : null;
  };

  const impliedFutures: number[] = [];
  for (const strike of sortedByProximity.slice(0, 3)) {
    const cMid = legMid(strike.CE);
    const pMid = legMid(strike.PE);
    if (cMid === null || pMid === null) continue;
    impliedFutures.push(strike.strikePrice + cMid - pMid);
  }

  if (impliedFutures.length === 0) return null;
  const price = impliedFutures.reduce((sum, v) => sum + v, 0) / impliedFutures.length;

  return {
    underlying,
    price,
    expiry: nearestExpiry,
    asOf: chain.asOf ?? new Date(),
    source: "PCP_DERIVED",
    openInterest: null,
    changePercent: null,
    allContracts: []
  };
}

/**
 * Fetches `underlying`'s near-month futures price: tries the direct NSE live
 * endpoint first, falls back to put-call parity on any failure (missing/
 * unresolved param, non-200, empty/unparseable response, or a live price
 * that's implausibly non-positive). Never throws — returns null only when
 * BOTH paths fail (matches the established null-safe fetcher convention
 * every other marketMoves fetcher in this codebase uses). Cached in-module
 * for 60s per underlying, same TTL convention as optionChain.ts's chainCache.
 */
export async function fetchIndexFuturesQuote(underlying: IndexOptionUnderlying): Promise<IndexFuturesQuote | null> {
  const cached = liveQuoteCache.get(underlying);
  if (cached && Date.now() - cached.at < LIVE_QUOTE_CACHE_TTL_MS) return cached.data;

  let result: IndexFuturesQuote | null = null;
  try {
    result = await fetchLiveIndexFuturesQuote(underlying);
  } catch (err) {
    console.warn(`[marketMoves/futuresQuote] LIVE fetch error for ${underlying}: ${err instanceof Error ? err.message : err}`);
  }

  if (!result) {
    try {
      result = await fetchPcpDerivedQuote(underlying);
    } catch (err) {
      console.warn(`[marketMoves/futuresQuote] PCP_DERIVED fetch error for ${underlying}: ${err instanceof Error ? err.message : err}`);
    }
  }

  liveQuoteCache.set(underlying, { at: Date.now(), data: result });
  return result;
}
