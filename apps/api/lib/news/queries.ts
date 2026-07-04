import { Prisma, type MarketCategory, type MarketStatus, type StoryStatus } from "@prisma/client";

import { prisma } from "@/lib/prisma";
import { NORMALIZATION_MAP } from "@/lib/finance/instrumentCatalog";
import { approvedStoryStatuses } from "@/lib/validations/news";

const visibleNewsStatuses: StoryStatus[] = [...new Set<StoryStatus>([...approvedStoryStatuses, "PUBLISHED"])];

// Feed category merges: "Business" absorbs Finance (+ the vestigial Company tag),
// and "Tech" absorbs the vestigial Product tag — matching the consolidated Feed
// chips. Applied only to the positive category filter; excludeCategory is untouched.
const CATEGORY_GROUPS: Partial<Record<MarketCategory, MarketCategory[]>> = {
  BUSINESS: ["BUSINESS", "FINANCE", "COMPANY"],
  TECH: ["TECH", "PRODUCT"],
};

/** Prisma where-fragment for a category filter, expanding merged Feed groups. */
function categoryWhere(category: MarketCategory): Prisma.StoryWhereInput {
  const group = CATEGORY_GROUPS[category];
  return group ? { category: { in: group } } : { category };
}

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
  resolutionNote: string | null;
  /** Nullable FK to event cluster for filter UX (S18-T4) */
  eventClusterId: string | null;
  /** True when sourced from trusted publication (no named analyst) — display as "Market Analysis from [Source]" */
  isSourceAttribution: boolean;
  /** Human-readable instrument name, e.g. "Nifty 50" — null until identified by auto-resolution */
  instrument: string | null;
  /** Yahoo Finance ticker symbol for the primary instrument, e.g. "^NSEI" */
  instrumentTicker: string | null;
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
      take: 10,
    },
  }) satisfies Prisma.StoryInclude;

/**
 * Sort key for the news feed pagination. Defaults to publishedAt; switches to
 * latestResolvedAt when the user has the "Resolved only" filter active so the
 * most recently resolved stories surface first regardless of original publish date.
 */
type NewsSortField = "publishedAt" | "latestResolvedAt";

function buildCursorWhere(
  cursor: { date: Date; id: string } | null | undefined,
  sortField: NewsSortField
): Prisma.StoryWhereInput | undefined {
  if (!cursor) return undefined;
  return {
    OR: [
      { [sortField]: { lt: cursor.date } },
      { AND: [{ [sortField]: cursor.date }, { id: { lt: cursor.id } }] },
    ] as Prisma.StoryWhereInput["OR"],
  };
}

export function encodeNewsCursor(input: { date: Date | string; id: string }) {
  return `${new Date(input.date).toISOString()}::${input.id}`;
}

/**
 * Raised when a cursor string is present in the request but doesn't match the
 * expected `ISO_DATE::id` format. Callers (route handlers) should map this to
 * a 400 response so client-side cursor bugs surface immediately instead of
 * silently degrading to "no cursor → page 1" behavior.
 */
export class InvalidCursorError extends Error {
  constructor(public readonly raw: string, reason: string) {
    super(`Invalid news cursor (${reason}): ${raw}`);
    this.name = "InvalidCursorError";
  }
}

export function decodeNewsCursor(cursor?: string | null) {
  // Absent cursor is fine — just means "start from page 1".
  if (cursor === undefined || cursor === null || cursor === "") return null;
  const [date, id] = cursor.split("::");
  if (!date || !id) {
    throw new InvalidCursorError(cursor, "expected ISO_DATE::id format");
  }
  const parsedDate = new Date(date);
  if (Number.isNaN(parsedDate.getTime())) {
    throw new InvalidCursorError(cursor, "date component is not a valid ISO timestamp");
  }
  return { date: parsedDate, id };
}

