import { NextResponse } from "next/server";
import { canonicalizeOrgDisplay } from "@predict-future/business-rules/experts/firmAliases";
import { prisma } from "@/lib/prisma";
import { computeCredibilityScore } from "@/lib/finance/credibility";

const TOP_N = 20;
const MIN_THRESHOLD = 3; // min qualifying experts to return a list
/**
 * Cap on how many Expert rows we load before computing credibility. The query
 * pulls the full opinions array per expert, so an unbounded findMany would
 * OOM the lambda once expert count grows large. 2000 is well above the
 * realistic universe of analysts we'd ever feature; we filter + sort + slice
 * down to TOP_N from there.
 */
const MAX_EXPERTS_SCANNED = 2000;

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const orgFilter = searchParams.get("org") ?? undefined;

  // Fetch experts with their opinions — credibility is derived from
  // admin-set resolutionStatus, no vote data required.
  // entityKind: "HUMAN" excludes FIRM entities (publication/desk "org-as-analyst"
  // identities — see lib/finance/expertEntityKind.ts) from the personal-credibility
  // leaderboard, same reasoning as apps/web's /analysts directory: a publication
  // doesn't have an individual track record to rank.
  const experts = await prisma.expert.findMany({
    where: { entityKind: "HUMAN", ...(orgFilter ? { organization: orgFilter } : {}) },
    select: {
      id: true,
      name: true,
      organization: true,
      verified: true,
      bio: true,
      avatarUrl: true,
      opinions: {
        where: { suppressedAt: null },
        select: {
          id: true,
          resolutionStatus: true,
        },
      },
    },
    take: MAX_EXPERTS_SCANNED,
  });

  // Compute credibility for each expert and filter those with >= 5 resolved
  type ScoredExpert = {
    expert: (typeof experts)[number];
    score: number;
    resolvedCount: number;
    hitCount: number;
    missCount: number;
  };

  const qualified: ScoredExpert[] = [];

  for (const expert of experts) {
    const credibility = computeCredibilityScore(expert.opinions);
    if (!credibility.provisional && credibility.score !== null) {
      qualified.push({
        expert,
        score: credibility.score,
        resolvedCount: credibility.resolvedCount,
        hitCount: credibility.hitCount,
        missCount: credibility.missCount,
      });
    }
  }

  // If fewer than MIN_THRESHOLD experts qualify, return empty list
  if (qualified.length < MIN_THRESHOLD) {
    const response = NextResponse.json([]);
    response.headers.set("Cache-Control", "public, max-age=300");
    return response;
  }

  // Sort descending by score, take top N
  qualified.sort((a, b) => b.score - a.score);
  const top = qualified.slice(0, TOP_N);

  const payload = top.map((entry, idx) => ({
    rank: idx + 1,
    expert: {
      id: entry.expert.id,
      name: entry.expert.name,
      organization: canonicalizeOrgDisplay(entry.expert.organization),
      verified: entry.expert.verified,
      bio: entry.expert.bio ?? null,
      avatarUrl: entry.expert.avatarUrl ?? null,
      credibilityScore: entry.score,
      provisional: false,
      totalOpinions: entry.expert.opinions.length,
      resolvedCount: entry.resolvedCount,
      hitCount: entry.hitCount,
      missCount: entry.missCount,
      recentCalls: [],
    },
  }));

  const response = NextResponse.json(payload);
  response.headers.set("Cache-Control", "public, max-age=300");
  return response;
}
