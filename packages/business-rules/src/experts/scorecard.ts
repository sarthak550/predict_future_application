/**
 * Analyst Scorecard — shared pure logic for public track-record surfaces.
 *
 * Consumed by:
 *  - apps/api/lib/finance/publicProfile.ts (wraps apps/api/lib/finance/credibility.ts,
 *    and imports the constants/helpers below for the public "indexable" decision)
 *  - apps/web/lib/finance/publicProfile.ts (apps/web cannot import apps/api's server
 *    code, so it uses `computeScorecard` here as the portable equivalent of
 *    computeCredibilityScore — the two MUST be kept in exact numeric agreement;
 *    do not change one without the other)
 *
 * Nothing here talks to Prisma or any DB — everything takes plain arrays of DTOs so it
 * is trivially unit-testable and safe to share across apps.
 */

// ─── Score thresholds ───────────────────────────────────────────────────────────

/**
 * Minimum resolved (HIT + MISS) calls before we show a hit-rate percentage at all.
 * Below this, the UI shows "building a track record" instead of a number.
 * MUST match the gate in apps/api/lib/finance/credibility.ts (resolvedCount < 3).
 */
export const PROVISIONAL_MIN_RESOLVED_CALLS = 3;

/**
 * Minimum resolved (HIT + MISS) calls before a profile is indexable (search-engine
 * visible). Below this, the profile still renders (reachable by direct URL / shared
 * link) but is served with a `noindex` robots directive and excluded from the
 * sitemap and the public directory listing. Chosen higher than the provisional
 * threshold (3) so indexed pages always show a real percentage, never "building a
 * track record" to Googlebot.
 */
export const INDEXABLE_MIN_RESOLVED_CALLS = 5;

export function isIndexableProfile(resolvedCount: number): boolean {
  return resolvedCount >= INDEXABLE_MIN_RESOLVED_CALLS;
}

// ─── Hit-rate scorecard ─────────────────────────────────────────────────────────

export type ScorecardResolutionStatus = "PENDING" | "RESOLVED_HIT" | "RESOLVED_MISS" | "NOT_GRADED" | string;

export interface ScorecardOpinion {
  resolutionStatus: ScorecardResolutionStatus;
}

export interface ScorecardResult {
  hitRate: number | null;
  resolvedCount: number;
  hitCount: number;
  missCount: number;
  provisional: boolean;
}

/**
 * Portable re-implementation of apps/api/lib/finance/credibility.ts#computeCredibilityScore.
 * Duplicated (not imported) because packages/* cannot depend on apps/api's server code.
 * Score = RESOLVED_HIT / (RESOLVED_HIT + RESOLVED_MISS). Returns hitRate=null with
 * provisional=true when resolvedCount < PROVISIONAL_MIN_RESOLVED_CALLS.
 *
 * KEEP THIS IN NUMERIC LOCKSTEP WITH computeCredibilityScore — any change to the hit-rate
 * formula must be made in both places.
 */
export function computeScorecard(opinions: ScorecardOpinion[]): ScorecardResult {
  const resolved = opinions.filter(
    (o) => o.resolutionStatus === "RESOLVED_HIT" || o.resolutionStatus === "RESOLVED_MISS"
  );
  const resolvedCount = resolved.length;

  if (resolvedCount < PROVISIONAL_MIN_RESOLVED_CALLS) {
    return { hitRate: null, resolvedCount, hitCount: 0, missCount: 0, provisional: true };
  }

  const hitCount = resolved.filter((o) => o.resolutionStatus === "RESOLVED_HIT").length;
  const missCount = resolved.filter((o) => o.resolutionStatus === "RESOLVED_MISS").length;

  return { hitRate: hitCount / resolvedCount, resolvedCount, hitCount, missCount, provisional: false };
}

// ─── Wilson confidence interval ─────────────────────────────────────────────────

export interface WilsonInterval {
  /** Lower bound of the 95% CI, as a fraction in [0, 1]. */
  lower: number;
  /** Upper bound of the 95% CI, as a fraction in [0, 1]. */
  upper: number;
}

/** z-score for a 95% confidence interval (two-tailed). Locked per Trust Layer Sprint Decision 2. */
const WILSON_Z_95 = 1.96;

