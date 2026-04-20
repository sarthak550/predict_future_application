import { NewsFeedScreen } from "@/components/feed/news-feed-screen";

export default async function TrendingPage() {
  return (
    <NewsFeedScreen
      view="trending"
      title="Trending stories"
      description="The fastest-moving stories and the most active crowd probabilities, all in one swipeable feed."
    />
  );
}
