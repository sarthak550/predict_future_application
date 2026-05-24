import { prisma } from "@/lib/prisma";

type Agreement = "AGREED" | "DISAGREED" | "NEUTRAL";

function implicationChoiceToAgreement(choice: string): Agreement {
  switch (choice) {
    case "STRONGLY_AGREE":
    case "AGREE":
    case "STRONG_GAIN":
    case "MILD_GAIN":
    case "BULLISH":
      return "AGREED";
    case "STRONGLY_DISAGREE":
    case "DISAGREE":
    case "STRONG_DROP":
    case "MILD_DROP":
    case "BEARISH":
      return "DISAGREED";
    default:
      return "NEUTRAL";
  }
}

type AccuracyStats = { pct: number; correct: number; total: number } | null;

async function computeUserOpinionAccuracyDetailed(userId: string): Promise<AccuracyStats> {
  const votes = await prisma.expertOpinionVote.findMany({
    where: {
      userId,
      pollType: "IMPLICATION",
      lockedAt: { not: null },
      opinion: { resolutionStatus: { in: ["RESOLVED_HIT", "RESOLVED_MISS"] } },
    },
    select: {
      choice: true,
      opinion: { select: { resolutionStatus: true } },
    },
  });

  const scoreable = votes.filter((v) => implicationChoiceToAgreement(v.choice) !== "NEUTRAL");
  if (scoreable.length === 0) return null;

  const correct = scoreable.filter((v) => {
    const a = implicationChoiceToAgreement(v.choice);
    const isHit = v.opinion.resolutionStatus === "RESOLVED_HIT";
    return (a === "AGREED" && isHit) || (a === "DISAGREED" && !isHit);
  });
  return {
    pct: Math.round((correct.length / scoreable.length) * 100),
    correct: correct.length,
    total: scoreable.length,
  };
}

async function computeUserOpinionAccuracy(userId: string): Promise<number | null> {
  const detail = await computeUserOpinionAccuracyDetailed(userId);
  return detail?.pct ?? null;
}

/**
 * Batch-fetch accuracy stats for a list of user IDs in a single query.
 * Returns a Map<userId, AccuracyStats>. Users with no scoreable votes map to null.
 */
async function computeUserOpinionAccuracyBatch(
  userIds: string[]
): Promise<Map<string, AccuracyStats>> {
  const result = new Map<string, AccuracyStats>();
  if (userIds.length === 0) return result;

  // Single query: all resolved IMPLICATION votes for the given users.
  const votes = await prisma.expertOpinionVote.findMany({
    where: {
      userId: { in: userIds },
      pollType: "IMPLICATION",
      lockedAt: { not: null },
      opinion: { resolutionStatus: { in: ["RESOLVED_HIT", "RESOLVED_MISS"] } },
    },
    select: {
      userId: true,
      choice: true,
      opinion: { select: { resolutionStatus: true } },
    },
  });

  // Group by userId and compute stats in JS.
  const byUser = new Map<string, typeof votes>();
  for (const v of votes) {
    if (!byUser.has(v.userId)) byUser.set(v.userId, []);
    byUser.get(v.userId)!.push(v);
  }

  for (const userId of userIds) {
    const userVotes = byUser.get(userId) ?? [];
    const scoreable = userVotes.filter((v) => implicationChoiceToAgreement(v.choice) !== "NEUTRAL");
    if (scoreable.length === 0) {
      result.set(userId, null);
      continue;
    }
    const correct = scoreable.filter((v) => {
      const a = implicationChoiceToAgreement(v.choice);
      const isHit = v.opinion.resolutionStatus === "RESOLVED_HIT";
      return (a === "AGREED" && isHit) || (a === "DISAGREED" && !isHit);
    });
    result.set(userId, {
      pct: Math.round((correct.length / scoreable.length) * 100),
      correct: correct.length,
      total: scoreable.length,
    });
  }

  return result;
}

// ─── R3: accuracy milestone detection ─────────────────────────────────────────

const CORRECT_MILESTONES = [5, 10, 25, 50, 100, 250, 500] as const;
const STREAK_MILESTONE = 3; // 3 correct calls in a row

