import { MarketCategory, MarketStatus } from "@prisma/client";
import { NextResponse } from "next/server";

import { getUserIdFromRequest } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

/**
 * GET /api/polls?userId=...&status=open|all&category=SPORTS
 *
 * Returns AI-generated opinion polls (markets linked to news stories).
 * Optionally filters by status and category. Includes the caller's vote if userId is provided.
 */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const userId = (await getUserIdFromRequest(request)) ?? undefined;

  const rawStatus = searchParams.get("status") ?? "all";
  const rawCategory = searchParams.get("category");
  const category =
    rawCategory && Object.values(MarketCategory).includes(rawCategory as MarketCategory)
      ? (rawCategory as MarketCategory)
      : undefined;

  const statusFilter =
    rawStatus === "open"
      ? { status: MarketStatus.OPEN }
      : rawStatus === "closed"
        ? { status: { in: [MarketStatus.CLOSED, MarketStatus.RESOLVED] as MarketStatus[] } }
        : {};

  const polls = await prisma.market.findMany({
    where: {
      storyId: { not: null },
      visibility: "PUBLIC",
      ...statusFilter,
      ...(category ? { category } : {}),
    },
    select: {
      id: true,
      title: true,
      category: true,
      status: true,
      marketType: true,
      closeAt: true,
      createdAt: true,
      yesCount: true,
      noCount: true,
      totalVotes: true,
      unit: true,
      minValue: true,
      maxValue: true,
      averageNumericValue: true,
      story: {
        select: { headline: true, summary: true, sourceUrl: true, sourceName: true, imageUrl: true },
      },
    },
    orderBy: { createdAt: "desc" },
    take: 60,
  });

  const pollIds = polls.map((p) => p.id);

  const userVotes =
    userId && pollIds.length > 0
      ? await prisma.vote.findMany({
          where: { userId, marketId: { in: pollIds } },
          select: { marketId: true, side: true, numericValue: true },
        })
      : [];

  const voteMap = new Map(
    userVotes.map((v) => [v.marketId, { side: v.side, numericValue: v.numericValue }])
  );

  return NextResponse.json({
    polls: polls.map((p) => ({
      id: p.id,
      title: p.title,
      category: p.category,
      status: p.status,
      marketType: p.marketType,
      closeAt: p.closeAt?.toISOString() ?? null,
      yesCount: p.yesCount,
      noCount: p.noCount,
      totalVotes: p.totalVotes,
      unit: p.unit ?? null,
      minValue: p.minValue ?? null,
      maxValue: p.maxValue ?? null,
      averageNumericValue: p.averageNumericValue ?? null,
      storyHeadline: p.story?.headline ?? null,
      storySummary: p.story?.summary ?? null,
      storySourceUrl: p.story?.sourceUrl ?? null,
      storySourceName: p.story?.sourceName ?? null,
      storyImageUrl: p.story?.imageUrl ?? null,
      userVote: voteMap.get(p.id) ?? null,
    })),
  });
}
