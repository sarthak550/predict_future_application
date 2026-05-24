export interface CredibilityResult {
  score: number | null;
  resolvedCount: number;
  hitCount: number;
  missCount: number;
  provisional: boolean;
}

type OpinionForCredibility = {
  resolutionStatus: string;
};

/**
 * Compute credibility score for an expert based on resolved opinions.
 * Score = RESOLVED_HIT / (RESOLVED_HIT + RESOLVED_MISS).
 * resolutionStatus is the source of truth — set by auto-resolution.
 *
 * Returns null with provisional=true if resolvedCount < 3.
 */
export function computeCredibilityScore(
  opinions: OpinionForCredibility[]
): CredibilityResult {
  const resolved = opinions.filter(
    (o) => o.resolutionStatus === "RESOLVED_HIT" || o.resolutionStatus === "RESOLVED_MISS"
  );
  const resolvedCount = resolved.length;

  if (resolvedCount < 3) {
    return { score: null, resolvedCount, hitCount: 0, missCount: 0, provisional: true };
  }

  const hitCount = resolved.filter((o) => o.resolutionStatus === "RESOLVED_HIT").length;
  const missCount = resolved.filter((o) => o.resolutionStatus === "RESOLVED_MISS").length;
  const score = hitCount / resolvedCount;

  return { score, resolvedCount, hitCount, missCount, provisional: false };
}
