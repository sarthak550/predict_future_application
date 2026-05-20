import { NextResponse } from "next/server";

import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

/**
 * POST /api/admin/markets/[marketId]/mark-flagship
 *
 * Sets or clears the flagship event designation on a market.
 * Body: { flagshipEventAt: string | null, flagshipEventType: string | null }
 *
 * Auth: ADMIN or MODERATOR only.
 */
export async function POST(
  request: Request,
  { params }: { params: { marketId: string } }
) {
  const session = await getSession();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  }

  const actor = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { role: true },
  });
  if (!actor || (actor.role !== "ADMIN" && actor.role !== "MODERATOR")) {
    return NextResponse.json({ error: "Admin access required." }, { status: 403 });
  }

  const market = await prisma.market.findUnique({
    where: { id: params.marketId },
    select: { id: true },
  });
  if (!market) {
    return NextResponse.json({ error: "Market not found." }, { status: 404 });
  }

  let body: { flagshipEventAt?: string | null; flagshipEventType?: string | null };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const { flagshipEventAt, flagshipEventType } = body;

  // Both must be set together, or both null to clear
  const isClearing = flagshipEventAt == null && flagshipEventType == null;
  if (!isClearing) {
    if (!flagshipEventAt || !flagshipEventType) {
      return NextResponse.json(
        { error: "Both flagshipEventAt and flagshipEventType must be provided together." },
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
  }

  const updated = await prisma.market.update({
    where: { id: params.marketId },
    data: {
      flagshipEventAt: isClearing ? null : new Date(flagshipEventAt!),
      flagshipEventType: isClearing ? null : flagshipEventType,
    },
    select: {
      id: true,
      title: true,
      status: true,
      flagshipEventAt: true,
      flagshipEventType: true,
    },
  });

  return NextResponse.json({ market: updated });
}
