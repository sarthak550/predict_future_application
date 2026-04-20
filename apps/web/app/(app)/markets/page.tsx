import { MarketCategory, MarketStatus, Prisma } from "@prisma/client";

import { MarketCard } from "@/components/markets/market-card";
import { MarketsFilters } from "@/components/markets/markets-filters";
import { EmptyState } from "@/components/ui/empty-state";
import { getCurrentUser } from "@/lib/auth";
import { buildMarketVisibilityWhere } from "@/lib/markets/deduplication";
import { rankMarkets } from "@/lib/markets/ranking";
import { prisma } from "@/lib/prisma";

type MarketsPageProps = {
  searchParams?: {
    category?: string;
    status?: string;
    q?: string;
    sort?: string;
    featured?: string;
  };
};

export default async function MarketsPage({ searchParams }: MarketsPageProps) {
  const user = await getCurrentUser();
  const canSeeInternal = Boolean(user && (user.role === "ADMIN" || user.role === "MODERATOR"));

  const where: Prisma.MarketWhereInput = buildMarketVisibilityWhere(canSeeInternal, searchParams?.status);

  if (
    searchParams?.category &&
    Object.values(MarketCategory).includes(searchParams.category as MarketCategory)
  ) {
    where.category = searchParams.category as MarketCategory;
  }

  if (searchParams?.status && Object.values(MarketStatus).includes(searchParams.status as MarketStatus)) {
    const requestedStatus = searchParams.status as MarketStatus;
    const canUseStatusFilter =
      canSeeInternal || (requestedStatus !== "DRAFT" && requestedStatus !== "REJECTED");
    if (canUseStatusFilter) {
      where.status = requestedStatus;
    }
  }

  if (searchParams?.q) {
    where.OR = [
      { title: { contains: searchParams.q, mode: "insensitive" } },
      { description: { contains: searchParams.q, mode: "insensitive" } },
      { creator: { username: { contains: searchParams.q, mode: "insensitive" } } }
    ];
  }

  if (searchParams?.featured === "true") {
    where.isFeatured = true;
  }

  const [markets, featuredMarkets, trendingMarkets] = await Promise.all([
    prisma.market.findMany({
      where,
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
    }),
    prisma.market.findMany({
      where: {
        visibility: "PUBLIC",
        status: "OPEN",
        isFeatured: true
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
      },
      take: 3
    }),
    prisma.market.findMany({
      where: {
        visibility: "PUBLIC",
        status: "OPEN"
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
      },
      take: 3
    })
  ]);

  const sortedMarkets =
    searchParams?.sort === "new"
      ? [...markets].sort((left, right) => right.createdAt.getTime() - left.createdAt.getTime())
      : searchParams?.sort === "closing"
        ? [...markets].sort((left, right) => left.closeAt.getTime() - right.closeAt.getTime())
        : searchParams?.sort === "featured"
          ? rankMarkets(markets.filter((market) => market.isFeatured)).concat(
              rankMarkets(markets.filter((market) => !market.isFeatured))
            )
          : rankMarkets(markets);
  const sortedFeaturedMarkets = rankMarkets(featuredMarkets).slice(0, 3);
  const sortedTrendingMarkets = rankMarkets(trendingMarkets).slice(0, 3);

  const showDiscoverySections =
    !searchParams?.q && !searchParams?.category && !searchParams?.status && searchParams?.featured !== "true";

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-semibold text-ink-900">Public markets</h1>
        <p className="mt-2 text-sm text-ink-500">
          Browse public forecasting questions that are visible across the platform.
        </p>
      </div>

      <MarketsFilters current={searchParams ?? {}} canSeeInternal={canSeeInternal} />

      {showDiscoverySections && featuredMarkets.length > 0 && (
        <section className="space-y-4">
          <div>
            <h2 className="text-2xl font-semibold text-ink-900">Featured picks</h2>
            <p className="text-sm text-ink-500">Staff-selected markets with strong structure and active interest.</p>
          </div>
          <div className="grid gap-5 xl:grid-cols-3">
            {sortedFeaturedMarkets.map((market) => (
              <MarketCard key={market.id} market={market} />
            ))}
          </div>
        </section>
      )}

      {showDiscoverySections && trendingMarkets.length > 0 && (
        <section className="space-y-4">
          <div>
            <h2 className="text-2xl font-semibold text-ink-900">Trending now</h2>
            <p className="text-sm text-ink-500">Open markets with the most activity and volume.</p>
          </div>
          <div className="grid gap-5 xl:grid-cols-3">
            {sortedTrendingMarkets.map((market) => (
              <MarketCard key={market.id} market={market} />
            ))}
          </div>
        </section>
      )}

      {markets.length === 0 ? (
        <EmptyState
          title="No markets found"
          description="Try a broader filter or create a new objective market."
        />
      ) : (
        <section className="space-y-4">
          <div>
            <h2 className="text-2xl font-semibold text-ink-900">All results</h2>
            <p className="text-sm text-ink-500">{markets.length} markets matched the current filters.</p>
          </div>
          <div className="grid gap-5 xl:grid-cols-2">
            {sortedMarkets.map((market) => (
              <MarketCard key={market.id} market={market} />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
