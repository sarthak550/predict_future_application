import { type MarketCategory, StoryStatus } from "@prisma/client";

import { getConfiguredIngestionCategories, shouldSeedTrendingStory } from "@/lib/news/config";
import { ingestStories } from "@/lib/news/ingestion";
import { fetchTopHeadlines } from "@/lib/news/providers";
import { generatePredictionFromStory } from "@/lib/news/predictions";
import { fetchRSSFeed } from "@/lib/news/rssProvider";
import { getRssSources, type RssSource } from "@/lib/news/rssSources";
import type { NormalizedNewsItem } from "@/lib/news/types";
import { prisma } from "@/lib/prisma";
import type { StoryInput } from "@/lib/validations/story";

export type FeedIngestionStatus = {
  id: string;
  name: string;
  url: string;
  category: MarketCategory;
  fetched: number;
  inserted: number;
  skippedDuplicates: number;
  error: string | null;
  status: "success" | "failed";
};

export type NewsIngestionResult = {
  fetched: number;
  ingested: number;
  skippedDuplicates: number;
  published: number;
  approved: number;
  drafted: number;
  errors: string[];
  feeds: FeedIngestionStatus[];
  ingestedAt: string;
};

function getSourceHomepageUrl(sourceUrl: string) {
  try {
    return new URL(sourceUrl).origin;
  } catch {
    return sourceUrl;
  }
}

function parseBooleanEnv(value: string | undefined, fallback = true) {
  if (!value) {
    return fallback;
  }

  const normalized = value.trim().toLowerCase();
  return normalized === "1" || normalized === "true" || normalized === "yes" || normalized === "on";
}

function dedupeBatch(items: NormalizedNewsItem[]) {
  const seen = new Set<string>();

  return items.filter((item) => {
    const key = `${item.external_id}:${item.source_url}:${item.dedupe_key}`;
    if (seen.has(key)) {
      return false;
    }

    seen.add(key);
    return true;
  });
}

function toFeedStatus(source: RssSource, partial?: Partial<FeedIngestionStatus>): FeedIngestionStatus {
  return {
    id: source.id,
    name: source.name,
    url: source.url,
    category: source.categoryHint,
    fetched: partial?.fetched ?? 0,
    inserted: partial?.inserted ?? 0,
    skippedDuplicates: partial?.skippedDuplicates ?? 0,
    error: partial?.error ?? null,
    status: partial?.status ?? "success"
  };
}

