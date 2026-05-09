import { prisma } from "@/lib/prisma";
import { computeMarketProbability } from "@/lib/markets/probabilitySnapshot";

/**
 * Snapshot hourly probabilities for all OPEN markets.
 *
 * Called by POST /api/cron/probability-snapshot (CRON_SECRET guarded).
 *
 * Also enforces a retention policy to prevent unbounded table growth:
 * - Snapshots older than 7 days are compressed to one per calendar day
 *   (the latest snapshot of each UTC day is kept, all others deleted).
 *
 * Returns { processed, snapshotsCreated } for the cron response body.
 */
export async function snapshotMarketProbabilities(): Promise<{
  processed: number;
  snapshotsCreated: number;
}> {
  let processed = 0;
  let snapshotsCreated = 0;

  try {
    const openMarkets = await prisma.market.findMany({
      where: {
        status: "OPEN",
        marketType: { in: ["BINARY", "MULTIPLE_CHOICE"] },
      },
      select: { id: true },
    });

    processed = openMarkets.length;

    for (const market of openMarkets) {
      try {
        const probability = await computeMarketProbability(market.id, prisma);
        if (probability === null) continue;

        await prisma.marketProbabilitySnapshot.create({
          data: { marketId: market.id, probability },
        });
        snapshotsCreated++;
      } catch (marketErr) {
        console.error(
          `[probability-snapshot] failed for market ${market.id}:`,
          marketErr
        );
        // Continue to next market — one failure must not abort the entire batch.
      }
    }

    // Retention policy: compress snapshots older than 7 days to 1 per UTC calendar day.
    // We keep the LATEST snapshot per (marketId, calendar-day) and delete the rest.
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

    // Find all old snapshots grouped by market and day.
    // Use raw aggregation to identify the IDs to KEEP, then delete everything else in the same window.
    const oldSnapshots = await prisma.marketProbabilitySnapshot.findMany({
      where: { snapshotAt: { lt: sevenDaysAgo } },
      select: { id: true, marketId: true, snapshotAt: true },
      orderBy: { snapshotAt: "asc" },
    });

    if (oldSnapshots.length > 0) {
      // Build a map of "marketId|YYYY-MM-DD" => latest snapshot id
      const keepIds = new Set<string>();
      for (const snap of oldSnapshots) {
        const dayKey = `${snap.marketId}|${snap.snapshotAt.toISOString().slice(0, 10)}`;
        // Because we ordered ASC, later iterations overwrite earlier ones — the final write wins.
        keepIds.delete(
          // remove any previously added id for this day-key (we only want the latest)
          [...keepIds].find((id) => {
            const existing = oldSnapshots.find((s) => s.id === id);
            return (
              existing &&
              `${existing.marketId}|${existing.snapshotAt.toISOString().slice(0, 10)}` === dayKey
            );
          }) ?? ""
        );
        keepIds.add(snap.id);
      }

      const deleteIds = oldSnapshots
        .map((s) => s.id)
        .filter((id) => !keepIds.has(id));

      if (deleteIds.length > 0) {
        await prisma.marketProbabilitySnapshot.deleteMany({
          where: { id: { in: deleteIds } },
        });
        console.info(
          `[probability-snapshot] retention: deleted ${deleteIds.length} old snapshots`
        );
      }
    }
  } catch (err) {
    console.error("[probability-snapshot] fatal error in snapshotMarketProbabilities:", err);
    throw err;
  }

  return { processed, snapshotsCreated };
}
