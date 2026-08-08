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
  // "firm" is the current param name (matches the mobile Firm filter, founder
  // ask 2026-08-08); "org" is kept as a fallback for any existing caller.
  const firmFilter = searchParams.get("firm") ?? searchParams.get("org") ?? undefined;

  // Fetch experts with their opinions — credibility is derived from
  // admin-set resolutionStatus, no vote data required.
  // entityKind: "HUMAN" excludes FIRM entities (publication/desk "org-as-analyst"
  // identities — see lib/finance/expertEntityKind.ts) from the personal-credibility
  // leaderboard, same reasoning as apps/web's /analysts directory: a publication
  // doesn't have an individual track record to rank.
  //
  // The firm filter is applied AFTER fetch, against the canonicalized display
  // name (not a raw-column WHERE) — a raw exact match would miss legacy rows
  // whose stored organization predates the firm-alias map.
  const experts = await prisma.expert.findMany({
    where: { entityKind: "HUMAN" },
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

  let qualified: ScoredExpert[] = [];

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

  if (firmFilter) {
    qualified = qualified.filter((entry) => canonicalizeOrgDisplay(entry.expert.organization) === firmFilter);
  }

  // If fewer than MIN_THRESHOLD experts qualify, return empty list. Skipped
  // when a firm filter is active — a single firm legitimately having 1-2
  // qualified analysts is still a meaningful answer to "who's from this firm,"
  // unlike the unfiltered top-of-market leaderboard this threshold protects.
  if (qualified.length < MIN_THRESHOLD && !firmFilter) {
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