async function collectRssItems() {
  const rssSources = getRssSources();
  const fetchedItems: NormalizedNewsItem[] = [];
  const errors: string[] = [];
  const failedFallbackCategories = new Set<MarketCategory>();
  const feeds: FeedIngestionStatus[] = [];

  for (const source of rssSources) {
    try {
      const items = await fetchRSSFeed(source.url);
      fetchedItems.push(...items);
      feeds.push(toFeedStatus(source, { fetched: items.length }));
      console.info(`[news:rss] ${source.id} fetched=${items.length}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      errors.push(`rss:${source.id} failed: ${message}`);
      feeds.push(toFeedStatus(source, { error: message, status: "failed" }));
      console.error(`[news:rss] ${source.id} failed`, error);
      if (source.fallbackCategory) {
        failedFallbackCategories.add(source.fallbackCategory);
      }
    }
  }

  return {
    fetchedItems,
    errors,
    failedFallbackCategories,
    feeds
  };
}

async function collectApiFallbackItems(categories: Set<MarketCategory>, errors: string[]) {
  if (categories.size === 0 || !parseBooleanEnv(process.env.NEWS_API_FALLBACK_ENABLED, true)) {
    return [];
  }

  const configuredCategories = new Set(getConfiguredIngestionCategories());
  const fallbackItems: NormalizedNewsItem[] = [];

  for (const category of categories) {
    if (!configuredCategories.has(category)) {
      continue;
    }

    try {
      const items = await fetchTopHeadlines(category);
      fallbackItems.push(...items);
      console.info(`[news:fallback] ${category} fetched=${items.length}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      errors.push(`api-fallback:${category} failed: ${message}`);
      console.error(`[news:fallback] ${category} failed`, error);
    }
  }

  return fallbackItems;
}

async function getStaffActorId(actorId?: string) {
  if (actorId) {
    return actorId;
  }

  return (
    await prisma.user.findFirst({
      where: {
        role: {
          in: ["ADMIN", "MODERATOR"]
        }
      },
      select: {
        id: true
      }
    })
  )?.id;
}

export class RSSIngestionService {
  static async run(actorId?: string): Promise<NewsIngestionResult> {
    const { fetchedItems: rssItems, errors, failedFallbackCategories, feeds } = await collectRssItems();
    const fallbackItems = await collectApiFallbackItems(failedFallbackCategories, errors);
    const normalized = dedupeBatch([...rssItems, ...fallbackItems]);
    const ingestedAt = new Date();

    if (normalized.length === 0) {
      return {
        fetched: 0,
        ingested: 0,
        skippedDuplicates: 0,
        published: 0,
        approved: 0,
        drafted: 0,
        errors,
        feeds,
        ingestedAt: ingestedAt.toISOString()
      };
    }

    const existingStories = await prisma.story.findMany({
      where: {
        OR: [
          {
            externalId: {
              in: normalized.map((item) => item.external_id)
            }
          },
          {
            sourceUrl: {
              in: normalized.map((item) => item.source_url)
            }
          },
          {
            dedupeKey: {
              in: normalized.map((item) => item.dedupe_key)
            }
          }
        ]
      },
      select: {
        externalId: true,
        sourceUrl: true,
        dedupeKey: true
      }
    });

    const existingExternalIds = new Set(existingStories.map((story) => story.externalId).filter(Boolean));
    const existingSourceUrls = new Set(existingStories.map((story) => story.sourceUrl));
    const existingDedupeKeys = new Set(existingStories.map((story) => story.dedupeKey).filter(Boolean));

    const newStories = normalized.filter(
      (item) =>
        !existingExternalIds.has(item.external_id) &&
        !existingSourceUrls.has(item.source_url) &&
        !existingDedupeKeys.has(item.dedupe_key)
    );

    if (newStories.length === 0) {
      return {
        fetched: normalized.length,
        ingested: 0,
        skippedDuplicates: normalized.length,
        published: 0,
        approved: 0,
        drafted: 0,
        errors,
        feeds,
        ingestedAt: ingestedAt.toISOString()
      };
    }

    const staffActorId = await getStaffActorId(actorId);
    if (!staffActorId) {
      throw new Error("A staff user is required to ingest news stories.");
    }

    const storiesToIngest: StoryInput[] = newStories.map((item) => {
      const category = item.category as MarketCategory;
      const generatedPrediction = generatePredictionFromStory({
        headline: item.title,
        summary: item.summary,
        category,
        publishedAt: item.published_at,
        sourceName: item.source_name,
        sourceUrl: item.source_url
      });

      return {
        headline: item.title,
        summary: item.summary,
        category,
        sourceName: item.source_name,
        sourceUrl: item.source_url,
        sourceHomepageUrl: getSourceHomepageUrl(item.source_url),
        imageUrl: item.image_url ?? "",
        publishedAt: item.published_at.toISOString(),
        ingestedAt: ingestedAt.toISOString(),
        language: "en",
        status: StoryStatus.PUBLISHED,
        ingestionType: item.external_id.startsWith("rss:") ? "RSS" : "API",
        ingestionFeedId: item.feed_id ?? "",
        ingestionFeedName: item.feed_name ?? "",
        externalId: item.external_id,
        dedupeKey: item.dedupe_key,
        rawPayloadJson: item.raw_payload_json,
        isTrending: shouldSeedTrendingStory({
          category,
          publishedAt: item.published_at,
          hasPrediction: Boolean(generatedPrediction)
        }),
        attachedPrediction: generatedPrediction ?? undefined
      };
    });

    await ingestStories(storiesToIngest, staffActorId);

    const newStoryExternalIds = new Set(newStories.map((story) => story.external_id));
    const perFeedInserted = new Map<string, number>();
    const perFeedSkipped = new Map<string, number>();

    for (const item of normalized) {
      const feedId = item.feed_id;
      if (!feedId) {
        continue;
      }

      if (newStoryExternalIds.has(item.external_id)) {
        perFeedInserted.set(feedId, (perFeedInserted.get(feedId) ?? 0) + 1);
      } else {
        perFeedSkipped.set(feedId, (perFeedSkipped.get(feedId) ?? 0) + 1);
      }
    }

    const feedStatuses = feeds.map((feed) => ({
      ...feed,
      inserted: perFeedInserted.get(feed.id) ?? 0,
      skippedDuplicates: perFeedSkipped.get(feed.id) ?? 0
    }));

    console.info(
      `[news:ingestion] fetched=${normalized.length} inserted=${newStories.length} duplicates=${
        normalized.length - newStories.length
      }`
    );

    return {
      fetched: normalized.length,
      ingested: newStories.length,
      skippedDuplicates: normalized.length - newStories.length,
      published: newStories.length,
      approved: 0,
      drafted: 0,
      errors,
      feeds: feedStatuses,
      ingestedAt: ingestedAt.toISOString()
    };
  }
}
