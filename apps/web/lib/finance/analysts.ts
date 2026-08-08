import { prisma } from "@/lib/prisma";
import { canonicalizeOrgDisplay } from "@predict-future/business-rules/experts/firmAliases";
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
 * an indexable analyst. Returns every indexable HUMAN expert (unsorted); callers
 * apply their own sort/slice.
 *
 * entityKind=FIRM rows (publication/desk "org-as-analyst" identities — see
 * apps/api/lib/finance/expertEntityKind.ts) are deliberately excluded from this
 * personal-credibility scorecard. The existing isSourceAttribution display
 * convention already presents those as "Market Analysis from [Source]", never as
 * a person with a track record — mixing a publication into a leaderboard of named
 * analysts' hit rates would misrepresent both what it is and dilute the page's
 * legal framing ("track records of INDIVIDUAL analysts").
 *
 * organization is canonicalized through the firm-alias map (e.g. bare "MOFSL" ->
 * "Motilal Oswal Financial Services") so a stray pre-merge acronym spelling never
 * displays next to a spelled-out sibling elsewhere on the page — belt-and-
 * suspenders on top of the merge script's own canonicalization at merge time and
 * expertMatch.ts's canonicalization at creation time.
 */
export async function fetchIndexableAnalysts(): Promise<IndexableAnalyst[]> {
  const experts = await prisma.expert.findMany({
    where: { slug: { not: null }, entityKind: "HUMAN" },
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
      organization: canonicalizeOrgDisplay(expert.organization),
      verified: expert.verified,
      avatarUrl: expert.avatarUrl,
      stats: getPublicProfileStats(expert.opinions),
    }))
    .filter((expert) => expert.stats.indexable);
}

export type FirmOption = { firm: string; count: number };

/**
 * Distinct canonical firms present among indexable analysts, with counts, sorted
 * by count desc then name — feeds the /analysts directory's firm filter dropdown
 * ("Motilal Oswal Financial Services (7)"). Derived from the SAME analyst list
 * fetchIndexableAnalysts returns (already canonicalized + HUMAN-only), so the
 * filter options and the actual filterable rows can never drift apart.
 */
export function buildFirmOptions(analysts: IndexableAnalyst[]): FirmOption[] {
  const counts = new Map<string, number>();
  for (const a of analysts) {
    counts.set(a.organization, (counts.get(a.organization) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([firm, count]) => ({ firm, count }))
    .sort((a, b) => b.count - a.count || a.firm.localeCompare(b.firm));
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
