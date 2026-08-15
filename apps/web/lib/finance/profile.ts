/**
 * Queries backing /profile (User Profile Page brief, 2026-08-15 — see
 * .claude/agent-memory/ceo-product-strategist/cto_assignment_brief_user_profile_page.md).
 *
 * Reconnect-not-construct: `getMyAnalysts` is the same per-expert accuracy
 * call `fetchIndexableAnalysts` (lib/finance/analysts.ts) already makes,
 * just scoped through ExpertFollow to the signed-in user's followed set
 * instead of the full directory — so a "My Analysts" card and that expert's
 * own /analysts/[slug] page can never show different numbers.
 */

import type { OpinionDirection, OpinionResolutionStatus } from "@prisma/client";

import { prisma } from "@/lib/prisma";
import { canonicalizeOrgDisplay } from "@predict-future/business-rules/experts/firmAliases";
import { getPublicProfileStats, type PublicProfileStats } from "@/lib/finance/publicProfile";

export type MyAnalyst = {
  followId: string;
  expertId: string;
  slug: string | null;
  name: string;
  organization: string;
  verified: boolean;
  avatarUrl: string | null;
  stats: PublicProfileStats;
};

export async function getMyAnalysts(userId: string): Promise<MyAnalyst[]> {
  const follows = await prisma.expertFollow.findMany({
    where: { userId },
    include: {
      expert: {
        select: {
          id: true,
          slug: true,
          name: true,
          organization: true,
          verified: true,
          avatarUrl: true,
          opinions: {
            where: { suppressedAt: null },
            select: { resolutionStatus: true, instrument: true, instrumentTicker: true },
          },
        },
      },
    },
    orderBy: { createdAt: "desc" },
  });

  return follows.map((follow) => ({
    followId: follow.id,
    expertId: follow.expert.id,
    slug: follow.expert.slug,
    name: follow.expert.name,
    organization: canonicalizeOrgDisplay(follow.expert.organization),
    verified: follow.expert.verified,
    avatarUrl: follow.expert.avatarUrl,
    stats: getPublicProfileStats(follow.expert.opinions),
  }));
}

export type MyTakeVote = {
  id: string;
  choice: string;
  lockedAt: Date;
  opinion: {
    id: string;
    resolutionStatus: OpinionResolutionStatus;
    resolvedAt: Date | null;
    publishedAt: Date;
    direction: OpinionDirection;
    quote: string;
    instrument: string | null;
    instrumentTicker: string | null;
    expert: {
      name: string;
      organization: string;
      verified: boolean;
      avatarUrl: string | null;
    };
  };
};

/**
 * The user's full locked-IMPLICATION-vote history — functionally the
 * web-side port of apps/api/app/api/finance/my-calls-digest/route.ts's own
 * query (reused/ported rather than re-invented; apps/web cannot call
 * apps/api's route directly, cross-origin — same reasoning
 * app/api/finance/experts/[id]/follow/route.ts documents at its own top).
 * Newest vote first. Feeds both the "My Takes" row list and, via
 * lib/finance/userAccuracy.ts#computeUserAccuracy, the aggregate accuracy
 * stat — one query, two consumers, so the list and the headline number can
 * never disagree with each other.
 */
export async function getMyTakes(userId: string): Promise<MyTakeVote[]> {
  const votes = await prisma.expertOpinionVote.findMany({
    where: {
      userId,
      pollType: "IMPLICATION",
      lockedAt: { not: null },
    },
    select: {
      id: true,
      choice: true,
      lockedAt: true,
      opinion: {
        select: {
          id: true,
          resolutionStatus: true,
          resolvedAt: true,
          publishedAt: true,
          direction: true,
          quote: true,
          instrument: true,
          instrumentTicker: true,
          expert: {
            select: { name: true, organization: true, verified: true, avatarUrl: true },
          },
        },
      },
    },
    orderBy: { lockedAt: "desc" },
  });

  // lockedAt is guaranteed non-null by the `{ not: null }` filter above —
  // Prisma's generated type can't express that, so narrow it here once
  // rather than at every call site.
  return votes.map((vote) => ({
    ...vote,
    lockedAt: vote.lockedAt as Date,
    opinion: {
      ...vote.opinion,
      expert: { ...vote.opinion.expert, organization: canonicalizeOrgDisplay(vote.opinion.expert.organization) },
    },
  }));
}
