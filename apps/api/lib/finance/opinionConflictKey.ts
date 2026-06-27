import { checkTickerMap, normalizeYahooTicker } from "@/lib/ai/extractInstrument";

/**
 * Canonical (per-story) instrument identity for grouping expert opinions when
 * detecting / cleaning up duplicate-and-conflicting calls by the same expert.
 *
 * Resolves from the QUOTE ONLY — deliberately NOT the headline, and NOT the stored
 * instrument/instrumentTicker columns. Reasons:
 *   - The story HEADLINE contaminates grouping: in a multi-instrument article
 *     ("analyst's top 10 sector picks", headline "bets on PSU banks"), passing the
 *     headline makes EVERY opinion resolve to the headline's instrument, falsely
 *     merging genuinely-distinct sector calls into one bull+bear "conflict".
 *   - The stored instrument/instrumentTicker columns were written by the live path
 *     which ALSO used the headline, so they carry the same contamination.
 *
 * Quote-only is conservative: it groups two opinions only when BOTH quotes name a
 * recognizable instrument that resolves the same way. This is exactly the safe
 * trade-off for a destructive cleanup — it catches the real "same expert, same
 * instrument named in both quotes, opposite directions" bug while never merging two
 * opinions whose quotes are about different things. Returns null when the quote names
 * no recognizable instrument; callers MUST leave such rows untouched.
 */
export function canonicalInstrumentKey(o: {
  quote: string;
  // headline/instrument/instrumentTicker intentionally accepted but UNUSED, so callers
  // can pass the full row without it changing behavior. See rationale above.
  headline?: string | null;
  instrument?: string | null;
  instrumentTicker?: string | null;
}): string | null {
  const mapped = checkTickerMap(o.quote, ""); // QUOTE-ONLY — empty headline by design
  if (mapped) return `t:${normalizeYahooTicker(mapped.ticker).toUpperCase()}`;
  return null;
}
