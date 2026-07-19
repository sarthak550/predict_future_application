/**
 * Public analyst-profile stats (apps/web/app/analysts/[slug]).
 *
 * WRAPS apps/api/lib/finance/credibility.ts#computeCredibilityScore — does not
 * reimplement the hit-rate math. Adds the per-instrument breakdown and the public
 * "indexable" (search-engine-visible) decision on top, using the shared thresholds
 * in @predict-future/business-rules so apps/web's SSR pages agree with this module
 * on exactly which profiles qualify.
 */

import {
  buildInstrumentBreakdown,
  isIndexableProfile,
  type InstrumentBreakdown,
  type InstrumentOpinion,
} from "@predict-future/business-rules";

import { computeCredibilityScore } from "./credibility";

export type PublicProfileOpinion = InstrumentOpinion;

export interface PublicProfileStats {
  hitRate: number | null;
  resolvedCount: number;
  hitCount: number;
  missCount: number;
  pendingCount: number;
  notGradedCount: number;
  perInstrument: InstrumentBreakdown[];
  /** True once resolvedCount >= business-rules' INDEXABLE_MIN_RESOLVED_CALLS. */
  indexable: boolean;
}

/**
 * Computes the full public-profile stat block for one analyst from their opinions.
 * Pure — takes the opinion DTOs, does not touch Prisma.
 */
export function getPublicProfileStats(opinions: PublicProfileOpinion[]): PublicProfileStats {
  const credibility = computeCredibilityScore(opinions);
  const pendingCount = opinions.filter((o) => o.resolutionStatus === "PENDING").length;
  const notGradedCount = opinions.filter((o) => o.resolutionStatus === "NOT_GRADED").length;

  return {
    hitRate: credibility.score,
    resolvedCount: credibility.resolvedCount,
    hitCount: credibility.hitCount,
    missCount: credibility.missCount,
    pendingCount,
    notGradedCount,
    perInstrument: buildInstrumentBreakdown(opinions),
    indexable: isIndexableProfile(credibility.resolvedCount),
  };
}
