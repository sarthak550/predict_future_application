import { NextResponse } from "next/server";

import { prisma } from "@/lib/prisma";
import { getIstDateString } from "@/lib/quests/engine";

/**
 * GET /api/markets/today-big-call
 *
 * Returns today's Big Call market (IST date), or { market: null } if none set.
 * No auth required — public endpoint.
 * Cache-Control: public, max-age=60 (1-minute cache for CDN/client).
 */
// NOTE (S50): Feed tab no longer calls this endpoint. Retained for future editorial
// surfaces and push cron. Do not deprecate without CEO sign-off.
// Serves live DB data — render dynamically so `next build` does not statically
// evaluate this route (which would hit the DB with no connection at build time).
export const dynamic = "force-dynamic";

export async function GET() {
  const dateStr = getIstDateString();
  const [yyyy, mm, dd] = dateStr.split("-").map(Number) as [number, number, number];
  const istOffsetMs = 5.5 * 60 * 60 * 1000;
  const dayStartUtc = new Date(Date.UTC(yyyy, mm - 1, dd) - istOffsetMs);
  const dayEndUtc = new Date(dayStartUtc.getTime() + 24 * 60 * 60 * 1000);

  try {
    const market = await prisma.market.findFirst({
      where: {
        isBigCallDate: { gte: dayStartUtc, lt: dayEndUtc },
        // Public endpoint: only surface markets that have made it past moderation
        // and aren't dead-ended. DRAFT/PENDING_REVIEW can leak unpublished content;
        // REJECTED/CANCELLED/HOST_TIMEOUT are killed markets that shouldn't
        // re-appear via the Big Call slot.
        status: { notIn: ["DRAFT", "PENDING_REVIEW", "REJECTED", "CANCELLED", "HOST_TIMEOUT"] },
      },
      select: {
        id: true,
        title: true,
        description: true,
        category: true,
        status: true,
        marketType: true,
        yesPool: true,
        noPool: true,
        totalVolume: true,
        totalParticipants: true,
        yesCount: true,
        noCount: true,
        totalVotes: true,
        closeAt: true,
        resolveAt: true,
        isBigCallDate: true,
        bigCallNotificationOpenedCount: true,
        creator: {
          select: {
            username: true,
            isVerifiedAnalyst: true,
          },
        },
      },
    });

    const response = NextResponse.json({ market: market ?? null });
    response.headers.set("Cache-Control", "public, max-age=60");
    return response;
  } catch (error) {
    console.error("[today-big-call]", error);
    return NextResponse.json({ error: "Unable to fetch today's Big Call market." }, { status: 500 });
  }
}
