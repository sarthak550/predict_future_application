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

  // Over-fetch so we can collapse the same story stored under BOTH an NSE symbol
  // and its BSE scrip code (identical headline, two ticker keys). Dedup by
  // normalized headline, preferring the NSE-symbol row over the "BSE:<code>" one.
  const rows = await prisma.marketMoveNews.findMany({
    where,
    orderBy: [{ publishedAt: "desc" }, { id: "asc" }],
    take: (limit + 1) * 4,
  });

  const normHeadline = (h: string) => h.toLowerCase().replace(/[^a-z0-9]/g, "");
  const dedup = new Map<string, (typeof rows)[number]>();
  for (const r of rows) {
    const key = normHeadline(r.headline);
    const existing = dedup.get(key);
    if (!existing) {
      dedup.set(key, r);
    } else if (existing.tickerSymbol.startsWith("BSE:") && !r.tickerSymbol.startsWith("BSE:")) {
      dedup.set(key, r); // upgrade to the NSE-symbol version (Map keeps position)
    }
  }
  const deduped = [...dedup.values()];

  const hasMore = deduped.length > limit;
  const page = hasMore ? deduped.slice(0, limit) : deduped;

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
