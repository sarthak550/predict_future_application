/**
 * Normalizes an ExpertOpinion's extracted instrument identity down to a
 * single lookup key for the `InstrumentAlias` table (apps/api/prisma/
 * schema.prisma) — the instrument-side mirror of expertDedup.ts's
 * normalizeExpertName (apps/api/lib/finance/expertDedup.ts).
 *
 * Unlike normalizeExpertName, this lives in the SHARED business-rules
 * package rather than apps/api-only, because apps/web must independently
 * recompute the SAME key from an ExpertOpinion row (instrument +
 * instrumentTicker) to join against InstrumentAlias for its dropdown/link/
 * cascade logic — apps/web cannot import apps/api's server code (see
 * firmAliases.ts's own note on why cross-app canonicalization helpers live
 * here rather than in either app).
 *
 * TICKER-FIRST: extraction (apps/api/lib/ai/extractInstrument.ts) always
 * commits `ticker` and `instrument` TOGETHER as one InstrumentResult, and the
 * ticker is the closer-to-canonical identifier — far fewer paraphrase
 * variants than free text (e.g. "SBI" and "State Bank of India" both already
 * resolve to the SAME ticker at extraction time), so keying on ticker
 * naturally collapses that class of duplicate before InstrumentAlias is even
 * consulted. Falls back to a normalized instrument label only for the rare
 * case no ticker was extracted at all — that fallback key is intentionally
 * WEAKER (free-text collisions are possible) since there is no authoritative
 * source to resolve a label-only entry against in the first place; see
 * resolveInstrumentAlias's own doc comment.
 */
export function normalizeInstrumentRawName(
  ticker: string | null | undefined,
  instrumentLabel: string | null | undefined,
): string | null {
  const trimmedTicker = ticker?.trim();
  if (trimmedTicker) return trimmedTicker.toUpperCase();

  const trimmedLabel = instrumentLabel?.trim();
  if (!trimmedLabel) return null;

  return trimmedLabel
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}