async function getLastThreeOutcomes(userId: string): Promise<boolean[]> {
  const recent = await prisma.expertOpinionVote.findMany({
    where: {
      userId,
      pollType: "IMPLICATION",
      lockedAt: { not: null },
      opinion: { resolutionStatus: { in: ["RESOLVED_HIT", "RESOLVED_MISS"] } },
    },
    select: {
      choice: true,
      opinion: { select: { resolutionStatus: true, resolvedAt: true } },
    },
    orderBy: { opinion: { resolvedAt: "desc" } },
    take: 3,
  });
  return recent
    .filter((v) => implicationChoiceToAgreement(v.choice) !== "NEUTRAL")
    .map((v) => {
      const a = implicationChoiceToAgreement(v.choice);
      const isHit = v.opinion.resolutionStatus === "RESOLVED_HIT";
      return (a === "AGREED" && isHit) || (a === "DISAGREED" && !isHit);
    });
}

async function alreadyAwarded(userId: string, milestoneKey: string): Promise<boolean> {
  const existing = await prisma.notification.findFirst({
    where: {
      userId,
      type: "STREAK_MILESTONE",
      metadata: { path: ["key"], equals: milestoneKey },
    },
    select: { id: true },
  });
  return Boolean(existing);
}

async function awardMilestone(
  userId: string,
  milestoneKey: string,
  title: string,
  body: string,
  expoPushToken: string | null
): Promise<{ inApp: boolean; push: boolean }> {
  if (await alreadyAwarded(userId, milestoneKey)) return { inApp: false, push: false };

  await prisma.notification.create({
    data: {
      userId,
      type: "STREAK_MILESTONE",
      title,
      body,
      href: "/finance/my-calls",
      metadata: { key: milestoneKey },
    },
  });
  if (expoPushToken) {
    void sendPushBatch([{ to: expoPushToken, title, body, data: { href: "/finance/my-calls" } }]).catch(
      (err) => console.error("[milestone] push error:", err)
    );
  }
  return { inApp: true, push: Boolean(expoPushToken) };
}

async function detectAndAwardMilestones(
  userId: string,
  stats: AccuracyStats,
  expoPushToken: string | null
): Promise<{ awarded: number }> {
  if (!stats) return { awarded: 0 };
  let awarded = 0;

  // Count milestone (exact match — fires once when correct count equals the threshold)
  if (CORRECT_MILESTONES.includes(stats.correct as (typeof CORRECT_MILESTONES)[number])) {
    const title = `🎯 ${stats.correct} correct calls!`;
    const body = `You're at ${stats.pct}% accuracy across ${stats.total} resolved calls. Tap to see your record.`;
    const res = await awardMilestone(userId, `correct-${stats.correct}`, title, body, expoPushToken);
    if (res.inApp) awarded++;
  }

  // Streak — fires each time the last 3 are all correct, but deduped per
  // current-correct-count so a single hot streak doesn't ping repeatedly.
  const last3 = await getLastThreeOutcomes(userId);
  if (last3.length === STREAK_MILESTONE && last3.every(Boolean)) {
    const title = "🔥 3 in a row!";
    const body = `Three correct calls back-to-back. Your accuracy: ${stats.pct}%.`;
    const res = await awardMilestone(userId, `streak-3-at-${stats.correct}`, title, body, expoPushToken);
    if (res.inApp) awarded++;
  }

  return { awarded };
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
      console.error("[notifyOpinionResolution] push chunk error:", err);
    }
  }
}

/**
 * Fan out push + in-app notifications to all locked Poll A voters of a resolved opinion.
 * Skips silently if the opinion is still PENDING. Safe to call multiple times — uses
 * skipDuplicates on the notification table, but won't dedupe the push send.
 *
 * Callers (admin manual resolve, auto-resolve cron) should call this once per resolution
 * AFTER the opinion's resolutionStatus is set to RESOLVED_HIT or RESOLVED_MISS.
 */
