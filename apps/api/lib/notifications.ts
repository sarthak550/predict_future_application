import { type NotificationType, type Prisma } from "@prisma/client";

import { prisma } from "@/lib/prisma";

type TxClient = Prisma.TransactionClient;

export async function createNotification(
  tx: TxClient,
  input: {
    userId: string;
    type: NotificationType;
    title: string;
    body: string;
    href?: string;
    storyId?: string;
    marketId?: string;
    metadata?: Prisma.JsonObject;
  }
) {
  await tx.notification.create({
    data: input
  });
}

export async function notifyMany(
  tx: TxClient,
  userIds: string[],
  payload: Omit<Parameters<typeof createNotification>[1], "userId">
) {
  const uniqueUserIds = Array.from(new Set(userIds));
  if (uniqueUserIds.length === 0) {
    return;
  }

  await tx.notification.createMany({
    data: uniqueUserIds.map((userId) => ({
      userId,
      ...payload
    }))
  });
}

/**
 * Creates in-app notifications for all followers of a given user.
 *
 * V1 cap: takes the first 500 followers only.
 * TODO S24-T3: implement cursor pagination beyond 500 followers for large accounts.
 *
 * Must be called outside any open transaction so it can use a fresh client.
 * Fire-and-forget — caller should void + catch.
 */
export async function notifyFollowers(
  followeeId: string,
  payload: Omit<Parameters<typeof createNotification>[1], "userId">
): Promise<void> {
  const follows = await prisma.follow.findMany({
    where: { followeeId },
    select: { followerId: true },
    orderBy: { createdAt: "asc" },
    // V1 cap: 500 followers max — TODO cursor-paginate for accounts beyond this limit
    take: 500,
  });

  if (follows.length === 0) return;

  const followerIds = follows.map((f) => f.followerId);

  await prisma.notification.createMany({
    data: followerIds.map((userId) => ({
      userId,
      ...payload,
    })),
    skipDuplicates: true,
  });
}

/**
 * Sends best-effort Expo push notifications to all followers of a given user.
 *
 * V1 cap: 500 followers max (aligned with notifyFollowers).
 * Batches into chunks of 100 per Expo API limit.
 * Failures are swallowed — push delivery is advisory, not transactional.
 * Fire-and-forget — caller should void + catch.
 */
export async function sendFollowerPushNotifications(
  followeeId: string,
  title: string,
  body: string
): Promise<void> {
  // Fetch followers with push tokens in a single join — skip those with no token.
  const follows = await prisma.follow.findMany({
    where: { followeeId },
    select: {
      follower: {
        select: { expoPushToken: true },
      },
    },
    orderBy: { createdAt: "asc" },
    // V1 cap aligned with notifyFollowers
    take: 500,
  });

  const tokens = follows
    .map((f) => f.follower.expoPushToken)
    .filter((t): t is string => typeof t === "string" && t.length > 0);

  if (tokens.length === 0) return;

  // Expo Push API supports up to 100 messages per request
  for (let i = 0; i < tokens.length; i += 100) {
    const chunk = tokens.slice(i, i + 100);
    const messages = chunk.map((to) => ({
      to,
      sound: "default" as const,
      title,
      body,
    }));

    await fetch("https://exp.host/--/api/v2/push/send", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify(messages),
    });
  }
}
