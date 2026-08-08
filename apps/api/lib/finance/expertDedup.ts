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
 */

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

/** Tokenizes an org string into distinctive (non-stopword, length >= 2) words,
 *  after camelCase-splitting and punctuation-stripping. */
function tokenizeOrg(org: string): string[] {
  const spaced = splitCamelCase(org).normalize("NFKC").toLowerCase();
  const cleaned = spaced.replace(/[^\p{L}\p{N}]+/gu, " ").trim();
  if (!cleaned) return [];
  return cleaned.split(/\s+/).filter((t) => t.length >= 2 && !ORG_STOPWORDS.has(t));
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
 * Known, accepted limitation: acronym expansion is NOT attempted (e.g. "ABSL AMC"
 * vs "Aditya Birla Sun Life AMC" will NOT auto-match — "absl" never appears as a
 * literal token in the expanded name). This is deliberate: a hardcoded acronym
 * dictionary is its own maintenance/false-positive liability. These cases fall
 * through to REVIEW, where a human resolves the acronym in seconds — an
 * intentional, safe under-merge, not a bug.
 */
export function orgVariantConfidence(orgA: string, orgB: string): boolean {
  const baseA = normalizeOrgBase(orgA);
  const baseB = normalizeOrgBase(orgB);

  if (!baseA || !baseB) return false;
  if (baseA === baseB) return true;
  if (baseA === "independent" || baseB === "independent") return false;

  const squashA = squashOrg(orgA);
  const squashB = squashOrg(orgB);
  if (
    squashA.length >= MIN_SQUASH_LENGTH &&
    squashB.length >= MIN_SQUASH_LENGTH &&
    (squashA.includes(squashB) || squashB.includes(squashA))
  ) {
    return true;
  }

  const tokensA = tokenizeOrg(orgA);
  const tokensB = new Set(tokenizeOrg(orgB));
  for (const t of tokensA) {
    if (t.length >= MIN_SHARED_TOKEN_LENGTH && tokensB.has(t)) return true;
  }

  return false;
}

// ─── Union-find clustering within a name-group ──────────────────────────────────

/** Simple union-find (disjoint-set) with path compression, sized for the small
 *  (typically < 10 members) name-groups this runs on. */
class UnionFind {
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
 */
export function pickBestOrgString(orgs: string[]): string {
  return [...orgs].sort((a, b) => {
    const lenDiff = normalizeOrgBase(b).length - normalizeOrgBase(a).length;
    if (lenDiff !== 0) return lenDiff;
    return b.length - a.length;
  })[0]!;
}
