import { NextResponse } from "next/server";

import { getSession } from "@/lib/auth";
import { createNotification, notifyFollowers, sendFollowerPushNotifications } from "@/lib/notifications";
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
  if (!actor || (actor.role !== "ADMIN" && actor.role !== "MODERATOR")) {
    return NextResponse.json({ error: "Admin access required." }, { status: 403 });
  }

  let approvedMarket: { id: string; title: string; creatorId: string } | null = null;
  let creatorUsername = "";

  try {
    await prisma.$transaction(async (tx) => {
      const market = await tx.market.findUnique({
        where: { id: params.marketId },
        include: { creator: { select: { username: true } } }
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

      approvedMarket = { id: market.id, title: market.title, creatorId: market.creatorId };
      creatorUsername = market.creator.username;
    });

    // Fire-and-forget follower notifications outside the transaction so they
    // never delay or roll back the approval commit.
    if (approvedMarket) {
      const { id: marketId, title: marketTitle, creatorId } = approvedMarket;
      const notifTitle = `${creatorUsername} published a new market`;

      void notifyFollowers(creatorId, {
        type: "FOLLOWED_USER_MARKET",
        title: notifTitle,
        body: marketTitle,
        href: `/markets/${marketId}`,
        marketId,
      }).catch((err) => console.error("[notifyFollowers market]", err));

      void sendFollowerPushNotifications(creatorId, notifTitle, marketTitle).catch(
        (err) => console.error("[sendFollowerPushNotifications market]", err)
      );
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: "Unable to approve market." }, { status: 400 });
  }
}
