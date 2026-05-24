import { NextResponse } from "next/server";

import { prisma } from "@/lib/prisma";

/**
 * POST /api/cron/flagship-reminder
 *
 * Sends a "Tomorrow: <title>" push notification to all users for every
 * flagship event market whose event date falls within the next 23-25 hours.
 *
 * Scheduled at 09:15 UTC daily (avoid the :00 pile-up).
 * Auth: Bearer CRON_SECRET header required.
 *
 * Idempotent: skips any market where flagshipReminderSentAt was set within
 * the past 24 hours, preventing double-push on Vercel 502 retries.
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

  // For the idempotency guard: skip markets notified within the past 24 hours.
  const twentyFourHoursAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);

  try {
    // Find OPEN flagship markets whose event fires within the 23-25h window
    // AND that have not already had a reminder sent in the past 24 hours.
    const markets = await prisma.market.findMany({
      where: {
        status: "OPEN",
        flagshipEventAt: {
          gte: windowStart,
          lte: windowEnd,
        },
        OR: [
          { flagshipReminderSentAt: null },
          { flagshipReminderSentAt: { lt: twentyFourHoursAgo } },
        ],
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
      // No tokens — still stamp markets as sent so the cron doesn't loop back.
      await prisma.market.updateMany({
        where: { id: { in: markets.map((m) => m.id) } },
        data: { flagshipReminderSentAt: now },
      });
      return NextResponse.json({ ok: true, sent: 0, marketIds: markets.map((m) => m.id) });
    }

    // Build chunk list for parallelised sends (10 concurrent Expo requests max)
    const PARALLEL = 10;
    const buildChunks = (tokens: string[]): string[][] => {
      const result: string[][] = [];
      for (let i = 0; i < tokens.length; i += CHUNK_SIZE) result.push(tokens.slice(i, i + CHUNK_SIZE));
      return result;
    };

    const sendChunks = async (chunks: string[][], title: string, deepLink: string, marketId: string): Promise<number> => {
      let sent = 0;
      for (let i = 0; i < chunks.length; i += PARALLEL) {
        const batch = chunks.slice(i, i + PARALLEL);
        const counts = await Promise.all(
          batch.map(async (chunk) => {
            const messages = chunk.map((to) => ({
              to,
              sound: "default" as const,
              title,
              body: "Predict before the market closes.",
              data: { href: deepLink },
            }));
            try {
              await fetch("https://exp.host/--/api/v2/push/send", {
                method: "POST",
                headers: { "Content-Type": "application/json", Accept: "application/json" },
                body: JSON.stringify(messages),
              });
              return chunk.length;
            } catch (chunkError) {
              console.error(`[flagship-reminder] chunk error for market ${marketId}:`, chunkError);
              return 0;
            }
          })
        );
        sent += counts.reduce((a, b) => a + b, 0);
      }
      return sent;
    };

    const tokenChunks = buildChunks(allTokens);
    let totalSent = 0;
    const sentMarketIds: string[] = [];

    // Send one broadcast per market, then stamp idempotency guard immediately after.
    for (const market of markets) {
      const notifTitle = `Tomorrow: ${market.title}`;
      const deepLink = `/market/${market.id}`;

      totalSent += await sendChunks(tokenChunks, notifTitle, deepLink, market.id);

      // Stamp idempotency guard immediately after each market's push completes.
      await prisma.market.update({
        where: { id: market.id },
        data: { flagshipReminderSentAt: now },
      });

      sentMarketIds.push(market.id);
    }

    return NextResponse.json({ ok: true, sent: totalSent, marketIds: sentMarketIds });
  } catch (error) {
    console.error("[flagship-reminder]", error);
    return NextResponse.json({ error: "Unable to send flagship reminders." }, { status: 500 });
  }
}
