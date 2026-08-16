"use client";

/**
 * Tabbed Stock News / Filings & Announcements section for /pulse (and reused
 * as-is by the instrument detail page's news tab, scoped to one symbol via
 * `newsSymbol`).
 *
 * Replaces the old layout (news list + filings buried in a collapsed <details>
 * at the bottom — a straight port of mobile's space-saving pattern). On web the
 * two feeds are peers: one tab bar at the top of the section, each tab showing
 * a longer server-fetched list with incremental "Show more" (filings run to
 * thousands per week, so the server caps what ships and the footer says so).
 *
 * Stock news pagination (2026-08-09, founder: users were hard-capped at the
 * first server-rendered batch with no way to read older items): "Show more"
 * first reveals the already-fetched server batch client-side for free (same
 * as filings), then once that's exhausted switches to real "Load more"
 * round-trips against /api/pulse/news (cursor = last shown item's
 * publishedAt+id) so reading can continue arbitrarily far back without ever
 * over-fetching — see lib/finance/newsPage.ts for the cursor contract.
 *
 * Time labels for the server-rendered batch arrive preformatted (ISR page,
 * 5-min revalidate); client-loaded items compute their own via the same
 * formatRelativeTime helper so this stays consistent across both sources.
 */

import { useRef, useState } from "react";
import Link from "next/link";
import { ArrowUpRight } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { formatRelativeTime } from "@/lib/utils";

export type PulseNewsItem = {
  id: string;
  tickerSymbol: string;
  headline: string;
  publisher: string;
  sourceUrl: string;
  /** ISO timestamp — the raw value backing the preformatted timeLabel below, needed as the pagination cursor. */
  publishedAt: string;
  timeLabel: string;
  summary: string | null;
};

type FetchedNewsItem = {
  id: string;
  tickerSymbol: string;
  headline: string;
  publisher: string;
  sourceUrl: string;
  publishedAt: string;
  summary: string | null;
};

type NewsPageApiResponse = {
  items: FetchedNewsItem[];
  hasMore: boolean;
  nextCursor: string | null;
};

export type PulseFilingItem = {
  id: string;
  source: string;
  companyName: string;
  eventTypeLabel: string;
  headline: string;
  detailUrl: string | null;
  timeLabel: string;
};

const NEWS_PAGE = 20;
const FILINGS_PAGE = 15;

/** Mirrors lib/finance/newsPage.ts's encodeNewsPageCursor format exactly — duplicated here (not imported) because that module pulls in `@/lib/prisma`, which must never enter a "use client" bundle. */
function cursorFor(item: { publishedAt: string; id: string }): string {
  return `${new Date(item.publishedAt).toISOString()}::${item.id}`;
}

