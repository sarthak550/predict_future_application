/**
 * A signed-in user's own IMPLICATION-vote accuracy — /profile's "My Takes"
 * aggregate stat (User Profile Page brief, Ticket 3).
 *
 * MIRRORS (does not import — apps/web cannot import apps/api's server code,
 * same constraint documented at the top of lib/finance/publicProfile.ts)
 * apps/api/lib/notifyOpinionResolution.ts#computeUserOpinionAccuracyDetailed:
 * same vote filter (locked IMPLICATION votes only), same bucketing
 * (implicationChoiceToAgreement / choiceToAgreed in my-calls-digest/route.ts),
 * same "neutral excluded from both numerator and denominator" rule. KEEP IN
 * SYNC — if the bucketing map changes on the api side, mirror the change
 * here, same convention publicProfile.ts/scorecard.ts already use for the
 * analyst-side duplication.
 *
 * Deliberately pure (no Prisma) and shaped to feed straight into
 * accuracy-stat.tsx's `AccuracyPercent`/`AccuracyCaption` (`{ hitCount,
 * resolvedCount }`) — a user's own accuracy claim gets zero more statistical
 * confidence than the analysts they're grading, no separate formatting path.
 */

export type VoteAgreement = "AGREED" | "DISAGREED" | "NEUTRAL";

/** Same bucket map as computeUserOpinionAccuracyDetailed / choiceToAgreed. */
export function implicationChoiceToAgreement(choice: string): VoteAgreement {
  switch (choice) {
    case "STRONGLY_AGREE":
    case "AGREE":
    case "STRONG_GAIN":
    case "MILD_GAIN":
    case "BULLISH":
      return "AGREED";
    case "STRONGLY_DISAGREE":
    case "DISAGREE":
    case "STRONG_DROP":
    case "MILD_DROP":
    case "BEARISH":
      return "DISAGREED";
    default:
      return "NEUTRAL";
  }
}

export type UserAccuracyVote = {
  choice: string;
  opinion: { resolutionStatus: string };
};

export interface UserAccuracyStats {
  hitCount: number;
  resolvedCount: number;
}

/**
 * Takes the user's locked IMPLICATION votes (already joined to their
 * opinions' resolutionStatus by the caller's query — see
 * lib/finance/profile.ts#getMyTakes) and returns `{ hitCount, resolvedCount }`
 * over the graded (HIT/MISS), non-neutral subset — the exact denominator
 * `computeUserOpinionAccuracyDetailed` uses for "Your accuracy is now X%" in
 * the resolution notification.
 */
export function computeUserAccuracy(votes: UserAccuracyVote[]): UserAccuracyStats {
  const graded = votes.filter(
    (v) => v.opinion.resolutionStatus === "RESOLVED_HIT" || v.opinion.resolutionStatus === "RESOLVED_MISS"
  );
  const scoreable = graded.filter((v) => implicationChoiceToAgreement(v.choice) !== "NEUTRAL");

  const hitCount = scoreable.filter((v) => {
    const agreement = implicationChoiceToAgreement(v.choice);
    const isHit = v.opinion.resolutionStatus === "RESOLVED_HIT";
    return (agreement === "AGREED" && isHit) || (agreement === "DISAGREED" && !isHit);
  }).length;

  return { hitCount, resolvedCount: scoreable.length };
}
