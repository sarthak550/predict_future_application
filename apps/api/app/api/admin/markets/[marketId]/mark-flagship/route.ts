import { NextResponse } from "next/server";

import { getUserIdFromRequest } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

/**
 * POST /api/admin/markets/[marketId]/mark-flagship
 *
 * Sets or clears the flagship event designation on a market.
 *
 * Body (one of):
 *   • { clusterId: string }                                              ← pull date + type from cluster (preferred)
 *   • { flagshipEventAt: string, flagshipEventType: string }             ← explicit date + type
 *   • { flagshipEventAt: null, flagshipEventType: null }                 ← clear flagship status
 *
 * When clusterId is provided, the market is also linked to that cluster via
 * eventClusterId, and the flagship date is inherited from cluster.startsAt.
 * The flagshipEventType is inferred from the cluster name (RBI / BUDGET / GST /
 * FED) or falls back to OTHER.
 *
 * Auth: ADMIN only — flagship events are curated, not user-generated.
 */

function inferFlagshipTypeFromCluster(clusterName: string): string {
  const lower = clusterName.toLowerCase();
  if (lower.includes("rbi") || lower.includes("mpc")) return "RBI";
  if (lower.includes("budget")) return "BUDGET";
  if (lower.includes("gst")) return "GST";
  if (lower.includes("fed") || lower.includes("fomc")) return "FED";
  if (lower.includes("global")) return "GLOBAL";
  return "OTHER";
}

export async function POST(
  request: Request,
  { params }: { params: { marketId: string } }
) {
  const userId = await getUserIdFromRequest(request);
  if (!userId) {
    return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  }

  const actor = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, role: true, isSuspended: true },
  });
  if (!actor || actor.isSuspended) {
    return NextResponse.json({ error: "Account cannot perform this action." }, { status: 403 });
  }
  if (actor.role !== "ADMIN") {
    return NextResponse.json({ error: "Admin access required." }, { status: 403 });
  }

  const market = await prisma.market.findUnique({
    where: { id: params.marketId },
    select: { id: true },
  });
  if (!market) {
    return NextResponse.json({ error: "Market not found." }, { status: 404 });
  }

  let body: {
    flagshipEventAt?: string | null;
    flagshipEventType?: string | null;
    clusterId?: string | null;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const { flagshipEventAt, flagshipEventType, clusterId } = body;

  const isClearing =
    flagshipEventAt == null && flagshipEventType == null && !clusterId;

  let resolvedDate: Date | null = null;
  let resolvedType: string | null = null;
  let resolvedClusterId: string | null = null;

  if (!isClearing) {
    if (clusterId) {
      // Cluster-driven path — pull official date + type from the cluster row.
      const cluster = await prisma.marketEventCluster.findUnique({
        where: { id: clusterId },
        select: { id: true, name: true, startsAt: true },
      });
      if (!cluster) {
        return NextResponse.json({ error: "Cluster not found." }, { status: 404 });
      }
      if (cluster.startsAt <= new Date()) {
        return NextResponse.json(
          { error: "Cluster startsAt is in the past — pick an upcoming cluster." },
          { status: 400 }
        );
      }
      resolvedDate = cluster.startsAt;
      resolvedType =
        typeof flagshipEventType === "string" && flagshipEventType.trim().length > 0
          ? flagshipEventType.trim()
          : inferFlagshipTypeFromCluster(cluster.name);
      resolvedClusterId = cluster.id;
    } else {
      if (!flagshipEventAt || !flagshipEventType) {
        return NextResponse.json(
          {
            error:
              "Pass clusterId, or both flagshipEventAt and flagshipEventType. Use null for both to clear.",
          },
          { status: 400 }
        );
      }
      const date = new Date(flagshipEventAt);
      if (isNaN(date.getTime()) || date <= new Date()) {
        return NextResponse.json(
          { error: "flagshipEventAt must be a valid future ISO date." },
          { status: 400 }
        );
      }
      resolvedDate = date;
      resolvedType = flagshipEventType;
    }
  }

  const updated = await prisma.$transaction(async (tx) => {
    const updatedMarket = await tx.market.update({
      where: { id: params.marketId },
      data: {
        flagshipEventAt: isClearing ? null : resolvedDate,
        flagshipEventType: isClearing ? null : resolvedType,
        ...(resolvedClusterId ? { eventClusterId: resolvedClusterId } : {}),
      },
      select: {
        id: true,
        title: true,
        status: true,
        flagshipEventAt: true,
        flagshipEventType: true,
        eventClusterId: true,
      },
    });

    await tx.adminAction.create({
      data: {
        actorId: actor.id,
        marketId: params.marketId,
        type: "FEATURE_MARKET",
        notes: isClearing ? "Cleared flagship designation." : `Set flagship: ${resolvedType ?? ""}`,
        metadata: {
          flagshipEventAt: isClearing ? null : resolvedDate?.toISOString(),
          flagshipEventType: isClearing ? null : resolvedType,
          clusterId: resolvedClusterId,
        },
      },
    });

    return updatedMarket;
  });

  return NextResponse.json({ market: updated });
}
