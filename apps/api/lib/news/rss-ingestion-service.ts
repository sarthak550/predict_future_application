import { type MarketCategory, StoryStatus } from "@prisma/client";

import { generatePollWithAI } from "@/lib/ai/gemini";
import { getConfiguredIngestionCategories, shouldSeedTrendingStory } from "@/lib/news/config";
import { ingestStories } from "@/lib/news/ingestion";
import { fetchOgImage, isGoogleNewsUrl } from "@/lib/news/og-image";
import { fetchTopHeadlines } from "@/lib/news/providers";
import { generatePredictionFromStory } from "@/lib/news/predictions";
import { fetchRSSFeed } from "@/lib/news/rssProvider";
import { getRssSources, type RssSource } from "@/lib/news/rssSources";
import type { NormalizedNewsItem } from "@/lib/news/types";
import { prisma } from "@/lib/prisma";
import type { StoryInput } from "@/lib/validations/story";

/**
 * Find stories with no imageUrl and attempt to fetch the og:image
 * from their source article. Runs in the background after ingestion.
 *
 * Skips Google News redirect URLs since they can't be resolved without JS.
 */
async function backfillMissingImages() {
  const stories = await prisma.story.findMany({
    where: {
      OR: [{ imageUrl: null }, { imageUrl: "" }],
      sourceUrl: { not: "" },
      status: { in: ["PUBLISHED", "APPROVED"] },
    },
    select: { id: true, sourceUrl: true },
    orderBy: { createdAt: "desc" },
    take: 50,
  });

  if (stories.length === 0) return;

  // Filter out Google News URLs (they require JS to resolve the real article)
  const resolvable = stories.filter((s) => !isGoogleNewsUrl(s.sourceUrl));
  if (resolvable.length === 0) return;

  let filled = 0;
  // Process up to 5 concurrently
  const CONCURRENCY = 5;
  for (let i = 0; i < resolvable.length; i += CONCURRENCY) {
    const batch = resolvable.slice(i, i + CONCURRENCY);
    const results = await Promise.allSettled(
      batch.map(async (story) => {
        const ogImage = await fetchOgImage(story.sourceUrl);
        if (ogImage) {
          await prisma.story.update({
            where: { id: story.id },
            data: { imageUrl: ogImage },
          });
          return true;
        }
        return false;
      })
    );
    filled += results.filter((r) => r.status === "fulfilled" && r.value).length;
  }

  if (filled > 0) {
    console.info(`[news:og-backfill] filled ${filled}/${resolvable.length} missing images (${stories.length - resolvable.length} Google News URLs skipped)`);
  }
}

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

    const storiesToIngest: StoryInput[] = [];
    let aiEnabled = Boolean(process.env.GROQ_API_KEY || process.env.GEMINI_API_KEY);
    let aiCallCount = 0;

    for (const item of newStories) {
      const category = item.category as MarketCategory;
      let aiSummary = item.summary; // Will be replaced by AI if available
      let generatedPrediction: ReturnType<typeof generatePredictionFromStory> = null;

      // AI-first: try Groq/Gemini for poll generation (opinion polls, not bets)
      if (aiEnabled) {
        try {
          // Rate limit: wait 2.5s between AI calls to stay within Groq's 30 RPM
          if (aiCallCount > 0) {
            await new Promise((r) => setTimeout(r, 2500));
          }
          aiCallCount++;

          const aiResult = await generatePollWithAI({
            headline: item.title,
            summary: item.summary,
            category,
            sourceName: item.source_name,
            sourceUrl: item.source_url,
            publishedAt: item.published_at.toISOString(),
          });

          if (aiResult.skip && aiResult.enhancedSummary) {
            // AI decided no good poll — use the enhanced summary
            aiSummary = aiResult.enhancedSummary;
            console.info(`[news:ai] skipped poll, enhanced summary for "${item.title.slice(0, 60)}..."`);
          } else {
            const now = new Date();
            const pollHours = Math.max(aiResult.expiresInHours ?? 168, 48);
            const closeAt = new Date(now.getTime() + pollHours * 60 * 60 * 1000).toISOString();
            const resolveAt = new Date(now.getTime() + (pollHours + 24) * 60 * 60 * 1000).toISOString();
            generatedPrediction = {
              title: aiResult.title,
              description: aiResult.description,
              template: "CUSTOM" as const,
              closeAt,
              resolveAt,
              resolutionSourceType: "MANUAL" as const,
              resolutionSourceName: item.source_name,
              resolutionSourceUrl: item.source_url,
              resolutionRuleText: `This is an opinion poll. The voting period closes automatically.`,
              marketType: aiResult.marketType,
              unit: aiResult.unit,
              minValue: aiResult.minValue,
              maxValue: aiResult.maxValue,
              precision: aiResult.precision,
            };

            console.info(`[news:ai] generated ${aiResult.marketType} poll for "${item.title.slice(0, 60)}..."`);
          }
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          console.warn(`[news:ai] failed for "${item.title.slice(0, 60)}...":`, msg);
          // If rate limited, stop trying AI for remaining stories
          if (msg.toLowerCase().includes("rate limit")) {
            console.warn("[news:ai] rate limited — disabling AI for remaining stories in this batch");
            aiEnabled = false;
          }
        }
      }

      // Fallback to rule-based only when AI is unavailable or failed
      if (!generatedPrediction && !aiEnabled) {
        generatedPrediction = generatePredictionFromStory({
          headline: item.title,
          summary: item.summary,
          category,
          publishedAt: item.published_at,
          sourceName: item.source_name,
          sourceUrl: item.source_url
        });
        if (generatedPrediction) {
          console.info(`[news:rules] fallback generated poll for "${item.title.slice(0, 60)}..."`);
        }
      }

      storiesToIngest.push({
        headline: item.title,
        summary: aiSummary,
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
      });
    }

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

    // Backfill OG images for stories that have no image
    void backfillMissingImages().catch((err) =>
      console.warn("[news:ingestion] og-image backfill failed:", err)
    );

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
