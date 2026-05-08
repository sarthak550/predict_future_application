import { Prisma, type MarketCategory, type MarketStatus, type StoryStatus } from "@prisma/client";

import { prisma } from "@/lib/prisma";
import { approvedStoryStatuses } from "@/lib/validations/news";

const visibleNewsStatuses: StoryStatus[] = [...new Set<StoryStatus>([...approvedStoryStatuses, "PUBLISHED"])];

export type PlainNewsItem = {
  id: string;
  title: string;
  summary: string;
  sourceName: string;
  sourceUrl: string;
  imageUrl: string | null;
  category: MarketCategory;
  publishedAt: string;
  ingestedAt: string;
  status: StoryStatus;
};

export type NewsFeedExpertOpinion = {
  id: string;
  expertId: string;
  expertName: string;
  expertOrganization: string;
  avatarUrl: string | null;
  verified: boolean;
  quote: string;
  direction: string;
  sourceUrl: string;
  resolutionStatus: string;
  resolvedAt: Date | null;
  /** Nullable FK to event cluster for filter UX (S18-T4) */
  eventClusterId: string | null;
};

export type NewsFeedItem = {
  id: string;
  slug: string;
  headline: string;
  summary: string;
  category: MarketCategory;
  sourceName: string;
  sourceUrl: string;
  imageUrl: string | null;
  publishedAt: string;
  ingestedAt: string;
  isFeatured: boolean;
  isTrending: boolean;
  market: {
    id: string;
    slug: string;
    title: string;
    status: MarketStatus;
    marketType: string;
    yesPool: number;
    noPool: number;
    totalVolume: number;
    totalParticipants: number;
    yesCount: number;
    noCount: number;
    totalVotes: number;
    unit: string | null;
    minValue: number | null;
    maxValue: number | null;
    averageNumericValue: number | null;
    closeAt: Date | null;
  } | null;
  expertOpinions: NewsFeedExpertOpinion[];
};

export type NewsCursorPage = {
  items: NewsFeedItem[];
  nextCursor: string | null;
  hasMore: boolean;
};

const UNAPPROVED_MARKET_STATUSES: MarketStatus[] = [
  "DRAFT",
  "PENDING_REVIEW",
  "REJECTED",
  "HOST_TIMEOUT",
];

const newsFeedInclude = () =>
  ({
    market: true,
    expertOpinions: {
      where: { suppressedAt: null },
      include: { expert: true },
      orderBy: { publishedAt: "desc" as const },
      take: 3,
    },
  }) satisfies Prisma.StoryInclude;

function buildCursorWhere(cursor?: { publishedAt: Date; id: string } | null): Prisma.StoryWhereInput | undefined {
  if (!cursor) return undefined;

  return {
    OR: [
      { publishedAt: { lt: cursor.publishedAt } },
      { AND: [{ publishedAt: cursor.publishedAt }, { id: { lt: cursor.id } }] }
    ]
  };
}

export function encodeNewsCursor(input: { publishedAt: Date | string; id: string }) {
  return `${new Date(input.publishedAt).toISOString()}::${input.id}`;
}

export function decodeNewsCursor(cursor?: string | null) {
  if (!cursor) return null;
  const [publishedAt, id] = cursor.split("::");
  if (!publishedAt || !id) return null;
  const parsedDate = new Date(publishedAt);
  if (Number.isNaN(parsedDate.getTime())) return null;
  return { publishedAt: parsedDate, id };
}

