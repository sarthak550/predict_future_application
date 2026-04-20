"use client";

import { useCallback, useEffect, useRef } from "react";

import { SwipeStoryCard } from "@/components/feed/swipe-story-card";
import type { SwipeStory } from "@/components/feed/swipe-story-card";

export function SwipeFeed({
  stories,
  balance,
  canTrade,
  hasMore,
  isLoadingMore,
  onLoadMore
}: {
  stories: SwipeStory[];
  balance?: number;
  canTrade: boolean;
  hasMore: boolean;
  isLoadingMore: boolean;
  onLoadMore?: () => void;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const observerRef = useRef<IntersectionObserver | null>(null);

  const attachPrefetchRef = useCallback(
    (node: HTMLDivElement | null) => {
      observerRef.current?.disconnect();

      if (!node || !containerRef.current || !hasMore || isLoadingMore || !onLoadMore) {
        return;
      }

      observerRef.current = new IntersectionObserver(
        (entries) => {
          const entry = entries[0];
          if (entry?.isIntersecting) {
            onLoadMore();
          }
        },
        {
          root: containerRef.current,
          rootMargin: "150% 0px 150% 0px",
          threshold: 0.2
        }
      );

      observerRef.current.observe(node);
    },
    [hasMore, isLoadingMore, onLoadMore]
  );

  useEffect(() => {
    return () => {
      observerRef.current?.disconnect();
    };
  }, []);

  return (
    <div
      ref={containerRef}
      className="h-full min-h-0 overflow-y-auto overscroll-y-contain snap-y snap-mandatory scroll-smooth"
    >
      {stories.map((story, index) => (
        <div
          key={story.id}
          ref={index === Math.max(0, stories.length - 3) ? attachPrefetchRef : undefined}
          className="min-h-full"
        >
          <SwipeStoryCard story={story} balance={balance} canTrade={canTrade} />
        </div>
      ))}
      <div className="flex min-h-20 items-center justify-center text-sm text-ink-400">
        {isLoadingMore ? "Loading more stories..." : hasMore ? "Keep scrolling for more" : "You are caught up"}
      </div>
    </div>
  );
}
