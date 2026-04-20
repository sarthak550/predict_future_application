import { MarketCategory, MarketStatus } from "@prisma/client";
import { NextResponse } from "next/server";

import { getSession } from "@/lib/auth";
import { createPredictionMarket } from "@/lib/markets/create";
import { computeMarketRankScore, rankMarkets } from "@/lib/markets/ranking";
import { prisma } from "@/lib/prisma";
import { createMarketSchema } from "@/lib/validations/market";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const status = searchParams.get("status");
  const category = searchParams.get("category");
  const q = searchParams.get("q");
  const featured = searchParams.get("featured");
  const sort = searchParams.get("sort");

  const markets = await prisma.market.findMany({
    where: {
      visibility: "PUBLIC",
      ...(status && Object.values(MarketStatus).includes(status as MarketStatus)
        ? { status: status as MarketStatus }
        : {}),
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
      : sort === "closing"
        ? [...markets].sort((left, right) => left.closeAt.getTime() - right.closeAt.getTime())
        : sort === "featured"
          ? [...markets].sort((left, right) => {
              if (left.isFeatured !== right.isFeatured) {
                return Number(right.isFeatured) - Number(left.isFeatured);
              }

              return computeMarketRankScore(right) - computeMarketRankScore(left);
            })
          : rankMarkets(markets);

  return NextResponse.json({
    markets: sortedMarkets.map((market) => ({
      ...market,
      marketRankScore: computeMarketRankScore(market)
    }))
  });
}

export async function POST(request: Request) {
  try {
    const session = await getSession();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Authentication required." }, { status: 401 });
    }

    const actor = await prisma.user.findUnique({
      where: { id: session.user.id }
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

    return NextResponse.json({ market: { id: market.id } }, { status: 201 });
  } catch (error) {
    console.error(error);
    if (error instanceof Error) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    return NextResponse.json({ error: "Unable to create market." }, { status: 400 });
  }
}
