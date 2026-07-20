/**
 * Expert-opinion "side taking" vote tallies — shared pure aggregation math.
 *
 * Consumed by:
 *  - apps/api/lib/finance/tallies.ts (wraps this with the Prisma read — mobile's
 *    two-step cast/lock vote flow and the admin resolve cutoff both flow through here)
 *  - apps/web/lib/finance/votes.ts (web's one-click auto-lock vote flow — same
 *    ExpertOpinionVote rows, same IMPLICATION pollType, so tallies are always a
 *    cross-platform sum of both surfaces' votes)
 *
 * Nothing here talks to Prisma — everything takes plain arrays of DTOs so it is
 * trivially unit-testable and safe to share across apps. Callers own the DB read
 * and pass in the raw vote rows + the opinion's resolvedAt cutoff.
 */

/**
 * The 5 canonical IMPLICATION bucket values (v3 — agreement axis).
 * Listed in ascending order: index 0 = strongest disagreement, index 4 = strongest agreement.
 */
export const IMPLICATION_BUCKETS = [
  "STRONGLY_DISAGREE",
  "DISAGREE",
  "NEUTRAL",
  "AGREE",
  "STRONGLY_AGREE",
] as const;

export type ImplicationBucket = (typeof IMPLICATION_BUCKETS)[number];

/**
 * Maps all current and legacy IMPLICATION choice strings to a 0-based bucket index.
 *
 *   Current (v3 agreement):     STRONGLY_DISAGREE  DISAGREE  NEUTRAL  AGREE  STRONGLY_AGREE
 *   Legacy (v2 magnitude):      STRONG_DROP        MILD_DROP FLAT     MILD_GAIN STRONG_GAIN
 *   Legacy (v1 direction):      BEARISH            —         NEUTRAL  —         BULLISH
 *
 * Bucket index → label:
 *   0 = STRONGLY_DISAGREE
 *   1 = DISAGREE
 *   2 = NEUTRAL
 *   3 = AGREE
 *   4 = STRONGLY_AGREE
 *
 * Returns -1 for unknown/invalid values so callers can skip them.
 */
export function choiceToBucketIndex(choice: string): number {
  switch (choice) {
    case "STRONGLY_DISAGREE":
    case "STRONG_DROP":
    case "BEARISH":
      return 0;
    case "DISAGREE":
    case "MILD_DROP":
      return 1;
    case "NEUTRAL":
    case "FLAT":
      return 2;
    case "AGREE":
    case "MILD_GAIN":
      return 3;
    case "STRONGLY_AGREE":
    case "STRONG_GAIN":
    case "BULLISH":
      return 4;
    default:
      return -1;
  }
}

/**
 * Normalises a user's raw stored choice (may be a legacy v1 value) to the
 * canonical v2 bucket label. Returns null if the value is unrecognised.
 */
export function normaliseImplicationChoice(
  choice: string
): ImplicationBucket | null {
  const idx = choiceToBucketIndex(choice);
  if (idx === -1) return null;
  return IMPLICATION_BUCKETS[idx] as ImplicationBucket;
}

/**
 * Computes the median bucket index (0-based) from a list of per-vote bucket
 * indices. Uses the lower-median convention: floor((n-1)/2) for a 0-indexed
 * sorted array, which equals floor(n/2) in the original spec.
 *
 * Returns null when the list is empty.
 */
function computeMedianBucket(
  bucketIndices: number[]
): 0 | 1 | 2 | 3 | 4 | null {
  if (bucketIndices.length === 0) return null;
  const sorted = [...bucketIndices].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted[mid] as 0 | 1 | 2 | 3 | 4;
}

export interface TalliesResponse {
  implication: {
    stronglyDisagree: number;
    disagree: number;
    neutral: number;
    agree: number;
    stronglyAgree: number;
    /** Count of locked votes only (these are what bucket counts above are based on). */
    total: number;
    /** Count of unlocked draft votes — shown to nudge users to commit. */
    draftTotal: number;
    userChoice: ImplicationBucket | null;
    /** ISO timestamp when the user locked their vote, null if draft or not voted. */
    userLockedAt: string | null;
    medianBucket: 0 | 1 | 2 | 3 | 4 | null;
  };
}

/** Minimal shape of an ExpertOpinionVote row needed to compute tallies. */
export interface VoteTallyInput {
  userId: string;
  choice: string;
  lockedAt: Date | null;
}

export interface ComputeVoteTalliesOptions {
  /** The current viewer's userId, or null when unauthenticated / computing anonymously. */
  userId: string | null;
  /**
   * The opinion's resolvedAt timestamp, or null if still PENDING. When set, only
   * votes locked strictly before this moment count toward the public tallies —
   * belt-and-suspenders against post-resolution writes slipping in via a bug /
   * manual DB edit / un-resolve flow. The vote-cast endpoints already reject
   * post-resolution writes at the API layer.
   */
  resolvedAt: Date | null;
}

/**
 * Pure aggregation: turns a flat list of ExpertOpinionVote rows for a single
 * opinion + IMPLICATION pollType into the public tallies response. Only locked
 * votes contribute to bucket counts / median (the public consensus signal);
 * unlocked draft votes are counted separately in draftTotal.
 */
export function computeVoteTallies(
  votes: VoteTallyInput[],
  { userId, resolvedAt }: ComputeVoteTalliesOptions
): TalliesResponse {
  const cutoff = resolvedAt ?? null;

  const bucketCounts = [0, 0, 0, 0, 0];
  const bucketIndices: number[] = [];
  let draftTotal = 0;

  for (const v of votes) {
    const idx = choiceToBucketIndex(v.choice);
    if (idx < 0 || idx > 4) continue;
    if (v.lockedAt && (!cutoff || v.lockedAt < cutoff)) {
      bucketCounts[idx]++;
      bucketIndices.push(idx);
    } else if (!v.lockedAt) {
      draftTotal++;
    }
  }

  const userVote = userId ? votes.find((v) => v.userId === userId) ?? null : null;
  const normalisedUserChoice = userVote
    ? normaliseImplicationChoice(userVote.choice)
    : null;

  return {
    implication: {
      stronglyDisagree: bucketCounts[0],
      disagree: bucketCounts[1],
      neutral: bucketCounts[2],
      agree: bucketCounts[3],
      stronglyAgree: bucketCounts[4],
      total: bucketIndices.length,
      draftTotal,
      userChoice: normalisedUserChoice,
      userLockedAt: userVote?.lockedAt?.toISOString() ?? null,
      medianBucket: computeMedianBucket(bucketIndices),
    },
  };
}
