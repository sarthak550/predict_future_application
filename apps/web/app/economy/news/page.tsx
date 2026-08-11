import type { Metadata } from "next";

import { MacroNewsFeed, type MacroNewsRow } from "@/components/finance/macro-news-feed";
import { getPublishedNewsPage } from "@/lib/news/queries";

/**
 * Dedicated macro/market news page (founder ask 2026-08-12: the homepage
 * strip was hard-capped at 4 items with no way to read older ones).
 *
 * Design choice — dedicated paginated page (not inline homepage expansion):
 * the homepage strip stays a light, fixed 4-item ISR render (its own
 * `MACRO_NEWS_LIMIT`, unchanged) and now links here via "View all" — keeps
 * zero added cost on the homepage's data-fetching Promise.all (a slow member
 * there was already an audit flag) while still giving unbounded read access
 * to older macro news, same shape as the stock-news "Load more" precedent
 * (/pulse + lib/finance/newsPage.ts) but reusing the already-existing,
 * already tie-safe `getPublishedNewsPage` (lib/news/queries.ts) instead of
 * duplicating its cursor logic — see api/economy/news/route.ts's doc comment
 * for why that's a fresh route rather than pointing at /api/news directly.
 */
export const revalidate = 300;

export const metadata: Metadata = {
  title: "Macro & Markets News — Predict Future",
  description:
    "India macro and market-moving headlines — RBI, rates, the rupee, and the news shaping every call on Predict Future.",
  alternates: { canonical: "https://predictfuture.app/economy/news" },
  openGraph: {
    title: "Macro & Markets News — Predict Future",
    description: "India macro and market-moving headlines, continuously updated.",
    type: "website",
    url: "https://predictfuture.app/economy/news",
  },
};

const PAGE_SIZE = 20;

export default async function EconomyNewsPage() {
  const page = await getPublishedNewsPage({ limit: PAGE_SIZE, category: "FINANCE" });

  const items: MacroNewsRow[] = page.items.map((item) => ({
    id: item.id,
    headline: item.headline,
    summary: item.summary,
    sourceName: item.sourceName,
    sourceUrl: item.sourceUrl,
    publishedAt: item.publishedAt,
  }));

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold text-ink-900">Macro &amp; markets news</h1>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-ink-500">
          India macro and market-moving headlines — the same feed behind the homepage&apos;s Indian Economy
          section, with the full history.
        </p>
      </div>

      <MacroNewsFeed initialItems={items} initialHasMore={page.hasMore} initialCursor={page.nextCursor} />
    </div>
  );
}
