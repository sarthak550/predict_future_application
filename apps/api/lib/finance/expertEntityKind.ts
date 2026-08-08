/**
 * Human-vs-firm classification for Expert rows (founder brief, 2026-08-08):
 * "Smarter identification -> I hope this should understand the human name and firm
 * name." Two classes:
 *
 *   HUMAN — a real named analyst (e.g. "Rahul Shah" / "Motilal Oswal Financial
 *           Services"). This is the DEFAULT — a misclassified FIRM is cosmetic (a
 *           publication's "profile" says "Market analysis from X" either way), a
 *           misclassified HUMAN would insultingly reduce a real named person to an
 *           org-string. When unsure, HUMAN.
 *
 *   FIRM   — an "org-as-analyst" row: the extractor attributed the opinion to the
 *            publication/desk itself rather than a named individual (isSourceAttribution
 *            opinions display today as "Market Analysis from [Source]" — see
 *            lib/ai/extractExpertOpinions.ts). Two shapes seen in real data:
 *              - name === `${organization} Analysis` (the normal source-attribution
 *                naming convention, e.g. "ETMarkets Analysis" / org "ETMarkets")
 *              - name === organization literally (an AI-extraction quirk where the
 *                firm name landed in the analyst-name field with no "Analysis"
 *                suffix and isSourceAttribution wasn't set — e.g. "JM Financial" /
 *                org "JM Financial", the founder's reported bug: this row and its
 *                sibling "JM Financial Analysis" are the SAME underlying "firm as
 *                analyst" identity and must classify identically)
 *
 * This is a conservative HEURISTIC over (name, organization), plus an optional
 * DB-derived signal (the fraction of an existing expert's opinions that are
 * isSourceAttribution=true) supplied by callers that have it. It does not need
 * network or DB access itself — kept pure so both extraction-time classification
 * (lib/finance/expertMatch.ts, no opinion history yet for a brand-new row) and the
 * offline backfill (scripts/backfill-expert-entity-kind.ts, has full opinion
 * history) can share the exact same rules.
 */

import { orgVariantMatch } from "./expertDedup";
import { isKnownFirmAlias } from "@predict-future/business-rules/experts/firmAliases";

export type ExpertEntityKind = "HUMAN" | "FIRM";

/**
 * Vocabulary that, if it appears as a whole token anywhere in an Expert's NAME
 * field, is strong evidence the "name" is actually a firm/publication descriptor,
 * not a person. Real human analyst names essentially never contain words like
 * "securities" or "institutional" — this list is checked against the NAME, never
 * the organization (every real org legitimately contains these words).
 */
const FIRM_VOCAB_TOKENS = new Set([
  "securities", "capital", "financial", "financials", "research", "broking",
  "brokerage", "wealth", "amc", "mutual", "bank", "advisors", "advisor",
  "advisory", "investmart", "institutional", "equities", "analysis", "asset",
  "assets", "management", "fund", "funds", "insurance", "ratings", "ventures",
  "holdings", "group", "partners", "llp", "ltd", "limited", "pvt", "consultants",
  "consultancy", "stockbrokers", "stockbroking", "markets", "trading",
  "publication", "editorial", "media", "network", "news",
]);

function stripTrailingAnalysis(nameCore: string): string {
  return nameCore.replace(/\s+analysis$/i, "").trim();
}

function tokenize(value: string): string[] {
  return value
    .toLowerCase()
    .normalize("NFKC")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
}

export type ClassifyExpertEntityKindOptions = {
  /** True when the opinion that (re)created/matched this row is itself flagged
   *  isSourceAttribution — the strongest possible FIRM signal, since that flag is
   *  set by the AI extractor specifically to mean "attributed to the publication,
   *  not a named analyst" (see extractExpertOpinions.ts). */
  isSourceAttribution?: boolean;
  /** For an EXISTING expert with opinion history: opinions-flagged-isSourceAttribution
   *  divided by total opinions. A majority-source-attribution history is strong
   *  evidence the row is a firm/publication identity even if a stray individual
   *  opinion once got attached to it. Supplied by the offline backfill script. */
  sourceAttributionRatio?: number;
};

/**
 * Classifies (name, organization) as HUMAN or FIRM. See module doc for the full
 * rule rationale. Rule order (first FIRM match wins; otherwise HUMAN):
 *
 *  1. isSourceAttribution === true on the triggering opinion — definitional.
 *  2. sourceAttributionRatio >= 0.6 on existing opinion history — majority signal.
 *  3. The name (with a trailing " Analysis" stripped, if present) is IDENTICAL
 *     (cosmetic normalization only — case/whitespace/punctuation, plus firm-alias
 *     phrase resolution) to its OWN organization field — catches both the
 *     "X Analysis" / org "X" convention AND the bare "JM Financial" / org
 *     "JM Financial" extraction-quirk shape. Deliberately narrower than the full
 *     orgVariantConfidence test (substring/shared-token): those looser rules exist
 *     to compare two ORG strings against each other, and produce real false
 *     positives here against founder-eponymous boutique firms, where a human
 *     name and its OWN firm's name legitimately share a surname/token — "Anshul
 *     Saigal" / "Saigal Capital", "Ed Yardeni" / "Yardeni Research", "Ajay Kedia"
 *     / "Kedia Commodities", "Puneet Dalmia" / "Dalmia Bharat" all falsely
 *     classified FIRM under the looser test during real dev-DB validation. Only
 *     an EXACT (cosmetically-equal) name===org match is safe here.
 *  4. The (analysis-stripped) name is itself a known firm alias (lib/finance/
 *     firmAliases.ts) — a bare acronym used as if it were a person's name.
 *  5. The name contains a firm-vocabulary token (FIRM_VOCAB_TOKENS).
 *  6. The name is a single bare all-caps acronym-shaped token (e.g. "MOFSL",
 *     "SBI", "ICICI") — real human names are essentially never written this way.
 */
export function classifyExpertEntityKind(
  name: string,
  organization: string,
  opts: ClassifyExpertEntityKindOptions = {}
): ExpertEntityKind {
  if (opts.isSourceAttribution === true) return "FIRM";
  if (typeof opts.sourceAttributionRatio === "number" && opts.sourceAttributionRatio >= 0.6) return "FIRM";

  const trimmedName = name.trim();
  if (!trimmedName) return "HUMAN"; // defensive — should not happen, never insult a blank

  const nameCore = stripTrailingAnalysis(trimmedName);

  if (organization.trim() && orgVariantMatch(nameCore, organization).reason === "identical") return "FIRM";
  if (isKnownFirmAlias(nameCore)) return "FIRM";

  const tokens = tokenize(nameCore);
  if (tokens.some((t) => FIRM_VOCAB_TOKENS.has(t))) return "FIRM";

  if (!nameCore.includes(" ") && /^[A-Z0-9&.]{2,10}$/.test(nameCore)) return "FIRM";

  return "HUMAN";
}
