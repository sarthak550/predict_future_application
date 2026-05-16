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
        include: {
          votes: { select: { pollType: true, choice: true, userId: true } },
        },
        orderBy: { publishedAt: "desc" },
      },
    },
  });

  if (!expert) {
    return NextResponse.json({ error: "Expert not found." }, { status: 404 });
  }

  const credibility = computeCredibilityScore(expert.opinions);
  const recentCalls = expert.opinions.slice(0, 5).map((o) => {
    const retroVotes = o.votes.filter((v) => v.pollType === "RETROSPECTIVE");
    const hitCount = retroVotes.filter((v) => v.choice === "HIT").length;
    const missCount = retroVotes.filter((v) => v.choice === "MISS").length;
    return {
      id: o.id,
      quote: o.quote,
      direction: o.direction,
      publishedAt: o.publishedAt.toISOString(),
      resolutionStatus: o.resolutionStatus,
      resolvedAt: o.resolvedAt?.toISOString() ?? null,
      resolutionNote: o.resolutionNote,
      retrospectiveTallies: { hit: hitCount, miss: missCount, total: retroVotes.length },
    };
  });

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
    hitCount: credibility.hitCount,
    missCount: credibility.missCount,
    recentCalls,
  });
}