export async function notifyOpinionResolution(opinionId: string): Promise<{
  notified: number;
  pushQueued: number;
}> {
  const opinion = await prisma.expertOpinion.findUnique({
    where: { id: opinionId },
    include: {
      expert: { select: { name: true, organization: true } },
      story: { select: { headline: true, latestResolvedAt: true } },
    },
  });
  if (!opinion) return { notified: 0, pushQueued: 0 };
  if (opinion.resolutionStatus !== "RESOLVED_HIT" && opinion.resolutionStatus !== "RESOLVED_MISS") {
    return { notified: 0, pushQueued: 0 };
  }

  // Bump Story.latestResolvedAt = max(current, opinion.resolvedAt) so the
  // "Resolved only" feed can paginate by recency-of-resolution.
  if (opinion.storyId && opinion.resolvedAt) {
    const current = opinion.story?.latestResolvedAt;
    if (!current || opinion.resolvedAt > current) {
      await prisma.story.update({
        where: { id: opinion.storyId },
        data: { latestResolvedAt: opinion.resolvedAt },
      });
    }
  }

  const expertLabel = opinion.expert.name
    ? `${opinion.expert.name} (${opinion.expert.organization})`
    : opinion.expert.organization;
  const instrumentLabel = opinion.instrument
    ? opinion.instrument
    : opinion.story?.headline
      ? opinion.story.headline.slice(0, 40) + (opinion.story.headline.length > 40 ? "…" : "")
      : "a call";
  const directionLabel =
    opinion.direction === "BULLISH" ? "BULLISH" : opinion.direction === "BEARISH" ? "BEARISH" : "NEUTRAL";
  const resolutionLabel = opinion.resolutionStatus === "RESOLVED_HIT" ? "HIT" : "MISS";

  const pollAVoters = await prisma.expertOpinionVote.findMany({
    where: { opinionId, pollType: "IMPLICATION", lockedAt: { not: null } },
    select: {
      userId: true,
      choice: true,
      user: { select: { expoPushToken: true } },
    },
  });
  if (pollAVoters.length === 0) return { notified: 0, pushQueued: 0 };

  const pushMessages: Array<{ to: string; title: string; body: string; data: Record<string, string> }> = [];
  const inAppNotifications: Array<{
    userId: string;
    type: "OPINION_RESOLVED";
    title: string;
    body: string;
    href: string | null;
  }> = [];

  const milestoneTasks: Array<Promise<void>> = [];

  // Batch-fetch accuracy for all voters in a single query — eliminates N+1.
  const voterUserIds = pollAVoters.map((v) => v.userId);
  const accuracyByUser = await computeUserOpinionAccuracyBatch(voterUserIds);

  const CONCURRENCY = 20;
  for (let i = 0; i < pollAVoters.length; i += CONCURRENCY) {
    const slice = pollAVoters.slice(i, i + CONCURRENCY);
    await Promise.all(
      slice.map(async (voter) => {
        const agreement = implicationChoiceToAgreement(voter.choice);
        const agreedPhrase =
          agreement === "AGREED" ? "You agreed" : agreement === "DISAGREED" ? "You disagreed" : "You were neutral";

        const stats = accuracyByUser.get(voter.userId) ?? null;
        const accuracySuffix = stats !== null ? ` Your accuracy is now ${stats.pct}%.` : "";

        const title = `${expertLabel} — ${directionLabel} on ${instrumentLabel}`;
        const body = `Resolved ${resolutionLabel}. ${agreedPhrase}.${accuracySuffix}`;
        const href = opinion.storyId ? `/story/${opinion.storyId}` : null;

        inAppNotifications.push({ userId: voter.userId, type: "OPINION_RESOLVED", title, body, href });
        if (voter.user.expoPushToken) {
          pushMessages.push({ to: voter.user.expoPushToken, title, body, data: href ? { href } : {} });
        }

        // R3: queue milestone detection (runs after the main fan-out so the
        // resolution push lands first). Only meaningful for non-neutral voters.
        if (agreement !== "NEUTRAL" && stats) {
          milestoneTasks.push(
            detectAndAwardMilestones(voter.userId, stats, voter.user.expoPushToken)
              .then(() => undefined)
              .catch((err) => {
                console.error(`[milestone] detection failed for ${voter.userId}:`, err);
              })
          );
        }
      })
    );
  }

  // Fire milestones in the background — never block resolution response.
  void Promise.all(milestoneTasks);

  await prisma.notification.createMany({
    data: inAppNotifications.map((n) => ({
      userId: n.userId,
      type: n.type,
      title: n.title,
      body: n.body,
      href: n.href,
      storyId: opinion.storyId ?? undefined,
    })),
    skipDuplicates: true,
  });

  void sendPushBatch(pushMessages).catch((err) => {
    console.error("[notifyOpinionResolution] push batch error:", err);
  });

  return { notified: inAppNotifications.length, pushQueued: pushMessages.length };
}
