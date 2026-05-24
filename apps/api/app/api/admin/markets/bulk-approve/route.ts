import { NextResponse } from "next/server";

import { getUserIdFromRequest } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

const MAX_BULK = 500;

export async function POST(request: Request) {
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
  if (actor.role !== "ADMIN" && actor.role !== "MODERATOR") {
    return NextResponse.json({ error: "Admin access required." }, { status: 403 });
  }

  let body: {
    ids?: string[];
    originPlatform?: string;
    status?: string;
  };

  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const { ids, originPlatform, status: filterStatus } = body;

  if (!ids?.length && !originPlatform) {
    return NextResponse.json(
      { error: "Provide either ids[] or originPlatform + status." },
      { status: 400 }
    );
  }

  // Resolve the candidate market IDs
  let candidateIds: string[];

  if (ids?.length) {
    candidateIds = ids.slice(0, MAX_BULK);
  } else {
    // Platform + status filter — fetch up to MAX_BULK pending markets
    const markets = await prisma.market.findMany({
      where: {
        originPlatform,
        status: filterStatus === "PENDING_REVIEW" ? "PENDING_REVIEW" : { notIn: ["OPEN"] },
      },
      select: { id: true },
      take: MAX_BULK,
    });
    candidateIds = markets.map((m) => m.id);
  }

  if (candidateIds.length === 0) {
    return NextResponse.json({ approved: 0, skipped: 0 });
  }

  // Fetch all candidates to know their current status + originPlatform
  const candidates = await prisma.market.findMany({
    where: { id: { in: candidateIds } },
    select: { id: true, status: true, originPlatform: true },
  });

  const toApprove = candidates.filter((m) => m.status !== "OPEN");
  const skipped = candidates.length - toApprove.length;

  if (toApprove.length === 0) {
    return NextResponse.json({ approved: 0, skipped });
  }

  const toApproveIds = toApprove.map((m) => m.id);
  const now = new Date();

  await prisma.$transaction(async (tx) => {
    // Bulk-update to OPEN
    await tx.market.updateMany({
      where: { id: { in: toApproveIds } },
      data: {
        status: "OPEN",
        approvedAt: now,
        approvedById: actor.id,
      },
    });

    // Insert one AdminAction per market
    await tx.adminAction.createMany({
      data: toApproveIds.map((marketId) => ({
        actorId: actor.id,
        marketId,
        type: "APPROVE_MARKET",
      })),
      skipDuplicates: true,
    });

    // Notifications for native (non-imported) markets only
    const nativeMarkets = toApprove.filter((m) => m.originPlatform == null);
    if (nativeMarkets.length > 0) {
      const fullMarkets = await tx.market.findMany({
        where: { id: { in: nativeMarkets.map((m) => m.id) } },
        select: { id: true, title: true, creatorId: true },
      });

      await tx.notification.createMany({
        data: fullMarkets.map((m) => ({
          userId: m.creatorId,
          marketId: m.id,
          type: "MARKET_APPROVED",
          title: "Market approved",
          body: `${m.title} is now live for forecasting.`,
          href: `/markets/${m.id}`,
        })),
        skipDuplicates: true,
      });
    }
  });

  return NextResponse.json({ approved: toApprove.length, skipped });
}