export async function getPublishedNewsPage(input?: {
  limit?: number;
  category?: MarketCategory;
  excludeCategory?: MarketCategory;
  cursor?: string | null;
  userId?: string | null;
  requireExpertOpinions?: boolean;
}) {
  const limit = Math.max(1, Math.min(20, input?.limit ?? 10));
  const decodedCursor = decodeNewsCursor(input?.cursor);
  const items = await prisma.story.findMany({
    where: {
      status: { in: visibleNewsStatuses },
      ...(input?.category ? { category: input.category } : {}),
      ...(input?.excludeCategory ? { category: { not: input.excludeCategory } } : {}),
      ...(input?.requireExpertOpinions ? { expertOpinions: { some: { suppressedAt: null } } } : {}),
      ...(buildCursorWhere(decodedCursor) ?? {})
    },
    orderBy: [{ publishedAt: "desc" }, { id: "desc" }],
    include: newsFeedInclude(),
    take: limit + 1
  });

  const hasMore = items.length > limit;
  const slice = items.slice(0, limit);
  const lastItem = slice.at(-1);

  return {
    items: slice.map<NewsFeedItem>((item) => ({
      id: item.id,
      slug: item.slug,
      headline: item.headline,
      summary: item.summary,
      category: item.category,
      sourceName: item.sourceName,
      sourceUrl: item.sourceUrl,
      imageUrl: item.imageUrl,
      publishedAt: item.publishedAt.toISOString(),
      ingestedAt: item.ingestedAt.toISOString(),
      isFeatured: item.isFeatured,
      isTrending: item.isTrending,
      market: item.market && !UNAPPROVED_MARKET_STATUSES.includes(item.market.status)
        ? {
            id: item.market.id,
            slug: item.market.slug,
            title: item.market.title,
            status: item.market.status,
            marketType: item.market.marketType,
            yesPool: item.market.yesPool,
            noPool: item.market.noPool,
            totalVolume: item.market.totalVolume,
            totalParticipants: item.market.totalParticipants,
            yesCount: item.market.yesCount,
            noCount: item.market.noCount,
            totalVotes: item.market.totalVotes,
            unit: item.market.unit,
            minValue: item.market.minValue,
            maxValue: item.market.maxValue,
            averageNumericValue: item.market.averageNumericValue,
            closeAt: item.market.closeAt,
          }
        : null,
      expertOpinions: (item.expertOpinions ?? []).map((opinion) => ({
        id: opinion.id,
        expertId: opinion.expertId,
        expertName: opinion.expert.name,
        expertOrganization: opinion.expert.organization,
        avatarUrl: opinion.expert.avatarUrl ?? null,
        verified: opinion.expert.verified,
        quote: opinion.quote,
        direction: opinion.direction,
        sourceUrl: opinion.sourceUrl,
        resolutionStatus: opinion.resolutionStatus,
        resolvedAt: opinion.resolvedAt ?? null,
        eventClusterId: opinion.eventClusterId ?? null,
      })),
    })),
    nextCursor: hasMore && lastItem ? encodeNewsCursor(lastItem) : null,
    hasMore
  } satisfies NewsCursorPage;
}

export async function getPublishedNewsItems(input?: {
  limit?: number;
  category?: MarketCategory;
}) {
  const limit = Math.max(1, Math.min(100, input?.limit ?? 20));
  const items = await prisma.story.findMany({
    where: {
      status: { in: visibleNewsStatuses },
      ...(input?.category ? { category: input.category } : {})
    },
    orderBy: [{ publishedAt: "desc" }, { ingestedAt: "desc" }],
    take: limit
  });

  return items.map<PlainNewsItem>((item) => ({
    id: item.id,
    title: item.headline,
    summary: item.summary,
    sourceName: item.sourceName,
    sourceUrl: item.sourceUrl,
    imageUrl: item.imageUrl,
    category: item.category,
    publishedAt: item.publishedAt.toISOString(),
    ingestedAt: item.ingestedAt.toISOString(),
    status: item.status
  }));
}

export async function getNewsDebugSnapshot() {
  const [totalItems, latestItems, latestIngestion, feedBreakdown] = await Promise.all([
    prisma.story.count({ where: { status: { in: visibleNewsStatuses } } }),
    prisma.story.findMany({
      where: { status: { in: visibleNewsStatuses } },
      orderBy: [{ ingestedAt: "desc" }, { publishedAt: "desc" }],
      take: 10,
      select: {
        id: true, headline: true, sourceName: true, sourceUrl: true,
        category: true, publishedAt: true, ingestedAt: true, status: true,
        ingestionFeedId: true, ingestionFeedName: true
      }
    }),
    prisma.story.findFirst({
      where: { status: { in: visibleNewsStatuses } },
      orderBy: { ingestedAt: "desc" },
      select: { ingestedAt: true }
    }),
    prisma.story.groupBy({
      by: ["ingestionFeedId", "ingestionFeedName"],
      where: { status: { in: visibleNewsStatuses }, ingestionFeedId: { not: null } },
      _count: { _all: true },
      _max: { ingestedAt: true, publishedAt: true }
    })
  ]);

  return {
    totalItems,
    latestItems: latestItems.map((item) => ({
      id: item.id, title: item.headline, sourceName: item.sourceName,
      sourceUrl: item.sourceUrl, category: item.category,
      publishedAt: item.publishedAt.toISOString(),
      ingestedAt: item.ingestedAt.toISOString(),
      status: item.status, feedId: item.ingestionFeedId, feedName: item.ingestionFeedName
    })),
    lastIngestionTime: latestIngestion?.ingestedAt.toISOString() ?? null,
    feedStatuses: feedBreakdown.map((feed) => ({
      feedId: feed.ingestionFeedId, feedName: feed.ingestionFeedName,
      totalItems: feed._count._all,
      lastIngestedAt: feed._max.ingestedAt?.toISOString() ?? null,
      latestPublishedAt: feed._max.publishedAt?.toISOString() ?? null
    }))
  };
}

export function getVisibleNewsStatuses() {
  return visibleNewsStatuses;
}