type OpinionFilterInput = {
  expertOpinionClusterId?: string;
  expertOpinionDirection?: "BULLISH" | "BEARISH" | "NEUTRAL";
  expertOpinionVerified?: boolean;
  expertOpinionResolved?: boolean;
  expertOpinionInstrument?: string;
  expertOpinionAnalyst?: string;
  expertOpinionSourceType?: "ANALYST" | "PUBLICATION";
};

/**
 * Returns the canonical label itself plus every raw NORMALIZATION_MAP key that
 * collapses to that canonical. Used by the instrument filter to match all stored
 * variants when the picker sends a canonical label.
 *
 * Examples (from current NORMALIZATION_MAP):
 *   getInstrumentVariants("SBI")   → ["SBI", "State Bank of India"]
 *   getInstrumentVariants("Gold")  → ["Gold", "Gold Futures"]
 *   getInstrumentVariants("L&T")   → ["L&T", "Larsen & Toubro"]
 *   getInstrumentVariants("Nifty 50") → ["Nifty 50", "Nifty 50 Index"]
 *   getInstrumentVariants("Reliance Industries") → ["Reliance Industries"]  // no map entry
 */
export function getInstrumentVariants(canonical: string): string[] {
  const variants: string[] = [canonical];
  for (const [raw, mapped] of Object.entries(NORMALIZATION_MAP)) {
    if (mapped === canonical) {
      variants.push(raw);
    }
  }
  return variants;
}

/**
 * Builds the Story.where filter for opinion-level constraints. When any opinion
 * filter is set, requires at least one matching opinion via `some`. When nothing
 * is set, honors the simpler requireExpertOpinions toggle.
 */
function buildOpinionWhere(input: OpinionFilterInput & { requireExpertOpinions?: boolean }) {
  const opinionWhere: Record<string, unknown> = { suppressedAt: null };
  let hasAnyOpinionFilter = false;

  if (input.expertOpinionClusterId) {
    opinionWhere.eventClusterId = input.expertOpinionClusterId;
    hasAnyOpinionFilter = true;
  }
  if (input.expertOpinionDirection) {
    opinionWhere.direction = input.expertOpinionDirection;
    hasAnyOpinionFilter = true;
  }
  if (input.expertOpinionResolved === true) {
    opinionWhere.resolutionStatus = { in: ["RESOLVED_HIT", "RESOLVED_MISS"] };
    hasAnyOpinionFilter = true;
  }
  if (input.expertOpinionInstrument) {
    const variants = getInstrumentVariants(input.expertOpinionInstrument);
    opinionWhere.OR = variants.flatMap((v) => [
      { instrument: { contains: v, mode: "insensitive" } },
      { instrumentTicker: { contains: v, mode: "insensitive" } },
    ]);
    hasAnyOpinionFilter = true;
  }
  if (input.expertOpinionAnalyst) {
    opinionWhere.expertId = input.expertOpinionAnalyst;
    hasAnyOpinionFilter = true;
  }
  if (input.expertOpinionSourceType === "ANALYST") {
    opinionWhere.isSourceAttribution = false;
    hasAnyOpinionFilter = true;
  } else if (input.expertOpinionSourceType === "PUBLICATION") {
    opinionWhere.isSourceAttribution = true;
    hasAnyOpinionFilter = true;
  }
  if (input.expertOpinionVerified === true) {
    opinionWhere.expert = { verified: true };
    hasAnyOpinionFilter = true;
  }

  if (hasAnyOpinionFilter) {
    return { expertOpinions: { some: opinionWhere } };
  }
  if (input.requireExpertOpinions) {
    return { expertOpinions: { some: { suppressedAt: null } } };
  }
  return {};
}

