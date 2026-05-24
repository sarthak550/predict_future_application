import { NextResponse } from "next/server";
import { getUserIdFromRequest } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function GET(
  request: Request,
  { params }: { params: { id: string } }
) {
  // Auth optional — header read so mobile Bearer tokens aren't silently rejected
  await getUserIdFromRequest(request);

  const opinion = await prisma.expertOpinion.findFirst({
    where: { id: params.id, suppressedAt: null },
    include: {
      expert: {
        select: {
          id: true,
          name: true,
          organization: true,
          avatarUrl: true,
          verified: true,
        },
      },
      eventCluster: {
        select: { id: true, slug: true, name: true },
      },
    },
  });

  if (!opinion) {
    return NextResponse.json({ error: "Opinion not found" }, { status: 404 });
  }

  // Sibling opinions — other takes extracted from the same article. Empty when none.
  const siblings = opinion.storyId
    ? (
        await prisma.expertOpinion.findMany({
          where: {
            storyId: opinion.storyId,
            id: { not: opinion.id },
            suppressedAt: null,
          },
          select: {
            id: true,
            expertId: true,
            direction: true,
            instrument: true,
            expert: {
              select: { name: true, organization: true, verified: true },
            },
          },
          take: 20,
        })
      ).map((s) => ({
        id: s.id,
        expertId: s.expertId,
        expertName: s.expert.name,
        expertOrganization: s.expert.organization,
        direction: s.direction,
        instrument: s.instrument ?? null,
        verified: s.expert.verified,
      }))
    : [];

  return NextResponse.json({
    id: opinion.id,
    expertId: opinion.expert.id,
    expertName: opinion.expert.name,
    expertOrganization: opinion.expert.organization,
    avatarUrl: opinion.expert.avatarUrl ?? null,
    analystTier: opinion.expert.verified ? "CHIEF_ANALYST" : "ANALYST",
    quote: opinion.quote,
    headline: opinion.headline ?? null,
    direction: opinion.direction,
    instrument: opinion.instrument ?? null,
    instrumentTicker: opinion.instrumentTicker ?? null,
    sourceUrl: opinion.sourceUrl,
    storyId: opinion.storyId ?? null,
    publishedAt: opinion.publishedAt.toISOString(),
    analystCallAt: opinion.analystCallAt?.toISOString() ?? null,
    resolutionStatus: opinion.resolutionStatus,
    resolvedAt: opinion.resolvedAt?.toISOString() ?? null,
    resolutionNote: opinion.resolutionNote ?? null,
    isSourceAttribution: opinion.isSourceAttribution,
    eventCluster: opinion.eventCluster ?? null,
    siblings,
  });
}
