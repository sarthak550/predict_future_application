import type { MarketCategory } from "@prisma/client";

import { CategoryTabs } from "@/components/feed/category-tabs";
import { FeedViewTabs } from "@/components/feed/feed-view-tabs";
import { NewsFeedStream } from "@/components/feed/news-feed-stream";
import { getCurrentUser } from "@/lib/auth";
import { marketCategoryLabels } from "@/lib/constants";
import { type FeedView } from "@/lib/stories/queries";

/**
 * Feed screen — the primary surface of the product.
 *
 * Design choice: a single central column, no right-hand widget rail. The feed
 * is the thing; anything competing with it for attention gets in the way. The
 * leaderboard lives on its own tab, the featured story is surfaced via the
 * feed ranking itself, and the streak shows up on the profile.
 */
export async function NewsFeedScreen({
  view,
  category,
  title,
  description
}: {
  view: FeedView;
  category?: MarketCategory;
  title: string;
  description: string;
}) {
  const user = await getCurrentUser();

  return (
    <div className="mx-auto flex min-h-[calc(100vh-6rem)] max-w-3xl flex-col gap-5">
      <header className="space-y-2">
        <h1 className="text-3xl font-semibold tracking-tight text-ink-900 sm:text-4xl">{title}</h1>
        <p className="max-w-2xl text-sm leading-7 text-ink-500">{description}</p>
      </header>

      <div className="space-y-3">
        <FeedViewTabs currentView={view} categoryPath={category?.toLowerCase()} />
        <CategoryTabs currentCategory={category} currentView={view} />
      </div>

      <div className="min-h-0 flex-1">
        <NewsFeedStream
          view={view}
          category={category}
          balance={user?.wallet?.balance}
          canTrade={Boolean(user && !user.isSuspended)}
        />
      </div>

      {category && (
        <p className="text-xs uppercase tracking-[0.2em] text-ink-400">
          Showing {marketCategoryLabels[category]} stories. Attached prediction markets appear where available.
        </p>
      )}
    </div>
  );
}
