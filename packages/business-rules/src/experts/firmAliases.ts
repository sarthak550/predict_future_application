/**
 * Curated firm/organization alias map — round-2 duplicate-expert work (2026-08-08).
 *
 * Lives in @predict-future/business-rules (not apps/api/lib/finance) because it's
 * needed on BOTH sides of the app split: apps/api's dedup engine (expertDedup.ts's
 * orgVariantConfidence, expertEntityKind.ts's classifier) uses it for MATCHING, and
 * apps/web's analyst directory (lib/finance/analysts.ts) uses canonicalizeOrgDisplay
 * for DISPLAY — apps/web cannot import apps/api's server code (separate deployable),
 * so a shared dependency-free package is the only way both stay in agreement on
 * what "MOFSL" canonicalizes to.
 *
 * Founder brief: "MOFSL/MOSL -> Motilal Oswal Financial Services, ABSL/ABSL AMC ->
 * Aditya Birla Sun Life AMC, MOAMC -> Motilal Oswal AMC, KC Securities -> Kantilal
 * Chaganlal Securities, HDFC Sec -> HDFC Securities, ICICI Sec/I-Sec -> ICICI
 * Securities, plus obvious ones found in the data."
 *
 * Deliberately a standalone LEAF module — no imports from expertDedup.ts (which
 * imports FROM here instead, along with expertEntityKind.ts); if this file imported
 * back from expertDedup.ts we'd have a circular dependency. The tiny normalization
 * helper below is intentionally duplicated (not re-exported from expertDedup.ts) to
 * keep this module dependency-free — it's 3 lines and extremely stable (lowercase/
 * strip-punctuation/collapse-whitespace), so the duplication-drift risk is
 * negligible next to the value of keeping this a leaf.
 *
 * Two distinct mechanisms, because acronyms show up in org strings two different ways:
 *
 *  1. FIRM_ALIAS_TOKENS — a single bare acronym WORD (e.g. "mofsl", "absl") that can
 *     appear standalone ("MOFSL") or embedded alongside other words that already
 *     tokenize away as generic stopwords ("ABSL Mutual Fund" -> "mutual"/"fund" are
 *     stopwords in expertDedup's ORG_STOPWORDS, leaving bare "absl"). Consumed by
 *     expertDedup.ts's tokenizeOrg(), which expands a matched token into the
 *     canonical org's own real brand tokens so ordinary shared-token matching does
 *     the rest — this composes correctly with every org string that happens to
 *     ALSO contain the acronym, not just an exact bare match.
 *
 *  2. FIRM_ALIAS_PHRASES — a short multi-word (or otherwise ambiguous-out-of-context)
 *     abbreviation that only makes sense as a whole phrase. "Sec" alone is a
 *     dangerously generic 3-letter fragment ("HDFC Sec" and "ICICI Sec" are
 *     DIFFERENT firms) — expanding a bare "sec" token would be a false-merge
 *     landmine. These are matched against the ENTIRE normalized org string instead,
 *     applied once at the top of orgVariantConfidence before any other test runs.
 *
 * Adding an entry: only add a mapping you can defend by name — this list feeds
 * BOTH the offline merge script's auto-merge decisions and extraction-time
 * prevention. An entry that's wrong merges two different real firms' analysts into
 * one profile, which is exactly the failure mode the "hard law" in expertDedup.ts
 * warns against. When unsure, leave it out — the acronym falls through to REVIEW
 * instead, same as any other unmatched org variant.
 */

function normalizeAliasKey(value: string): string {
  return value
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

/** Bare acronym token -> canonical full org name. Keys are already normalizeAliasKey'd
 *  (lowercase, single word, no punctuation) so lookups are a direct map hit. */
export const FIRM_ALIAS_TOKENS: Record<string, string> = {
  mofsl: "Motilal Oswal Financial Services",
  mosl: "Motilal Oswal Financial Services",
  absl: "Aditya Birla Sun Life AMC",
  moamc: "Motilal Oswal AMC",
};

/** Whole normalized org-string phrase -> canonical full org name. */
export const FIRM_ALIAS_PHRASES: Record<string, string> = {
  "hdfc sec": "HDFC Securities",
  "icici sec": "ICICI Securities",
  "i sec": "ICICI Securities", // "I-Sec" normalizes to "i sec" (hyphen -> space)
  "kc securities": "Kantilal Chaganlal Securities",
};

/**
 * Whole-phrase alias resolution — used at the top of orgVariantConfidence(), applied
 * to the FULL org string before any other comparison. A no-op (returns the input
 * unchanged) unless the entire normalized string is a known phrase alias.
 */
export function canonicalizeOrgPhrase(org: string): string {
  const key = normalizeAliasKey(org);
  return FIRM_ALIAS_PHRASES[key] ?? org;
}

/**
 * True when `text` (after normalization) IS a known alias — either a bare acronym
 * token or a whole phrase alias — used by expertEntityKind.ts to recognize an
 * Expert.name field that is itself just a firm's acronym (e.g. name="MOFSL").
 */
export function isKnownFirmAlias(text: string): boolean {
  const key = normalizeAliasKey(text);
  if (FIRM_ALIAS_PHRASES[key]) return true;
  if (!key.includes(" ") && FIRM_ALIAS_TOKENS[key]) return true;
  return false;
}

/**
 * Best-effort DISPLAY canonicalization for an org string: resolves it to its full
 * canonical name ONLY when the whole string is itself a known alias (bare acronym
 * or phrase alias) — never rewrites a longer, more specific org string that merely
 * CONTAINS an alias-able fragment (e.g. "ABSL Mutual Fund" is intentionally left
 * as-is here; only used for the dedup-matching token expansion in expertDedup.ts,
 * not silently rewritten for display, since collapsing "ABSL Mutual Fund" into
 * "Aditya Birla Sun Life AMC" for DISPLAY would erase a real business-line
 * distinction the reader may care about). This is what guarantees the founder's
 * "MOFSL never appears next to Motilal Oswal Financial Services in a list" law for
 * the common case: a bare acronym org value gets rewritten to its full name;
 * anything more specific is left for a human to judge during merge review.
 */
export function canonicalizeOrgDisplay(org: string): string {
  const phraseMatch = canonicalizeOrgPhrase(org);
  if (phraseMatch !== org) return phraseMatch;

  const key = normalizeAliasKey(org);
  if (!key.includes(" ")) {
    const tokenMatch = FIRM_ALIAS_TOKENS[key];
    if (tokenMatch) return tokenMatch;
  }
  return org;
}
