import { type NotificationType, type Prisma } from "@prisma/client";

import { prisma } from "@/lib/prisma";
import { getIstDateString } from "@/lib/quests/engine";

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

// ---------------------------------------------------------------------------
// Helpers for notifyFollowersOnPosition
// ---------------------------------------------------------------------------

/**
 * Returns UTC Date boundaries for the current IST calendar day.
 * Mirrors the same pattern used in the quest engine and tip route.
 */
function getIstDayBoundsUtc(): { startOfDayUtc: Date; endOfDayUtc: Date } {
  const istDateStr = getIstDateString();
  const parts = istDateStr.split("-").map(Number) as [number, number, number];
  const [yyyy, mm, dd] = parts;
  const istOffsetMs = 5.5 * 60 * 60 * 1000;
  const startOfDayUtc = new Date(Date.UTC(yyyy, mm - 1, dd) - istOffsetMs);
  const endOfDayUtc = new Date(startOfDayUtc.getTime() + 24 * 60 * 60 * 1000);
  return { startOfDayUtc, endOfDayUtc };
}

/** Max FOLLOWED_USER_PREDICTION notifications a follower may receive per followee per IST day. */
const PREDICTION_NOTIFY_DAILY_CAP = 3;

/**
 * Returns how many FOLLOWED_USER_PREDICTION notifications `followerId` has
 * already received from `followeeId` today (IST boundary).
 */
async function getPredictionPushQuota(
  followerId: string,
  followeeId: string
): Promise<number> {
  const { startOfDayUtc, endOfDayUtc } = getIstDayBoundsUtc();
  return prisma.notification.count({
    where: {
      userId: followerId,
      type: "FOLLOWED_USER_PREDICTION",
      // metadata stores the followeeId so we can scope count per pair
      metadata: { path: ["followeeId"], equals: followeeId },
      createdAt: { gte: startOfDayUtc, lt: endOfDayUtc },
    },
  });
}

/**
 * Notify followers of `followeeId` that they just placed a position.
 *
 * Anti-spam throttle: each follower receives at most 3 FOLLOWED_USER_PREDICTION
 * notifications per followee per IST calendar day (both in-app and push).
 *
 * Must be called OUTSIDE any open transaction and fire-and-forget.
 * Caller must void + catch — failures must never surface to position creation.
 *
 * @param followeeId  - The user who placed the position.
 * @param followeeUsername - Display name for notification copy.
 * @param market - Minimal market data needed for the notification.
 * @param side - Human-readable label (e.g. "YES", "NO", "Option A", "123").
 * @param amount - Points staked.
 */
export async function notifyFollowersOnPosition(
  followeeId: string,
  followeeUsername: string,
  market: { id: string; title: string },
  side: string,
  amount: number
): Promise<void> {
  // Fetch all followers (up to 500) with push tokens.
  const follows = await prisma.follow.findMany({
    where: { followeeId },
    select: {
      followerId: true,
      follower: {
        select: { id: true, expoPushToken: true },
      },
    },
    orderBy: { createdAt: "asc" },
    take: 500,
  });

  if (follows.length === 0) return;

  const title = `${followeeUsername} made a call`;
  const body = `${followeeUsername} called ${side} on "${market.title}" — ${amount} pts`;
  const href = `/market/${market.id}`;

  // Check quota per follower, then batch-create notifications for those under the cap.
  const quotas = await Promise.all(
    follows.map((f) => getPredictionPushQuota(f.followerId, followeeId))
  );

  const eligibleFollowers = follows.filter((_, i) => quotas[i] < PREDICTION_NOTIFY_DAILY_CAP);

  if (eligibleFollowers.length === 0) return;

  // Batch in-app notifications for all eligible followers.
  await prisma.notification.createMany({
    data: eligibleFollowers.map((f) => ({
      userId: f.followerId,
      type: "FOLLOWED_USER_PREDICTION" as const,
      title,
      body,
      href,
      marketId: market.id,
      // Store followeeId in metadata so the daily quota query can scope per-pair.
      metadata: { followeeId },
    })),
    skipDuplicates: true,
  });

  // Send push notifications to eligible followers who have an Expo token.
  const pushTokens = eligibleFollowers
    .map((f) => f.follower.expoPushToken)
    .filter((t): t is string => typeof t === "string" && t.length > 0);

  if (pushTokens.length === 0) return;

  // Expo Push API supports up to 100 messages per request.
  for (let i = 0; i < pushTokens.length; i += 100) {
    const chunk = pushTokens.slice(i, i + 100);
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
