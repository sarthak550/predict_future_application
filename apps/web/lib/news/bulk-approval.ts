import { prisma } from "@/lib/prisma";
import { approveStoryForFeed } from "@/lib/news/approval";
import { isTrustedSourceName } from "@/lib/news/config";
import { pendingStoryStatuses } from "@/lib/validations/news";

type BulkApproveInput = {
  actorId: string;
  limit?: number;
  trustedOnly?: boolean;
};

type BulkApproveResult = {
  approved: number;
  skipped: number;
  errors: string[];
};

const predictionFriendlyCategories = new Set([
  "SPORTS",
  "WEATHER",
  "BUSINESS",
  "TECH",
  "ENTERTAINMENT",
  "PRODUCT",
  "COMPANY"
]);

export async function bulkApproveEligibleStories(input: BulkApproveInput): Promise<BulkApproveResult> {
  const limit = input.limit ?? 25;
  const trustedOnly = input.trustedOnly ?? true;

  const candidates = await prisma.story.findMany({
    where: {
      status: {
        in: pendingStoryStatuses
      }
    },
    include: {
      market: true
    },
    orderBy: [{ publishedAt: "desc" }, { createdAt: "desc" }],
    take: 100
  });

  const eligibleStories = candidates
    .filter((story) => !trustedOnly || isTrustedSourceName(story.sourceName))
    .filter((story) => story.market || predictionFriendlyCategories.has(story.category))
    .slice(0, limit);

  if (eligibleStories.length === 0) {
    return {
      approved: 0,
      skipped: candidates.length,
      errors: []
    };
  }

  const errors: string[] = [];
  let approved = 0;

  for (const story of eligibleStories) {
    try {
      await prisma.$transaction(async (tx) => {
        await approveStoryForFeed(tx, {
          storyId: story.id,
          actorId: input.actorId,
          note: "Bulk-published from moderation queue."
        });
      });
      approved += 1;
    } catch (error) {
      errors.push(`${story.headline}: ${error instanceof Error ? error.message : "Unable to approve story."}`);
    }
  }

  return {
    approved,
    skipped: candidates.length - approved,
    errors: errors.slice(0, 10)
  };
}
