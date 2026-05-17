import { NextResponse } from "next/server";

import { getUserIdFromRequest } from "@/lib/auth";
import { computeMarketRankScore } from "@/lib/markets/ranking";
import { prisma } from "@/lib/prisma";
import { getDisplayName } from "@/lib/users/displayName";

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 50;

/**
 * GET /api/users/me/saved-markets?limit=20&cursor=...
 *
 * Returns the authenticated user's bookmarked markets, paginated by cursor.
 * Response shape: { markets: ApiMarketSummary[], nextCursor: string | null, hasMore: boolean }
 */
export async function GET(request: Request) {
  const userId = await getUserIdFromRequest(request).catch(() => null);
  if (!userId) {
    return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const limitParam = searchParams.get("limit");
  const cursorParam = searchParams.get("cursor");

  const limit = limitParam
    ? Math.max(1, Math.min(MAX_LIMIT, parseInt(limitParam, 10)))
    : DEFAULT_LIMIT;

  const savedRecords = await prisma.savedMarket.findMany({
    where: { userId },
    // Cursor is the SavedMarket id (so we don't need market id as cursor)
    ...(cursorParam ? { cursor: { id: cursorParam }, skip: 1 } : {}),
    take: limit + 1,
    orderBy: { createdAt: "desc" },
    include: {
      market: {
        include: {
          creator: {
            select: {
              id: true,
              username: true,
              displayMode: true,
              reputationScore: true,
              isVerifiedAnalyst: true,
              stats: {
                select: {
                  hostTrustScore: true,
                  cleanStreakCount: true,
                  recentHostTimeoutCount: true,
                  overturnedHostedMarketsCount: true,
                  publicHostingEligibility: true,
                },
              },
            },
          },
          _count: {
            select: { comments: true },
          },
        },
      },
    },
  });

  const hasMore = savedRecords.length > limit;
  const page = hasMore ? savedRecords.slice(0, limit) : savedRecords;
  const nextCursor = hasMore ? (page[page.length - 1]?.id ?? null) : null;

  const markets = page.map(({ market }) => ({
    ...market,
    creator: market.creator
      ? { ...market.creator, username: getDisplayName(market.creator) }
      : market.creator,
    marketRankScore: computeMarketRankScore(market),
    iSaved: true,
  }));

  return NextResponse.json({ markets, nextCursor, hasMore });
}
