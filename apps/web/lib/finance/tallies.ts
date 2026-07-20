import { prisma } from "@/lib/prisma";
import {
  computeVoteTallies,
  type TalliesResponse,
} from "@predict-future/business-rules/finance/voteTallies";

/**
 * Web-side wrapper around the shared pure aggregation math in
 * @predict-future/business-rules/finance/voteTallies. Reads the same
 * ExpertOpinionVote rows apps/api's tallies route reads — web's vote route
 * (lib/finance/votes.ts) writes into the exact same table/pollType, so a call's
 * tallies are always the cross-platform sum of mobile + web votes.
 */
export type { TalliesResponse };

export async function buildTalliesResponse(
  opinionId: string,
  userId: string | null
): Promise<TalliesResponse> {
  const [opinion, implVotes] = await Promise.all([
    prisma.expertOpinion.findUnique({
      where: { id: opinionId },
      select: { resolvedAt: true },
    }),
    prisma.expertOpinionVote.findMany({
      where: { opinionId, pollType: "IMPLICATION" },
      select: { userId: true, choice: true, lockedAt: true },
    }),
  ]);

  return computeVoteTallies(implVotes, {
    userId,
    resolvedAt: opinion?.resolvedAt ?? null,
  });
}
