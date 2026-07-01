import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

// Serves live DB data — render dynamically so `next build` does not statically
// evaluate this route (which would hit the DB with no connection at build time).
export const dynamic = "force-dynamic";

export async function GET() {
  const opinions = await prisma.expertOpinion.findMany({
    where: {
      resolutionStatus: { in: ["RESOLVED_HIT", "RESOLVED_MISS"] },
      suppressedAt: null,
      storyId: { not: null },
    },
    include: {
      expert: { select: { id: true, name: true, organization: true, verified: true, avatarUrl: true } },
      story: { select: { id: true, headline: true, publishedAt: true, sourceUrl: true } },
    },
    orderBy: { resolvedAt: "desc" },
    take: 20,
  });

  const payload = opinions.map((o) => ({
    id: o.id,
    expertId: o.expert.id,
    expertName: o.expert.name,
    expertOrganization: o.expert.organization,
    expertVerified: o.expert.verified,
    expertAvatarUrl: o.expert.avatarUrl ?? null,
    direction: o.direction,
    quote: o.quote,
    resolutionStatus: o.resolutionStatus,
    resolutionNote: o.resolutionNote ?? null,
    resolvedAt: o.resolvedAt?.toISOString() ?? null,
    publishedAt: o.publishedAt.toISOString(),
    storyId: o.story?.id ?? null,
    storyHeadline: o.story?.headline ?? null,
    instrument: o.instrument ?? null,
  }));

  const response = NextResponse.json(payload);
  response.headers.set("Cache-Control", "public, max-age=120");
  return response;
}
