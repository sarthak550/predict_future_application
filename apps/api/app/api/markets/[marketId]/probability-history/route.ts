import { NextResponse } from "next/server";

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
  _request: Request,
  { params }: { params: { marketId: string } }
) {
  try {
    const market = await prisma.market.findUnique({
      where: { id: params.marketId },
      select: {
        id: true,
        status: true,
        outcome: true,
        createdAt: true,
        marketType: true,
      },
    });

    if (!market) {
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
