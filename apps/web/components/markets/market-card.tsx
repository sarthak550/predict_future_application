import Link from "next/link";
import type { Market, User, UserStat } from "@prisma/client";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import {
  marketCategoryLabels,
  marketStatusLabels,
  marketTemplateLabels,
  marketTypeLabels,
  poolRewardModeLabels,
  marketVisibilityLabels
} from "@/lib/constants";
import { getMarketRankingLabels } from "@/lib/markets/ranking";
import { calculateProbabilities } from "@/lib/markets/probability";
import { formatDateTime, formatNumericValue, formatPercent, formatPoints } from "@/lib/utils";

type MarketCardProps = {
  market: Market & {
    creator: Pick<User, "username" | "reputationScore"> & {
      stats?: Pick<
        UserStat,
        | "hostTrustScore"
        | "cleanStreakCount"
        | "recentHostTimeoutCount"
        | "overturnedHostedMarketsCount"
        | "publicHostingEligibility"
      > | null;
    };
    _count?: {
      comments: number;
      positions?: number;
    };
  };
};

export function MarketCard({ market }: MarketCardProps) {
  const probability = calculateProbabilities(market.yesPool, market.noPool);
  const statusVariant =
    market.status === "OPEN"
      ? "success"
      : market.status === "DRAFT"
        ? "warning"
        : market.status === "REJECTED"
          ? "danger"
          : market.status === "RESOLVED"
            ? "accent"
            : "default";
  const rankingLabels = getMarketRankingLabels(market);
  const isNumeric = market.marketType === "NUMERIC";
  const payoutDistribution = Array.isArray(market.payoutDistributionJson)
    ? market.payoutDistributionJson.filter((value): value is number => typeof value === "number")
    : [];

  return (
    <Card className="h-full">
      <CardHeader className="gap-4">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant={statusVariant}>{marketStatusLabels[market.status]}</Badge>
          <Badge>{marketCategoryLabels[market.category]}</Badge>
          <Badge variant="accent">{marketTemplateLabels[market.template]}</Badge>
          <Badge variant="accent">{marketVisibilityLabels[market.visibility]}</Badge>
          <Badge variant="accent">{marketTypeLabels[market.marketType]}</Badge>
          {(market.resolutionMode === "HOST" || market.resolutionMode === "TRUSTED_HOST") && (
            <Badge variant="accent">{poolRewardModeLabels[market.poolRewardMode]}</Badge>
          )}
          {market.isFeatured && <Badge variant="accent">Featured</Badge>}
          {rankingLabels.map((label) => (
            <Badge key={label} variant="accent">
              {label}
            </Badge>
          ))}
        </div>
        <div className="space-y-2">
          <CardTitle className="text-xl leading-8">
            <Link href={`/markets/${market.id}`} className="hover:text-signal-sky">
              {market.title}
            </Link>
          </CardTitle>
          <CardDescription>{market.description}</CardDescription>
        </div>
      </CardHeader>
      <CardContent className="space-y-5">
        {isNumeric ? (
          <div className="space-y-3 rounded-[24px] bg-ink-50 p-4">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium text-ink-600">Closest guesses win</span>
              <span className="text-lg font-semibold text-ink-900">{market.winnersCount} slots</span>
            </div>
            <div className="grid grid-cols-2 gap-3 text-sm text-ink-500">
              <div>
                <p className="font-medium text-ink-800">Value range</p>
                <p>
                  {market.minValue !== null
                    ? formatNumericValue(market.minValue, { unit: market.unit, precision: market.precision })
                    : "No min"}
                  {" - "}
                  {market.maxValue !== null
                    ? formatNumericValue(market.maxValue, { unit: market.unit, precision: market.precision })
                    : "No max"}
                </p>
              </div>
              <div>
                <p className="font-medium text-ink-800">Payout split</p>
                <p>{payoutDistribution.length > 0 ? payoutDistribution.map((value) => `${value}%`).join(" / ") : "Set on open"}</p>
              </div>
            </div>
          </div>
        ) : (
          <div className="space-y-3 rounded-[24px] bg-ink-50 p-4">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium text-ink-600">Crowd YES probability</span>
              <span className="text-lg font-semibold text-ink-900">
                {formatPercent(probability.yesProbability)}
              </span>
            </div>
            <Progress value={probability.yesProbability * 100} />
            <div className="grid grid-cols-2 gap-3 text-sm text-ink-500">
              <div>
                <p className="font-medium text-emerald-700">YES pool</p>
                <p>{formatPoints(market.yesPool)} pts</p>
              </div>
              <div>
                <p className="font-medium text-rose-700">NO pool</p>
                <p>{formatPoints(market.noPool)} pts</p>
              </div>
            </div>
          </div>
        )}

        <div className="grid grid-cols-2 gap-3 text-sm text-ink-500">
          <div>
            <p className="font-medium text-ink-800">Closes</p>
            <p>{formatDateTime(market.closeAt)}</p>
          </div>
          <div>
            <p className="font-medium text-ink-800">Resolves</p>
            <p>{formatDateTime(market.resolveAt)}</p>
          </div>
          <div>
            <p className="font-medium text-ink-800">Creator</p>
            <p>
              @{market.creator.username}
              {market.creator.stats?.publicHostingEligibility ? " · trusted host" : ""}
            </p>
          </div>
          <div>
            <p className="font-medium text-ink-800">Volume</p>
            <p>{formatPoints(market.totalVolume)} pts</p>
          </div>
        </div>

        {(market.resolutionMode === "HOST" || market.resolutionMode === "TRUSTED_HOST") && (
          <div className="rounded-[20px] bg-amber-50 p-4 text-sm text-amber-900">
            {market.poolRewardMode === "COMMISSION_BASED"
              ? `Commission-based host market · ${(market.hostCommissionBps / 100).toFixed(2)}% host reward · max pool ${
                  market.maxPoolAllowed ? `${formatPoints(market.maxPoolAllowed)} pts` : "uncapped"
                }`
              : "Bond-based host market · host reward equals the locked bond · no pool cap"}
          </div>
        )}

        <Link href={`/markets/${market.id}`} className="block">
          <Button className="w-full">{isNumeric ? "Open market to submit a guess" : "Open market to take a position"}</Button>
        </Link>
      </CardContent>
    </Card>
  );
}