export function PulseTabs({
  news,
  filings,
  newsSymbol,
}: {
  news: PulseNewsItem[];
  filings: PulseFilingItem[];
  /** Scopes "Load more" server fetches to one ticker — set by the instrument detail page's news tab; omitted (global feed) on /pulse. */
  newsSymbol?: string;
}) {
  const [tab, setTab] = useState<"news" | "filings">("news");
  const [newsCount, setNewsCount] = useState(NEWS_PAGE);
  const [filingsCount, setFilingsCount] = useState(FILINGS_PAGE);

  // Local, appendable copy of the server-rendered `news` batch — "Load more"
  // appends real server fetches onto this. Re-synced from `news` whenever the
  // prop itself changes (a fresh reference on every server render, i.e. a
  // real navigation to a new /pulse or /instruments/[symbol] page) so a
  // client-side route change never leaks stale news/cursor state from the
  // previous page into the new one.
  const [newsItems, setNewsItems] = useState<PulseNewsItem[]>(news);
  const [newsCursor, setNewsCursor] = useState<string | null>(() =>
    news.length > 0 ? cursorFor(news[news.length - 1]) : null
  );
  const [newsHasMore, setNewsHasMore] = useState(true);
  const [newsLoading, setNewsLoading] = useState(false);
  const [newsLoadError, setNewsLoadError] = useState(false);
  const newsItemsSourceRef = useRef(news);

  if (newsItemsSourceRef.current !== news) {
    newsItemsSourceRef.current = news;
    // Reset happens synchronously during render (React-recommended pattern
    // for "derived state that must reset when a prop changes") rather than
    // in a useEffect, so the stale batch is never painted even for a frame.
    setNewsItems(news);
    setNewsCursor(news.length > 0 ? cursorFor(news[news.length - 1]) : null);
    setNewsHasMore(true);
    setNewsLoading(false);
    setNewsLoadError(false);
    setNewsCount(NEWS_PAGE);
  }

  async function loadMoreNews() {
    if (newsLoading || !newsHasMore) return;
    setNewsLoading(true);
    setNewsLoadError(false);
    try {
      const params = new URLSearchParams();
      if (newsCursor) params.set("cursor", newsCursor);
      if (newsSymbol) params.set("symbol", newsSymbol);
      const res = await fetch(`/api/pulse/news?${params.toString()}`, { cache: "no-store" });
      if (!res.ok) throw new Error(`Load more failed with status ${res.status}`);
      const data = (await res.json()) as NewsPageApiResponse;

      const mapped: PulseNewsItem[] = data.items.map((item) => ({
        id: item.id,
        tickerSymbol: item.tickerSymbol,
        headline: item.headline,
        publisher: item.publisher,
        sourceUrl: item.sourceUrl,
        publishedAt: item.publishedAt,
        timeLabel: formatRelativeTime(item.publishedAt),
        summary: item.summary,
      }));

      setNewsItems((prev) => [...prev, ...mapped]);
      setNewsCount((c) => c + mapped.length);
      setNewsCursor(data.nextCursor);
      setNewsHasMore(data.hasMore);
    } catch (err) {
      console.error("[PulseTabs] loadMoreNews failed:", err instanceof Error ? err.message : err);
      setNewsLoadError(true);
    } finally {
      setNewsLoading(false);
    }
  }

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <TabButton active={tab === "news"} onClick={() => setTab("news")}>
          Stock news
        </TabButton>
        <TabButton active={tab === "filings"} onClick={() => setTab("filings")}>
          Filings &amp; announcements
        </TabButton>
      </div>

      {tab === "news" ? (
        newsItems.length === 0 ? (
          <EmptyCard label="No stock news captured yet." />
        ) : (
          <Card>
            <CardContent className="divide-y divide-ink-100 p-0">
              {newsItems.slice(0, newsCount).map((item) => (
                <NewsRowItem key={item.id} item={item} />
              ))}
              <NewsSectionFooter
                shown={Math.min(newsCount, newsItems.length)}
                total={newsItems.length}
                hasMore={newsHasMore}
                loading={newsLoading}
                loadError={newsLoadError}
                onShowMore={() => setNewsCount((c) => c + NEWS_PAGE)}
                onLoadMore={loadMoreNews}
              />
            </CardContent>
          </Card>
        )
      ) : filings.length === 0 ? (
        <EmptyCard label="No exchange filings captured yet." />
      ) : (
        <Card>
          <CardContent className="p-5">
            <ul className="divide-y divide-ink-100">
              {filings.slice(0, filingsCount).map((filing) => (
                <li key={filing.id} className="py-3">
                  <div className="flex flex-wrap items-center gap-2 text-xs text-ink-400">
                    <Badge>{filing.source}</Badge>
                    <Badge>{filing.eventTypeLabel}</Badge>
                    <span>{filing.timeLabel}</span>
                  </div>
                  <p className="mt-1.5 text-sm text-ink-800">
                    <span className="font-medium">{filing.companyName}</span> — {filing.headline}
                  </p>
                  {filing.detailUrl && (
                    <a
                      href={filing.detailUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="mt-1 inline-flex items-center gap-1 text-xs font-medium text-signal-sky hover:underline"
                    >
                      View filing
                      <ArrowUpRight className="h-3 w-3" />
                    </a>
                  )}
                </li>
              ))}
            </ul>
            <ShowMoreFooter
              shown={Math.min(filingsCount, filings.length)}
              total={filings.length}
              onMore={() => setFilingsCount((c) => c + FILINGS_PAGE)}
            />
          </CardContent>
        </Card>
      )}
    </section>
  );
}

