import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { computeCredibilityScore } from "@/lib/finance/credibility";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const q = (searchParams.get("q") ?? "").trim();

  if (q.length < 2) {
    return NextResponse.json([]);
  }

  const experts = await prisma.expert.findMany({
    where: {
      OR: [
        { name: { contains: q, mode: "insensitive" } },
        { organization: { contains: q, mode: "insensitive" } },
      ],
    },
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
          votes: {
            where: { pollType: "RETROSPECTIVE" },
            select: { pollType: true, choice: true },
          },
        },
      },
    },
    take: 20,
  });

  const results = experts.map((expert) => {
    const credibility = computeCredibilityScore(expert.opinions);
    return {
      id: expert.id,
      name: expert.name,
      organization: expert.organization,
      verified: expert.verified,
      avatarUrl: expert.avatarUrl ?? null,
      totalOpinions: expert.opinions.length,
      credibilityScore: credibility.score,
      provisional: credibility.provisional,
      resolvedCount: credibility.resolvedCount,
      followerCount: expert._count.followers,
    };
  });

  // Sort: verified first, then by opinion count desc
  results.sort((a, b) => {
    if (a.verified !== b.verified) return a.verified ? -1 : 1;
    return b.totalOpinions - a.totalOpinions;
  });

  return NextResponse.json(results);
}
