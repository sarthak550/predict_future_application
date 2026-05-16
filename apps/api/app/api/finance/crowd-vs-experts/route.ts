import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";
export const revalidate = 300; // 5-minute cache

/**
 * GET /api/finance/crowd-vs-experts
 *
 * Compares crowd vs. expert accuracy on resolved ExpertOpinion records.
 *
 * Expert correct:  resolutionStatus = 'RESOLVED_HIT' (mapped from DB 'HIT')
 * Crowd correct:   For resolved opinions linked to a market, the crowd's
 *                  majority vote (yesCount vs noCount) matched the expert's
 *                  direction — approximated by checking if the expert was
 *                  BULLISH/HIT and yes > no, or BEARISH/MISS and no > yes.
 *                  Falls back to counting retrospective RETROSPECTIVE votes
 *                  when no market is linked.
 *
 * provisional:     true when resolvedCount < 20 (limited sample)
 * Returns { resolvedCount: 0 } shape when no resolved opinions exist.
 */
export async function GET() {
  const resolvedOpinions = await prisma.expertOpinion.findMany({
    where: {
      resolutionStatus: { in: ["RESOLVED_HIT", "RESOLVED_MISS"] },
      suppressedAt: null,
      isSourceAttribution: false,
    },
    select: {
      id: true,
      resolutionStatus: true,
      direction: true,
      marketId: true,
    },
  });

  const resolvedCount = resolvedOpinions.length;

  if (resolvedCount === 0) {
    return NextResponse.json({ resolvedCount: 0 });
  }

  // Expert accuracy: count HIT resolutions
  const expertCorrect = resolvedOpinions.filter(
    (o) => o.resolutionStatus === "RESOLVED_HIT"
  ).length;
  const expertWinRate = Math.round((expertCorrect / resolvedCount) * 100);

  // Crowd accuracy: for each resolved opinion, check if crowd agreed with the
  // actual outcome using linked market data or retrospective votes.
  const marketIds = resolvedOpinions
    .map((o) => o.marketId)
    .filter((id): id is string => id !== null);

  // Fetch market vote counts for linked markets
  const markets =
    marketIds.length > 0
      ? await prisma.market.findMany({
          where: { id: { in: marketIds } },
          select: { id: true, yesCount: true, noCount: true },
        })
      : [];
  const marketMap = new Map(markets.map((m) => [m.id, m]));

  // Fetch retrospective votes for opinions without markets
  const opinionIds = resolvedOpinions.map((o) => o.id);
  const retroVotes = await prisma.expertOpinionVote.findMany({
    where: { opinionId: { in: opinionIds }, pollType: "RETROSPECTIVE" },
    select: { opinionId: true, choice: true },
  });

  // Group retro votes by opinionId
  const retroByOpinion = new Map<string, { hit: number; miss: number }>();
  for (const vote of retroVotes) {
    const existing = retroByOpinion.get(vote.opinionId) ?? { hit: 0, miss: 0 };
    if (vote.choice === "HIT") existing.hit++;
    else if (vote.choice === "MISS") existing.miss++;
    retroByOpinion.set(vote.opinionId, existing);
  }

  let crowdCorrect = 0;
  let crowdSample = 0;

  for (const opinion of resolvedOpinions) {
    const isExpertHit = opinion.resolutionStatus === "RESOLVED_HIT";

    if (opinion.marketId) {
      const market = marketMap.get(opinion.marketId);
      if (market) {
        const crowdSaysYes = (market.yesCount ?? 0) >= (market.noCount ?? 0);
        // For BULLISH opinions: crowd "correct" if majority says YES and expert hit
        // For BEARISH opinions: crowd "correct" if majority says NO and expert hit
        const crowdAgreesWithHit =
          opinion.direction === "BULLISH" ? crowdSaysYes : !crowdSaysYes;
        const crowdWasCorrect = crowdAgreesWithHit === isExpertHit;
        if (crowdWasCorrect) crowdCorrect++;
        crowdSample++;
        continue;
      }
    }

    // Fall back to retrospective votes
    const retro = retroByOpinion.get(opinion.id);
    if (retro && retro.hit + retro.miss > 0) {
      const crowdSaysHit = retro.hit > retro.miss;
      if (crowdSaysHit === isExpertHit) crowdCorrect++;
      crowdSample++;
    }
  }

  // When we have no crowd signal at all, approximate with 50%
  const effectiveCrowdSample = crowdSample || resolvedCount;
  const effectiveCrowdCorrect = crowdSample > 0 ? crowdCorrect : Math.round(resolvedCount * 0.5);
  const crowdWinRate = Math.round((effectiveCrowdCorrect / effectiveCrowdSample) * 100);

  return NextResponse.json({
    resolvedCount,
    crowdCorrect: effectiveCrowdCorrect,
    expertCorrect,
    crowdWinRate,
    expertWinRate,
    sampleSize: resolvedCount,
    provisional: resolvedCount < 20,
    lastUpdated: new Date().toISOString(),
  });
}
