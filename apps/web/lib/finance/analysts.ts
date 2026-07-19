import { prisma } from "@/lib/prisma";
import { getPublicProfileStats, type PublicProfileStats } from "@/lib/finance/publicProfile";

export type IndexableAnalyst = {
  id: string;
  slug: string;
  name: string;
  organization: string;
  verified: boolean;
  avatarUrl: string | null;
  stats: PublicProfileStats;
};

export type AnalystSortMode = "accuracy" | "volume";

/**
 * Shared query behind /analysts (full directory) and the homepage's "Top
 * analysts" strip — extracted here so the two never drift on what counts as
 * an indexable analyst. Returns every indexable expert (unsorted); callers
 * apply their own sort/slice.
 */
export async function fetchIndexableAnalysts(): Promise<IndexableAnalyst[]> {
  const experts = await prisma.expert.findMany({
    where: { slug: { not: null } },
    select: {
      id: true,
      slug: true,
      name: true,
      organization: true,
      verified: true,
      avatarUrl: true,
      opinions: {
        where: { suppressedAt: null },
        select: { resolutionStatus: true, instrument: true, instrumentTicker: true },
      },
    },
  });

  return experts
    .map((expert) => ({
      id: expert.id,
      slug: expert.slug as string,
      name: expert.name,
      organization: expert.organization,
      verified: expert.verified,
      avatarUrl: expert.avatarUrl,
      stats: getPublicProfileStats(expert.opinions),
    }))
    .filter((expert) => expert.stats.indexable);
}

/**
 * Default sort is descending accuracy — a "worst analyst" default ordering is
 * a hard legal-framing requirement, never build one, not even as an
 * available option (see app/analysts/page.tsx's own note on this).
 */
export function sortAnalysts(analysts: IndexableAnalyst[], sort: AnalystSortMode): IndexableAnalyst[] {
  return [...analysts].sort((a, b) => {
    if (sort === "volume") {
      return b.stats.resolvedCount - a.stats.resolvedCount;
    }
    // accuracy: hitRate is guaranteed non-null here since indexable implies resolvedCount >= 5
    return (b.stats.hitRate ?? 0) - (a.stats.hitRate ?? 0);
  });
}
