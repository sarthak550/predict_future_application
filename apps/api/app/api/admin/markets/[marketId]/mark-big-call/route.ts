import { NextResponse } from "next/server";

import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getIstDateString } from "@/lib/quests/engine";

/**
 * POST /api/admin/markets/[marketId]/mark-big-call
 *
 * Designates a market as "Today's Big Call" for the given date (defaults to today IST).
 * Only one market may be the Big Call per day. Marking a new one clears the existing one.
 * Resetting bigCallNotificationSentAt allows the cron to re-send if the admin marks
 * a market early in the day before 8am.
 *
 * Body (optional): { date?: string } — YYYY-MM-DD format, defaults to today IST.
 * Returns: { marketId, isBigCallDate }
 */
export async function POST(
  request: Request,
  { params }: { params: { marketId: string } }
) {
  const session = await getSession();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  }

  const actor = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { role: true },
  });
  if (!actor || actor.role !== "ADMIN") {
    return NextResponse.json({ error: "Admin access required." }, { status: 403 });
  }

  // Parse optional date override from body
  let dateStr: string;
  try {
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    if (typeof body.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(body.date)) {
      dateStr = body.date;
    } else {
      dateStr = getIstDateString();
    }
  } catch {
    dateStr = getIstDateString();
  }

  // Convert the YYYY-MM-DD IST date to a UTC DateTime stored at IST midnight.
  // IST midnight = UTC midnight minus 5h30m (i.e. UTC 18:30 of the previous day).
  const [yyyy, mm, dd] = dateStr.split("-").map(Number) as [number, number, number];
  const istOffsetMs = 5.5 * 60 * 60 * 1000;
  const bigCallDateUtc = new Date(Date.UTC(yyyy, mm - 1, dd) - istOffsetMs);

  // Build range for querying: anything within this IST calendar day
  const dayStartUtc = bigCallDateUtc;
  const dayEndUtc = new Date(dayStartUtc.getTime() + 24 * 60 * 60 * 1000);

  try {
    // Verify the target market exists
    const targetMarket = await prisma.market.findUnique({
      where: { id: params.marketId },
      select: { id: true, title: true },
    });
    if (!targetMarket) {
      return NextResponse.json({ error: "Market not found." }, { status: 404 });
    }

    // Clear any existing Big Call for this date (only one per day)
    await prisma.market.updateMany({
      where: {
        isBigCallDate: { gte: dayStartUtc, lt: dayEndUtc },
        id: { not: params.marketId },
      },
      data: {
        isBigCallDate: null,
        bigCallNotificationSentAt: null,
      },
    });

    // Set this market as the Big Call and reset the sent-at guard so the cron
    // can fire even if this market was previously designated for another day.
    const updated = await prisma.market.update({
      where: { id: params.marketId },
      data: {
        isBigCallDate: bigCallDateUtc,
        bigCallNotificationSentAt: null,
      },
      select: { id: true, isBigCallDate: true },
    });

    return NextResponse.json({
      marketId: updated.id,
      isBigCallDate: updated.isBigCallDate?.toISOString() ?? null,
    });
  } catch (error) {
    console.error("[mark-big-call]", error);
    return NextResponse.json({ error: "Unable to mark market as Big Call." }, { status: 400 });
  }
}
