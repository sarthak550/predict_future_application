import { createHash, randomUUID } from "crypto";
import { type MarketType, type Prisma, StoryStatus } from "@prisma/client";

import { getPreferredSourceTrustTier } from "@/lib/news/config";
import { prisma } from "@/lib/prisma";
import { slugify } from "@/lib/utils";
import { type StoryInput } from "@/lib/validations/story";

type TxClient = Prisma.TransactionClient;

function estimateReadTimeSeconds(summary: string) {
  const words = summary.trim().split(/\s+/).filter(Boolean).length;
  return Math.min(60, Math.max(15, Math.ceil(words / 3) * 5));
}

function buildStorySlug(headline: string, publishedAt: string, uniquenessKey: string) {
  const baseSlug = slugify(headline).slice(0, 64) || "story";
  const timestamp = new Date(publishedAt).toISOString().replace(/[-:TZ.]/g, "").slice(0, 12);
  const suffix = createHash("sha1").update(uniquenessKey).digest("hex").slice(0, 8);
  return `${baseSlug}-${timestamp}-${suffix}`;
}

function buildMarketSlug(title: string) {
  return `${slugify(title)}-${randomUUID().slice(0, 8)}`;
}

function mapStoryStatusToMarketStatus(status: StoryStatus | undefined) {
  if (status === "APPROVED" || status === "PUBLISHED") {
    return "OPEN" as const;
  }

  if (status === "REJECTED") {
    return "REJECTED" as const;
  }

  return "DRAFT" as const;
}

async function upsertSource(tx: TxClient, input: StoryInput) {
  const slug = slugify(input.sourceName);
  const preferredTrustTier = getPreferredSourceTrustTier(input.sourceName);

  return tx.source.upsert({
    where: { slug },
    update: {
      name: input.sourceName,
      homepageUrl: input.sourceHomepageUrl || null,
      language: input.language,
      attributionLabel: `Source: ${input.sourceName}`,
      ...(preferredTrustTier === "VERIFIED" ? { trustTier: preferredTrustTier } : {})
    },
    create: {
      slug,
      name: input.sourceName,
      homepageUrl: input.sourceHomepageUrl || null,
      language: input.language,
      attributionLabel: `Source: ${input.sourceName}`,
      trustTier: preferredTrustTier
    }
  });
}

