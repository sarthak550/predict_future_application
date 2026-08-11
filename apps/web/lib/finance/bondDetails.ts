/**
 * Bonds informational layer — structured fact extraction for the Bond
 * Details panel (Instrument Details Audit, 2026-08-12).
 *
 * Mirrors apps/api/lib/marketMoves/bondName.ts's validated GS/GB parsing —
 * SAME regexes, SAME coupon-divisor rule, SAME per-token-verified SGB month
 * map (see that file's doc comments for the 2026-07-26 QA-pass provenance
 * behind every rule below, cross-referenced against the 89 real GS+GB rows
 * in BondEodQuote for session 2026-07-24) — but returns STRUCTURED fields
 * (coupon %, maturity year, SGB month/year as separate values) rather than
 * bondName.ts's single composed display string, since the panel needs to
 * label each fact independently rather than show one pre-joined sentence.
 *
 * Duplicated here rather than imported from apps/api: apps/web and apps/api
 * are separate deployed Next apps with no cross-app import path — the same
 * module-boundary convention lib/finance/fundamentals.ts documents for
 * itself (see that file's top doc comment).
 *
 * Best-effort, never throws: a symbol that doesn't match its series'
 * pattern returns null — the caller (BondDetailsPanel) then renders nothing
 * for that bond rather than guessing a field, per the house honesty
 * convention (a parsing miss degrades to "no panel," never a wrong fact).
 */

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
] as const;

/**
 * Month-token → month-index lookup for GB symbols, copied verbatim from
 * bondName.ts's MONTH_ABBR_TO_INDEX (2026-07-26 QA pass). Do NOT extend by
 * guessing a new short form's meaning — see that file's doc comment for the
 * per-entry verification (the "JU" entry in particular is a single-symbol
 * exception, not a general abbreviation rule). If bondName.ts's map is ever
 * extended with a newly-verified entry, mirror the addition here too.
 */
const MONTH_ABBR_TO_INDEX = new Map<string, number>([
  ["JAN", 0], ["FEB", 1], ["MAR", 2], ["APR", 3], ["MAY", 4], ["JUN", 5],
  ["JUL", 6], ["AUG", 7], ["SEP", 8], ["OCT", 9], ["NOV", 10], ["DEC", 11],
  ["MR", 2], ["J", 0], ["N", 10], ["NV", 10], ["OC", 9], ["D", 11],
  ["DC", 11], ["DE", 11], ["JU", 5],
]);

export interface GsBondFacts {
  /** e.g. 7.38 for "738GS2027". */
  couponPct: number;
  /** e.g. 2027 for "738GS2027". */
  maturityYear: number;
  issuer: "Government of India";
}

/**
 * Parses a GS (Government Security) symbol into structured facts — same
 * regex and coupon-divisor rule as bondName.ts's `parseGsDisplayName`:
 *   - 3-4 coupon digits: parseInt(digits) / 100 (e.g. "1018GS2026" -> 10.18)
 *   - 2 coupon digits:   parseInt(digits) / 10  (e.g. "68GS2060" -> 6.80)
 * Returns null when the symbol doesn't match — caller renders no panel for
 * that bond rather than a partial/guessed one. "GR" series tickers are a
 * distinct, intentionally-unhandled NSE convention (see bondName.ts) and
 * correctly fall through to null here too.
 */
export function parseGsBondFacts(symbol: string): GsBondFacts | null {
  const m = /^(\d{2,4})GS(\d{4})$/.exec(symbol);
  if (!m) return null;
  const digits = m[1];
  const divisor = digits.length === 2 ? 10 : 100;
  const couponPct = parseInt(digits, 10) / divisor;
  return { couponPct, maturityYear: Number(m[2]), issuer: "Government of India" };
}

export interface GbBondFacts {
  /** Full month name, e.g. "August". */
  maturityMonth: string;
  /** 4-digit year, e.g. 2028. */
  maturityYear: number;
}

/**
 * Parses a GB (Sovereign Gold Bond) symbol's redemption month/year — same
 * regex and month-token map as bondName.ts's `parseGbDisplayName`. Returns
 * null when the symbol doesn't match OR the captured month token isn't in
 * the verified map (an unrecognized short form is left unresolved rather
 * than guessed, same rule as bondName.ts).
 */
export function parseGbBondFacts(symbol: string): GbBondFacts | null {
  const m = /^SGB([A-Z]{1,3})(\d{2})/.exec(symbol);
  if (!m) return null;
  const monthIdx = MONTH_ABBR_TO_INDEX.get(m[1]);
  if (monthIdx === undefined) return null;
  return { maturityMonth: MONTH_NAMES[monthIdx], maturityYear: 2000 + Number(m[2]) };
}