/**
 * Wilson score interval at 95% confidence for a binomial hit rate — Trust Layer Sprint
 * (2026-08-15) Decision 2, formula locked by the founder brief. Given `hitCount` HITs out
 * of `resolvedCount` graded (HIT + MISS) calls, returns the 95% CI on the true underlying
 * hit rate. Unlike a naive normal-approximation interval, Wilson stays well-behaved (and
 * inside [0, 1]) even at small n or at p̂ near 0/1 — exactly the small-sample analyst-track-
 * record case this exists for.
 *
 * Pure, zero-Prisma, unit-tested via `scorecard.selfcheck.ts` (`npm run check` in this
 * package) — does NOT change `computeCredibilityScore`/`computeScorecard`'s hitRate
 * definition or the indexable-profile gate; it is a separate, additive disclosure number
 * consumed by apps/web's accuracy-stat display (Decision 2) and the /methodology page's
 * sample-size explainer (Decision 3).
 *
 * Returns `null` when `resolvedCount === 0` (no graded calls — nothing to compute a CI on;
 * n < PROVISIONAL_MIN_RESOLVED_CALLS callers should already be showing "Building a track
 * record" instead of calling this at all).
 *
 * @example
 *   computeWilsonInterval(4, 6) // founder's own worked example → { lower: ~0.30, upper: ~0.90 }
 */
export function computeWilsonInterval(hitCount: number, resolvedCount: number): WilsonInterval | null {
  if (resolvedCount === 0) return null;

  const z = WILSON_Z_95;
  const phat = hitCount / resolvedCount;
  const zSquared = z * z;

  const center = phat + zSquared / (2 * resolvedCount);
  const margin = z * Math.sqrt(phat * (1 - phat) / resolvedCount + zSquared / (4 * resolvedCount * resolvedCount));
  const denom = 1 + zSquared / resolvedCount;

  // Clamp to [0, 1] — the raw formula can land a hair outside this range (e.g. a
  // -1e-17 "lower" at hitCount=0) purely from floating-point arithmetic, not because
  // the interval is genuinely unbounded.
  const lower = Math.min(1, Math.max(0, (center - margin) / denom));
  const upper = Math.min(1, Math.max(0, (center + margin) / denom));

  return { lower, upper };
}

// ─── Instrument canonicalization ────────────────────────────────────────────────

/**
 * Duplicated from apps/api/lib/finance/instrumentCatalog.ts#NORMALIZATION_MAP so that
 * apps/web (which cannot import apps/api's server code) can group per-instrument
 * breakdowns under the same canonical labels apps/api uses elsewhere. KEEP IN SYNC —
 * if you add a variant to one map, add it to the other.
 */
export const INSTRUMENT_NORMALIZATION_MAP: Record<string, string> = {
  "Nifty 50 Index": "Nifty 50",
  "Nifty IT Index": "Nifty IT",
  "Bank Nifty Index": "Bank Nifty",
  "State Bank of India": "SBI",
  "Larsen & Toubro": "L&T",
  "Gold Futures": "Gold",
  "Crude Oil Futures": "Crude Oil",
};

export function canonicalizeInstrument(label: string): string {
  return INSTRUMENT_NORMALIZATION_MAP[label] ?? label;
}

// ─── Per-instrument breakdown ───────────────────────────────────────────────────

export interface InstrumentOpinion {
  instrument: string | null;
  instrumentTicker: string | null;
  resolutionStatus: ScorecardResolutionStatus;
}

export interface InstrumentBreakdown {
  instrument: string;
  instrumentTicker: string | null;
  hitCount: number;
  missCount: number;
  resolvedCount: number;
  pendingCount: number;
}

/**
 * Groups opinions by canonical instrument label (falling back to the raw ticker, then
 * "Other" for untagged rows) and tallies hit/miss/pending per group. Sorted by
 * resolvedCount desc, then hitCount desc, so the analyst's strongest / most-tracked
 * instruments surface first.
 */
export function buildInstrumentBreakdown(opinions: InstrumentOpinion[]): InstrumentBreakdown[] {
  const groups = new Map<string, InstrumentBreakdown>();

  for (const opinion of opinions) {
    const rawLabel = opinion.instrument?.trim();
    const label = rawLabel ? canonicalizeInstrument(rawLabel) : "Other";
    const key = label;

    let group = groups.get(key);
    if (!group) {
      group = {
        instrument: label,
        instrumentTicker: opinion.instrumentTicker ?? null,
        hitCount: 0,
        missCount: 0,
        resolvedCount: 0,
        pendingCount: 0,
      };
      groups.set(key, group);
    } else if (!group.instrumentTicker && opinion.instrumentTicker) {
      group.instrumentTicker = opinion.instrumentTicker;
    }

    if (opinion.resolutionStatus === "RESOLVED_HIT") {
      group.hitCount += 1;
      group.resolvedCount += 1;
    } else if (opinion.resolutionStatus === "RESOLVED_MISS") {
      group.missCount += 1;
      group.resolvedCount += 1;
    } else if (opinion.resolutionStatus === "PENDING") {
      group.pendingCount += 1;
    }
  }

  return [...groups.values()].sort((a, b) => {
    if (b.resolvedCount !== a.resolvedCount) return b.resolvedCount - a.resolvedCount;
    return b.hitCount - a.hitCount;
  });
}
