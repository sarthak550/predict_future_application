/**
 * Paper Trading Phase 2 — shared index-option contract identity helpers.
 *
 * Pure module: zero I/O. Used by apps/web's order-placement route (building the
 * PaperOrder.symbol value and parsing the NSE "DD-MMM-YYYY" expiry string into a
 * Date at write time) and by any UI surface that needs the same canonical
 * contract label — one implementation, so a display string and a DB-stored
 * symbol can never drift apart from how a contract's identity is actually
 * computed for grouping in replay.ts.
 */

export type ContractOptionType = "CE" | "PE";

const MONTH_ABBR = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];

/**
 * Parses an NSE-format expiry string ("28-Jul-2026", the exact format both
 * option-chain endpoints use) into a UTC-midnight Date — a pure calendar date,
 * not tied to any specific time-of-day, matching how PaperOrder.expiryDate is
 * stored and grouped by replay.ts's contract key. Returns null on any
 * unparseable input (defensive — callers should already be passing a string
 * that came straight from the chain/expiries endpoint).
 */
export function parseNseExpiryDate(expiry: string): Date | null {
  const match = expiry.trim().match(/^(\d{1,2})-([A-Za-z]{3})-(\d{4})$/);
  if (!match) return null;
  const [, dd, mon, yyyy] = match;
  const monthIndex = MONTH_ABBR.indexOf(mon.toUpperCase());
  if (monthIndex < 0) return null;
  const d = new Date(Date.UTC(Number(yyyy), monthIndex, Number(dd)));
  return Number.isNaN(d.getTime()) ? null : d;
}

/** UTC-midnight Date -> "28-Jul-2026" (NSE's own format), the inverse of parseNseExpiryDate. */
export function formatNseExpiryDate(expiryDate: Date): string {
  const dd = String(expiryDate.getUTCDate()).padStart(2, "0");
  const mon = MONTH_ABBR[expiryDate.getUTCMonth()];
  const monLabel = `${mon[0]}${mon.slice(1).toLowerCase()}`;
  const yyyy = expiryDate.getUTCFullYear();
  return `${dd}-${monLabel}-${yyyy}`;
}

/**
 * Canonical PaperOrder.symbol value for an option contract — compact, no
 * separators, matches NSE's own identifier convention closely enough to be
 * recognizable: e.g. "NIFTY24700CE28AUG2026".
 */
export function formatOptionContractSymbol(
  underlyingSymbol: string,
  strikePrice: number,
  optionType: ContractOptionType,
  expiryDate: Date
): string {
  const dd = String(expiryDate.getUTCDate()).padStart(2, "0");
  const mon = MONTH_ABBR[expiryDate.getUTCMonth()];
  const yyyy = expiryDate.getUTCFullYear();
  return `${underlyingSymbol}${strikePrice}${optionType}${dd}${mon}${yyyy}`;
}

/**
 * Human-readable contract label for UI surfaces — e.g. "NIFTY 24700 CE,
 * 28-Aug-26", exactly the format the Phase 2 brief's positions-view spec uses.
 */
export function formatOptionContractLabel(
  underlyingSymbol: string,
  strikePrice: number,
  optionType: ContractOptionType,
  expiryDate: Date
): string {
  const dd = String(expiryDate.getUTCDate()).padStart(2, "0");
  const mon = MONTH_ABBR[expiryDate.getUTCMonth()];
  const monLabel = `${mon[0]}${mon.slice(1).toLowerCase()}`;
  const yy = String(expiryDate.getUTCFullYear()).slice(-2);
  return `${underlyingSymbol} ${strikePrice} ${optionType}, ${dd}-${monLabel}-${yy}`;
}

/** Whole calendar days remaining until `expiryDate`, from `now` (defaults to the current instant). 0 on expiry day itself; negative once past expiry (defensive — a settled contract should never reach a UI position row, but this never throws either way). */
export function daysToExpiry(expiryDate: Date, now: Date = new Date()): number {
  const MS_PER_DAY = 24 * 60 * 60 * 1000;
  const nowDateOnly = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const expiryDateOnly = Date.UTC(expiryDate.getUTCFullYear(), expiryDate.getUTCMonth(), expiryDate.getUTCDate());
  return Math.round((expiryDateOnly - nowDateOnly) / MS_PER_DAY);
}

/**
 * The F&O-traded index underlyings — the ONLY symbols that trade as
 * cash-settled INDEX_OPTIONs (everything else in the F&O universe is a
 * physically-settled STOCK_OPTION). Single source of truth for every
 * consumer: chain fetch type=Indices selection, order instrumentKind
 * classification, settlement spot lookup, chain-browser toggle, UI copy.
 *
 * Yahoo spot tickers verified live 2026-07-25 against NSE's own
 * records.underlyingValue TO THE PAISA (traps: Yahoo's ^NSMIDCP is Nifty
 * NEXT 50 — not midcap — and ^CNXFIN is NOT FINNIFTY):
 *   NIFTY 23,767.45 = ^NSEI · BANKNIFTY = ^NSEBANK ·
 *   FINNIFTY 25,909.90 = NIFTY_FIN_SERVICE.NS ·
 *   MIDCPNIFTY 14,436.05 = NIFTY_MID_SELECT.NS · NIFTYNXT50 71,766 = ^NSMIDCP
 */
export const INDEX_OPTION_UNDERLYINGS = ["NIFTY", "BANKNIFTY", "FINNIFTY", "MIDCPNIFTY", "NIFTYNXT50"] as const;

export type IndexOptionUnderlying = (typeof INDEX_OPTION_UNDERLYINGS)[number];

export function isIndexOptionUnderlying(symbol: string): symbol is IndexOptionUnderlying {
  return (INDEX_OPTION_UNDERLYINGS as readonly string[]).includes(symbol);
}

/** Yahoo chart-API ticker for each index's spot — used by settlement fallback and the 1D index chart. */
export const YAHOO_INDEX_SPOT_TICKER: Record<IndexOptionUnderlying, string> = {
  NIFTY: "^NSEI",
  BANKNIFTY: "^NSEBANK",
  FINNIFTY: "NIFTY_FIN_SERVICE.NS",
  MIDCPNIFTY: "NIFTY_MID_SELECT.NS",
  NIFTYNXT50: "^NSMIDCP"
};
