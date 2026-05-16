import { NextResponse } from "next/server";

import { getSession, getUserIdFromRequest } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

/**
 * POST /api/groups/:id/launch
 *
 * Transitions all DRAFT and PENDING_REVIEW markets in the group to OPEN status.
 * Only the group owner may call this endpoint.
 */
export async function POST(
  request: Request,
  { params }: { params: { id: string } }
) {
  const { searchParams } = new URL(request.url);
  const userId = await getUserIdFromRequest(request);

  if (!userId) {
    return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  }

  const group = await prisma.group.findUnique({
    where: { id: params.id },
    select: { id: true, ownerId: true },
  });

  if (!group) {
    return NextResponse.json({ error: "Group not found." }, { status: 404 });
  }

  if (group.ownerId !== userId) {
    return NextResponse.json({ error: "Only the group owner can launch markets." }, { status: 403 });
  }

  // Capture the target market ids before the bulk update so we can return
  // them to the caller for optimistic UI updates.
  const targetMarkets = await prisma.market.findMany({
    where: {
      groupId: params.id,
      status: { in: ["DRAFT", "PENDING_REVIEW"] },
    },
    select: { id: true },
  });

  const result = await prisma.market.updateMany({
    where: {
      groupId: params.id,
      status: { in: ["DRAFT", "PENDING_REVIEW"] },
    },
    data: {
      status: "OPEN",
      approvedAt: new Date(),
    },
  });

  const launchedMarkets = targetMarkets;

  return NextResponse.json({
    launched: result.count,
    marketIds: launchedMarkets.map((m) => m.id),
  });
}