function EmptyCard({ label }: { label: string }) {
  return (
    <Card>
      <CardContent className="p-6 text-sm text-ink-500">{label}</CardContent>
    </Card>
  );
}

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-full px-4 py-1.5 text-sm font-medium transition-colors ${
        active
          ? "bg-ink-900 text-white"
          : "border border-ink-200 bg-white text-ink-600 hover:bg-ink-50"
      }`}
    >
      {children}
    </button>
  );
}

function ShowMoreFooter({
  shown,
  total,
  onMore,
}: {
  shown: number;
  total: number;
  onMore: () => void;
}) {
  if (shown >= total) {
    return (
      <p className="px-5 py-3 text-center text-xs text-ink-400">
        Showing the latest {total} — older items roll off as new ones arrive.
      </p>
    );
  }
  return (
    <button
      type="button"
      onClick={onMore}
      className="w-full border-t border-ink-100 py-3 text-center text-xs font-medium text-ink-500 transition-colors hover:bg-ink-50 hover:text-ink-700"
    >
      Show more ({shown} of {total})
    </button>
  );
}

/**
 * Single Stock news row — extracted verbatim from the old inline `.map()`
 * body so client-fetched ("Load more") rows render through the EXACT same
 * markup as the server-rendered initial batch, never a duplicated copy.
 */
function NewsRowItem({ item }: { item: PulseNewsItem }) {
  const tickerBadge = item.tickerSymbol.startsWith("BSE:") ? (
    // "BSE:<code>" rows have no reliable NSE mapping, so they stay a plain
    // (non-linking) badge — NSE-symbol rows tap through to the instrument page.
    <Badge className="mt-0.5 shrink-0">{item.tickerSymbol.replace(/^BSE:/i, "")}</Badge>
  ) : (
    <Link
      href={`/instruments/${item.tickerSymbol}`}
      onClick={(e) => e.stopPropagation()}
      className="mt-0.5 shrink-0"
    >
      <Badge className="transition-colors hover:bg-ink-200">{item.tickerSymbol}</Badge>
    </Link>
  );

  // Rows with a summary: the summary supplements the headline, it never
  // replaces the source attribution — publisher name + an explicit
  // "Read at <publisher>" link stay visible below it. The whole row is
  // NOT a single <a> in this case (a summary makes the row too tall for
  // "anywhere in the row opens the link" to be the obvious affordance).
  // Rows without a summary yet keep the original whole-row-is-a-link
  // behavior — unchanged UX for headline-only stories.
  if (item.summary) {
    return (
      <div className="flex items-start gap-3 px-5 py-4">
        {tickerBadge}
        <div className="min-w-0 flex-1">
          <p className="text-sm leading-6 text-ink-900">{item.headline}</p>
          <p className="mt-1 text-sm leading-6 text-ink-500">{item.summary}</p>
          <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-ink-400">
            <span>{item.timeLabel}</span>
            <span>·</span>
            <a
              href={item.sourceUrl}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 font-medium text-signal-sky hover:underline"
            >
              Read at {item.publisher}
              <ArrowUpRight className="h-3 w-3" />
            </a>
          </div>
        </div>
      </div>
    );
  }

  // Stretched-link row, NOT a wrapping <a> (QA 2026-08-16): the ticker badge
  // is itself a <Link>, and nesting an <a> inside an <a> is invalid HTML that
  // threw a real React hydration error on every instrument-page load. Same
  // absolute-inset overlay + elevated-child pattern the analyst cards use —
  // row click opens the article, badge click still goes to the instrument.
  return (
    <div className="relative flex items-start gap-3 px-5 py-4 transition hover:bg-ink-50/60">
      <a
        href={item.sourceUrl}
        target="_blank"
        rel="noreferrer"
        className="absolute inset-0 z-0"
        aria-label={`Read at ${item.publisher}: ${item.headline}`}
      />
      <span className="relative z-10">{tickerBadge}</span>
      <div className="pointer-events-none relative z-10 min-w-0 flex-1">
        <p className="text-sm leading-6 text-ink-900">{item.headline}</p>
        <p className="mt-1 text-xs text-ink-400">
          {item.publisher} · {item.timeLabel}
        </p>
      </div>
      <ArrowUpRight className="pointer-events-none relative z-10 mt-1 h-3.5 w-3.5 shrink-0 text-ink-300" />
    </div>
  );
}

/**
 * Stock news tab footer — a small state machine:
 *   1. shown < total (already-fetched items not all revealed yet): "Show
 *      more" reveals them client-side, no network (identical to the old
 *      ShowMoreFooter behavior for the first server-rendered batch).
 *   2. loadError: quiet inline retry — current items stay on screen.
 *   3. hasMore: "Load more" round-trips to /api/pulse/news for the next
 *      batch (disabled + "Loading…" while in flight).
 *   4. Otherwise: the cursor is exhausted — a clear end-state message.
 * No auto-fetch/auto-scroll anywhere in this chain — every network call is
 * a direct result of a user click, keeping requests bounded.
 */
function NewsSectionFooter({
  shown,
  total,
  hasMore,
  loading,
  loadError,
  onShowMore,
  onLoadMore,
}: {
  shown: number;
  total: number;
  hasMore: boolean;
  loading: boolean;
  loadError: boolean;
  onShowMore: () => void;
  onLoadMore: () => void;
}) {
  if (shown < total) {
    return (
      <button
        type="button"
        onClick={onShowMore}
        className="w-full border-t border-ink-100 py-3 text-center text-xs font-medium text-ink-500 transition-colors hover:bg-ink-50 hover:text-ink-700"
      >
        Show more ({shown} of {total})
      </button>
    );
  }

  if (loadError) {
    return (
      <div className="flex flex-wrap items-center justify-center gap-2 border-t border-ink-100 py-3 text-center text-xs text-ink-400">
        <span>Couldn&apos;t load more stock news.</span>
        <button
          type="button"
          onClick={onLoadMore}
          className="font-medium text-signal-sky hover:underline"
        >
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
