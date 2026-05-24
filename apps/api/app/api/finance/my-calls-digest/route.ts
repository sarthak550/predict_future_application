import { NextResponse } from "next/server";

import { getUserIdFromRequest } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export type DigestOpinion = {
  opinionId: string;
  expertId: string;
  expertName: string;
  expertOrganization: string;
  expertVerified: boolean;
  expertAvatarUrl: string | null;
  instrument: string | null;
  instrumentTicker: string | null;
  direction: string;
  quote: string;
  /** PENDING for pending opinions, RESOLVED_HIT/RESOLVED_MISS for resolved. */
  resolutionStatus: "PENDING" | "RESOLVED_HIT" | "RESOLVED_MISS";
  /** ISO string for resolved; null for pending. */
  resolvedAt: string | null;
  /** ISO string when the analyst made the call. */
  publishedAt: string;
  /** ISO string when the user locked their vote. */
  votedAt: string;
  /** The user's raw implication choice, normalised to v3 bucket label */
  userChoice: string;
  /** True when the user agreed (AGREE/STRONGLY_AGREE) and it was a HIT,
   *  or disagreed (DISAGREE/STRONGLY_DISAGREE) and it was a MISS. Null for NEUTRAL or PENDING. */
  userWasCorrect: boolean | null;
  /** True = AGREE/STRONGLY_AGREE bucket; false = DISAGREE/STRONGLY_DISAGREE; null = NEUTRAL */
  userAgreed: boolean | null;
  storyId: string | null;
  storyHeadline: string | null;
};

export type MyCallsDigestResponse = {
  hits: number;
  misses: number;
  /** Resolved opinions the user voted on where choice was NEUTRAL */
  neutrals: number;
  /** Opinions still PENDING (not yet graded) */
  pending: number;
  totalVoted: number;
  resolvedOpinions: DigestOpinion[];
  /** S38: pending opinion details so the My Calls screen can filter to pending. */
  pendingOpinions: DigestOpinion[];
};

function choiceToAgreed(choice: string): boolean | null {
  switch (choice) {
    case "STRONGLY_AGREE":
    case "AGREE":
    case "STRONG_GAIN":
    case "MILD_GAIN":
    case "BULLISH":
      return true;
    case "STRONGLY_DISAGREE":
    case "DISAGREE":
    case "STRONG_DROP":
    case "MILD_DROP":
    case "BEARISH":
      return false;
    default:
      return null; // NEUTRAL / FLAT
  }
}

/**
 * GET /api/finance/my-calls-digest
 *
 * Returns the authenticated user's Poll A voting history with outcomes.
 * Scoped to the past 7 days of resolved opinions for the digest card, but
 * the full resolved history is returned so the detail screen can show all-time.
 *
 * Auth: Bearer JWT required.
 */
export async function GET(request: Request) {
  const userId = await getUserIdFromRequest(request);
  if (!userId) {
    return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  }

  // Fetch all locked IMPLICATION votes for this user (drafts don't count toward the digest)
  const votes = await prisma.expertOpinionVote.findMany({
    where: {
      userId,
      pollType: "IMPLICATION",
      lockedAt: { not: null },
    },
    include: {
      opinion: {
        include: {
          expert: {
            select: {
              id: true,
              name: true,
              organization: true,
              verified: true,
              avatarUrl: true,
            },
          },
          story: {
            select: { id: true, headline: true },
          },
        },
      },
    },
    orderBy: { createdAt: "desc" },
  });

  let hits = 0;
  let misses = 0;
  let neutrals = 0;
  let pending = 0;
  const resolvedOpinions: DigestOpinion[] = [];
  const pendingOpinions: DigestOpinion[] = [];

  for (const vote of votes) {
    const op = vote.opinion;
    const isResolved =
      op.resolutionStatus === "RESOLVED_HIT" || op.resolutionStatus === "RESOLVED_MISS";

    const agreed = choiceToAgreed(vote.choice);
    const baseRow: Omit<DigestOpinion, "resolutionStatus" | "resolvedAt" | "userWasCorrect"> = {
      opinionId: op.id,
      expertId: op.expert.id,
      expertName: op.expert.name,
      expertOrganization: op.expert.organization,
      expertVerified: op.expert.verified,
      expertAvatarUrl: op.expert.avatarUrl ?? null,
      instrument: op.instrument ?? null,
      instrumentTicker: op.instrumentTicker ?? null,
      direction: op.direction,
      quote: op.quote,
      publishedAt: op.publishedAt.toISOString(),
      votedAt: vote.lockedAt!.toISOString(),
      userChoice: vote.choice,
      userAgreed: agreed,
      storyId: op.story?.id ?? null,
      storyHeadline: op.story?.headline ?? null,
    };

    if (!isResolved) {
      pending++;
      pendingOpinions.push({
        ...baseRow,
        resolutionStatus: "PENDING",
        resolvedAt: null,
        userWasCorrect: null,
      });
      continue;
    }

    const isHit = op.resolutionStatus === "RESOLVED_HIT";

    let userWasCorrect: boolean | null = null;
    if (agreed === true) {
      userWasCorrect = isHit;
      if (isHit) hits++; else misses++;
    } else if (agreed === false) {
      userWasCorrect = !isHit;
      if (!isHit) hits++; else misses++;
    } else {
      neutrals++;
    }

    resolvedOpinions.push({
      ...baseRow,
      resolutionStatus: op.resolutionStatus as "RESOLVED_HIT" | "RESOLVED_MISS",
      resolvedAt: op.resolvedAt!.toISOString(),
      userWasCorrect,
    });
  }

  const payload: MyCallsDigestResponse = {
    hits,
    misses,
    neutrals,
    pending,
    totalVoted: votes.length,
    resolvedOpinions,
    pendingOpinions,
  };

  const response = NextResponse.json(payload);
  // Short cache — user sees near-real-time; CDN freshness 30s
  response.headers.set("Cache-Control", "private, max-age=30");
  return response;
}
