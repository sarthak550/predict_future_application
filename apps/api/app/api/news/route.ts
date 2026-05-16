import { MarketCategory } from "@prisma/client";
import { NextResponse } from "next/server";

import { getUserIdFromRequest } from "@/lib/auth";
import { getPublishedNewsPage, getPersonalizedNewsPage } from "@/lib/news/queries";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const userId = (await getUserIdFromRequest(request)) ?? undefined;
  const rawLimit = Number(searchParams.get("limit") ?? 10);
  const limit = Number.isFinite(rawLimit) ? Math.max(1, Math.min(30, Math.floor(rawLimit))) : 10;
  const rawCategory = searchParams.get("category");
  const cursor = searchParams.get("cursor");
  const category =
    rawCategory && Object.values(MarketCategory).includes(rawCategory as MarketCategory)
      ? (rawCategory as MarketCategory)
      : undefined;

  const rawExcludeCategory = searchParams.get("excludeCategory");
  const excludeCategory =
    rawExcludeCategory && Object.values(MarketCategory).includes(rawExcludeCategory as MarketCategory)
      ? (rawExcludeCategory as MarketCategory)
      : undefined;

  const requireExpertOpinions = searchParams.get("requireExpertOpinions") === "true";
  const personalized = searchParams.get("personalized") === "true";

  // Personalized mode: boost stories linked to markets where followed analysts
  // have placed positions in the last 14 days.
  let page;
  if (personalized && userId) {
    page = await getPersonalizedNewsPage({
      limit,
      category,
      excludeCategory,
      cursor,
      userId,
      requireExpertOpinions,
    });
  } else {
    page = await getPublishedNewsPage({
      limit,
      category,
      excludeCategory,
      cursor,
      userId,
      requireExpertOpinions,
    });
  }

  // Batch-fetch user votes for all markets in this page
  const marketIds = page.items
    .map((item) => item.market?.id)
    .filter((id): id is string => Boolean(id));

  const userVotes =
    userId && marketIds.length > 0
      ? await prisma.vote.findMany({
          where: { userId, marketId: { in: marketIds } },
          select: { marketId: true, side: true, numericValue: true },
        })
      : [];

  const votesByMarket = new Map(
    userVotes.map((v) => [v.marketId, { side: v.side, numericValue: v.numericValue }])
  );

  return NextResponse.json({
    items: page.items.map((item) => ({
      ...item,
      poll: item.market
        ? {
            id: item.market.id,
            title: item.market.title,
            status: item.market.status,
            marketType: item.market.marketType,
            yesCount: item.market.yesCount,
            noCount: item.market.noCount,
            totalVotes: item.market.totalVotes,
            averageNumericValue: item.market.averageNumericValue,
            closeAt: item.market.closeAt?.toISOString() ?? null,
            unit: item.market.unit,
            minValue: item.market.minValue,
            maxValue: item.market.maxValue,
            userVote: votesByMarket.get(item.market.id) ?? null,
          }
        : null,
      expertOpinions: item.expertOpinions.length > 0 ? item.expertOpinions : undefined,
    })),
    nextCursor: page.nextCursor,
    hasMore: page.hasMore
  });
}