async function upsertStoryWithMarket(tx: TxClient, input: StoryInput, actorId: string) {
  const source = await upsertSource(tx, input);
  const storyStatus = input.status ?? "DRAFT";
  const existingStory = await tx.story.findFirst({
    where: {
      OR: [
        ...(input.externalId
          ? [
              {
                externalId: input.externalId
              }
            ]
          : []),
        {
          sourceUrl: input.sourceUrl
        }
      ]
    },
    include: {
      market: true
    }
  });

  const story = existingStory
    ? await tx.story.update({
        where: { id: existingStory.id },
        data: {
          headline: input.headline,
          summary: input.summary,
          category: input.category,
          sourceId: source.id,
          sourceName: input.sourceName,
          sourceUrl: input.sourceUrl,
          imageUrl: input.imageUrl || null,
          publishedAt: new Date(input.publishedAt),
          ingestedAt: input.ingestedAt ? new Date(input.ingestedAt) : new Date(),
          language: input.language,
          status: storyStatus,
          ingestionType: input.ingestionType ?? "MANUAL",
          ingestionFeedId: input.ingestionFeedId || null,
          ingestionFeedName: input.ingestionFeedName || null,
          externalId: input.externalId || null,
          dedupeKey: input.dedupeKey || null,
          rawPayloadJson: input.rawPayloadJson,
          readTimeSeconds: estimateReadTimeSeconds(input.summary),
          isFeatured: input.isFeatured ?? false,
          isTrending: input.isTrending ?? false,
          approvedById: storyStatus === "APPROVED" || storyStatus === "PUBLISHED" ? actorId : null
        }
      })
    : await tx.story.create({
        data: {
          slug: buildStorySlug(input.headline, input.publishedAt, input.externalId || input.sourceUrl),
          headline: input.headline,
          summary: input.summary,
          category: input.category,
          sourceId: source.id,
          sourceName: input.sourceName,
          sourceUrl: input.sourceUrl,
          imageUrl: input.imageUrl || null,
          publishedAt: new Date(input.publishedAt),
          ingestedAt: input.ingestedAt ? new Date(input.ingestedAt) : new Date(),
          language: input.language,
          status: storyStatus,
          ingestionType: input.ingestionType ?? "MANUAL",
          ingestionFeedId: input.ingestionFeedId || null,
          ingestionFeedName: input.ingestionFeedName || null,
          externalId: input.externalId || null,
          dedupeKey: input.dedupeKey || null,
          rawPayloadJson: input.rawPayloadJson,
          readTimeSeconds: estimateReadTimeSeconds(input.summary),
          isFeatured: input.isFeatured ?? false,
          isTrending: input.isTrending ?? false,
          createdById: actorId,
          approvedById: storyStatus === "APPROVED" || storyStatus === "PUBLISHED" ? actorId : null
        }
      });

  let marketId: string | null = existingStory?.market?.id ?? null;

  if (input.attachedPrediction) {
    const nextStatus =
      existingStory?.market?.status === "RESOLVED" || existingStory?.market?.status === "CANCELLED"
        ? existingStory.market.status
        : mapStoryStatusToMarketStatus(storyStatus);
    const marketData = {
      title: input.attachedPrediction.title,
      description: input.attachedPrediction.description,
      category: input.category,
      template: input.attachedPrediction.template,
      creatorId: actorId,
      status: nextStatus,
      closeAt: new Date(input.attachedPrediction.closeAt),
      resolveAt: new Date(input.attachedPrediction.resolveAt),
      resolutionSourceType: input.attachedPrediction.resolutionSourceType,
      resolutionSourceName: input.attachedPrediction.resolutionSourceName,
      resolutionSourceUrl: input.attachedPrediction.resolutionSourceUrl || input.sourceUrl,
      resolutionRuleText: input.attachedPrediction.resolutionRuleText,
      fallbackRuleText: input.attachedPrediction.fallbackRuleText || null,
      structuredData: input.attachedPrediction.structuredData,
      marketType: (input.attachedPrediction.marketType === "NUMERIC" ? "NUMERIC" : "BINARY") as MarketType,
      unit: input.attachedPrediction.unit ?? null,
      minValue: input.attachedPrediction.minValue ?? null,
      maxValue: input.attachedPrediction.maxValue ?? null,
      precision: input.attachedPrediction.precision ?? null,
      storyId: story.id,
      approvedAt:
        storyStatus === "APPROVED" || storyStatus === "PUBLISHED"
          ? existingStory?.market?.approvedAt ?? new Date()
          : existingStory?.market?.approvedAt ?? null,
      approvedById:
        storyStatus === "APPROVED" || storyStatus === "PUBLISHED"
          ? existingStory?.market?.approvedById ?? actorId
          : existingStory?.market?.approvedById ?? null
    };

    const market = existingStory?.market
      ? await tx.market.update({
          where: { id: existingStory.market.id },
          data: marketData
        })
      : await tx.market.create({
          data: {
            slug: buildMarketSlug(input.attachedPrediction.title),
            ...marketData
          }
        });

    marketId = market.id;
  }

  await tx.adminAction.create({
    data: {
      actorId,
      storyId: story.id,
      marketId,
      type: "INGEST_STORY",
      metadata: {
        sourceName: input.sourceName,
        storyStatus,
        hasPrediction: Boolean(input.attachedPrediction)
      }
    }
  });

  return { storyId: story.id, marketId };
}

export async function ingestStories(items: StoryInput[], actorId: string) {
  const results: Array<Awaited<ReturnType<typeof upsertStoryWithMarket>>> = [];
  const failures: Array<{ item: StoryInput; error: unknown }> = [];

  // Each story is ingested in its OWN short transaction rather than wrapping the
  // entire batch in a single interactive transaction. A mega-transaction over
  // hundreds of RSS items blows past Postgres/Neon transaction limits and fails
  // with P2028 ("Transaction not found ... old closed transaction"), especially
  // with cross-region DB latency. Per-item transactions stay well under the
  // timeout and make ingestion resilient — one malformed story no longer aborts
  // the whole run.
  for (const item of items) {
    try {
      const result = await prisma.$transaction(
        (tx) => upsertStoryWithMarket(tx, item, actorId),
        { maxWait: 10000, timeout: 20000 }
      );
      results.push(result);
    } catch (error) {
      console.error(
        `[news:ingest] failed to ingest story from ${item.sourceName} (${item.sourceUrl}):`,
        error
      );
      failures.push({ item, error });
    }
  }

  // If every item failed (e.g. a single-story admin ingest, or a systemic DB
  // outage), surface the error to the caller instead of silently returning [].
  if (results.length === 0 && failures.length > 0) {
    throw failures[0].error;
  }

  return results;
}
