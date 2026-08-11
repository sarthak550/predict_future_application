"use client";

/**
 * Macro news list with cursor "Load more" — the /economy/news continuation
 * of the homepage's MacroNewsStrip (components/finance/economy-section.tsx).
 * Standalone from PulseTabs' stock-news tab: that component's row shape
 * (ticker badge, publisher, MarketMoveNews-specific fields) doesn't fit
 * Story rows (headline/summary/sourceName), and per the founder's brief this
 * page isn't tabbed — it's just the one feed, so PulseTabs' tab bar / filings
 * tab machinery would be unused weight. The footer state machine below is
 * the same shape as PulseTabs' NewsSectionFooter, minus its first "reveal an
 * already-overfetched local batch" stage: the server page here renders
 * exactly one page's worth (PAGE_SIZE, matching getPublishedNewsPage's own
 * cap), not an oversized buffer, so every "load more" past that is a real
 * network round-trip from the first click — never an unbounded fetch.
 */

import { useState } from "react";
import { ArrowUpRight } from "lucide-react";

import { Card, CardContent } from "@/components/ui/card";
import { formatRelativeTime } from "@/lib/utils";

export type MacroNewsRow = {
  id: string;
  headline: string;
  summary: string;
  sourceName: string;
  sourceUrl: string;
  /** ISO timestamp — the raw value backing the row's relative-time label, also the pagination cursor's basis. */
  publishedAt: string;
};

type MacroNewsApiResponse = {
  items: MacroNewsRow[];
  hasMore: boolean;
  nextCursor: string | null;
};

export function MacroNewsFeed({
  initialItems,
  initialHasMore,
  initialCursor,
}: {
  initialItems: MacroNewsRow[];
  initialHasMore: boolean;
  initialCursor: string | null;
}) {
  const [items, setItems] = useState<MacroNewsRow[]>(initialItems);
  const [cursor, setCursor] = useState<string | null>(initialCursor);
  const [hasMore, setHasMore] = useState(initialHasMore);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState(false);

  async function loadMore() {
    if (loading || !hasMore) return;
    setLoading(true);
    setLoadError(false);
    try {
      const params = new URLSearchParams();
      if (cursor) params.set("cursor", cursor);
      const res = await fetch(`/api/economy/news?${params.toString()}`, { cache: "no-store" });
      if (!res.ok) throw new Error(`Load more failed with status ${res.status}`);
      const data = (await res.json()) as MacroNewsApiResponse;

      setItems((prev) => [...prev, ...data.items]);
      setCursor(data.nextCursor);
      setHasMore(data.hasMore);
    } catch (err) {
      console.error("[MacroNewsFeed] loadMore failed:", err instanceof Error ? err.message : err);
      setLoadError(true);
    } finally {
      setLoading(false);
    }
  }

  if (items.length === 0) {
    return (
      <Card>
        <CardContent className="p-6 text-sm text-ink-500">No macro news captured yet.</CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardContent className="divide-y divide-ink-100 p-0">
        {items.map((item) => (
          <NewsRow key={item.id} item={item} />
        ))}
        <Footer total={items.length} hasMore={hasMore} loading={loading} loadError={loadError} onLoadMore={loadMore} />
      </CardContent>
    </Card>
  );
}

function NewsRow({ item }: { item: MacroNewsRow }) {
  const hasSummary = item.summary.trim().length > 0;
  const timeLabel = formatRelativeTime(item.publishedAt);

  // Summary rows: the row is too tall for "anywhere in the row opens the
  // link" to be the obvious affordance, so the source attribution gets its
  // own explicit "Read at <source>" link — same split PulseTabs' NewsRowItem
  // uses for its summary variant. Headline-only rows keep the simpler
  // whole-row-is-a-link treatment (matches the homepage strip's row exactly).
  if (hasSummary) {
    return (
      <div className="px-5 py-4">
        <a
          href={item.sourceUrl}
          target="_blank"
          rel="noreferrer"
          className="text-sm font-medium leading-6 text-ink-900 hover:text-signal-sky hover:underline"
        >
          {item.headline}
        </a>
        <p className="mt-1 text-sm leading-6 text-ink-500">{item.summary}</p>
        <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-ink-400">
          <span>{item.sourceName}</span>
          <span>·</span>
          <span>{timeLabel}</span>
        </div>
      </div>
    );
  }

  return (
    <a
      href={item.sourceUrl}
      target="_blank"
      rel="noreferrer"
      className="flex items-start gap-3 px-5 py-4 transition hover:bg-ink-50/60"
    >
      <div className="min-w-0 flex-1">
        <p className="text-sm leading-6 text-ink-900">{item.headline}</p>
        <p className="mt-1 text-xs text-ink-400">
          {item.sourceName} · {timeLabel}
        </p>
      </div>
      <ArrowUpRight className="mt-1 h-3.5 w-3.5 shrink-0 text-ink-300" />
    </a>
  );
}

/**
 * Footer state machine (mirrors PulseTabs' NewsSectionFooter, sans its
 * "Show more" free-reveal stage — see this file's top doc comment for why):
 *   1. loadError: quiet inline retry — current items stay on screen.
 *   2. hasMore: "Load more" round-trips to /api/economy/news for the next
 *      batch (disabled + "Loading…" while in flight).
 *   3. Otherwise: the cursor is exhausted — a clear end-state message.
 * No auto-fetch/auto-scroll — every network call is a direct result of a
 * user click, keeping requests bounded.
 */
function Footer({
  total,
  hasMore,
  loading,
  loadError,
  onLoadMore,
}: {
  total: number;
  hasMore: boolean;
  loading: boolean;
  loadError: boolean;
  onLoadMore: () => void;
}) {
  if (loadError) {
    return (
      <div className="flex flex-wrap items-center justify-center gap-2 border-t border-ink-100 py-3 text-center text-xs text-ink-400">
        <span>Couldn&apos;t load more news.</span>
        <button type="button" onClick={onLoadMore} className="font-medium text-signal-sky hover:underline">
          Try again
        </button>
      </div>
    );
  }

  if (hasMore) {
    return (
      <button
        type="button"
        onClick={onLoadMore}
        disabled={loading}
        className="w-full border-t border-ink-100 py-3 text-center text-xs font-medium text-ink-500 transition-colors hover:bg-ink-50 hover:text-ink-700 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {loading ? "Loading…" : "Load more"}
      </button>
    );
  }

  return (
    <p className="px-5 py-3 text-center text-xs text-ink-400">
      You&apos;re all caught up — {total} items shown.
    </p>
  );
}
