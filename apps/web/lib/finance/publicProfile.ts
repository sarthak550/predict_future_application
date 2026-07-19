/**
 * Public analyst-profile stats for apps/web's SSR pages (app/analysts/**).
 *
 * apps/web cannot import apps/api's server code (separate deployable, separate
 * process), so this composes the same shared pure logic apps/api/lib/finance/
 * publicProfile.ts uses — `computeScorecard` / `isIndexableProfile` /
 * `buildInstrumentBreakdown` from @predict-future/business-rules — instead of
 * duplicating the hit-rate math locally. The two modules MUST stay in agreement on
 * what counts as "indexable"; both read the same INDEXABLE_MIN_RESOLVED_CALLS
 * constant from business-rules, so they always will.
 */

import {
  buildInstrumentBreakdown,
  computeScorecard,
  isIndexableProfile,
  type InstrumentBreakdown,
  type InstrumentOpinion,
} from "@predict-future/business-rules";

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

export function getPublicProfileStats(opinions: PublicProfileOpinion[]): PublicProfileStats {
  const scorecard = computeScorecard(opinions);
  const pendingCount = opinions.filter((o) => o.resolutionStatus === "PENDING").length;
  const notGradedCount = opinions.filter((o) => o.resolutionStatus === "NOT_GRADED").length;

  return {
    hitRate: scorecard.hitRate,
    resolvedCount: scorecard.resolvedCount,
    hitCount: scorecard.hitCount,
    missCount: scorecard.missCount,
    pendingCount,
    notGradedCount,
    perInstrument: buildInstrumentBreakdown(opinions),
    indexable: isIndexableProfile(scorecard.resolvedCount),
  };
}