export async function getPublishedNewsPage(input?: {
  limit?: number;
  category?: MarketCategory;
  excludeCategory?: MarketCategory;
  cursor?: string | null;
  userId?: string | null;
  requireExpertOpinions?: boolean;
} & OpinionFilterInput) {
  const limit = Math.max(1, Math.min(50, input?.limit ?? 10));
  const decodedCursor = decodeNewsCursor(input?.cursor);
  const expertOpinionsFilter = buildOpinionWhere(input ?? {});

  // When "Resolved only" is on, paginate by the most recent resolution time
  // instead of original publish date so a 60-day-old call that just resolved
  // surfaces near the top rather than being buried on page 6.
  const sortField: NewsSortField = input?.expertOpinionResolved === true ? "latestResolvedAt" : "publishedAt";
  const sortNullFilter: Prisma.StoryWhereInput =
    sortField === "latestResolvedAt" ? { latestResolvedAt: { not: null } } : {};

  const items = await prisma.story.findMany({
    where: {
      status: { in: visibleNewsStatuses },
      ...(input?.category ? categoryWhere(input.category) : {}),
      ...(input?.excludeCategory ? { category: { not: input.excludeCategory } } : {}),
      ...expertOpinionsFilter,
      ...sortNullFilter,
      ...(buildCursorWhere(decodedCursor, sortField) ?? {})
    },
    orderBy: [{ [sortField]: "desc" }, { id: "desc" }] as Prisma.StoryOrderByWithRelationInput[],
    include: newsFeedInclude(),
    take: limit + 1
  });

  const hasMore = items.length > limit;
  const slice = items.slice(0, limit);
  const lastItem = slice.at(-1);
  const cursorDateFor = (item: typeof slice[number]): Date =>
    sortField === "latestResolvedAt"
      ? (item.latestResolvedAt ?? item.publishedAt)
      : item.publishedAt;

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
        storyId: opinion.storyId ?? null,
        publishedAt: opinion.publishedAt.toISOString(),
        analystCallAt: opinion.analystCallAt?.toISOString() ?? null,
        resolutionStatus: opinion.resolutionStatus,
        resolvedAt: opinion.resolvedAt ?? null,
        resolutionNote: opinion.resolutionNote ?? null,
        eventClusterId: opinion.eventClusterId ?? null,
        isSourceAttribution: opinion.isSourceAttribution,
        instrument: opinion.instrument ?? null,
        instrumentTicker: opinion.instrumentTicker ?? null,
        siblings: (item.expertOpinions ?? [])
          .filter((sib) => sib.id !== opinion.id)
          .map((sib) => ({
            id: sib.id,
            expertId: sib.expertId,
            expertName: sib.expert.name,
            expertOrganization: sib.expert.organization,
            direction: sib.direction,
            instrument: sib.instrument ?? null,
            verified: sib.expert.verified,
          })),
      })),
    })),
    nextCursor: hasMore && lastItem ? encodeNewsCursor({ date: cursorDateFor(lastItem), id: lastItem.id }) : null,
    hasMore
  } satisfies NewsCursorPage;
}

/**
 * Personalized news feed.
 *
 * Stories linked to markets where followed analysts placed positions in the
 * last 14 days are surfaced first. Non-boosted stories fill the tail in
 * standard reverse-chronological order.
 *
 * Falls back to standard chronological feed when:
 * - userId is missing
 * - The user follows nobody
 * - No relevant market positions found
 */
