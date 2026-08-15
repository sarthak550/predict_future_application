/**
 * Growth Loop Sprint G5 (Decision 5) — fan out OPINION_RESOLVED notifications
 * to an expert's FOLLOWERS when one of their calls resolves, alongside (not
 * replacing) notifyOpinionResolution.ts's existing voter fan-out.
 *
 * A sibling function, not a change to notifyOpinionResolution itself: that
 * function's voter path has its own milestone/streak/accuracy machinery that
 * must keep working unchanged (founder brief — "no schema changes needed"
 * and "deleting or materially changing notifyOpinionResolution's existing
 * voter behavior" is explicitly out of scope). Followers get a plainer
 * message — they didn't vote on this specific call, they just follow the
 * analyst — so a separate, simpler function is the more honest fit than
 * threading a second code path through the voter function's per-voter
 * accuracy computation.
 *
 * Same anti-spam pattern as notifyExpertFollowersOnNewOpinion.ts
 * (FOLLOWER_DAILY_CAP = 3/expert/user/IST-day) — reused verbatim, not a
 * second cap constant, per the brief's explicit instruction. The cap check
 * filters on `type: "OPINION_RESOLVED"` AND `metadata.reason:
 * "followed_expert"`, so it counts only follower-driven resolution alerts —
 * the existing voter-driven OPINION_RESOLVED notifications (which set no
 * metadata at all) never collide with this count.
 *
 * `suppressedAt: null` guard (new — notifyOpinionResolution's voter path
 * doesn't need one, since voting already implies the opinion was visible
 * when cast; a follower could otherwise be pinged about a call that's since
 * been pulled from the public scorecard).
 *
 * Deliberately NOT gated on `expert.verified` (unlike
 * notifyExpertFollowersOnNewOpinion's tier-1 signal-quality gate for its
 * firehose new-opinion fan-out): a user explicitly chose to follow this
 * specific expert via FollowExpertButton (G1), which itself isn't gated on
 * verified status — honoring an explicit follow shouldn't depend on a
 * signal-quality heuristic designed for a different, broader firehose.
 *
 * `href` points at `/calls/${opinionId}` — the real, working web share page
 * — NOT `/story/${storyId}` (notifyOpinionResolution's voter-facing href),
 * which is a mobile-only deep-link path apps/web doesn't route.
 */

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
      console.error("[notifyExpertFollowersOnOpinionResolution] push chunk error:", err);
    }
  }
}

/**
 * Call AFTER opinion.resolutionStatus is already set to RESOLVED_HIT/
 * RESOLVED_MISS (same timing contract as notifyOpinionResolution) — at all
 * three sites that resolve an opinion: admin/expert-opinions/[id]/resolve,
 * and cron/auto-resolve-opinions' sweep (Phase 0) and main resolution loop.
 * Safe to call unconditionally; no-ops cleanly if the opinion isn't
 * resolved, is suppressed, or has zero followers.
 */
export async function notifyExpertFollowersOnOpinionResolution(opinionId: string): Promise<{
  inAppNotified: number;
  pushQueued: number;
  capSkipped: number;
}> {
  const opinion = await prisma.expertOpinion.findUnique({
    where: { id: opinionId },
    select: {
      id: true,
      direction: true,
      instrument: true,
      resolutionStatus: true,
      suppressedAt: true,
      expert: { select: { id: true, name: true, organization: true } },
    },
  });
  if (!opinion) return { inAppNotified: 0, pushQueued: 0, capSkipped: 0 };
  if (opinion.suppressedAt) return { inAppNotified: 0, pushQueued: 0, capSkipped: 0 };
  if (opinion.resolutionStatus !== "RESOLVED_HIT" && opinion.resolutionStatus !== "RESOLVED_MISS") {
    return { inAppNotified: 0, pushQueued: 0, capSkipped: 0 };
  }

  const followers = await prisma.expertFollow.findMany({
    where: { expertId: opinion.expert.id },
    select: { userId: true, user: { select: { expoPushToken: true } } },
    take: 5000,
  });
  if (followers.length === 0) return { inAppNotified: 0, pushQueued: 0, capSkipped: 0 };

  const { startOfDayUtc, endOfDayUtc } = getIstDayBoundsUtc();

  const sentTodayCounts = await prisma.notification.groupBy({
    by: ["userId"],
    where: {
      userId: { in: followers.map((f) => f.userId) },
      type: "OPINION_RESOLVED",
      metadata: { path: ["reason"], equals: "followed_expert" },
      createdAt: { gte: startOfDayUtc, lt: endOfDayUtc },
    },
    _count: { _all: true },
  });
  const capByUser = new Map<string, number>(sentTodayCounts.map((row) => [row.userId, row._count._all]));

  const expertLabel = opinion.expert.name
    ? `${opinion.expert.name}${opinion.expert.organization ? ` (${opinion.expert.organization})` : ""}`
    : opinion.expert.organization;
  const resolutionLabel = opinion.resolutionStatus === "RESOLVED_HIT" ? "HIT" : "MISS";
  const subject = opinion.instrument ?? "a call";
  const title = `${expertLabel} — ${resolutionLabel}`;
  const body = `Their call on ${subject} resolved ${resolutionLabel}. See the full breakdown.`;
  const href = `/calls/${opinion.id}`;

  const inAppData: Array<{
    userId: string;
    type: "OPINION_RESOLVED";
    title: string;
    body: string;
    href: string;
    metadata: { expertId: string; opinionId: string; reason: string };
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
      type: "OPINION_RESOLVED",
      title,
      body,
      href,
      metadata: { expertId: opinion.expert.id, opinionId: opinion.id, reason: "followed_expert" },
    });
    if (f.user.expoPushToken) {
      pushMessages.push({ to: f.user.expoPushToken, title, body, data: { href } });
    }
  }

  if (inAppData.length > 0) {
    await prisma.notification.createMany({ data: inAppData, skipDuplicates: false });
  }
  void sendPushBatch(pushMessages).catch((err) => {
    console.error("[notifyExpertFollowersOnOpinionResolution] push batch error:", err);
  });

  return { inAppNotified: inAppData.length, pushQueued: pushMessages.length, capSkipped };
}
