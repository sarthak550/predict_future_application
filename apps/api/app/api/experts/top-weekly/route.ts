import { NextResponse } from "next/server";

import type { ApiTopExpertEntry } from "@predict-future/types";

import { prisma } from "@/lib/prisma";

/** Maximum number of entries returned. */
const TOP_N = 10;

/**
 * Minimum resolved-call count required for an expert to qualify.
 * Experts with fewer than MIN_RESOLVED resolved calls in the window are excluded.
 */
const MIN_RESOLVED = 3;

/**
 * GET /api/experts/top-weekly
 *
 * Returns the top N experts ranked by accuracy over a rolling 7-day window.
 * Only ExpertOpinion rows with isSourceAttribution=false are included (named
 * analysts only — "Market Analysis from Source" opinions are excluded).
 *
 * Response is cached at the edge for 1 hour (revalidate: 3600).
 * No auth required — this is a public endpoint.
 *
 * If fewer than 3 experts meet the MIN_RESOLVED threshold, returns [].
 */
export const revalidate = 3600;

export async function GET(): Promise<NextResponse<ApiTopExpertEntry[]>> {
  const windowStart = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

  // Aggregate resolved opinions per expert within the 7-day window.
  // We use a raw groupBy via Prisma's groupBy to avoid loading every opinion
  // row into the Node process — the composite index covers this query exactly.
  //
  // suppressedAt: null — admin-suppressed opinions must not contribute to
  // public credibility rankings, otherwise moderation has no effect on Top 3.
  const rows = await prisma.expertOpinion.groupBy({
    by: ["expertId", "resolutionStatus"],
    where: {
      isSourceAttribution: false,
      suppressedAt: null,
      resolutionStatus: {
        in: ["RESOLVED_HIT", "RESOLVED_MISS"],
      },
      resolvedAt: {
        gte: windowStart,
      },
    },
    _count: {
      id: true,
    },
  });

  // Pivot the grouped rows into a map: expertId -> { hitCount, missCount }
  type TallyEntry = { hitCount: number; missCount: number };
  const tallyMap = new Map<string, TallyEntry>();

  for (const row of rows) {
    const existing = tallyMap.get(row.expertId) ?? { hitCount: 0, missCount: 0 };
    if (row.resolutionStatus === "RESOLVED_HIT") {
      existing.hitCount += row._count.id;
    } else {
      existing.missCount += row._count.id;
    }
    tallyMap.set(row.expertId, existing);
  }

  // Filter to experts meeting the minimum threshold
  const qualifiedIds: string[] = [];
  for (const [expertId, tally] of tallyMap.entries()) {
    const totalResolved = tally.hitCount + tally.missCount;
    if (totalResolved >= MIN_RESOLVED) {
      qualifiedIds.push(expertId);
    }
  }

  // If fewer than 3 experts qualify, return empty array per spec
  if (qualifiedIds.length < MIN_RESOLVED) {
    return NextResponse.json([]);
  }

  // Fetch expert name + organization for the qualified experts
  const experts = await prisma.expert.findMany({
    where: { id: { in: qualifiedIds } },
    select: { id: true, name: true, organization: true },
  });

  const expertMap = new Map(experts.map((e) => [e.id, e]));

  // Build sorted entries
  type RankedEntry = Omit<ApiTopExpertEntry, "rank"> & { rank: number };
  const entries: RankedEntry[] = [];

  for (const expertId of qualifiedIds) {
    const tally = tallyMap.get(expertId)!;
    const expert = expertMap.get(expertId);
    if (!expert) continue; // expert row deleted — skip gracefully

    const totalResolved = tally.hitCount + tally.missCount;
    const hitRate = tally.hitCount / totalResolved;

    entries.push({
      rank: 0, // assigned below after sort
      expertId,
      expertName: expert.name,
      organization: expert.organization,
      hitRate,
      resolvedCount: totalResolved,
      hitCount: tally.hitCount,
    });
  }

  // Sort descending by hitRate, break ties by resolvedCount (more calls = more confidence)
  entries.sort((a, b) => {
    const rateDiff = b.hitRate - a.hitRate;
    if (rateDiff !== 0) return rateDiff;
    return b.resolvedCount - a.resolvedCount;
  });

  // Take top N and assign final ranks
  const top = entries.slice(0, TOP_N).map((entry, idx) => ({
    ...entry,
    rank: idx + 1,
  }));

  return NextResponse.json(top);
}