export async function getPersonalizedNewsPage(input: {
  limit?: number;
  category?: MarketCategory;
  excludeCategory?: MarketCategory;
  cursor?: string | null;
  userId: string;
  requireExpertOpinions?: boolean;
} & OpinionFilterInput): Promise<NewsCursorPage> {
  const limit = Math.max(1, Math.min(50, input.limit ?? 10));
  const decodedCursor = decodeNewsCursor(input.cursor);

  // 1. Fetch the set of userIds the current user follows.
  const followRows = await prisma.follow.findMany({
    where: { followerId: input.userId },
    select: { followeeId: true },
  });

  if (followRows.length === 0) {
    // No follows → standard feed
    return getPublishedNewsPage(input);
  }

  const followeeIds = followRows.map((r) => r.followeeId);
  const since14Days = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000);

  // 2. Collect marketIds from those users' recent positions.
  const recentPositions = await prisma.marketPosition.findMany({
    where: {
      userId: { in: followeeIds },
      createdAt: { gte: since14Days },
    },
    select: { marketId: true },
  });

  const boostedMarketIds = [...new Set(recentPositions.map((p) => p.marketId))];

  if (boostedMarketIds.length === 0) {
    // Followed analysts have no recent positions → standard feed
    return getPublishedNewsPage(input);
  }

  // 3. Fetch two batches in one query: boosted stories first, then the rest.
  // We over-fetch slightly (2× limit) then page correctly.
  const expertOpinionsFilter = buildOpinionWhere(input);

  // Same sort-key switch as getPublishedNewsPage — when "Resolved only" is on,
  // paginate by latestResolvedAt so newly-resolved stories surface first.
  const sortField: NewsSortField = input.expertOpinionResolved === true ? "latestResolvedAt" : "publishedAt";
  const sortNullFilter: Prisma.StoryWhereInput =
    sortField === "latestResolvedAt" ? { latestResolvedAt: { not: null } } : {};

  const baseWhere: Prisma.StoryWhereInput = {
    status: { in: visibleNewsStatuses },
    ...(input.category ? categoryWhere(input.category) : {}),
    ...(input.excludeCategory ? { category: { not: input.excludeCategory } } : {}),
    ...expertOpinionsFilter,
    ...sortNullFilter,
    ...(buildCursorWhere(decodedCursor, sortField) ?? {}),
  };

  const orderBy = [{ [sortField]: "desc" }, { id: "desc" }] as Prisma.StoryOrderByWithRelationInput[];

  const [boostedItems, regularItems] = await Promise.all([
    prisma.story.findMany({
      where: { ...baseWhere, market: { id: { in: boostedMarketIds } } },
      orderBy,
      include: newsFeedInclude(),
      take: limit + 1,
    }),
    prisma.story.findMany({
      where: {
        ...baseWhere,
        // Exclude stories already in the boosted batch so no duplicates.
        NOT: { market: { id: { in: boostedMarketIds } } },
      },
      orderBy,
      include: newsFeedInclude(),
      take: limit + 1,
    }),
  ]);

  // Merge: boosted first, then regular, deduplicate by id.
  const seenIds = new Set<string>();
  const merged: typeof boostedItems = [];
  for (const item of [...boostedItems, ...regularItems]) {
    if (!seenIds.has(item.id)) {
      seenIds.add(item.id);
      merged.push(item);
    }
  }

  const hasMore = merged.length > limit;
  const slice = merged.slice(0, limit);
  const lastItem = slice.at(-1);
  const personalizedCursorDateFor = (item: typeof slice[number]): Date =>
    sortField === "latestResolvedAt"
      ? (item.latestResolvedAt ?? item.publishedAt)
      : item.publishedAt;

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
        storyId: opinion.storyId ?? null,
        publishedAt: opinion.publishedAt.toISOString(),
        analystCallAt: opinion.analystCallAt?.toISOString() ?? null,
        resolutionStatus: opinion.resolutionStatus,
        resolvedAt: opinion.resolvedAt ?? null,
        resolutionNote: opinion.resolutionNote ?? null,
        eventClusterId: opinion.eventClusterId ?? null,
        isSourceAttribution: opinion.isSourceAttribution,
        instrument: opinion.instrument ?? null,
        instrumentTicker: opinion.instrumentTicker ?? null,
        siblings: (item.expertOpinions ?? [])
          .filter((sib) => sib.id !== opinion.id)
          .map((sib) => ({
            id: sib.id,
            expertId: sib.expertId,
            expertName: sib.expert.name,
            expertOrganization: sib.expert.organization,
            direction: sib.direction,
            instrument: sib.instrument ?? null,
            verified: sib.expert.verified,
          })),
      })),
    })),
    nextCursor: hasMore && lastItem ? encodeNewsCursor({ date: personalizedCursorDateFor(lastItem), id: lastItem.id }) : null,
    hasMore,
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
