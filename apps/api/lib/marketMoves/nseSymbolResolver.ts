/**
 * Company-name → NSE-symbol resolver.
 *
 * WHY: BSE announcements arrive with a BSE scrip code + company name but no
 * NSE symbol, so filings and every news article derived from them carried a
 * dead "BSE:<code>" ticker — 1,157 of 3,353 news rows (34%) were unlinked to
 * any instrument page (founder report 2026-07-26) despite names like
 * "NTPC Ltd" that obviously map. Most BSE-announcing companies are dual-listed,
 * and we already hold the full NSE equity master (symbol ↔ company name), so
 * an exact match on NORMALIZED names recovers the NSE symbol for the bulk of
 * them.
 *
 * PRECISION OVER RECALL: only an exact normalized-name match resolves. No
 * fuzzy/token matching — a wrong link (an article pinned to the wrong
 * company's page) is strictly worse than an unlinked one. Ambiguous
 * normalized names (two symbols sharing one) resolve to nothing.
 *
 * Normalization: uppercase, punctuation → spaces, whitespace collapsed, and
 * TRAILING corporate suffix tokens stripped repeatedly (LIMITED/LTD/PRIVATE/
 * PVT) — "NTPC Ltd" and "NTPC LIMITED" both normalize to "NTPC";
 * "RailTel Corporation of India Ltd" → "RAILTEL CORPORATION OF INDIA"
 * (mid-name tokens like CORPORATION are meaningful and untouched).
 */

import { fetchEquityNames } from "./nse";

const TRAILING_SUFFIX_TOKENS = new Set(["LIMITED", "LTD", "PRIVATE", "PVT"]);

export function normalizeCompanyName(raw: string): string {
  const tokens = raw
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, " ")
    .trim()
    .split(/\s+/);
  // Leading "THE": NSE's master says "THE FEDERAL BANK LIMITED" where BSE says
  // "Federal Bank Ltd" — both must normalize identically.
  if (tokens.length > 1 && tokens[0] === "THE") tokens.shift();
  while (tokens.length > 1 && TRAILING_SUFFIX_TOKENS.has(tokens[tokens.length - 1])) {
    tokens.pop();
  }
  return tokens.join(" ");
}

/** Secondary exact key with ALL spaces removed — catches pure spacing variants ("PATHLABS" vs "PATH LABS") while staying full-name-exact. */
export function normalizeCompanyNameCompact(raw: string): string {
  return normalizeCompanyName(raw).replace(/ /g, "");
}

/** Inverted maps (normalizedName → symbol, compactName → symbol), rebuilt alongside the 12h equity-master cache. Ambiguous names map to null and never resolve. */
let inverted: { at: number; map: Map<string, string | null>; compact: Map<string, string | null> } | null = null;
const INVERTED_TTL_MS = 12 * 60 * 60 * 1000;

async function invertedNameMaps(): Promise<{ map: Map<string, string | null>; compact: Map<string, string | null> }> {
  const now = Date.now();
  if (inverted && now - inverted.at < INVERTED_TTL_MS) return inverted;

  const bySymbol = await fetchEquityNames(); // symbol → companyName, cached upstream
  const map = new Map<string, string | null>();
  const compact = new Map<string, string | null>();
  for (const [symbol, companyName] of bySymbol) {
    const key = normalizeCompanyName(companyName);
    if (!key) continue;
    map.set(key, map.has(key) ? null : symbol); // collision → ambiguous → never resolve
    const ckey = key.replace(/ /g, "");
    compact.set(ckey, compact.has(ckey) ? null : symbol);
  }
  if (map.size > 0) inverted = { at: now, map, compact };
  return { map, compact };
}

/** Resolves a company name to its NSE symbol, or null when no exact (unambiguous) normalized match exists — spaced key first, space-free key as fallback. Never throws. */
export async function resolveNseSymbolByCompanyName(companyName: string): Promise<string | null> {
  try {
    const key = normalizeCompanyName(companyName);
    if (!key) return null;
    const { map, compact } = await invertedNameMaps();
    return map.get(key) ?? compact.get(key.replace(/ /g, "")) ?? null;
  } catch {
    return null;
  }
}
