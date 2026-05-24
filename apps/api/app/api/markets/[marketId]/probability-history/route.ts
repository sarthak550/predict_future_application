import { NextResponse } from "next/server";

import { getUserIdFromRequest } from "@/lib/auth";
import { canViewMarket } from "@/lib/markets/access";
import { prisma } from "@/lib/prisma";

/**
 * GET /api/markets/[marketId]/probability-history
 *
 * Returns historical probability snapshots for the consensus-line chart.
 *
 * Auth: not required — public endpoint.
 * Cache-Control: public, max-age=300 (5 minutes).
 *
 * Display aggregation:
 * - If market age <= 7 days: return all hourly snapshots.
 * - If market age > 7 days: return the last snapshot of each UTC calendar day.
 *
 * Response shape:
 *   {
 *     marketId: string;
 *     snapshots: Array<{ at: string; probability: number }>;
 *     resolvedProbability: number | null;
 *   }
 */
export async function GET(
  request: Request,
  { params }: { params: { marketId: string } }
) {
  try {
    const viewerId = (await getUserIdFromRequest(request)) ?? undefined;
    const viewer = viewerId
      ? await prisma.user.findUnique({
          where: { id: viewerId },
          select: { id: true, role: true },
        })
      : null;

    const market = await prisma.market.findUnique({
      where: { id: params.marketId },
      select: {
        id: true,
        creatorId: true,
        status: true,
        outcome: true,
        createdAt: true,
        closeAt: true,
        finalizationAt: true,
        marketType: true,
        visibility: true,
        groupId: true,
        group: viewer?.id
          ? {
              select: {
                ownerId: true,
                memberships: {
                  where: { userId: viewer.id },
                  select: { userId: true },
                },
              },
            }
          : { select: { ownerId: true } },
      },
    });

    if (!market) {
      return NextResponse.json({ error: "Market not found." }, { status: 404 });
    }

    if (!canViewMarket(market, viewer)) {
      return NextResponse.json({ error: "Market not found." }, { status: 404 });
    }

    // Fetch all snapshots ordered chronologically
    const rawSnapshots = await prisma.marketProbabilitySnapshot.findMany({
      where: { marketId: params.marketId },
      orderBy: { snapshotAt: "asc" },
      select: { snapshotAt: true, probability: true },
    });

    // Determine if we apply daily aggregation (market older than 7 days)
    const marketAgeMs = Date.now() - market.createdAt.getTime();
    const sevenDaysMs = 7 * 24 * 60 * 60 * 1000;
    const applyDailyAgg = marketAgeMs > sevenDaysMs;

    let displaySnapshots: Array<{ at: string; probability: number }>;

    if (!applyDailyAgg) {
      // Return all hourly points as-is
      displaySnapshots = rawSnapshots.map((s) => ({
        at: s.snapshotAt.toISOString(),
        probability: s.probability,
      }));
    } else {
      // Aggregate to last snapshot per UTC calendar day
      const dayMap = new Map<string, { at: string; probability: number }>();
      for (const snap of rawSnapshots) {
        const dayKey = snap.snapshotAt.toISOString().slice(0, 10); // "YYYY-MM-DD"
        // Later entries overwrite earlier ones → last snapshot of the day wins
        dayMap.set(dayKey, {
          at: snap.snapshotAt.toISOString(),
          probability: snap.probability,
        });
      }
      displaySnapshots = [...dayMap.values()];
    }

    // Always guarantee the chart can render (>=2 points) by synthesizing a 50%
    // baseline at market creation and, if there's still only 1 point, an endpoint
    // at the market's natural end time. This means:
    //  - 0 real snapshots (never bet) → baseline at createdAt + endpoint at close/finalize → flat 50% line
    //  - 1 real snapshot              → baseline at createdAt + the snapshot
    //  - 2+ real snapshots            → just the snapshots
    {
      const firstSnap = displaySnapshots[0];
      const baseline = { at: market.createdAt.toISOString(), probability: 0.5 };
      if (!firstSnap || new Date(firstSnap.at).getTime() > market.createdAt.getTime()) {
        displaySnapshots = [baseline, ...displaySnapshots];
      }
      // If only the baseline exists, anchor a second point at the market's end
      // (finalizationAt for resolved, closeAt otherwise, falling back to now).
      // Ensure the endpoint is meaningfully after the baseline so the chart
      // doesn't collapse to a single point — minimum 1 hour separation.
      if (displaySnapshots.length < 2) {
        const baselineTs = market.createdAt.getTime();
        const minSeparationMs = 60 * 60 * 1000;
        const endCandidate = market.finalizationAt ?? market.closeAt ?? new Date();
        const endTs = (endCandidate instanceof Date ? endCandidate : new Date(endCandidate)).getTime();
        const anchorTs = Math.max(endTs, baselineTs + minSeparationMs, Date.now());
        displaySnapshots = [...displaySnapshots, { at: new Date(anchorTs).toISOString(), probability: 0.5 }];
      }
    }

    // For resolved markets, append the final outcome as a definitive endpoint on the chart
    let resolvedProbability: number | null = null;
    if (market.status === "RESOLVED") {
      resolvedProbability = market.outcome === "YES" ? 1.0 : 0.0;
    }

    const response = NextResponse.json({
      marketId: params.marketId,
      snapshots: displaySnapshots,
      resolvedProbability,
    });

    response.headers.set("Cache-Control", "public, max-age=300");

    return response;
  } catch (error) {
    console.error("[probability-history]", error);
    return NextResponse.json(
      { error: "Unable to fetch probability history." },
      { status: 500 }
    );
  }
}
