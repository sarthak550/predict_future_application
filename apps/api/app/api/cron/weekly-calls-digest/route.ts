import { NextResponse } from "next/server";

import { prisma } from "@/lib/prisma";

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
      console.error("[weekly-calls-digest] push chunk error:", err);
    }
  }
}

/**
 * Returns ISO week key in the form "YYYY-WNN", e.g. "2026-W21".
 * Uses the ISO week number definition (week starts Monday).
 */
function getIsoWeekKey(date: Date): string {
  // Thursday-based ISO week: find the Thursday of the current week to get the year.
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  // Set to nearest Thursday (day 4); current day 0=Sun → 1-based offset
  d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7));
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const weekNum = Math.ceil(((d.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
  return `${d.getUTCFullYear()}-W${String(weekNum).padStart(2, "0")}`;
}

/**
 * POST /api/cron/weekly-calls-digest
 *
 * Runs every Sunday at 09:00 IST (03:30 UTC via vercel.json).
 *
 * For every user who voted on at least one expert-opinion Poll A (IMPLICATION)
 * that resolved in the past 7 days, creates an in-app SYSTEM notification
 * summarising their week in calls: "Your week in calls — X HIT, Y MISS."
 *
 * Auth: Bearer CRON_SECRET required.
 * Idempotent: a WeeklyDigestRun row is inserted at the start. On Prisma P2002
 * (unique violation on weekKey), the cron returns early without sending any
 * notifications — safe against Vercel 502 retries.
 */
export async function POST(request: Request) {
  const expectedSecret = process.env.CRON_SECRET;
  if (!expectedSecret || request.headers.get("Authorization") !== `Bearer ${expectedSecret}`) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  // --- Idempotency guard ---
  const weekKey = getIsoWeekKey(new Date());
  try {
    await prisma.weeklyDigestRun.create({ data: { weekKey } });
  } catch (err: unknown) {
    // P2002 = unique constraint violation → already ran this week
    if (
      typeof err === "object" &&
      err !== null &&
      "code" in err &&
      (err as { code: string }).code === "P2002"
    ) {
      console.log(`[weekly-calls-digest] already ran for ${weekKey}, skipping`);
      return NextResponse.json({ ok: true, skipped: true, reason: "already-ran-this-week" });
    }
    throw err;
  }

  // Find all Poll A votes on opinions that resolved in the past 7 days
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

  const votes = await prisma.expertOpinionVote.findMany({
    where: {
      pollType: "IMPLICATION",
      lockedAt: { not: null }, // Only locked votes count toward the weekly digest
      opinion: {
        resolutionStatus: { in: ["RESOLVED_HIT", "RESOLVED_MISS"] },
        resolvedAt: { gte: sevenDaysAgo },
      },
    },
    select: {
      userId: true,
      choice: true,
      opinion: { select: { resolutionStatus: true } },
    },
  });

  if (votes.length === 0) {
    await prisma.weeklyDigestRun.update({
      where: { weekKey },
      data: { completedAt: new Date(), userCount: 0, pushCount: 0 },
    });
    return NextResponse.json({ ok: true, notified: 0, reason: "no resolved votes in past 7 days" });
  }

  // Group by userId and compute per-user hit/miss counts
  function choiceToAgreed(choice: string): boolean | null {
    switch (choice) {
      case "STRONGLY_AGREE":
      case "AGREE":
      case "STRONG_GAIN":
      case "MILD_GAIN":
      case "BULLISH":
        return true;
      case "STRONGLY_DISAGREE":
      case "DISAGREE":
      case "STRONG_DROP":
      case "MILD_DROP":
      case "BEARISH":
        return false;
      default:
        return null;
    }
  }

  const userSummaries = new Map<string, { hits: number; misses: number }>();

  for (const vote of votes) {
    const agreed = choiceToAgreed(vote.choice);
    if (agreed === null) continue; // neutral — exclude from HIT/MISS count

    const isHit = vote.opinion.resolutionStatus === "RESOLVED_HIT";
    const wasCorrect = agreed ? isHit : !isHit;

    const summary = userSummaries.get(vote.userId) ?? { hits: 0, misses: 0 };
    if (wasCorrect) {
      summary.hits++;
    } else {
      summary.misses++;
    }
    userSummaries.set(vote.userId, summary);
  }

  if (userSummaries.size === 0) {
    await prisma.weeklyDigestRun.update({
      where: { weekKey },
      data: { completedAt: new Date(), userCount: 0, pushCount: 0 },
    });
    return NextResponse.json({ ok: true, notified: 0, reason: "all resolved votes were neutral" });
  }

  // Build notification records for all affected users.
  // Body copy: prefer accuracy framing when there's at least one wrong; otherwise celebrate.
  const userIds = Array.from(userSummaries.keys());
  const usersWithTokens = await prisma.user.findMany({
    where: { id: { in: userIds } },
    select: { id: true, expoPushToken: true },
  });
  const tokenByUser = new Map(usersWithTokens.map((u) => [u.id, u.expoPushToken]));

  const notificationData: Array<{
    userId: string;
    type: "SYSTEM";
    title: string;
    body: string;
    href: string;
  }> = [];
  const pushMessages: Array<{ to: string; title: string; body: string; data: Record<string, string> }> = [];

  for (const [userId, { hits, misses }] of userSummaries) {
    const total = hits + misses;
    const pct = total > 0 ? Math.round((hits / total) * 100) : null;
    const title = "Your week in calls";
    const body =
      misses === 0
        ? `${hits} correct, 0 wrong — perfect week. Tap to review.`
        : `${hits} correct, ${misses} wrong${pct !== null ? ` (${pct}% accurate)` : ""}. Tap to review.`;
    const href = "/finance/my-calls";

    notificationData.push({ userId, type: "SYSTEM", title, body, href });
    const token = tokenByUser.get(userId);
    if (token) {
      pushMessages.push({ to: token, title, body, data: { href } });
    }
  }

  await prisma.notification.createMany({ data: notificationData, skipDuplicates: false });

  void sendPushBatch(pushMessages).catch((err) => {
    console.error("[weekly-calls-digest] push batch error:", err);
  });

  // Mark run as complete with stats
  await prisma.weeklyDigestRun.update({
    where: { weekKey },
    data: {
      completedAt: new Date(),
      userCount: notificationData.length,
      pushCount: pushMessages.length,
    },
  });

  console.log(
    `[weekly-calls-digest] notified ${notificationData.length} users in-app, ${pushMessages.length} push queued`
  );

  return NextResponse.json({
    ok: true,
    notified: notificationData.length,
    pushQueued: pushMessages.length,
  });
}
