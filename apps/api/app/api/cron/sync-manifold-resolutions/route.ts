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

import { prisma } from "@/lib/prisma";

const MANIFOLD_BASE = "https://api.manifold.markets/v0";
const REQUEST_DELAY_MS = 200;
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

function hasCronAccess(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return true;
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

  const markets = await prisma.market.findMany({
    where: {
      originPlatform: "manifold",
      status: { in: [MarketStatus.PENDING_REVIEW, MarketStatus.OPEN] },
    },
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

    // Always refresh crowd data + mirror into native counters ($1 = 10 pts)
    const probability = detail.resolutionProbability ?? detail.probability ?? null;
    await prisma.market.update({
      where: { id: m.id },
      data: {
        externalProbability: probability,
        externalVolume: detail.volume ?? null,
        externalTraderCount: detail.uniqueBettorCount ?? null,
        totalVolume: detail.volume != null ? Math.round(detail.volume * 10) : 0,
        totalParticipants: detail.uniqueBettorCount ?? 0,
      },
    });
    crowdUpdated++;

    // If now resolved, sync the outcome
    if (detail.isResolved && (detail.resolution === "YES" || detail.resolution === "NO")) {
      const outcome = detail.resolution === "YES" ? MarketOutcome.YES : MarketOutcome.NO;
      const resolvedAt = detail.resolutionTime ? new Date(detail.resolutionTime) : new Date();

      await prisma.$transaction([
        prisma.market.update({
          where: { id: m.id },
          data: {
            status: MarketStatus.RESOLVED,
            resolutionStatus: ResolutionStatus.FINALIZED,
            outcome,
            finalizationAt: resolvedAt,
          },
        }),
        prisma.marketResolution.upsert({
          where: { marketId: m.id },
          create: {
            marketId: m.id,
            outcome,
            sourceName: "Manifold Markets",
            sourceUrl: `https://manifold.markets/market/${manifoldId}`,
            explanation: `Synced from Manifold. Original resolution: ${detail.resolution}`,
            resolvedAt,
          },
          update: {},
        }),
      ]);
      resolved++;
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
