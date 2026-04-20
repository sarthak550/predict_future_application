import { randomUUID } from "crypto";
import { Prisma } from "@prisma/client";

import { generatePredictionFromStory } from "@/lib/news/predictions";
import { createNotification } from "@/lib/notifications";
import { slugify } from "@/lib/utils";
import { pendingStoryStatuses } from "@/lib/validations/news";

type TxClient = Prisma.TransactionClient;

export async function approveStoryForFeed(
  tx: TxClient,
  input: {
    storyId: string;
    actorId: string;
    note?: string | null;
  }
) {
  const story = await tx.story.findUnique({
    where: { id: input.storyId },
    include: {
      market: true
    }
  });

  if (!story) {
    throw new Error("Story not found.");
  }

  if (!pendingStoryStatuses.includes(story.status)) {
    throw new Error("Only draft stories can be approved.");
  }

  let marketId = story.market?.id ?? null;

  if (!story.market) {
    const suggestion = generatePredictionFromStory({
      headline: story.headline,
      summary: story.summary,
      category: story.category,
      publishedAt: story.publishedAt,
      sourceName: story.sourceName,
      sourceUrl: story.sourceUrl
    });

    if (!suggestion) {
      throw new Error("Attach a prediction market before approving this story.");
    }

    const createdMarket = await tx.market.create({
      data: {
        storyId: story.id,
        slug: `${slugify(suggestion.title)}-${randomUUID().slice(0, 8)}`,
        title: suggestion.title,
        description: suggestion.description,
        category: story.category,
        template: suggestion.template,
        creatorId: input.actorId,
        status: "OPEN",
        closeAt: new Date(suggestion.closeAt),
        resolveAt: new Date(suggestion.resolveAt),
        resolutionSourceType: suggestion.resolutionSourceType,
        resolutionSourceName: suggestion.resolutionSourceName,
        resolutionSourceUrl: suggestion.resolutionSourceUrl || story.sourceUrl,
        resolutionRuleText: suggestion.resolutionRuleText,
        fallbackRuleText: suggestion.fallbackRuleText || null,
        structuredData: suggestion.structuredData as Prisma.InputJsonValue | undefined,
        approvedAt: new Date(),
        approvedById: input.actorId
      }
    });
    marketId = createdMarket.id;
  } else if (story.market.status !== "RESOLVED" && story.market.status !== "CANCELLED") {
    await tx.market.update({
      where: { id: story.market.id },
      data: {
        status: "OPEN",
        approvedAt: new Date(),
        approvedById: input.actorId
      }
    });
    marketId = story.market.id;
  } else {
    marketId = story.market.id;
  }

  await tx.story.update({
    where: { id: story.id },
    data: {
      status: "APPROVED",
      approvedById: input.actorId
    }
  });

  await tx.adminAction.create({
    data: {
      actorId: input.actorId,
      storyId: story.id,
      marketId,
      type: "APPROVE_STORY",
      notes: input.note || null
    }
  });

  if (story.createdById && story.createdById !== input.actorId) {
    await createNotification(tx, {
      userId: story.createdById,
      storyId: story.id,
      marketId: marketId ?? undefined,
      type: "SYSTEM",
      title: "Story approved",
      body: `${story.headline} is now live in the feed.`,
      href: `/stories/${story.slug}`
    });
  }

  return {
    storyId: story.id,
    marketId,
    headline: story.headline,
    sourceName: story.sourceName
  };
}
