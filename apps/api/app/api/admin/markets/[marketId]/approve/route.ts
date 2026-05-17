import { NextResponse } from "next/server";

import { getSession } from "@/lib/auth";
import { createNotification, notifyFollowers, sendFollowerPushNotifications } from "@/lib/notifications";
import { prisma } from "@/lib/prisma";

/**
 * Sends a push notification to all users with push tokens.
 * Best-effort — failures are logged but never throw.
 */
async function sendBroadcastPush(title: string, body: string, href: string): Promise<void> {
  const BATCH_SIZE = 500;
  const CHUNK_SIZE = 100;
  const allTokens: string[] = [];

  let cursor: string | undefined = undefined;
  while (true) {
    const users: Array<{ id: string; expoPushToken: string | null }> = await prisma.user.findMany({
      where: { expoPushToken: { not: null } },
      select: { id: true, expoPushToken: true },
      take: BATCH_SIZE,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      orderBy: { id: "asc" },
    });
    for (const u of users) {
      if (u.expoPushToken) allTokens.push(u.expoPushToken);
    }
    if (users.length < BATCH_SIZE) break;
    cursor = users[users.length - 1].id;
  }

  for (let i = 0; i < allTokens.length; i += CHUNK_SIZE) {
    const chunk = allTokens.slice(i, i + CHUNK_SIZE);
    const messages = chunk.map((to) => ({
      to,
      sound: "default" as const,
      title,
      body,
      data: { href },
    }));
    try {
      await fetch("https://exp.host/--/api/v2/push/send", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify(messages),
      });
    } catch (chunkError) {
      console.error("[flagship-push] chunk send error:", chunkError);
    }
  }
}

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

  let approvedMarket: {
    id: string;
    title: string;
    creatorId: string;
    flagshipEventAt: Date | null;
  } | null = null;
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

      approvedMarket = {
        id: market.id,
        title: market.title,
        creatorId: market.creatorId,
        flagshipEventAt: market.flagshipEventAt ?? null,
      };
      creatorUsername = market.creator.username;
    });

    // Fire-and-forget follower notifications outside the transaction so they
    // never delay or roll back the approval commit.
    if (approvedMarket) {
      const { id: marketId, title: marketTitle, creatorId, flagshipEventAt } = approvedMarket;
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

      // S32-T5: If this is a flagship event, broadcast push to ALL users
      if (flagshipEventAt != null) {
        void sendBroadcastPush(
          "🔥 New flagship event",
          marketTitle,
          `/market/${marketId}`
        ).catch((err) => console.error("[flagship-push on approve]", err));
      }
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: "Unable to approve market." }, { status: 400 });
  }
}
