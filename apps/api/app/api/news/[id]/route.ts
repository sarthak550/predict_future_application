import { NextResponse } from "next/server";

import { prisma } from "@/lib/prisma";
import { approvedStoryStatuses } from "@/lib/validations/news";
import type { StoryStatus } from "@prisma/client";

const visibleStatuses: StoryStatus[] = [...new Set<StoryStatus>([...approvedStoryStatuses, "PUBLISHED"])];

export async function GET(
  _request: Request,
  { params }: { params: { id: string } }
) {
  const story = await prisma.story.findFirst({
    where: {
      id: params.id,
      status: { in: visibleStatuses },
    },
    include: {
      expertOpinions: {
        where: { suppressedAt: null },
        include: { expert: true },
        orderBy: { publishedAt: "desc" },
        take: 10,
      },
    },
  });

  if (!story) {
    return NextResponse.json({ error: "Story not found." }, { status: 404 });
  }

  return NextResponse.json({
    story: {
      id: story.id,
      slug: story.slug,
      headline: story.headline,
      summary: story.summary,
      category: story.category,
      sourceName: story.sourceName,
      sourceUrl: story.sourceUrl,
      imageUrl: story.imageUrl ?? null,
      publishedAt: story.publishedAt.toISOString(),
      ingestedAt: story.ingestedAt.toISOString(),
      expertOpinions: story.expertOpinions.map((opinion) => ({
        id: opinion.id,
        expertId: opinion.expertId,
        expertName: opinion.expert.name,
        expertOrganization: opinion.expert.organization,
        avatarUrl: opinion.expert.avatarUrl ?? null,
        verified: opinion.expert.verified,
        quote: opinion.quote,
        direction: opinion.direction,
        sourceUrl: opinion.sourceUrl,
        storyId: opinion.storyId ?? null,
        publishedAt: opinion.publishedAt.toISOString(),
        analystCallAt: opinion.analystCallAt?.toISOString() ?? null,
        resolutionStatus: opinion.resolutionStatus,
        resolvedAt: opinion.resolvedAt?.toISOString() ?? null,
        resolutionNote: opinion.resolutionNote ?? null,
        isSourceAttribution: opinion.isSourceAttribution,
        instrument: opinion.instrument ?? null,
        instrumentTicker: opinion.instrumentTicker ?? null,
      })),
    },
  });
}
