import { MarketCategory, MarketStatus } from "@prisma/client";
import { NextResponse } from "next/server";

import { getSession, getUserIdFromRequest } from "@/lib/auth";
import { createPredictionMarket } from "@/lib/markets/create";
import { computeMarketRankScore, rankMarkets } from "@/lib/markets/ranking";
import { prisma } from "@/lib/prisma";
import { createMarketSchema } from "@/lib/validations/market";

/** Statuses hidden from public market lists by default — unmoderated or removed. */
const UNAPPROVED_STATUSES: MarketStatus[] = ["DRAFT", "PENDING_REVIEW", "REJECTED", "HOST_TIMEOUT"];

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const status = searchParams.get("status");
  const includeUnapproved = searchParams.get("includeUnapproved") === "true";
  const category = searchParams.get("category");
  const q = searchParams.get("q");
  const featured = searchParams.get("featured");
  const sort = searchParams.get("sort");
  const limitParam = searchParams.get("limit");
  const limit = limitParam ? Math.max(1, Math.min(100, parseInt(limitParam, 10))) : undefined;

  // Resolve viewer role to decide whether to honor includeUnapproved=true (admin/mod only).
  let viewerIsModerator = false;
  if (includeUnapproved) {
    const viewerId = await getUserIdFromRequest(request).catch(() => null);
    if (viewerId) {
      const viewer = await prisma.user.findUnique({
        where: { id: viewerId },
        select: { role: true },
      });
      viewerIsModerator = viewer?.role === "ADMIN" || viewer?.role === "MODERATOR";
    }
  }

  // Status filter logic:
  //   - If client passed an explicit ?status=, respect it (their explicit choice).
  //   - Else if includeUnapproved=true AND viewer is admin/moderator, no status filter (return all).
  //   - Otherwise default to hiding DRAFT / PENDING_REVIEW / REJECTED / HOST_TIMEOUT.
  const explicitStatusFilter =
    status && Object.values(MarketStatus).includes(status as MarketStatus)
      ? { status: status as MarketStatus }
      : null;
  const defaultUnapprovedFilter =
    !explicitStatusFilter && !(includeUnapproved && viewerIsModerator)
      ? { status: { notIn: UNAPPROVED_STATUSES } }
      : null;

  const markets = await prisma.market.findMany({
    where: {
      visibility: "PUBLIC",
      storyId: null,
      ...(explicitStatusFilter ?? {}),
      ...(defaultUnapprovedFilter ?? {}),
      ...(category && Object.values(MarketCategory).includes(category as MarketCategory)
        ? { category: category as MarketCategory }
        : {}),
      ...(featured === "true" ? { isFeatured: true } : {}),
      ...(q
        ? {
            OR: [
              {
                title: {
                  contains: q,
                  mode: "insensitive"
                }
              },
              {
                description: {
                  contains: q,
                  mode: "insensitive"
                }
              },
              {
                creator: {
                  username: {
                    contains: q,
                    mode: "insensitive"
                  }
                }
              }
            ]
          }
        : {})
    },
    include: {
      creator: {
        select: {
          username: true,
          reputationScore: true,
          stats: {
            select: {
              hostTrustScore: true,
              cleanStreakCount: true,
              recentHostTimeoutCount: true,
              overturnedHostedMarketsCount: true,
              publicHostingEligibility: true
            }
          }
        }
      },
      _count: {
        select: {
          comments: true
        }
      }
    }
  });

  const sortedMarkets =
    sort === "new"
      ? [...markets].sort((left, right) => right.createdAt.getTime() - left.createdAt.getTime())
      : sort === "closing" || sort === "close_at"
        ? [...markets].sort((left, right) => left.closeAt.getTime() - right.closeAt.getTime())
        : sort === "featured"
          ? [...markets].sort((left, right) => {
              if (left.isFeatured !== right.isFeatured) {
                return Number(right.isFeatured) - Number(left.isFeatured);
              }

              return computeMarketRankScore(right) - computeMarketRankScore(left);
            })
          : sort === "volume"
            ? [...markets].sort((left, right) => (right.totalVolume ?? 0) - (left.totalVolume ?? 0))
            : rankMarkets(markets);

  const resultMarkets = limit ? sortedMarkets.slice(0, limit) : sortedMarkets;

  return NextResponse.json({
    markets: resultMarkets.map((market) => ({
      ...market,
      marketRankScore: computeMarketRankScore(market)
    }))
  });
}

export async function POST(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const session = await getSession();
    const userId = session?.user?.id ?? searchParams.get("userId");
    if (!userId) {
      return NextResponse.json({ error: "Authentication required." }, { status: 401 });
    }

    const actor = await prisma.user.findUnique({
      where: { id: userId }
    });
    if (!actor || actor.isSuspended) {
      return NextResponse.json({ error: "Account is not allowed to create markets." }, { status: 403 });
    }

    const payload = createMarketSchema.parse(await request.json());
    const market = await createPredictionMarket({
      actorId: actor.id,
      actorRole: actor.role,
      actorUsername: actor.username,
      actorReputationScore: actor.reputationScore,
      payload
    });

    return NextResponse.json({ market: { id: market.id, status: market.status } }, { status: 201 });
  } catch (error) {
    console.error(error);
    if (error instanceof Error) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    return NextResponse.json({ error: "Unable to create market." }, { status: 400 });
  }
}
