/**
 * POST /api/cron/award-reasoning-badges
 *
 * Awards the "Best Reasoner" badge (slug: best-reasoner-1) to the top 1% of
 * users by cumulative reasoning upvotes. Minimum threshold: 5 upvotes.
 *
 * Schedule: 30 3 * * * (03:30 UTC — 09:00 IST)
 *
 * Auth: CRON_SECRET header or bearer token.
 */

import { NextResponse } from "next/server";

import { prisma } from "@/lib/prisma";

function hasCronAccess(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    // No secret configured — allow (useful in dev).
    return true;
  }
  const authHeader = request.headers.get("authorization");
  const cronHeader = request.headers.get("x-cron-secret");
  return authHeader === `Bearer ${secret}` || cronHeader === secret;
}

export async function POST(request: Request) {
  if (!hasCronAccess(request)) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  // Aggregate total reasoning upvotes per user across all their positions.
  const upvoteTotals = await prisma.marketPosition.groupBy({
    by: ["userId"],
    _sum: { reasoningUpvotes: true },
    having: {
      reasoningUpvotes: { _sum: { gte: 5 } },
    },
    orderBy: { _sum: { reasoningUpvotes: "desc" } },
  });

  if (upvoteTotals.length === 0) {
    return NextResponse.json({ awarded: 0, skipped: 0 });
  }

  // Top 1% (at least 1 user).
  const topCount = Math.max(1, Math.ceil(upvoteTotals.length * 0.01));
  const topUsers = upvoteTotals.slice(0, topCount);

  // Ensure the badge exists.
  const badge = await prisma.badge.upsert({
    where: { slug: "best-reasoner-1" },
    update: {},
    create: {
      slug: "best-reasoner-1",
      name: "Best Reasoner",
      description:
        "Top 1% of analysts by reasoning upvotes (minimum 5 upvotes to qualify).",
    },
    select: { id: true },
  });

  let awarded = 0;
  let skipped = 0;

  for (const entry of topUsers) {
    const { userId } = entry;

    // Upsert UserBadge — skip if already held.
    const existing = await prisma.userBadge.findUnique({
      where: { userId_badgeId: { userId, badgeId: badge.id } },
    });

    if (existing) {
      skipped++;
      continue;
    }

    await prisma.userBadge.create({
      data: {
        userId,
        badgeId: badge.id,
        awardedFor: "Top 1% reasoning upvotes",
      },
    });

    // Send in-app notification.
    await prisma.notification.create({
      data: {
        userId,
        type: "SYSTEM",
        title: "Best Reasoner Badge",
        body: "You've earned the Best Reasoner badge — you're in the top 1% of analysts by reasoning quality.",
      },
    }).catch((err) => {
      console.error(`[award-reasoning-badges] Notification failed for ${userId}:`, err);
    });

    awarded++;
  }

  return NextResponse.json({ awarded, skipped, topCount });
}

export async function GET(request: Request) {
  return POST(request);
}
