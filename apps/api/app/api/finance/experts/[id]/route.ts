import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { computeCredibilityScore } from "@/lib/finance/credibility";

export async function GET(
  _request: Request,
  { params }: { params: { id: string } }
) {
  const expert = await prisma.expert.findUnique({
    where: { id: params.id },
    include: {
      opinions: {
        where: { suppressedAt: null },
        orderBy: { publishedAt: "desc" },
      },
      _count: { select: { followers: true } },
    },
  });

  if (!expert) {
    return NextResponse.json({ error: "Expert not found." }, { status: 404 });
  }

  const credibility = computeCredibilityScore(expert.opinions);
  const recentCalls = expert.opinions.slice(0, 5).map((o) => ({
    id: o.id,
    quote: o.quote,
    direction: o.direction,
    publishedAt: o.publishedAt.toISOString(),
    analystCallAt: o.analystCallAt?.toISOString() ?? null,
    resolutionStatus: o.resolutionStatus,
    resolvedAt: o.resolvedAt?.toISOString() ?? null,
    resolutionNote: o.resolutionNote,
  }));

  return NextResponse.json({
    id: expert.id,
    name: expert.name,
    organization: expert.organization,
    verified: expert.verified,
    bio: expert.bio,
    avatarUrl: expert.avatarUrl,
    credibilityScore: credibility.score,
    provisional: credibility.provisional,
    totalOpinions: expert.opinions.length,
    resolvedCount: credibility.resolvedCount,
    followerCount: expert._count.followers,
    hitCount: credibility.hitCount,
    missCount: credibility.missCount,
    recentCalls,
  });
}
