import { NextResponse } from "next/server";

import {
  DEFAULT_NEWS_PAGE_TAKE,
  decodeNewsPageCursor,
  encodeNewsPageCursor,
  fetchNewsPage,
} from "@/lib/finance/newsPage";
import { resolveIndexNewsScope } from "@/lib/finance/indexNewsScope";

export const dynamic = "force-dynamic";

/**
 * GET /api/pulse/news — "Load more" continuation for the Stock news tab
 * (components/finance/pulse-tabs.tsx) past its server-rendered first page.
 *
 * Query params:
 *   cursor — opaque string from a previous response's `nextCursor` (omit for
 *            the very first continuation call, i.e. right after the initial
 *            server-rendered batch runs out).
 *   take   — page size, default/clamp per DEFAULT_/MAX_NEWS_PAGE_TAKE.
 *   symbol — optional NSE ticker to scope to one instrument's news (used by
 *            the instrument detail page's news tab, which shares this same
 *            client component and the same underlying MarketMoveNews table).
 *
 * Public GET, read-only, same trust level as /pulse itself (no auth) —
 * mirrors /api/instruments/search's unauthenticated read pattern.
 */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);

  const cursor = decodeNewsPageCursor(searchParams.get("cursor"));
  if (searchParams.get("cursor") && !cursor) {
    return NextResponse.json({ error: "Invalid cursor." }, { status: 400 });
  }

  const rawTake = Number(searchParams.get("take") ?? DEFAULT_NEWS_PAGE_TAKE);
  const take = Number.isFinite(rawTake) ? rawTake : DEFAULT_NEWS_PAGE_TAKE;

  const rawSymbol = searchParams.get("symbol")?.trim().toUpperCase();
  const tickerSymbol = rawSymbol && rawSymbol.length > 0 ? rawSymbol : undefined;

  try {
    // Index Constituent News (2026-08-15): an index symbol's continuation
    // pages over its MEMBERS' news — same scope the instrument page's
    // server-rendered first batch used (see instrument.ts's aggregation
    // block), so the cursor sequence stays consistent. Non-index symbols
    // resolve to null and keep the plain single-ticker filter.
    const indexScope = tickerSymbol ? await resolveIndexNewsScope(tickerSymbol) : null;
    const page = await fetchNewsPage({ cursor, take, tickerSymbol, tickerSymbols: indexScope ?? undefined });

    return NextResponse.json({
      items: page.items.map((item) => ({
        id: item.id,
        tickerSymbol: item.tickerSymbol,
        headline: item.headline,
        publisher: item.publisher,
        sourceUrl: item.sourceUrl,
        publishedAt: item.publishedAt.toISOString(),
        summary: item.summary,
      })),
      hasMore: page.hasMore,
      nextCursor: page.nextCursor ? encodeNewsPageCursor(page.nextCursor) : null,
    });
  } catch (err) {
    console.error("[api/pulse/news] fetchNewsPage failed:", err instanceof Error ? err.message : err);
    return NextResponse.json({ error: "Stock news temporarily unavailable." }, { status: 500 });
  }
}
