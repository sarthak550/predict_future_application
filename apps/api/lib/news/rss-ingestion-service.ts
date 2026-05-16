import { randomUUID } from "crypto";
import { type MarketCategory, type MarketType, StoryStatus } from "@prisma/client";

import { generatePollWithAI } from "@/lib/ai/gemini";
import {
  extractExpertOpinionsFromStory,
  isApprovedFinanceSource,
  persistExpertOpinions,
} from "@/lib/ai/extractExpertOpinions";
import { getConfiguredIngestionCategories, shouldSeedTrendingStory } from "@/lib/news/config";
import { evaluateFinanceTag } from "@/lib/news/financeTagging";
import { ingestStories } from "@/lib/news/ingestion";
import { fetchOgImage, isGoogleNewsUrl } from "@/lib/news/og-image";
import { fetchTopHeadlines } from "@/lib/news/providers";
import { fetchArticleBody } from "@/lib/news/articleBody";

import { fetchRSSFeed } from "@/lib/news/rssProvider";
import { getRssSources, type RssSource } from "@/lib/news/rssSources";
import type { NormalizedNewsItem } from "@/lib/news/types";
import { prisma } from "@/lib/prisma";
import { slugify } from "@/lib/utils";
import type { StoryInput } from "@/lib/validations/story";

/**
 * Find stories with no imageUrl and attempt to fetch the og:image
 * from their source article. Runs in the background after ingestion.
 *
 * Skips Google News redirect URLs since they can't be resolved without JS.
 */
