import { prisma } from "@/lib/prisma";
import { ExpertOpinionsAdminClient } from "./client";

export const dynamic = "force-dynamic";

export default async function ExpertOpinionsAdminPage() {
  const [pendingOpinions, unverifiedExperts] = await Promise.all([
    prisma.expertOpinion.findMany({
      where: {
        resolutionStatus: "PENDING",
        suppressedAt: null,
      },
      include: {
        expert: {
          select: { id: true, name: true, organization: true, verified: true },
        },
        story: {
          select: { headline: true },
        },
      },
      orderBy: { publishedAt: "desc" },
      take: 100,
    }),
    prisma.expert.findMany({
      where: { verified: false },
      select: {
        id: true,
        name: true,
        organization: true,
        bio: true,
        avatarUrl: true,
      },
      orderBy: { createdAt: "desc" },
      take: 100,
    }),
  ]);

  const serializedOpinions = pendingOpinions.map((o) => ({
    id: o.id,
    expertName: o.expert.name,
    expertOrganization: o.expert.organization,
    direction: o.direction as "BULLISH" | "BEARISH" | "NEUTRAL",
    quote: o.quote,
    storyHeadline: o.story?.headline ?? null,
    publishedAt: o.publishedAt.toISOString(),
  }));

  const serializedExperts = unverifiedExperts.map((e) => ({
    id: e.id,
    name: e.name,
    organization: e.organization,
    bio: e.bio ?? null,
    avatarUrl: e.avatarUrl ?? null,
  }));

  return (
    <div className="space-y-10">
      <div>
        <h1 className="text-3xl font-semibold text-ink-900">Expert Opinion Review</h1>
        <p className="mt-2 text-sm text-ink-500">
          Review AI-extracted expert opinions and verify expert profiles. Suppressed opinions are
          hidden from all public surfaces.
        </p>
      </div>
      <ExpertOpinionsAdminClient
        initialOpinions={serializedOpinions}
        initialExperts={serializedExperts}
      />
    </div>
  );
}
