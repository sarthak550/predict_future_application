/**
 * Sync Manifold-imported OPEN markets to their current resolution state.
 *
 * For each market with originPlatform='manifold' and status in (PENDING_REVIEW, OPEN):
 *  - Fetch the latest state from Manifold's /market/{id} endpoint
 *  - If now resolved on Manifold:
 *      - Update local market to RESOLVED with the outcome
 *      - Create MarketResolution row
 *  - Always update crowd data (probability, volume, traderCount)
 *
 * Scheduled daily (vercel.json). Guarded by CRON_SECRET.
 */

import { MarketOutcome, MarketStatus, ResolutionStatus } from "@prisma/client";
import { NextResponse } from "next/server";

import { settleMarket } from "@/lib/markets/payouts";
import { prisma } from "@/lib/prisma";

const MANIFOLD_BASE = "https://api.manifold.markets/v0";
const REQUEST_DELAY_MS = 200;
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

function hasCronAccess(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const authHeader = request.headers.get("authorization");
  const cronHeader = request.headers.get("x-cron-secret");
  return authHeader === `Bearer ${secret}` || cronHeader === secret;
}

interface ManifoldMarketDetail {
  id: string;
  isResolved?: boolean;
  resolution?: string;
  resolutionTime?: number;
  probability?: number;
  resolutionProbability?: number;
  volume?: number;
  uniqueBettorCount?: number;
}

async function fetchManifoldMarket(id: string): Promise<ManifoldMarketDetail | null> {
  try {
    const resp = await fetch(`${MANIFOLD_BASE}/market/${id}`);
    if (!resp.ok) return null;
    return (await resp.json()) as ManifoldMarketDetail;
  } catch {
    return null;
  }
}

export async function POST(request: Request) {
  if (!hasCronAccess(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Cap at 200 per run and process least-recently-synced first so the backlog drains
  // evenly. Skip markets whose externalLastSyncedAt was set within the last 6 hours.
  // We deliberately do NOT use updatedAt here — updatedAt is bumped by every local trade,
  // which would prevent active markets from ever re-syncing their Manifold resolution state.
  const sixHoursAgo = new Date(Date.now() - 6 * 60 * 60 * 1000);
  const markets = await prisma.market.findMany({
    where: {
      originPlatform: "manifold",
      status: { in: [MarketStatus.PENDING_REVIEW, MarketStatus.OPEN] },
      OR: [
        { externalLastSyncedAt: null },
        { externalLastSyncedAt: { lt: sixHoursAgo } },
      ],
    },
    orderBy: { externalLastSyncedAt: "asc" },
    take: 200,
    select: { id: true, externalId: true },
  });

  let checked = 0;
  let resolved = 0;
  let crowdUpdated = 0;
  let failed = 0;

  for (const m of markets) {
    const manifoldId = m.externalId?.replace(/^manifold:/, "");
    if (!manifoldId) {
      failed++;
      continue;
    }
    checked++;

    const detail = await fetchManifoldMarket(manifoldId);
    if (!detail) {
      failed++;
      await sleep(REQUEST_DELAY_MS);
      continue;
    }

    // Always refresh crowd data + mirror into native counters ($1 = 10 pts).
    // Stamp externalLastSyncedAt to now so this market exits the sync window for the next 6 hours,
    // regardless of whether updatedAt was bumped by a local trade in the interim.
    const probability = detail.resolutionProbability ?? detail.probability ?? null;
    await prisma.market.update({
      where: { id: m.id },
      data: {
        externalProbability: probability,
        externalVolume: detail.volume ?? null,
        externalTraderCount: detail.uniqueBettorCount ?? null,
        totalVolume: detail.volume != null ? Math.round(detail.volume * 10) : 0,
        totalParticipants: detail.uniqueBettorCount ?? 0,
        externalLastSyncedAt: new Date(),
      },
    });
    crowdUpdated++;

    // If now resolved, sync the outcome AND settle native positions.
    // Interactive transaction (not batched) so settleMarket sees the updated
    // market row + can credit wallets + create MARKET_WIN/REFUND/HOST_* transactions
    // atomically with the status flip. Without settleMarket, users with native
    // positions on a Manifold-synced market would never get paid out.
    if (detail.isResolved && (detail.resolution === "YES" || detail.resolution === "NO")) {
      const outcome = detail.resolution === "YES" ? MarketOutcome.YES : MarketOutcome.NO;
      const resolvedAt = detail.resolutionTime ? new Date(detail.resolutionTime) : new Date();

      try {
        await prisma.$transaction(
          async (tx) => {
            await tx.market.update({
              where: { id: m.id },
              data: {
                status: MarketStatus.RESOLVED,
                resolutionStatus: ResolutionStatus.FINALIZED,
                outcome,
                finalizationAt: resolvedAt,
              },
            });
            // NOTE: sourceName/explanation are user-facing (explanation is returned to
            // clients as the market's resolution "rationale" — see
            // apps/api/app/api/markets/[marketId]/route.ts). Keep this copy platform-neutral;
            // sourceUrl stays as the canonical external record for internal audit only
            // (never selected/returned by any client-facing route).
            await tx.marketResolution.upsert({
              where: { marketId: m.id },
              create: {
                marketId: m.id,
                outcome,
                sourceName: "External Market Data",
                sourceUrl: `https://manifold.markets/market/${manifoldId}`,
                explanation: `Resolved based on external market data. Outcome: ${detail.resolution}.`,
                resolvedAt,
              },
              update: {},
            });
            // Pay out native positions. createUniqueWalletTransaction inside
            // settleMarket prevents double-credit on cron retry.
            await settleMarket(tx, m.id);
          },
          { maxWait: 30000, timeout: 30000 }
        );
        resolved++;
      } catch (err) {
        console.error(`[sync-manifold] settle failed for ${m.id}:`, err);
        failed++;
      }
    }

    await sleep(REQUEST_DELAY_MS);
  }

  return NextResponse.json({
    checked,
    resolved,
    crowdUpdated,
    failed,
  });
}
