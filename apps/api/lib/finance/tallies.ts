import { prisma } from "@/lib/prisma";

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
    total: number;
    userChoice: ImplicationBucket | null;
    medianBucket: 0 | 1 | 2 | 3 | 4 | null;
  };
  retrospective: {
    hit: number;
    miss: number;
    total: number;
    userChoice: "HIT" | "MISS" | null;
    isLocked: boolean;
    unlockReason: string | null;
  };
}

export async function buildTalliesResponse(
  opinionId: string,
  userId: string | null
): Promise<TalliesResponse> {
  const [opinion, votes] = await Promise.all([
    prisma.expertOpinion.findUnique({
      where: { id: opinionId },
      select: { resolutionStatus: true, resolvedAt: true },
    }),
    prisma.expertOpinionVote.findMany({
      where: { opinionId },
      select: { userId: true, pollType: true, choice: true },
    }),
  ]);

  // ── IMPLICATION tallies (5-bucket, backwards-compatible with legacy 3-value votes) ──
  const implVotes = votes.filter((v) => v.pollType === "IMPLICATION");

  const bucketCounts = [0, 0, 0, 0, 0]; // indexed 0-4
  const bucketIndices: number[] = [];

  for (const v of implVotes) {
    const idx = choiceToBucketIndex(v.choice);
    if (idx >= 0 && idx <= 4) {
      bucketCounts[idx]++;
      bucketIndices.push(idx);
    }
  }

  const implTotal = bucketIndices.length;
  const medianBucket = computeMedianBucket(bucketIndices);

  const userImplVote = userId
    ? implVotes.find((v) => v.userId === userId)?.choice ?? null
    : null;
  const normalisedUserChoice = userImplVote
    ? normaliseImplicationChoice(userImplVote)
    : null;

  // ── RETROSPECTIVE tallies (unchanged) ──
  const retroVotes = votes.filter((v) => v.pollType === "RETROSPECTIVE");
  const hit = retroVotes.filter((v) => v.choice === "HIT").length;
  const miss = retroVotes.filter((v) => v.choice === "MISS").length;
  const retroTotal = retroVotes.length;
  const retroUserVote = userId
    ? retroVotes.find((v) => v.userId === userId)?.choice ?? null
    : null;

  const isLocked = !opinion || opinion.resolutionStatus === "PENDING";
  let unlockReason: string | null = null;
  if (!isLocked && opinion) {
    const resLabel =
      opinion.resolutionStatus === "RESOLVED_HIT" ? "HIT" : "MISS";
    const resolvedDate = opinion.resolvedAt
      ? opinion.resolvedAt.toLocaleDateString("en-IN", {
          day: "numeric",
          month: "short",
          year: "numeric",
        })
      : "Unknown date";
    unlockReason = `Resolved ${resLabel} on ${resolvedDate}`;
  }

  return {
    implication: {
      stronglyDisagree: bucketCounts[0],
      disagree: bucketCounts[1],
      neutral: bucketCounts[2],
      agree: bucketCounts[3],
      stronglyAgree: bucketCounts[4],
      total: implTotal,
      userChoice: normalisedUserChoice,
      medianBucket,
    },
    retrospective: {
      hit,
      miss,
      total: retroTotal,
      userChoice: retroUserVote as "HIT" | "MISS" | null,
      isLocked,
      unlockReason,
    },
  };
}
