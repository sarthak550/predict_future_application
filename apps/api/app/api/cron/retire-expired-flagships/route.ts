/**
 * POST /api/cron/retire-expired-flagships
 *
 * Sweeps markets whose flagshipEventAt is older than RETIRE_WINDOW_DAYS and
 * clears flagshipEventAt + flagshipEventType so they drop out of the Next Event
 * carousel. The market itself is untouched — only its flagship-event metadata.
 *
 * Window: 7 days past the event date (keeps the day-after wrap visible).
 */

import { NextResponse } from "next/server";

import { prisma } from "@/lib/prisma";

const RETIRE_WINDOW_DAYS = 7;

function hasCronAccess(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const authHeader = request.headers.get("authorization");
  const cronHeader = request.headers.get("x-cron-secret");
  return authHeader === `Bearer ${secret}` || cronHeader === secret;
}

export async function POST(request: Request) {
  if (!hasCronAccess(request)) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const cutoff = new Date(Date.now() - RETIRE_WINDOW_DAYS * 24 * 60 * 60 * 1000);

  try {
    const expired = await prisma.market.findMany({
      where: {
        flagshipEventAt: { lt: cutoff },
      },
      select: { id: true, title: true, flagshipEventAt: true, flagshipEventType: true },
    });

    if (expired.length === 0) {
      return NextResponse.json({ retired: 0, cutoff: cutoff.toISOString(), markets: [] });
    }

    const result = await prisma.market.updateMany({
      where: { id: { in: expired.map((m) => m.id) } },
      data: { flagshipEventAt: null, flagshipEventType: null },
    });

    console.info(
      `[cron/retire-expired-flagships] retired ${result.count} flagship marker(s) older than ${cutoff.toISOString()}`
    );

    return NextResponse.json({
      retired: result.count,
      cutoff: cutoff.toISOString(),
      markets: expired.map((m) => ({
        id: m.id,
        title: m.title,
        wasFlagshipEventAt: m.flagshipEventAt?.toISOString() ?? null,
        wasFlagshipEventType: m.flagshipEventType,
      })),
    });
  } catch (err) {
    console.error("[cron/retire-expired-flagships] failed:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Retire job failed." },
      { status: 500 }
    );
  }
}

export async function GET(request: Request) {
  return POST(request);
}
