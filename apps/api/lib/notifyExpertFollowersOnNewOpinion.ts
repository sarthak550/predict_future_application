/**
 * Fan-out: when a verified expert publishes a new opinion, notify everyone
 * who follows that expert via in-app + Expo push.
 *
 * Triggered from persistExpertOpinions after a successful prisma.expertOpinion.create.
 * Fire-and-forget — failures must never block ingestion.
 *
 * Anti-spam: a follower receives at most FOLLOWER_DAILY_CAP notifications from
 * the same expert per IST calendar day (matches the FOLLOWED_USER_PREDICTION
 * throttle pattern in lib/notifications.ts).
 */

import { formatRelativeTime } from "@predict-future/utils";

import { prisma } from "@/lib/prisma";

const FOLLOWER_DAILY_CAP = 3;

function getIstDayBoundsUtc(): { startOfDayUtc: Date; endOfDayUtc: Date } {
  // IST = UTC+5:30
  const istOffsetMs = 5.5 * 60 * 60 * 1000;
  const nowIst = new Date(Date.now() + istOffsetMs);
  const yyyy = nowIst.getUTCFullYear();
  const mm = nowIst.getUTCMonth();
  const dd = nowIst.getUTCDate();
  const startOfDayUtc = new Date(Date.UTC(yyyy, mm, dd) - istOffsetMs);
  const endOfDayUtc = new Date(startOfDayUtc.getTime() + 24 * 60 * 60 * 1000);
  return { startOfDayUtc, endOfDayUtc };
}

async function sendPushBatch(
  messages: Array<{ to: string; title: string; body: string; data?: Record<string, string> }>
): Promise<void> {
  if (messages.length === 0) return;
  const CHUNK = 100;
  for (let i = 0; i < messages.length; i += CHUNK) {
    const chunk = messages.slice(i, i + CHUNK).map((m) => ({ ...m, sound: "default" as const }));
    try {
      await fetch("https://exp.host/--/api/v2/push/send", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify(chunk),
      });
    } catch (err) {
      console.error("[notifyExpertFollowersOnNewOpinion] push chunk error:", err);
    }
  }
}

export async function notifyExpertFollowersOnNewOpinion(opinionId: string): Promise<{
  inAppNotified: number;
  pushQueued: number;
  capSkipped: number;
}> {
  const opinion = await prisma.expertOpinion.findUnique({
    where: { id: opinionId },
    include: {
      expert: { select: { id: true, name: true, organization: true, verified: true } },
      story: { select: { headline: true } },
    },
  });
  if (!opinion) return { inAppNotified: 0, pushQueued: 0, capSkipped: 0 };

  // Only fan out for VERIFIED experts (tier-1) — keeps signal high. Unverified
  // and "Market Analysis from <publication>" attributions don't push.
  if (!opinion.expert.verified || opinion.isSourceAttribution) {
    return { inAppNotified: 0, pushQueued: 0, capSkipped: 0 };
  }

  const followers = await prisma.expertFollow.findMany({
    where: { expertId: opinion.expert.id },
    select: {
      userId: true,
      user: { select: { expoPushToken: true } },
    },
    take: 5000,
  });
  if (followers.length === 0) return { inAppNotified: 0, pushQueued: 0, capSkipped: 0 };

  const { startOfDayUtc, endOfDayUtc } = getIstDayBoundsUtc();

  const sentTodayCounts = await prisma.notification.groupBy({
    by: ["userId"],
    where: {
      userId: { in: followers.map((f) => f.userId) },
      type: "FOLLOWED_USER_OPINION",
      metadata: { path: ["expertId"], equals: opinion.expert.id },
      createdAt: { gte: startOfDayUtc, lt: endOfDayUtc },
    },
    _count: { _all: true },
  });
  const capByUser = new Map<string, number>(
    sentTodayCounts.map((row) => [row.userId, row._count._all])
  );

  const expertLabel = opinion.expert.name
    ? `${opinion.expert.name}${opinion.expert.organization ? ` (${opinion.expert.organization})` : ""}`
    : opinion.expert.organization;
  const directionArrow =
    opinion.direction === "BULLISH" ? "↑" : opinion.direction === "BEARISH" ? "↓" : "→";
  const subject =
    opinion.instrument ??
    opinion.story?.headline?.slice(0, 40) ??
    "new call";
  // Surface when the analyst made the call — protects users from acting on
  // backlog opinions as if they were fresh. Prefers analystCallAt when known.
  const whenSuffix = ` · Called ${formatRelativeTime(opinion.analystCallAt ?? opinion.publishedAt)}`;
  const title = `${expertLabel} — new call`;
  const body = `${directionArrow} ${opinion.direction} on ${subject}${whenSuffix}`;
  const href = opinion.storyId ? `/story/${opinion.storyId}` : null;

  const inAppData: Array<{
    userId: string;
    type: "FOLLOWED_USER_OPINION";
    title: string;
    body: string;
    href: string | null;
    metadata: Record<string, string>;
    storyId?: string;
  }> = [];
  const pushMessages: Array<{ to: string; title: string; body: string; data: Record<string, string> }> = [];
  let capSkipped = 0;

  for (const f of followers) {
    if ((capByUser.get(f.userId) ?? 0) >= FOLLOWER_DAILY_CAP) {
      capSkipped++;
      continue;
    }
    inAppData.push({
      userId: f.userId,
      type: "FOLLOWED_USER_OPINION",
      title,
      body,
      href,
      metadata: { expertId: opinion.expert.id, opinionId: opinion.id },
      ...(opinion.storyId ? { storyId: opinion.storyId } : {}),
    });
    if (f.user.expoPushToken) {
      pushMessages.push({
        to: f.user.expoPushToken,
        title,
        body,
        data: href ? { href } : {},
      });
    }
  }

  if (inAppData.length > 0) {
    await prisma.notification.createMany({ data: inAppData, skipDuplicates: false });
  }
  void sendPushBatch(pushMessages).catch((err) => {
    console.error("[notifyExpertFollowersOnNewOpinion] push batch error:", err);
  });

  return {
    inAppNotified: inAppData.length,
    pushQueued: pushMessages.length,
    capSkipped,
  };
}
