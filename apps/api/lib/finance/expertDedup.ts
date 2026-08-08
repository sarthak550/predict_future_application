/**
 * Expert duplicate-detection core — pure, DB-free functions shared by:
 *  - scripts/merge-duplicate-experts.ts (offline bulk merge of existing dupes)
 *  - lib/finance/expertMatch.ts (extraction-time prevention — reuse instead of create)
 *
 * Both callers MUST use these exact same functions. If the merge script and the
 * prevention path ever disagree on what counts as "the same analyst", the prevention
 * path will keep creating new dupes that the merge script would then classify
 * differently than the ones it already cleaned up — a slow-motion re-divergence bug.
 *
 * ── The hard law ─────────────────────────────────────────────────────────────────
 * SAME NAME DOES NOT MEAN SAME PERSON. Two people can share the exact same name and
 * both write about markets in Indian finance media (see: two different well-known
 * "Nilesh Shah"s — one runs Kotak Mahindra AMC, the other founded Envision Capital).
 * This module NEVER merges purely on name — organization must also confidently match.
 * "Independent" (used by the extractor when an article names an analyst without
 * their firm) is explicitly excluded from matching anything else, even the exact
 * same name — an "Independent" attribution is too weak a signal to safely fold into
 * a named-firm profile, or vice versa. Ambiguous cases always fall through to human
 * review; they are never silently auto-merged. Under-merging (leaving a real dupe
 * unmerged) is an acceptable failure mode here; over-merging (fusing two different
 * real people) is not.
 *
 * ── The merge invariant (founder-confirmed, 2026-08-08) ─────────────────────────
 * "We can have merge on when both analyst's name and firm name is same." AUTO-MERGE
 * requires BOTH of the following, never just one:
 *   (a) SAME NAME — normalized exact match, OR (for the FIRM entity class only, see
 *       expertEntityKind.ts) the guarded subset-containment rule in
 *       nameTokenSubset() ("JM Financial" vs "JM Financial Analysis").
 *   (b) SAME FIRM — organization strings resolve to the same canonical firm via
 *       orgVariantConfidence() (identical / substring / shared-token / alias-map).
 * Name-only NEVER merges — two different "Nilesh Shah"s (Kotak AMC vs Envision
 * Capital) must never fuse just because the name matches. Firm-only NEVER merges —
 * two different analysts who both work at Geojit are two different people, not one.
 * Career-move and Independent-vs-named-org cases (same person, but name+org can't
 * both be algorithmically confirmed without human judgment) are handled by
 * scripts/merge-duplicate-experts.ts's --pairs mode, an explicit founder/orchestrator-
 * reviewed list — never auto-merged by the clusterer.
 */

import { canonicalizeOrgPhrase, FIRM_ALIAS_TOKENS, isKnownFirmAlias } from "@predict-future/business-rules/experts/firmAliases";

// ─── Name normalization ─────────────────────────────────────────────────────────

/**
 * Normalizes an Expert.name for clustering: NFKC, lowercase, punctuation stripped
 * (Unicode-aware — keeps letters/digits from any script, not just ASCII), whitespace
 * collapsed. This is the ONLY signal used to group experts into "possibly the same
 * person" candidate clusters — organization confidence (below) decides whether a
 * cluster is safe to actually merge.
 */
