/**
 * All-Indices informational layer — maps an /indices/[slug] directory slug
 * (derived by apps/api's allIndices.ts via slugifyIndexName from NSE's live
 * index display name) to the tradable F&O underlying symbol the Paper
 * Trading options terminal understands (business-rules'
 * INDEX_OPTION_UNDERLYINGS — see optionContract.ts).
 *
 * ONLY these five slugs are tradable. Every other one of the 139 all-indices
 * rows is informational-only — the founder's explicit framing ("we cant be
 * limited to few [tradable names]"): the BROWSING surface is now broad
 * (/indices covers everything NSE publishes), the TRADABLE surface stays
 * exactly the five names market reality allows (the options terminal itself
 * is untouched by this feature).
 *
 * Source values are NSE's own `index` display-name strings, verified live
 * 2026-07-25 — all five sit in the `INDICES ELIGIBLE IN DERIVATIVES` group
 * NSE itself publishes in the /api/allIndices response:
 *   "NIFTY 50" -> NIFTY · "NIFTY BANK" -> BANKNIFTY ·
 *   "NIFTY FINANCIAL SERVICES" -> FINNIFTY ·
 *   "NIFTY MIDCAP SELECT" -> MIDCPNIFTY · "NIFTY NEXT 50" -> NIFTYNXT50
 */

import {
  INDEX_OPTION_UNDERLYINGS,
  type IndexOptionUnderlying
} from "@predict-future/business-rules/papertrading/optionContract";

export const INDEX_SLUG_TO_TRADABLE_UNDERLYING: Record<string, IndexOptionUnderlying> = {
  "NIFTY-50": "NIFTY",
  "NIFTY-BANK": "BANKNIFTY",
  "NIFTY-FINANCIAL-SERVICES": "FINNIFTY",
  "NIFTY-MIDCAP-SELECT": "MIDCPNIFTY",
  "NIFTY-NEXT-50": "NIFTYNXT50"
};

// Defensive at-import assertion: every mapped value must be a real tradable
// underlying business-rules recognizes — a typo here would silently break
// the options terminal link-out with no compile-time signal (the map's
// values are plain string literals, not type-checked against the source of
// truth by TypeScript alone).
for (const symbol of Object.values(INDEX_SLUG_TO_TRADABLE_UNDERLYING)) {
  if (!(INDEX_OPTION_UNDERLYINGS as readonly string[]).includes(symbol)) {
    throw new Error(`[indexTradableAlias] "${symbol}" is not a recognized INDEX_OPTION_UNDERLYING`);
  }
}

/** Returns the tradable underlying symbol for a directory slug, or null if this index isn't F&O-tradable. */
export function tradableUnderlyingForIndexSlug(slug: string): IndexOptionUnderlying | null {
  return INDEX_SLUG_TO_TRADABLE_UNDERLYING[slug] ?? null;
}
