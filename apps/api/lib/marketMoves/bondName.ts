/**
 * Bonds informational layer — human-readable name parser for NSE GS
 * (Government Securities) and GB (Sovereign Gold Bond) symbols.
 *
 * Best-effort, never throws: falls back to the raw symbol when a pattern
 * doesn't match, so a parsing miss degrades gracefully (an ugly-but-correct
 * raw symbol) rather than breaking a page or hiding a row.
 *
 * Both patterns below were VALIDATED against the real feed post-launch
 * (2026-07-26 QA pass) using the 89 real GS+GB rows in BondEodQuote for
 * session 2026-07-24 — see the per-function doc comments for what that
 * validation found and fixed. This superseded the brief's original
 * "verified GS / unverified GB" claim, which is now stale: the initial GS
 * regex itself had an unhandled 2-digit-coupon case (11% of real GS rows),
 * and the initial GB regex missed several short (1-2 letter) month tokens
 * from an older SGB tranche-naming era (23% of real GB rows).
 */

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
] as const;

/**
 * Month-token → month-index lookup for GB symbols. Two eras coexist in the
 * real data: modern tranches spell the month out in full ("JAN".."DEC");
 * older tranches (~2021-22 issuance, e.g. "SGBJ28VIII", "SGBMR29XII") use a
 * shorter 1-2 letter token instead — NOT simply "first letter(s) of the
 * month name" in every case, so each short form below is either taken
 * directly from a real symbol's QA-confirmed month (2026-07-26 QA pass,
 * cross-referenced against real BondEodQuote rows for session 2026-07-24)
 * or independently verified (see "JU" below). Do NOT extend this map by
 * guessing a new short form's meaning — a wrong month violates the
 * honest-display rule; leaving a symbol on its raw-symbol fallback does not.
 */
const MONTH_ABBR_TO_INDEX = new Map<string, number>([
  // Full 3-letter forms — the modern/common case.
  ["JAN", 0], ["FEB", 1], ["MAR", 2], ["APR", 3], ["MAY", 4], ["JUN", 5],
  ["JUL", 6], ["AUG", 7], ["SEP", 8], ["OCT", 9], ["NOV", 10], ["DEC", 11],
  // Short forms confirmed against real symbols (2026-07-26 QA pass):
  ["MR", 2],  // March  — e.g. SGBMR29XII
  ["J", 0],   // January — e.g. SGBJ28VIII
  ["N", 10],  // November — e.g. SGBN28VIII
  ["NV", 10], // November — e.g. SGBNV29VII
  ["OC", 9],  // October — e.g. SGBOC28VII
  ["D", 11],  // December — e.g. SGBD29VIII
  ["DC", 11], // December — e.g. SGBDC27VII
  ["DE", 11], // December — e.g. SGBDE30III, SGBDE31III
  // "JU" is genuinely ambiguous as an abbreviation (June or July) — resolved
  // ONLY for this specific real symbol via NSE's own quote page
  // (nseindia.com/get-quotes/equity?symbol=SGBJU29III, cross-checked against
  // equitymaster.com's listing, both titled "SOVEREIGN GOLD BOND(S) 2.5%
  // JUNE 2029 SR-III", checked 2026-07-26) — NOT a general "JU always means
  // June" rule. Every other real June/July symbol in the dataset already
  // spells the month out in full (JUN/JUL), so this short form only ever
  // appears on this one 2021-22-era tranche in the data seen so far. If a
  // future ingest surfaces a different "JU…" symbol, re-verify its month
  // independently before trusting this entry for it.
  ["JU", 5],  // June — SGBJU29III specifically, NSE-verified
]);

/**
 * Parses a GS (Government Security) symbol, e.g. "1018GS2026" -> coupon
 * digits "1018", year "2026". Coupon is basis-points-as-integer, but the
 * divisor depends on the coupon field's digit count (confirmed against real
 * data, 2026-07-26 QA pass — the original 3-4-digit-only assumption missed
 * every 2-digit coupon in the feed, e.g. "68GS2060"):
 *   - 3-4 digits: parseInt(digits) / 100 -> "10.18" (e.g. "1018GS2026"), "5.74" (e.g. "574GS2026")
 *   - 2 digits:   parseInt(digits) / 10  -> "6.80"  (e.g. "68GS2060"), "9.20" (e.g. "92GS2030")
 * Returns null when the symbol doesn't match — caller falls back to the raw
 * symbol. Note: "GR" series tickers (e.g. "697GR2034") are a distinct,
 * intentionally-unhandled NSE naming convention — they don't match this "GS"
 * pattern and correctly fall back to the raw symbol; do not widen this
 * regex to also match "GR".
 */
function parseGsDisplayName(symbol: string): string | null {
  const m = /^(\d{2,4})GS(\d{4})$/.exec(symbol);
  if (!m) return null;
  const digits = m[1];
  const divisor = digits.length === 2 ? 10 : 100;
  const couponPct = (parseInt(digits, 10) / divisor).toFixed(2);
  return `${couponPct}% GOI ${m[2]}`;
}

/**
 * Parses a GB (Sovereign Gold Bond) symbol against NSE's SGB tranche
 * convention: "SGB" + a 1-3 letter month token + 2-digit year (e.g.
 * "SGBAUG28", "SGBJ28VIII", "SGBNV29VII"), optionally followed by a
 * tranche-disambiguating roman-numeral suffix which is intentionally
 * ignored — the display name doesn't need to distinguish tranches issued in
 * the same month. The month token's length varies by issuance era (modern
 * tranches spell it out fully; some 2021-22-era tranches use a 1-2 letter
 * short form) — see MONTH_ABBR_TO_INDEX's doc comment for the exact,
 * per-token-verified mapping. Returns null when the symbol doesn't match OR
 * when the captured token isn't in the verified map (an unrecognized short
 * form is left unresolved rather than guessed) — caller falls back to the
 * raw symbol AND logs the miss so the map can be extended, ONLY once
 * verified, in a follow-up commit.
 */
function parseGbDisplayName(symbol: string): string | null {
  const m = /^SGB([A-Z]{1,3})(\d{2})/.exec(symbol);
  if (!m) return null;
  const monthIdx = MONTH_ABBR_TO_INDEX.get(m[1]);
  if (monthIdx === undefined) return null;
  return `Sovereign Gold Bond ${MONTH_NAMES[monthIdx]} 20${m[2]}`;
}

/**
 * Parses an NSE bond symbol into a human-readable label. Best-effort: falls
 * back to the raw symbol (never throws, never returns empty) when the
 * pattern doesn't match, so a parsing miss degrades gracefully rather than
 * breaking a page.
 */
export function parseBondDisplayName(symbol: string, series: "GS" | "GB"): string {
  if (series === "GS") {
    return parseGsDisplayName(symbol) ?? symbol;
  }
  return parseGbDisplayName(symbol) ?? symbol;
}
