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