export async function backfillMissingImages() {
  const stories = await prisma.story.findMany({
    where: {
      OR: [{ imageUrl: null }, { imageUrl: "" }],
      sourceUrl: { not: "" },
      status: { in: ["PUBLISHED", "APPROVED"] },
    },
    select: { id: true, sourceUrl: true },
    orderBy: { createdAt: "desc" },
    take: 200,
  });

  if (stories.length === 0) {
    console.info("[news:og-backfill] no stories need images");
    return;
  }

  // Split into resolvable (non-Google) and Google News stories
  const resolvable = stories.filter((s) => !isGoogleNewsUrl(s.sourceUrl));
  const googleStories = stories.filter((s) => isGoogleNewsUrl(s.sourceUrl));
  console.info(`[news:og-backfill] checking ${resolvable.length} direct URLs, ${googleStories.length} Google News (skipped)`);
  if (resolvable.length === 0) return;

  let filled = 0;
  // Process up to 5 concurrently with 8s timeout per URL
  const CONCURRENCY = 5;
  for (let i = 0; i < resolvable.length; i += CONCURRENCY) {
    const batch = resolvable.slice(i, i + CONCURRENCY);
    const results = await Promise.allSettled(
      batch.map(async (story) => {
        const ogImage = await fetchOgImage(story.sourceUrl, 8000);
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

  console.info(`[news:og-backfill] filled ${filled}/${resolvable.length} missing images`);
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

const MAX_AI_POLLS_PER_BATCH = 8;

/**
 * Generates AI polls for recently-ingested stories that don't have a market yet.
 * Runs in the background after stories are already saved to the DB.
 */
async function generatePollsInBackground(items: NormalizedNewsItem[], actorId: string) {
  // Find stories that were just inserted and have no market
  const sourceUrls = items.map((i) => i.source_url);
  const stories = await prisma.story.findMany({
    where: {
      sourceUrl: { in: sourceUrls },
      market: null,
    },
    select: { id: true, headline: true, summary: true, category: true, sourceName: true, sourceUrl: true, publishedAt: true },
    orderBy: { publishedAt: "desc" },
    take: MAX_AI_POLLS_PER_BATCH,
  });

  if (stories.length === 0) {
    console.info("[news:ai-polls] no stories need polls");
    return;
  }

  let aiEnabled = true;
  let generated = 0;

  for (let i = 0; i < stories.length; i++) {
    if (!aiEnabled) break;
    const story = stories[i];

    // Rate limit: 15s between calls for Groq free tier
    if (i > 0) {
      await new Promise((r) => setTimeout(r, 15_000));
    }

    try {
      const aiResult = await generatePollWithAI({
        headline: story.headline,
        summary: story.summary,
        category: story.category,
        sourceName: story.sourceName,
        sourceUrl: story.sourceUrl,
        publishedAt: story.publishedAt.toISOString(),
      });

      if (aiResult.skip) {
        // Update story summary if AI provided an enhanced one
        if (aiResult.enhancedSummary) {
          await prisma.story.update({
            where: { id: story.id },
            data: { summary: aiResult.enhancedSummary },
          });
          console.info(`[news:ai-polls] enhanced summary for "${story.headline.slice(0, 50)}..."`);
        }
        continue;
      }

      const now = new Date();
      const pollHours = Math.max(aiResult.expiresInHours ?? 168, 48);
      const closeAt = new Date(now.getTime() + pollHours * 60 * 60 * 1000);
      const resolveAt = new Date(now.getTime() + (pollHours + 24) * 60 * 60 * 1000);

      await prisma.market.create({
        data: {
          slug: `${slugify(aiResult.title).slice(0, 80)}-${randomUUID().slice(0, 8)}`,
          title: aiResult.title,
          description: aiResult.description,
          category: story.category,
          template: "CUSTOM",
          marketType: (aiResult.marketType ?? "BINARY") as MarketType,
          unit: aiResult.unit ?? null,
          minValue: aiResult.minValue ?? null,
          maxValue: aiResult.maxValue ?? null,
          precision: aiResult.precision ?? null,
          creatorId: actorId,
          status: "OPEN",
          closeAt,
          resolveAt,
          resolutionSourceType: "MANUAL",
          resolutionSourceName: story.sourceName,
          resolutionSourceUrl: story.sourceUrl,
          resolutionRuleText: "This is an opinion poll. The voting period closes automatically.",
          storyId: story.id,
          approvedAt: now,
          approvedById: actorId,
        },
      });

      generated++;
      console.info(`[news:ai-polls] created ${aiResult.marketType} poll for "${story.headline.slice(0, 50)}..."`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(`[news:ai-polls] failed for "${story.headline.slice(0, 50)}...":`, msg);
      if (msg.toLowerCase().includes("rate limit")) {
        console.warn("[news:ai-polls] rate limited — stopping background poll generation");
        aiEnabled = false;
      }
    }
  }

  console.info(`[news:ai-polls] done — ${generated}/${stories.length} polls created`);
}

const MAX_FINANCE_EXTRACTIONS_PER_BATCH = 5;

/**
 * Phase 3: Extract expert opinions from newly-ingested FINANCE stories from approved sources.
 * Runs in the background after stories are saved — never blocks ingestion.
 *
 * For each story:
 * 1. If bodyFetchFailed === true, skip (permanent failure already recorded).
 * 2. If bodyText is null, attempt to fetch it now; persist bodyText or bodyFetchFailed.
 * 3. Pass bodyText (if >= 200 chars) or summary to the extractor.
 *
 * Cost guardrail: only processes FINANCE-categorized stories whose source domain
 * is in the approved Indian finance source list. All others are skipped.
 */
async function extractFinanceOpinionsInBackground(items: NormalizedNewsItem[]) {
  const geminiKey = process.env.GEMINI_API_KEY;
  if (!geminiKey) {
    console.debug("[Finance AI] GEMINI_API_KEY not set — skipping expert opinion extraction");
    return;
  }

  const sourceUrls = items.map((i) => i.source_url);

  // Fetch stories that: (a) were just ingested, (b) are FINANCE-tagged, (c) have no opinions yet
  const financeStories = await prisma.story.findMany({
    where: {
      sourceUrl: { in: sourceUrls },
      category: "FINANCE",
      expertOpinions: { none: {} },
    },
    select: {
      id: true,
      headline: true,
      summary: true,
      sourceUrl: true,
      publishedAt: true,
      bodyText: true,
      bodyFetchedAt: true,
      bodyFetchFailed: true,
    },
    orderBy: { publishedAt: "desc" },
    take: MAX_FINANCE_EXTRACTIONS_PER_BATCH,
  });

  if (financeStories.length === 0) {
    console.info("[Finance AI] No FINANCE stories need expert opinion extraction");
    return;
  }

  let extracted = 0;

  for (const story of financeStories) {
    // Cost guardrail: skip if source domain is not in the approved list
    if (!isApprovedFinanceSource(story.sourceUrl)) {
      console.debug(`[Finance AI] Skipping extraction — source not in approved list: ${story.sourceUrl}`);
      continue;
    }

    try {
      // Step 1: ensure body text is present (fetch if needed)
      let contentForExtraction: string;

      if (story.bodyFetchFailed) {
        // Permanent failure — use summary fallback
        console.debug(`[Finance AI] Body fetch previously failed for story ${story.id} — using summary`);
        contentForExtraction = `${story.headline}\n\n${story.summary}`;
      } else if (!story.bodyText) {
        // Body not yet fetched — attempt fetch now
        console.info(`[Finance AI] Fetching article body for story ${story.id}: ${story.sourceUrl}`);
        const bodyResult = await fetchArticleBody(story.sourceUrl);

        if (bodyResult.text) {
          await prisma.story.update({
            where: { id: story.id },
            data: {
              bodyText: bodyResult.text,
              bodyFetchedAt: new Date(),
              bodyFetchFailed: false,
            },
          });
          contentForExtraction = bodyResult.text;
          console.info(`[Finance AI] Body fetched (${bodyResult.text.length} chars) for story ${story.id}`);
        } else {
          // Fetch failed — mark and fall back to summary
          await prisma.story.update({
            where: { id: story.id },
            data: {
              bodyFetchFailed: true,
              bodyFetchedAt: new Date(),
            },
          });
          console.warn(`[Finance AI] Body fetch failed for story ${story.id}: ${bodyResult.error}`);
          contentForExtraction = `${story.headline}\n\n${story.summary}`;
        }
      } else if (story.bodyText.length >= 200) {
        // Body already present and sufficient
        contentForExtraction = story.bodyText;
      } else {
        // Body present but too short (edge case) — use summary
        contentForExtraction = `${story.headline}\n\n${story.summary}`;
      }

      // Step 2: extract expert opinions using body text (preferred) or summary fallback
      const opinions = await extractExpertOpinionsFromStory({
        id: story.id,
        title: story.headline,
        content: contentForExtraction,
        sourceUrl: story.sourceUrl,
        publishedAt: story.publishedAt,
      });

      if (opinions.length > 0) {
        await persistExpertOpinions(prisma, story.id, story.sourceUrl, story.publishedAt, opinions);
        extracted += opinions.length;
      }
    } catch (err) {
      // Never block ingestion — log and continue
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[Finance AI] Extraction loop failed for story ${story.id}: ${msg}`);
    }
  }

  console.info(`[Finance AI] done — ${extracted} opinions extracted from ${financeStories.length} FINANCE stories`);
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

    // ---- Phase 1: Ingest all stories immediately ----
    // Fetch og:image from source articles for stories that have no image from RSS
    // Skip Google News URLs since they can't be resolved without JavaScript
    const needsImage = newStories.filter((item) => !item.image_url && !isGoogleNewsUrl(item.source_url));
    const ogImages = new Map<string, string>();
    if (needsImage.length > 0) {
      const CONCURRENCY = 8;
      for (let i = 0; i < needsImage.length; i += CONCURRENCY) {
        const batch = needsImage.slice(i, i + CONCURRENCY);
        const results = await Promise.allSettled(
          batch.map(async (item) => {
            const img = await fetchOgImage(item.source_url, 6000);
            if (img) ogImages.set(item.source_url, img);
          })
        );
      }
      console.info(`[news:og-fetch] fetched ${ogImages.size}/${needsImage.length} og:images inline`);
    }

    const storiesToIngest: StoryInput[] = newStories.map((item) => {
      // Apply FINANCE category override: if the source is an approved Indian finance source
      // AND the title/summary contains India-market keywords, tag as FINANCE.
      // Otherwise fall back to the RSS-inferred category.
      const financeDecision = evaluateFinanceTag(item.title, item.summary, item.source_url);
      const resolvedCategory: MarketCategory = financeDecision.isFinance
        ? "FINANCE"
        : (item.category as MarketCategory);

      return {
        headline: item.title,
        summary: item.summary,
        category: resolvedCategory,
        sourceName: item.source_name,
        sourceUrl: item.source_url,
        sourceHomepageUrl: getSourceHomepageUrl(item.source_url),
        imageUrl: item.image_url ?? ogImages.get(item.source_url) ?? "",
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
          category: resolvedCategory,
          publishedAt: item.published_at,
          hasPrediction: false
        }),
      };
    });

    await ingestStories(storiesToIngest, staffActorId);
    console.info(`[news:ingestion] phase 1 done — ${storiesToIngest.length} stories inserted`);

    // ---- Phase 2: Generate AI polls in background for stories without markets ----
    const aiEnabled = Boolean(process.env.GROQ_API_KEY || process.env.GEMINI_API_KEY);
    if (aiEnabled) {
      void generatePollsInBackground(newStories, staffActorId).catch((err) =>
        console.error("[news:ai-polls] background poll generation failed:", err)
      );
    }

    // ---- Phase 3: Extract expert opinions for FINANCE stories from approved sources ----
    // Cost guardrail: only runs when GEMINI_API_KEY is set AND at least one story is from
    // an approved Indian finance source (which may have been saved as FINANCE after tagging).
    // The background job queries the DB for actual FINANCE-categorized stories, so the pre-check
    // here just avoids spawning the coroutine when no finance sources were in this batch.
    const hasApprovedFinanceSourceStory = newStories.some((item) =>
      isApprovedFinanceSource(item.source_url)
    );
    if (process.env.GEMINI_API_KEY && hasApprovedFinanceSourceStory) {
      void extractFinanceOpinionsInBackground(newStories).catch((err) =>
        console.error("[Finance AI] background expert opinion extraction failed:", err)
      );
    }

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

    // Backfill OG images for older stories — run in background, don't block response
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
