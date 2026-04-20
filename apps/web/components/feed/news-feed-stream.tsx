"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { MarketCategory, MarketStatus, PositionSide } from "@prisma/client";

import { SwipeFeed } from "@/components/feed/swipe-feed";
import type { SwipeStory } from "@/components/feed/swipe-story-card";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";

type FeedStoryResponse = SwipeStory & {
  market: {
    id: string;
    title: string;
    status: MarketStatus;
    yesPool: number;
    noPool: number;
    totalVolume: number;
    positions?: Array<{
      side: PositionSide;
      amount: number;
    }>;
  } | null;
};

type CursorNewsResponse = {
  items?: FeedStoryResponse[];
  nextCursor?: string | null;
  hasMore?: boolean;
  error?: string;
};

type PagedFeedResponse = {
  stories?: FeedStoryResponse[];
  pagination?: {
    hasMore?: boolean;
    page?: number;
  };
  error?: string;
};

export function NewsFeedStream({
  view,
  category,
  balance,
  canTrade
}: {
  view: "for-you" | "latest" | "trending" | "resolved";
  category?: MarketCategory;
  balance?: number;
  canTrade: boolean;
}) {
  const pageSize = 10;
  const isLatestView = view === "latest";
  const [stories, setStories] = useState<FeedStoryResponse[]>([]);
  const [page, setPage] = useState(1);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [error, setError] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const loadingRef = useRef(false);

  const fetchLatestBatch = useCallback(
    async (cursor?: string | null, signal?: AbortSignal) => {
      const endpoint = new URL("/api/news", window.location.origin);
      endpoint.searchParams.set("limit", String(pageSize));
      if (category) {
        endpoint.searchParams.set("category", category);
      }
      if (cursor) {
        endpoint.searchParams.set("cursor", cursor);
      }

      const response = await fetch(endpoint.toString(), {
        signal
      });
      const payload = (await response.json()) as CursorNewsResponse;
      if (!response.ok) {
        throw new Error(payload.error ?? "Unable to load latest news.");
      }

      return {
        items: payload.items ?? [],
        hasMore: Boolean(payload.hasMore),
        nextCursor: payload.nextCursor ?? null
      };
    },
    [category, pageSize]
  );

  const fetchRankedPage = useCallback(
    async (nextPage: number, signal?: AbortSignal) => {
      const endpoint = new URL(
        view === "trending" ? "/api/news/trending" : "/api/news/feed",
        window.location.origin
      );
      endpoint.searchParams.set("page", String(nextPage));
      endpoint.searchParams.set("pageSize", String(pageSize));
      if (view !== "trending") {
        endpoint.searchParams.set("view", view);
      }
      if (category) {
        endpoint.searchParams.set("category", category);
      }

      const response = await fetch(endpoint.toString(), {
        signal
      });
      const payload = (await response.json()) as PagedFeedResponse;
      if (!response.ok) {
        throw new Error(payload.error ?? "Unable to load feed.");
      }

      return {
        items: payload.stories ?? [],
        hasMore: Boolean(payload.pagination?.hasMore),
        page: payload.pagination?.page ?? nextPage
      };
    },
    [category, pageSize, view]
  );

  useEffect(() => {
    const controller = new AbortController();
    loadingRef.current = false;
    setStories([]);
    setPage(1);
    setNextCursor(null);
    setHasMore(false);
    setError("");
    setIsLoading(true);

    void (async () => {
      try {
        if (isLatestView) {
          const payload = await fetchLatestBatch(null, controller.signal);
          setStories(payload.items);
          setHasMore(payload.hasMore);
          setNextCursor(payload.nextCursor);
        } else {
          const payload = await fetchRankedPage(1, controller.signal);
          setStories(payload.items);
          setHasMore(payload.hasMore);
          setPage(payload.page);
        }
      } catch (fetchError) {
        if ((fetchError as Error).name === "AbortError") {
          return;
        }

        setError(fetchError instanceof Error ? fetchError.message : "Unable to load feed.");
      } finally {
        setIsLoading(false);
      }
    })();

    return () => {
      controller.abort();
    };
  }, [fetchLatestBatch, fetchRankedPage, isLatestView]);

  const loadMore = useCallback(async () => {
    if (loadingRef.current || isLoadingMore || !hasMore) {
      return;
    }

    loadingRef.current = true;
    setIsLoadingMore(true);
    setError("");

    try {
      if (isLatestView) {
        const payload = await fetchLatestBatch(nextCursor);
        setStories((current) => {
          const seen = new Set(current.map((story) => story.id));
          return [...current, ...payload.items.filter((story) => !seen.has(story.id))];
        });
        setHasMore(payload.hasMore);
        setNextCursor(payload.nextCursor);
      } else {
        const targetPage = page + 1;
        const payload = await fetchRankedPage(targetPage);
        setStories((current) => {
          const seen = new Set(current.map((story) => story.id));
          return [...current, ...payload.items.filter((story) => !seen.has(story.id))];
        });
        setHasMore(payload.hasMore);
        setPage(payload.page);
      }
    } catch (loadMoreError) {
      setError(loadMoreError instanceof Error ? loadMoreError.message : "Unable to load more stories.");
    } finally {
      loadingRef.current = false;
      setIsLoadingMore(false);
    }
  }, [fetchLatestBatch, fetchRankedPage, hasMore, isLatestView, isLoadingMore, nextCursor, page]);

  if (isLoading) {
    return (
      <EmptyState
        title="Loading latest news..."
        description="Building the vertical feed from the latest published stories."
      />
    );
  }

  if (!isLoading && stories.length === 0) {
    return (
      <EmptyState
        title="No stories available"
        description="The feed is refreshing. Try again in a moment."
      />
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col gap-3">
      <div className="min-h-0 flex-1">
        <SwipeFeed
          stories={stories}
          balance={balance}
          canTrade={canTrade}
          hasMore={hasMore}
          isLoadingMore={isLoadingMore}
          onLoadMore={() => {
            void loadMore();
          }}
        />
      </div>
      {error && stories.length > 0 && (
        <div className="flex items-center justify-center gap-3 rounded-2xl border border-rose-200 bg-white/80 px-4 py-3 text-sm text-rose-700">
          <span>{error}</span>
          <Button size="sm" variant="secondary" onClick={() => void loadMore()}>
            Retry
          </Button>
        </div>
      )}
    </div>
  );
}
