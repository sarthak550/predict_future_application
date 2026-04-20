import type { MarketCategory } from "@prisma/client";

type RankedStory = {
  id: string;
  category: MarketCategory;
  ingestionType: "MANUAL" | "RSS" | "API" | "CURATED";
  publishedAt: Date;
  createdAt: Date;
  isFeatured: boolean;
  isTrending: boolean;
  market: {
    totalParticipants: number;
    totalVolume: number;
    positions?: Array<unknown>;
    _count?: {
      comments: number;
    };
  } | null;
};

type FeedView = "for-you" | "latest" | "trending" | "resolved";

type RankingContext = {
  view: FeedView;
  categoryWeights?: Partial<Record<MarketCategory, number>>;
  curatedPositions?: Map<string, number>;
};

function getHoursOld(publishedAt: Date) {
  return Math.max(0, (Date.now() - publishedAt.getTime()) / (1000 * 60 * 60));
}

function getCategoryWeight(category: MarketCategory, categoryWeights?: Partial<Record<MarketCategory, number>>) {
  return categoryWeights?.[category] ?? 0;
}

function getCuratedBoost(storyId: string, curatedPositions?: Map<string, number>) {
  const position = curatedPositions?.get(storyId);
  if (!position) {
    return 0;
  }

  return Math.max(0, 3 - position * 0.35);
}

function scoreStory(story: RankedStory, context: RankingContext) {
  const hoursOld = getHoursOld(story.publishedAt);
  const ingestHoursOld = getHoursOld(story.createdAt);
  const recency = Math.max(0, 36 - hoursOld) / 6;
  const freshness = Math.max(0, 72 - hoursOld) / 12;
  const ingestFreshness = Math.max(0, 24 - ingestHoursOld) / 4;
  const market = story.market;
  const volumeScore = market ? Math.min(6, market.totalVolume / 2000) : 0;
  const participantScore = market ? Math.min(4, market.totalParticipants / 8) : 0;
  const discussionScore = market?._count ? Math.min(2.5, market._count.comments / 3) : 0;
  const unseenBoost = market && (market.positions?.length ?? 0) === 0 ? 1.25 : -0.25;
  const featuredBoost = story.isFeatured ? 2.5 : 0;
  const trendingBoost = story.isTrending ? 2 : 0;
  const curatedBoost = getCuratedBoost(story.id, context.curatedPositions);
  const categoryBoost = getCategoryWeight(story.category, context.categoryWeights);
  const apiBoost =
    story.ingestionType === "RSS" || story.ingestionType === "API"
      ? 2.5
      : story.ingestionType === "MANUAL"
        ? 1
        : 0;

  if (context.view === "latest") {
    return (
      recency * 2.5 +
      freshness +
      ingestFreshness * 2 +
      apiBoost * 2 +
      volumeScore * 0.8 +
      featuredBoost * 0.5 +
      trendingBoost * 0.3
    );
  }

  if (context.view === "trending") {
    return (
      volumeScore * 3 +
      participantScore * 2 +
      discussionScore * 1.5 +
      freshness +
      apiBoost * 0.8 +
      trendingBoost * 2.5 +
      featuredBoost
    );
  }

  if (context.view === "resolved") {
    return recency * 2.5 + discussionScore + participantScore + apiBoost * 0.6 + featuredBoost * 0.3;
  }

  return (
    categoryBoost * 2.5 +
    curatedBoost * 2 +
    unseenBoost * 2 +
    apiBoost +
    featuredBoost * 1.8 +
    trendingBoost * 1.4 +
    volumeScore * 1.2 +
    participantScore +
    freshness
  );
}

export function rankFeedStories<T extends RankedStory>(stories: T[], context: RankingContext) {
  return [...stories].sort((left, right) => {
    const scoreDelta = scoreStory(right, context) - scoreStory(left, context);
    if (scoreDelta !== 0) {
      return scoreDelta;
    }

    return right.publishedAt.getTime() - left.publishedAt.getTime();
  });
}
