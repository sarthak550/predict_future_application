import { NextResponse } from "next/server";

import { decodeNewsCursor, getPublishedNewsPage } from "@/lib/news/queries";

export const dynamic = "force-dynamic";

/**
 * GET /api/economy/news — "Load more" continuation for the homepage macro
 * news strip / the dedicated /economy/news page, past their server-rendered
 * first page.
 *
 * Founder ask 2026-08-12: "Macro & Market news right now only shows latest 4
 * news, there is no way of seeing more than that." Mirrors the shape of
 * /api/pulse/news (that route's own doc comment has the full precedent) but
 * built on top of `getPublishedNewsPage` (lib/news/queries.ts) rather than a
 * duplicated cursor module — that function already does tie-safe
 * (publishedAt desc, id desc) cursor pagination over `Story`, category-
 * filterable, and is the same query `/api/news` uses for the (parked) swipe
 * feed. A dedicated route still exists here (rather than pointing the client
 * straight at /api/news?category=FINANCE) so this feature doesn't inherit
 * that route's session lookup + market-relation join, which exist only for
 * the parked feed's prediction-market pairing and are dead weight for a
 * plain news list.
 *
 * Query params:
 *   cursor — opaque string from a previous response's `nextCursor` (omit for
 *            the very first continuation call, i.e. right after the
 *            server-rendered first page runs out).
 *   limit  — page size, clamped to getPublishedNewsPage's own 1-20 bound.
 *
 * Public GET, read-only, no auth — same trust level as /api/pulse/news.
 */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);

  const cursorRaw = searchParams.get("cursor");
  if (cursorRaw && !decodeNewsCursor(cursorRaw)) {
    return NextResponse.json({ error: "Invalid cursor." }, { status: 400 });
  }

  const rawLimit = Number(searchParams.get("limit") ?? 20);
  const limit = Number.isFinite(rawLimit) ? rawLimit : 20;

  try {
    const page = await getPublishedNewsPage({ limit, category: "FINANCE", cursor: cursorRaw });

    return NextResponse.json({
      items: page.items.map((item) => ({
        id: item.id,
        headline: item.headline,
        summary: item.summary,
        sourceName: item.sourceName,
        sourceUrl: item.sourceUrl,
        publishedAt: item.publishedAt,
      })),
      hasMore: page.hasMore,
      nextCursor: page.nextCursor,
    });
  } catch (err) {
    console.error("[api/economy/news] getPublishedNewsPage failed:", err instanceof Error ? err.message : err);
    return NextResponse.json({ error: "Macro news temporarily unavailable." }, { status: 500 });
  }
}