export function normalizeExpertName(name: string): string {
  return name
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// ─── Near-duplicate name matching (round 2, 2026-08-08) ─────────────────────────

/** Minimum token count (on the SMALLER side) for the subset-name rule to apply.
 *  Guards against a single shared given/family name being "enough" — e.g. "Shah"
 *  alone must never be treated as a near-duplicate of "Rahul Shah"; a bare 1-token
 *  name carries far too little identifying signal on its own. */
const MIN_SUBSET_NAME_TOKENS = 2;

/**
 * True when one normalized name's token set is a proper subset of the other's — the
 * founder's "JM Financial" ⊂ "JM Financial Analysis" case, generalized. This is a
 * NAME-only signal; per the merge invariant (see module doc), a caller must ALSO
 * confirm the org test before treating two differently-spelled names as the same
 * analyst. Deliberately guarded against the "Rahul Shah" ⊂ "Rahul Shah Gupta"
 * landmine — two DIFFERENT real people can easily share a first+last name that is a
 * strict prefix of a third person's fuller name:
 *   - both sides must have >= MIN_SUBSET_NAME_TOKENS tokens (no single-token asks)
 *   - equal token counts never match here (that's exact-normalized-name territory,
 *     handled separately, not a "subset" relationship)
 *   - callers MUST additionally require the org test to pass (or the FIRM entity
 *     class, where org-as-analyst rows for the same firm are always the same
 *     analyst by construction) before merging on this alone.
 */
export function nameTokenSubset(normalizedNameA: string, normalizedNameB: string): boolean {
  const tokensA = normalizedNameA.split(" ").filter(Boolean);
  const tokensB = normalizedNameB.split(" ").filter(Boolean);
  if (tokensA.length < MIN_SUBSET_NAME_TOKENS || tokensB.length < MIN_SUBSET_NAME_TOKENS) return false;
  if (tokensA.length === tokensB.length) return false;

  const [smaller, larger] = tokensA.length < tokensB.length ? [tokensA, tokensB] : [tokensB, tokensA];
  const largerSet = new Set(larger);
  return smaller.every((t) => largerSet.has(t));
}

// ─── Organization variant matching ──────────────────────────────────────────────

/**
 * Generic finance-sector / corporate-suffix / web-domain words that carry no
 * brand-identifying signal on their own. Stripped before token-overlap matching so
 * that a single shared GENERIC word (e.g. "wealth", "research", "capital") can never
 * be mistaken for two orgs being the same firm — only a shared DISTINCTIVE brand
 * token (e.g. "geojit", "carnelian", "nuvama", "sbi", "kotak") can do that.
 *
 * Deliberately broad. A stopword missing from this list makes the matcher too
 * permissive (false-merge risk); an extra stopword just means one more real dupe
 * falls through to manual review instead of being auto-merged (safe). When in
 * doubt, add the word here.
 */
const ORG_STOPWORDS = new Set([
  // From the founder's brief — exact list.
  "ltd", "limited", "pvt", "private", "securities", "capital", "financial",
  "services", "asset", "management", "amc", "india", "institutional",
  "equities", "market", "markets", "and", "by", "the",
  // Additional generic finance-sector descriptors — reduce false-positive
  // single-token matches between genuinely unrelated firms that happen to both
  // be, say, "... Wealth ..." or "... Research ...".
  "finance", "service", "assets", "group", "global", "holdings", "wealth",
  "research", "advisors", "advisor", "advisory", "consultants", "consultancy",
  "brokers", "broking", "brokerage", "trading", "investment", "investments",
  "fund", "funds", "mf", "mutual", "partners", "associates", "llp", "inc",
  "corp", "corporation", "co", "company",
  // Web/domain noise — org strings sometimes carry a URL-ish fragment
  // ("strike.money and indiacharts.com").
  "com", "www", "in", "of", "for",
]);

/** Minimum length for a single shared token to count as a confident brand match.
 *  Below this, a token is more likely a generic acronym fragment than a distinctive
 *  brand (chosen from real prod/dev data: "sbi" at 3 chars must match, but shorter
 *  2-letter fragments like stray initials are too weak a signal on their own). */
const MIN_SHARED_TOKEN_LENGTH = 3;

/** Minimum length (per side) for the squashed-substring containment rule. Guards
 *  against short, low-information strings matching everything by accident. */
const MIN_SQUASH_LENGTH = 4;

/** Splits camelCase/PascalCase boundaries into separate words before tokenizing,
 *  so brand names written as one CamelCase word (e.g. "IndiaCharts") still token-
 *  match against a spaced-out or punctuated variant of the same name. */
function splitCamelCase(value: string): string {
  return value.replace(/([a-z0-9])([A-Z])/g, "$1 $2");
}

/** Lowercase, NFKC-normalized, whitespace-collapsed org string — used for the
 *  cheap "identical after cosmetic normalization" check (case/whitespace-only
 *  differences, extremely common: "ShareKhan" vs "Sharekhan"). */
function normalizeOrgBase(org: string): string {
  return org
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** All non-alphanumeric characters removed entirely (no spaces) — used for the
 *  substring-containment rule that catches suffix variants like "Geojit
 *  Investments" vs "Geojit Investments Limited" (identical prefix, one has an
 *  extra legal-suffix word tacked on). */
function squashOrg(org: string): string {
  return org.normalize("NFKC").toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");
}

/** Tokenizes a string into distinctive (non-stopword, length >= 2) words, after
 *  camelCase-splitting and punctuation-stripping. Alias-expansion-free — used both
 *  as the raw tokenizer and, internally, to tokenize an alias's canonical target. */
function tokenizeOrgRaw(org: string): string[] {
  const spaced = splitCamelCase(org).normalize("NFKC").toLowerCase();
  const cleaned = spaced.replace(/[^\p{L}\p{N}]+/gu, " ").trim();
  if (!cleaned) return [];
  return cleaned.split(/\s+/).filter((t) => t.length >= 2 && !ORG_STOPWORDS.has(t));
}

/**
 * Tokenizes an org string the same way tokenizeOrgRaw does, but additionally
 * expands any bare acronym token found in FIRM_ALIAS_TOKENS (lib/finance/
 * firmAliases.ts) into the canonical org's own real brand tokens — e.g. "mofsl"
 * (from org string "MOFSL" or "MOFSL Institutional") expands to
 * {"motilal","oswal"} (from "Motilal Oswal Financial Services", with the generic
 * "financial"/"services" stopwords dropped same as any other org string). This
 * lets the existing shared-distinctive-token rule below do the actual matching —
 * no separate acronym-matching code path needed, and it composes correctly with
 * org strings that mix an acronym with other real words (e.g. "ABSL Mutual Fund").
 */
function tokenizeOrg(org: string): string[] {
  const raw = tokenizeOrgRaw(org);
  const expanded = new Set<string>();
  for (const t of raw) {
    const aliasTarget = FIRM_ALIAS_TOKENS[t];
    if (aliasTarget) {
      for (const ct of tokenizeOrgRaw(aliasTarget)) expanded.add(ct);
    } else {
      expanded.add(t);
    }
  }
  return [...expanded];
}

/**
 * Confident-match test for two organization strings belonging to Expert rows that
 * ALREADY share the same normalized name. Returns true only when the two orgs are
 * almost certainly spelling/formatting variants of the SAME firm — never a fuzzy
 * "probably related" signal. Anything not caught here is left for human review.
 *
 * Rules (first match wins):
 *  1. Identical after cosmetic normalization (case/whitespace only) — e.g.
 *     "ShareKhan" vs "Sharekhan".
 *  2. "Independent" is excluded from matching ANYTHING else, including itself
 *     compared against a different org — see the module doc's hard law.
 *  3. Squashed (all-punctuation-removed) substring containment, e.g. "Geojit
 *     Investments" is a prefix of "Geojit Investments Limited".
 *  4. Any single shared distinctive (non-stopword, length >= 3) token, e.g.
 *     "SBI Cap Securities" / "SBI Securities" share "sbi"; "Carnelian Asset
 *     Management" / "Carnelian Asset Management & Advisors" share "carnelian".
 *     This is also what makes transitive bridging work within a name-cluster:
 *     "Strike Money Analytics and Indiacharts" and "strike.money and
 *     indiacharts.com" both share {strike, money, indiacharts} even though
 *     neither is a substring of the other.
 *
 * Round 2 (2026-08-08) added a curated alias map (lib/finance/firmAliases.ts) for
 * exactly the acronym-expansion gap called out above — "ABSL AMC" vs "Aditya Birla
 * Sun Life AMC" now DOES auto-match, via a deliberately narrow, human-curated list
 * rather than a general acronym-guessing algorithm (which would be its own false-
 * positive liability). Any acronym NOT in that curated list still falls through to
 * REVIEW exactly as before — an intentional, safe under-merge, not a bug.
 */
export type OrgVariantReason = "identical" | "substring" | "shared-token" | null;

/**
 * Reason-tagged version of the org-variant test — same rules as orgVariantConfidence
 * (which is now a thin wrapper around this), but also reports WHICH rule proved the
 * match. Alias resolution (phrase-level via canonicalizeOrgPhrase, token-level via
 * tokenizeOrg's FIRM_ALIAS_TOKENS expansion) happens transparently inside the
 * "identical" and "shared-token" checks — a match that only succeeded because of an
 * alias still reports as "identical" or "shared-token" (the alias is what MADE the
 * strings identical/token-overlapping; it is not a fourth, separate rule). Callers
 * that need to know alias involvement specifically can check whether either input
 * differs from its canonicalizeOrgPhrase()/tokenizeOrg() form.
 */
export function orgVariantMatch(orgAInput: string, orgBInput: string): { match: boolean; reason: OrgVariantReason } {
  const orgA = canonicalizeOrgPhrase(orgAInput);
  const orgB = canonicalizeOrgPhrase(orgBInput);

  const baseA = normalizeOrgBase(orgA);
  const baseB = normalizeOrgBase(orgB);

  if (!baseA || !baseB) return { match: false, reason: null };
  if (baseA === baseB) return { match: true, reason: "identical" };
  if (baseA === "independent" || baseB === "independent") return { match: false, reason: null };

  const squashA = squashOrg(orgA);
  const squashB = squashOrg(orgB);
  if (
    squashA.length >= MIN_SQUASH_LENGTH &&
    squashB.length >= MIN_SQUASH_LENGTH &&
    (squashA.includes(squashB) || squashB.includes(squashA))
  ) {
    return { match: true, reason: "substring" };
  }

  const tokensA = tokenizeOrg(orgA);
  const tokensB = new Set(tokenizeOrg(orgB));
  for (const t of tokensA) {
    if (t.length >= MIN_SHARED_TOKEN_LENGTH && tokensB.has(t)) return { match: true, reason: "shared-token" };
  }

  return { match: false, reason: null };
}

/** Boolean-only convenience wrapper around orgVariantMatch() — the common case for
 *  callers (clusterOrgVariants, expertMatch.ts) that only need yes/no. */
export function orgVariantConfidence(orgA: string, orgB: string): boolean {
  return orgVariantMatch(orgA, orgB).match;
}

/** Human-facing evidence categories for a confirmed org match — what
 * scripts/merge-duplicate-experts.ts prints per auto-merge group so an orchestrator
 * reviewing the dry-run plan can see WHICH rule proved the firm match, per the
 * founder's ask for per-merge evidence. "alias-map" takes priority in the label
 * whenever the firm-alias map (lib/finance/firmAliases.ts) was involved in either
 * input — even though, mechanically, an alias match still resolves via the
 * "identical" or "shared-token" rule (see orgVariantMatch's doc comment), an
 * orchestrator reviewing "MOFSL" merged into "Motilal Oswal Financial Services"
 * wants to see that a curated alias made the call, not read it as a coincidental
 * plain shared-token match. */
export type OrgMatchEvidence = "identical" | "substring" | "shared-token" | "alias-map";

/** True when tokenizing `org` the plain way (no alias expansion) yields at least one
 *  token that IS a known bare-acronym alias key — i.e. alias expansion would change
 *  this org string's token set. Used only for evidence reporting below; the actual
 *  matching in orgVariantMatch always uses the alias-expanding tokenizeOrg(). */
function orgHasAliasToken(org: string): boolean {
  return tokenizeOrgRaw(org).some((t) => t in FIRM_ALIAS_TOKENS);
}

export function describeOrgMatchEvidence(
  orgAInput: string,
  orgBInput: string
): { match: boolean; evidence: OrgMatchEvidence | null } {
  const raw = orgVariantMatch(orgAInput, orgBInput);
  if (!raw.match) return { match: false, evidence: null };

  const aliasInvolved =
    isKnownFirmAlias(orgAInput) ||
    isKnownFirmAlias(orgBInput) ||
    canonicalizeOrgPhrase(orgAInput) !== orgAInput ||
    canonicalizeOrgPhrase(orgBInput) !== orgBInput ||
    orgHasAliasToken(orgAInput) ||
    orgHasAliasToken(orgBInput);

  return { match: true, evidence: aliasInvolved ? "alias-map" : (raw.reason as OrgMatchEvidence) };
}

// ─── Union-find clustering within a name-group ──────────────────────────────────

/** Simple union-find (disjoint-set) with path compression, sized for the small
 *  (typically < 10 members) name-groups this runs on. Exported so
 *  scripts/merge-duplicate-experts.ts can reuse it for the round-2 cross-name-group
 *  union pass (nameTokenSubset below) instead of hand-rolling a second copy. */
export class UnionFind {
  private parent: number[];
  constructor(size: number) {
    this.parent = Array.from({ length: size }, (_, i) => i);
  }
  find(i: number): number {
    if (this.parent[i] !== i) this.parent[i] = this.find(this.parent[i]!);
    return this.parent[i]!;
  }
  union(a: number, b: number): void {
    const ra = this.find(a);
    const rb = this.find(b);
    if (ra !== rb) this.parent[ra] = rb;
  }
}

/**
 * Groups a list of organization strings (all belonging to experts sharing the same
 * normalized name) into connected components via orgVariantConfidence, run as a
 * graph over ALL pairs (not just adjacent ones) so a third "bridge" variant can
 * transitively connect two orgs that don't directly match each other — e.g.
 * "Strike Money Analytics and Indiacharts" and "strike.money and indiacharts.com"
 * both independently match a middle "Strike Money Analytics & Indiacharts" even
 * in cases where two endpoints alone wouldn't.
 *
 * Returns an array of index-groups (indices into the input `orgs` array). A
 * component of size 1 means that org didn't confidently match ANY other org
 * sharing the same name — it must be routed to REVIEW, never auto-merged alone.
 */
export function clusterOrgVariants(orgs: string[]): number[][] {
  const uf = new UnionFind(orgs.length);
  for (let i = 0; i < orgs.length; i++) {
    for (let j = i + 1; j < orgs.length; j++) {
      if (orgVariantConfidence(orgs[i]!, orgs[j]!)) {
        uf.union(i, j);
      }
    }
  }
  const groups = new Map<number, number[]>();
  for (let i = 0; i < orgs.length; i++) {
    const root = uf.find(i);
    const arr = groups.get(root) ?? [];
    arr.push(i);
    groups.set(root, arr);
  }
  return [...groups.values()];
}

/**
 * Picks the "most complete" organization string among a set of confirmed variants
 * — the longest after cosmetic normalization, tiebroken by raw string length. The
 * intuition: a longer variant is usually the more formal/complete legal name
 * ("Geojit Investments Limited" over "Geojit Investments" over "Geojit").
 *
 * "Independent" is deliberately EXCLUDED from ever winning this comparison against
 * a real alternative, even though it's often textually longer than a short real org
 * ("Independent" is 11 characters, longer than e.g. "ET Now" at 6) — per this
 * module's hard law, "Independent" is a structurally weak, non-informative
 * placeholder, never the "most complete" identity for an analyst who ALSO has a
 * genuinely named org among the candidates (a real case caught during round-2
 * --pairs mode review: "Swaminathan Aiyar" merging "ET Now" + "Independent" must
 * keep "ET Now", not silently regress to "Independent" just because it's a longer
 * string). Only falls back to treating "Independent" normally if every candidate
 * IS "Independent" (a degenerate input that should not occur in a real merge group,
 * since orgVariantConfidence never clusters "Independent" with anything else).
 */
export function pickBestOrgString(orgs: string[]): string {
  const real = orgs.filter((o) => normalizeOrgBase(o) !== "independent");
  const candidates = real.length > 0 ? real : orgs;
  return [...candidates].sort((a, b) => {
    const lenDiff = normalizeOrgBase(b).length - normalizeOrgBase(a).length;
    if (lenDiff !== 0) return lenDiff;
    return b.length - a.length;
  })[0]!;
}
