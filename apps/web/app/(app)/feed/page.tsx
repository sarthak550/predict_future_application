import type { MarketCategory } from "@prisma/client";

import { NewsFeedScreen } from "@/components/feed/news-feed-screen";

function getFeedCopy(view: string, category?: MarketCategory) {
  if (view === "latest") {
    return {
      title: "Latest stories",
      description: "Swipe through the freshest short-form stories and predict what happens next."
    };
  }

  if (view === "trending") {
    return {
      title: "Trending now",
      description: "The stories attracting the most attention and the busiest crowd forecasts."
    };
  }

  if (view === "resolved") {
    return {
      title: "Resolved stories",
      description: "Catch up on outcomes, settlement results, and how the crowd performed."
    };
  }

  return {
    title: category ? `${category.toLowerCase()} feed` : "Swipe through the news",
    description: "Read the headline, skim the summary, check the source, then make your call with virtual points."
  };
}

export default async function FeedPage({
  searchParams
}: {
  searchParams?: { view?: string };
}) {
  const view = (searchParams?.view ?? "latest") as "for-you" | "latest" | "trending" | "resolved";
  const copy = getFeedCopy(view);

  return <NewsFeedScreen view={view} title={copy.title} description={copy.description} />;
}
