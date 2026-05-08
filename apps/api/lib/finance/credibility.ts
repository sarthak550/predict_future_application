export interface CredibilityResult {
  score: number | null;
  resolvedCount: number;
  hitCount: number;
  missCount: number;
  provisional: boolean;
}

type OpinionWithVotes = {
  resolutionStatus: string;
  votes: Array<{ pollType: string; choice: string }>;
};

/**
 * Compute credibility score for an expert based on resolved opinions.
 * Score = proportion of resolved opinions where the majority of retrospective
 * votes (Poll B) said HIT.
 *
 * Returns null with provisional=true if resolvedCount < 5 (not enough signal).
 */
export function computeCredibilityScore(
  opinions: OpinionWithVotes[]
): CredibilityResult {
  const resolved = opinions.filter(
    (o) => o.resolutionStatus === "RESOLVED_HIT" || o.resolutionStatus === "RESOLVED_MISS"
  );
  const resolvedCount = resolved.length;

  if (resolvedCount < 5) {
    return { score: null, resolvedCount, hitCount: 0, missCount: 0, provisional: true };
  }

  let hitCount = 0;
  let missCount = 0;

  for (const opinion of resolved) {
    const retroVotes = opinion.votes.filter((v) => v.pollType === "RETROSPECTIVE");
    if (retroVotes.length === 0) {
      // No retrospective votes — treat as neutral, don't count either way
      continue;
    }
    const hitVotes = retroVotes.filter((v) => v.choice === "HIT").length;
    const isHit = hitVotes > retroVotes.length / 2;
    if (isHit) {
      hitCount++;
    } else {
      missCount++;
    }
  }

  const scoredCount = hitCount + missCount;
  const score = scoredCount > 0 ? hitCount / scoredCount : null;

  return { score, resolvedCount, hitCount, missCount, provisional: false };
}
