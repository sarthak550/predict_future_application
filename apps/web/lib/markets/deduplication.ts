import { addDays, subDays } from "date-fns";
import { type MarketCategory, type MarketTemplate, type MarketVisibility, Prisma } from "@prisma/client";

import { prisma } from "@/lib/prisma";

function normalizeTitle(input: string) {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokenSimilarity(left: string, right: string) {
  const leftTokens = new Set(normalizeTitle(left).split(" ").filter(Boolean));
  const rightTokens = new Set(normalizeTitle(right).split(" ").filter(Boolean));

  if (leftTokens.size === 0 || rightTokens.size === 0) {
    return 0;
  }

  const shared = Array.from(leftTokens).filter((token) => rightTokens.has(token)).length;
  return shared / Math.max(leftTokens.size, rightTokens.size);
}

export async function findPotentialDuplicateMarket(input: {
  title: string;
  category: MarketCategory;
  template: MarketTemplate;
  resolveAt: Date;
  visibility?: MarketVisibility;
  groupId?: string | null;
  excludeMarketId?: string;
}) {
  const candidates = await prisma.market.findMany({
    where: {
      category: input.category,
      template: input.template,
      visibility: input.visibility ?? "PUBLIC",
      ...(input.visibility === "PRIVATE" && input.groupId ? { groupId: input.groupId } : {}),
      resolveAt: {
        gte: subDays(input.resolveAt, 14),
        lte: addDays(input.resolveAt, 14)
      },
      status: {
        in: ["DRAFT", "PENDING_REVIEW", "OPEN", "CLOSED", "RESOLVING", "RESOLVED"]
      },
      ...(input.excludeMarketId
        ? {
            id: {
              not: input.excludeMarketId
            }
          }
        : {})
    },
    orderBy: {
      createdAt: "desc"
    },
    take: 20
  });

  const normalizedInput = normalizeTitle(input.title);

  for (const candidate of candidates) {
    const normalizedCandidate = normalizeTitle(candidate.title);
    if (normalizedCandidate === normalizedInput) {
      return {
        market: candidate,
        reason: "A market with the same question already exists."
      };
    }

    const similarity = tokenSimilarity(input.title, candidate.title);
    if (similarity >= 0.72) {
      return {
        market: candidate,
        reason: `This market is very similar to "${candidate.title}".`
      };
    }
  }

  return null;
}

export function buildMarketVisibilityWhere(
  canSeeInternal: boolean,
  searchStatus?: string | null
): Prisma.MarketWhereInput {
  const baseWhere: Prisma.MarketWhereInput = {
    visibility: "PUBLIC"
  };

  if (canSeeInternal && searchStatus) {
    return baseWhere;
  }

  return {
    ...baseWhere,
    status: {
      notIn: ["DRAFT", "PENDING_REVIEW", "REJECTED"]
    }
  };
}
