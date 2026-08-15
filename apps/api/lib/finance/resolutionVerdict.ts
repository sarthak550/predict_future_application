/**
 * Independent, hand-verified re-implementation of the AI grader's HIT/MISS/NOT_GRADED
 * rule — extracted from apps/api/scripts/audit-resolution-accuracy.ts (Trust Layer
 * Sprint T0, 2026-08-15) so it has exactly one implementation, reused by both that
 * script and scripts/investigate-accuracy-discrepancy.ts, instead of two copies that
 * could silently drift apart.
 *
 * This mirrors VERDICT_SYSTEM_PROMPT in apps/api/lib/ai/evaluateOpinionResolution.ts —
 * it is deliberately a from-scratch re-derivation against real Yahoo prices, not a
 * shared import of the AI prompt itself, because the whole point of an audit script is
 * to check the AI's output against ground truth computed a different way. Keep the
 * NOT_GRADED threshold below in agreement with the prompt's "|pctChange| < 1.5%" rule
 * if that prompt ever changes.
 */

/** The AI's self-described "too close to call" band. Moves smaller than this in either
 *  direction are NOT_GRADED, not counted as a win for anyone. */
export const NOISE_PCT = 1.5;

export type Verdict = "HIT" | "MISS" | "NOT_GRADED";

/**
 * Re-derives what the AI grader's verdict SHOULD be for a given direction + realized
 * price move, independent of what's actually stored in the DB.
 */
export function deriveVerdict(direction: string, pctChange: number): Verdict {
  if (Math.abs(pctChange) < NOISE_PCT) {
    // Below the noise floor — NEUTRAL calls are arguably right when range-bound,
    // but the AI treats sub-threshold moves as NOT_GRADED regardless.
    return direction === "NEUTRAL" ? "HIT" : "NOT_GRADED";
  }
  if (direction === "BULLISH") return pctChange > 0 ? "HIT" : "MISS";
  if (direction === "BEARISH") return pctChange < 0 ? "HIT" : "MISS";
  // NEUTRAL with significant move → MISS (analyst said flat, market moved)
  return "MISS";
}

/** Maps the DB's resolutionStatus enum down to the same Verdict shape deriveVerdict returns. */
export function shortVerdict(s: string): Verdict | "UNKNOWN" {
  if (s === "RESOLVED_HIT") return "HIT";
  if (s === "RESOLVED_MISS") return "MISS";
  if (s === "NOT_GRADED") return "NOT_GRADED";
  return "UNKNOWN";
}
