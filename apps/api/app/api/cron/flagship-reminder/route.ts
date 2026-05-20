import { NextResponse } from "next/server";

import { prisma } from "@/lib/prisma";

/**
 * POST /api/cron/flagship-reminder
 *
 * Sends a "⏰ Tomorrow: <title>" push notification to all users for every
 * flagship event market whose event date falls within the next 23-25 hours.
 *
 * Scheduled at 09:15 UTC daily (avoid the :00 pile-up).
 * Auth: Bearer CRON_SECRET header required.
 *
 * Returns:
 *   { ok: true; sent: number; marketIds: string[] }
 */
export async function POST(request: Request) {
  const expectedSecret = process.env.CRON_SECRET;
  if (!expectedSecret || request.headers.get("Authorization") !== `Bearer ${expectedSecret}`) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const now = new Date();
  const windowStart = new Date(now.getTime() + 23 * 60 * 60 * 1000);
  const windowEnd = new Date(now.getTime() + 25 * 60 * 60 * 1000);

  try {
    // Find OPEN flagship markets whose event fires within the 23-25h window
    const markets = await prisma.market.findMany({
      where: {
        status: "OPEN",
        flagshipEventAt: {
          gte: windowStart,
          lte: windowEnd,
        },
      },
      select: { id: true, title: true },
    });

    if (markets.length === 0) {
      return NextResponse.json({ ok: true, sent: 0, marketIds: [] });
    }

    // Fetch all push tokens in batches of 500
    const BATCH_SIZE = 500;
    const CHUNK_SIZE = 100;
    const allTokens: string[] = [];

    let cursor: string | undefined = undefined;
    while (true) {
      const users: Array<{ id: string; expoPushToken: string | null }> = await prisma.user.findMany({
        where: { expoPushToken: { not: null } },
        select: { id: true, expoPushToken: true },
        take: BATCH_SIZE,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
        orderBy: { id: "asc" },
      });

      for (const u of users) {
        if (u.expoPushToken) allTokens.push(u.expoPushToken);
      }

      if (users.length < BATCH_SIZE) break;
      cursor = users[users.length - 1].id;
    }

    if (allTokens.length === 0) {
      return NextResponse.json({ ok: true, sent: 0, marketIds: markets.map((m) => m.id) });
    }

    let totalSent = 0;
    const sentMarketIds: string[] = [];

    // Send one broadcast per market
    for (const market of markets) {
      const notifTitle = `⏰ Tomorrow: ${market.title}`;
      const deepLink = `/market/${market.id}`;

      for (let i = 0; i < allTokens.length; i += CHUNK_SIZE) {
        const chunk = allTokens.slice(i, i + CHUNK_SIZE);
        const messages = chunk.map((to) => ({
          to,
          sound: "default" as const,
          title: notifTitle,
          body: "Predict before the market closes.",
          data: { href: deepLink },
        }));

        try {
          await fetch("https://exp.host/--/api/v2/push/send", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Accept: "application/json",
            },
            body: JSON.stringify(messages),
          });
          totalSent += chunk.length;
        } catch (chunkError) {
          console.error(`[flagship-reminder] chunk error for market ${market.id}:`, chunkError);
        }
      }

      sentMarketIds.push(market.id);
    }

    return NextResponse.json({ ok: true, sent: totalSent, marketIds: sentMarketIds });
  } catch (error) {
    console.error("[flagship-reminder]", error);
    return NextResponse.json({ error: "Unable to send flagship reminders." }, { status: 500 });
  }
}
