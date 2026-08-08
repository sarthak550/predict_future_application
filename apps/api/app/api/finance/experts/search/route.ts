import { NextResponse } from "next/server";
import { canonicalizeOrgDisplay } from "@predict-future/business-rules/experts/firmAliases";
import { prisma } from "@/lib/prisma";
import { computeCredibilityScore } from "@/lib/finance/credibility";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const q = (searchParams.get("q") ?? "").trim();
  const firmFilter = (searchParams.get("firm") ?? "").trim();

  // A firm filter lets the screen browse a firm's whole roster with no text
  // query typed (founder ask, 2026-08-08: a Firm filter alongside the expert
  // list, not just name-click navigation) — the 2-char gate only applies when
  // there's no firm selected.
  if (q.length < 2 && !firmFilter) {
    return NextResponse.json([]);
  }

  const experts = await prisma.expert.findMany({
    where: q.length >= 2
      ? {
          OR: [
            { name: { contains: q, mode: "insensitive" } },
            { organization: { contains: q, mode: "insensitive" } },
          ],
        }
      : {},
    select: {
      id: true,
      name: true,
      organization: true,
      verified: true,
      avatarUrl: true,
      _count: { select: { followers: true } },
      opinions: {
        where: { suppressedAt: null },
        select: {
          id: true,
          resolutionStatus: true,
        },
      },
    },
    // A firm-only browse (no text query) needs a wider candidate set than a
    // real text search does, since the firm match happens post-canonicalization
    // below — a raw column exact-match would miss legacy rows whose stored
    // value predates the alias map, so we can't push the firm filter into the
    // WHERE clause itself.
    take: firmFilter && q.length < 2 ? 500 : 20,
  });

  let results = experts.map((expert) => {
    const credibility = computeCredibilityScore(expert.opinions);
    return {
      id: expert.id,
      name: expert.name,
      // Canonicalized through the firm-alias map (lib/finance/firmAliases.ts) so a
      // stray pre-merge acronym spelling (e.g. "MOFSL") never displays next to its
      // spelled-out sibling elsewhere in search results.
      organization: canonicalizeOrgDisplay(expert.organization),
      verified: expert.verified,
      avatarUrl: expert.avatarUrl ?? null,
      totalOpinions: expert.opinions.length,
      credibilityScore: credibility.score,
      provisional: credibility.provisional,
      resolvedCount: credibility.resolvedCount,
      followerCount: expert._count.followers,
    };
  });

  if (firmFilter) {
    results = results.filter((r) => r.organization === firmFilter);
  }

  // Sort: verified first, then by opinion count desc
  results.sort((a, b) => {
    if (a.verified !== b.verified) return a.verified ? -1 : 1;
    return b.totalOpinions - a.totalOpinions;
  });

  return NextResponse.json(results.slice(0, 20));
}
