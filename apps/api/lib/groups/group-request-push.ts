/**
 * S56: Push notification helpers for the GroupJoinRequest lifecycle.
 *
 * Two functions:
 *   notifyOwnersAndAdminsOfNewRequest — fires to all OWNER + ADMIN when a request is submitted.
 *   notifyRequesterOfDecision         — fires to the requester when their request is approved/rejected.
 *
 * Both are fire-and-forget. Push failure must never block the HTTP response.
 * Callers should: void notifyOwnersAndAdminsOfNewRequest(...).catch(console.error);
 *
 * Push fan-out is bounded:
 *   - New request: N owners+admins (typically 1–5, not the whole group).
 *   - Decision:    1 requester.
 * No budget gate needed (compare big-call-push which fans out to thousands).
 */

import { prisma } from "@/lib/prisma";

const EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send";
const EXPO_CHUNK_SIZE = 100; // Expo limit per API request

/**
 * Sends push notifications to up to 100 Expo tokens in a single request.
 * Swallows errors — push is advisory, never transactional.
 */
async function sendPushMessages(
  messages: Array<{
    to: string;
    title: string;
    body: string;
    data?: Record<string, string>;
  }>
): Promise<void> {
  if (messages.length === 0) return;

  // Chunk into batches of EXPO_CHUNK_SIZE
  for (let i = 0; i < messages.length; i += EXPO_CHUNK_SIZE) {
    const chunk = messages.slice(i, i + EXPO_CHUNK_SIZE).map((m) => ({
      ...m,
      sound: "default" as const,
    }));

    try {
      await fetch(EXPO_PUSH_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify(chunk),
      });
    } catch (err) {
      console.error("[group-request-push] chunk send error:", err);
    }
  }
}

/**
 * Notify all OWNER and ADMIN members of a group that a new join request has arrived.
 *
 * Fired from POST /api/groups/:id/join-request after the GroupJoinRequest row is created.
 *
 * @param groupId           - The group that received the request.
 * @param requestId         - The GroupJoinRequest id (for deep link).
 * @param requesterUsername - The username of the person who submitted the request.
 */
export async function notifyOwnersAndAdminsOfNewRequest({
  groupId,
  requestId,
  requesterUsername,
}: {
  groupId: string;
  requestId: string;
  requesterUsername: string;
}): Promise<void> {
  // Fetch the group name and the push tokens of all owners/admins in one query.
  const group = await prisma.group.findUnique({
    where: { id: groupId },
    select: {
      name: true,
      memberships: {
        where: {
          role: { in: ["OWNER", "ADMIN"] },
          bannedAt: null,
        },
        select: {
          user: { select: { expoPushToken: true } },
        },
      },
    },
  });

  if (!group) return;

  const tokens = group.memberships
    .map((m) => m.user.expoPushToken)
    .filter((t): t is string => typeof t === "string" && t.length > 0);

  if (tokens.length === 0) return;

  const title = "New join request";
  const body = `${requesterUsername} wants to join ${group.name}.`;
  const deepLink = `/group/${groupId}/requests`;

  const messages = tokens.map((to) => ({
    to,
    title,
    body,
    data: { href: deepLink, requestId },
  }));

  await sendPushMessages(messages);
}

/**
 * Notify the requester that their join request has been approved or rejected.
 *
 * Fired from POST .../approve or POST .../reject after the decision is persisted.
 *
 * @param requestId  - The GroupJoinRequest id (for record-keeping / deep link).
 * @param userId     - The requester's userId.
 * @param approved   - true = approved, false = rejected.
 * @param groupName  - Human-readable group name for the notification body.
 * @param note       - Optional rejection note (ignored on approval).
 */
export async function notifyRequesterOfDecision({
  userId,
  approved,
  groupName,
  groupId,
  note,
}: {
  userId: string;
  approved: boolean;
  groupName: string;
  groupId: string;
  note?: string | null;
}): Promise<void> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { expoPushToken: true },
  });

  if (!user?.expoPushToken) return;

  let title: string;
  let body: string;
  let deepLink: string;

  if (approved) {
    title = "You're in!";
    body = `Your request to join ${groupName} was approved.`;
    deepLink = `/group/${groupId}`;
  } else {
    title = "Request not approved";
    body = `Your request to join ${groupName} wasn't approved.`;
    if (note) {
      body += ` Reason: ${note}`;
    }
    deepLink = `/group/${groupId}`;
  }

  await sendPushMessages([
    {
      to: user.expoPushToken,
      title,
      body,
      data: { href: deepLink },
    },
  ]);
}
