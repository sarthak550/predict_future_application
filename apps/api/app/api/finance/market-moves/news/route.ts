/**
 * GET /api/finance/market-moves/news
 *
 * Market Pulse (Phase 1c) — paginated, reverse-chronological feed of
 * MarketMoveNews rows (readable Google News stock headlines), served from
 * the warm store written by the market-moves-news cron.
 *
 * Query params:
 *   cursor?: opaque pagination cursor (base64url JSON: { publishedAt, id })
 *   limit?: number (default 20, max 50)
 *   tickerSymbol?: filter to a single ticker
 *
 * Public endpoint — no auth required.
 * Response: { items: [...], nextCursor: string | null, hasMore: boolean }
 */

import { NextResponse } from "next/server";

import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

const PAGE_SIZE_DEFAULT = 20;
const PAGE_SIZE_MAX = 50;

type Cursor = { publishedAt: string; id: string };

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
            { publishedAt: { lt: new Date(cursor.publishedAt) } },
            { publishedAt: { equals: new Date(cursor.publishedAt) }, id: { gt: cursor.id } },
          ],
        }
      : {}),
  };

  const rows = await prisma.marketMoveNews.findMany({
    where,
    orderBy: [{ publishedAt: "desc" }, { id: "asc" }],
    take: limit + 1,
  });

  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;

  let nextCursor: string | null = null;
  if (hasMore && page.length > 0) {
    const last = page[page.length - 1];
    const raw: Cursor = { publishedAt: last.publishedAt.toISOString(), id: last.id };
    nextCursor = Buffer.from(JSON.stringify(raw), "utf8").toString("base64url");
  }

  return NextResponse.json({
    items: page.map((n) => ({
      id: n.id,
      tickerSymbol: n.tickerSymbol,
      companyName: n.companyName,
      headline: n.headline,
      publisher: n.publisher,
      sourceUrl: n.sourceUrl,
      publishedAt: n.publishedAt.toISOString(),
    })),
    nextCursor,
    hasMore,
  });
}
