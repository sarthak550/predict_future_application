import { NextResponse } from "next/server";

import { getSession } from "@/lib/auth";
import { createNotification } from "@/lib/notifications";
import { prisma } from "@/lib/prisma";

export async function POST(
  _request: Request,
  { params }: { params: { marketId: string } }
) {
  const session = await getSession();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  }

  const actor = await prisma.user.findUnique({
    where: { id: session.user.id }
  });
  if (!actor || (actor.role !== "ADMIN" && actor.role !== "MODERATOR") || actor.isSuspended) {
    return NextResponse.json({ error: "Admin access required." }, { status: 403 });
  }

  try {
    await prisma.$transaction(async (tx) => {
      const market = await tx.market.findUnique({
        where: { id: params.marketId }
      });
      if (!market) {
        throw new Error("Market not found.");
      }
      if (market.status !== "DRAFT" && market.status !== "PENDING_REVIEW") {
        throw new Error("Only pending markets can be approved.");
      }

      await tx.market.update({
        where: { id: market.id },
        data: {
          status: "OPEN",
          approvedAt: new Date(),
          approvedById: actor.id
        }
      });

      await tx.adminAction.create({
        data: {
          actorId: actor.id,
          marketId: market.id,
          type: "APPROVE_MARKET"
        }
      });

      await createNotification(tx, {
        userId: market.creatorId,
        marketId: market.id,
        type: "MARKET_APPROVED",
        title: "Market approved",
        body: `${market.title} is now live for forecasting.`,
        href: `/markets/${market.id}`
      });
    });

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: "Unable to approve market." }, { status: 400 });
  }
}
