/**
 * GET /api/finance/market-moves/events
 *
 * Market Pulse (Phase 1) — paginated, reverse-chronological feed of
 * MarketMoveEvent rows (NSE/BSE corporate announcements), served from the
 * warm store written by the market-moves-announcements cron.
 *
 * Query params:
 *   cursor?: opaque pagination cursor (base64url JSON: { announcedAt, id })
 *   limit?: number (default 20, max 50)
 *   tickerSymbol?: filter to a single ticker (e.g. "RELIANCE" or "BSE:500325")
 *
 * Public endpoint — no auth required.
 * Response: { items: [...], nextCursor: string | null, hasMore: boolean }
 */

import { NextResponse } from "next/server";

import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

const PAGE_SIZE_DEFAULT = 20;
const PAGE_SIZE_MAX = 50;

type Cursor = { announcedAt: string; id: string };

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);

  const limitParam = parseInt(searchParams.get("limit") ?? "", 10);
  const limit = Math.min(
    Number.isFinite(limitParam) && limitParam > 0 ? limitParam : PAGE_SIZE_DEFAULT,
    PAGE_SIZE_MAX
  );

  const tickerSymbol = searchParams.get("tickerSymbol") || undefined;

  const cursorParam = searchParams.get("cursor");
  let cursor: Cursor | undefined;
  if (cursorParam) {
    try {
      cursor = JSON.parse(Buffer.from(cursorParam, "base64url").toString("utf8")) as Cursor;
    } catch {
      cursor = undefined; // malformed cursor — ignore, start from the beginning
    }
  }

  const where = {
    ...(tickerSymbol ? { tickerSymbol } : {}),
    ...(cursor
      ? {
          OR: [
            { announcedAt: { lt: new Date(cursor.announcedAt) } },
            { announcedAt: { equals: new Date(cursor.announcedAt) }, id: { gt: cursor.id } },
          ],
        }
      : {}),
  };

  const rows = await prisma.marketMoveEvent.findMany({
    where,
    orderBy: [{ announcedAt: "desc" }, { id: "asc" }],
    take: limit + 1,
  });

  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;

  let nextCursor: string | null = null;
  if (hasMore && page.length > 0) {
    const last = page[page.length - 1];
    const raw: Cursor = { announcedAt: last.announcedAt.toISOString(), id: last.id };
    nextCursor = Buffer.from(JSON.stringify(raw), "utf8").toString("base64url");
  }

  return NextResponse.json({
    items: page.map((e) => ({
      id: e.id,
      source: e.source,
      tickerSymbol: e.tickerSymbol,
      tickerType: e.tickerType,
      companyName: e.companyName,
      eventType: e.eventType,
      headline: e.headline,
      detailUrl: e.detailUrl,
      rawText: e.rawText,
      announcedAt: e.announcedAt.toISOString(),
    })),
    nextCursor,
    hasMore,
  });
}
