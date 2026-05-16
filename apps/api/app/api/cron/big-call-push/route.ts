import { NextResponse } from "next/server";

import { prisma } from "@/lib/prisma";
import { getIstDateString } from "@/lib/quests/engine";

/**
 * POST /api/cron/big-call-push
 *
 * Sends Expo push notifications to all users for Today's Big Call market.
 * Designed to fire at 8:00 AM IST (02:30 UTC) via Vercel Cron or external scheduler.
 *
 * Auth: Bearer CRON_SECRET header required.
 * Idempotent: bigCallNotificationSentAt IS NULL guard prevents double-sends.
 *
 * Returns:
 *   { ok: true, sent: number, marketId: string }
 *   { ok: true, sent: 0, reason: string }  — if no Big Call market for today
 */
export async function POST(request: Request) {
  const expectedSecret = process.env.CRON_SECRET;
  if (!expectedSecret || request.headers.get("Authorization") !== `Bearer ${expectedSecret}`) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  // Determine today's IST date range in UTC
  const dateStr = getIstDateString();
  const [yyyy, mm, dd] = dateStr.split("-").map(Number) as [number, number, number];
  const istOffsetMs = 5.5 * 60 * 60 * 1000;
  const dayStartUtc = new Date(Date.UTC(yyyy, mm - 1, dd) - istOffsetMs);
  const dayEndUtc = new Date(dayStartUtc.getTime() + 24 * 60 * 60 * 1000);

  try {
    // Find today's Big Call market that hasn't had a notification sent yet
    const market = await prisma.market.findFirst({
      where: {
        isBigCallDate: { gte: dayStartUtc, lt: dayEndUtc },
        bigCallNotificationSentAt: null,
      },
      select: { id: true, title: true },
    });

    if (!market) {
      return NextResponse.json({ ok: true, sent: 0, reason: "no big call set" });
    }

    // Fetch all users with push tokens in pages of 500 to avoid memory issues
    const BATCH_SIZE = 500;
    const CHUNK_SIZE = 100; // Expo Push API limit per request
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
      // Still mark sentAt so we don't retry on every cron tick when there are no tokens
      await prisma.market.update({
        where: { id: market.id },
        data: { bigCallNotificationSentAt: new Date() },
      });
      return NextResponse.json({ ok: true, sent: 0, marketId: market.id });
    }

    const notifTitle = "Today's Big Call";
    const notifBody = `Today's Big Call: ${market.title}`;
    const deepLink = `/market/${market.id}`;

    // Send in chunks of 100 — Expo Push API limit
    let totalSent = 0;
    for (let i = 0; i < allTokens.length; i += CHUNK_SIZE) {
      const chunk = allTokens.slice(i, i + CHUNK_SIZE);
      const messages = chunk.map((to) => ({
        to,
        sound: "default" as const,
        title: notifTitle,
        body: notifBody,
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
        // Best-effort: log and continue with remaining chunks
        console.error("[big-call-push] chunk send error:", chunkError);
      }
    }

    // Mark notification as sent — prevents re-fire on subsequent cron ticks
    await prisma.market.update({
      where: { id: market.id },
      data: { bigCallNotificationSentAt: new Date() },
    });

    return NextResponse.json({ ok: true, sent: totalSent, marketId: market.id });
  } catch (error) {
    console.error("[big-call-push]", error);
    return NextResponse.json({ error: "Unable to send Big Call push notifications." }, { status: 500 });
  }
}
