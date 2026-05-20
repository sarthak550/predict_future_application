import { NextResponse } from "next/server";

import { prisma } from "@/lib/prisma";

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
 * Idempotent: running twice on the same day produces duplicate notifications
 * because notifications have no unique constraint; the cron schedule (weekly)
 * is the deduplication guard.
 */
export async function POST(request: Request) {
  const expectedSecret = process.env.CRON_SECRET;
  if (!expectedSecret || request.headers.get("Authorization") !== `Bearer ${expectedSecret}`) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  // Find all Poll A votes on opinions that resolved in the past 7 days
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

  const votes = await prisma.expertOpinionVote.findMany({
    where: {
      pollType: "IMPLICATION",
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
    return NextResponse.json({ ok: true, notified: 0, reason: "all resolved votes were neutral" });
  }

  // Build notification records for all affected users
  const notificationData = Array.from(userSummaries.entries()).map(([userId, { hits, misses }]) => ({
    userId,
    type: "SYSTEM" as const,
    title: "Your week in calls",
    body: `${hits} HIT, ${misses} MISS this week. Tap to review your calls.`,
    href: "/finance/my-calls",
  }));

  // Batch-create notifications — skip any duplicates (shouldn't happen, but defensive)
  await prisma.notification.createMany({
    data: notificationData,
    skipDuplicates: false,
  });

  console.log(`[weekly-calls-digest] notified ${notificationData.length} users`);

  return NextResponse.json({ ok: true, notified: notificationData.length });
}
