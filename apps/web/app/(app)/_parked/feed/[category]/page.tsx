import { MarketCategory } from "@prisma/client";
import { notFound } from "next/navigation";

import { NewsFeedScreen } from "@/components/feed/news-feed-screen";
import { marketCategoryLabels } from "@/lib/constants";

export default async function CategoryFeedPage({
  params,
  searchParams
}: {
  params: { category: string };
  searchParams?: { view?: string };
}) {
  const normalizedCategory = params.category.toUpperCase();
  if (!Object.values(MarketCategory).includes(normalizedCategory as MarketCategory)) {
    notFound();
  }

  const category = normalizedCategory as MarketCategory;
  const view = (searchParams?.view ?? "latest") as "for-you" | "latest" | "trending" | "resolved";

  return (
    <NewsFeedScreen
      view={view}
      category={category}
      title={marketCategoryLabels[category]}
      description={`Short-form ${marketCategoryLabels[category].toLowerCase()} stories with attached prediction questions.`}
    />
  );
}
