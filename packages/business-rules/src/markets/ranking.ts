import { type MarketCategory, type MarketVisibility, type PoolRewardMode } from "@prisma/client";

function getNumberEnv(name: string, fallback: number) {
  const value = Number(process.env[name] ?? fallback);
  return Number.isFinite(value) ? value : fallback;
}

export function getMarketRankingConfig() {
  return {
    recencyWindowHours: getNumberEnv("MARKET_RANK_RECENCY_WINDOW_HOURS", 96),
    commentWeight: getNumberEnv("MARKET_RANK_COMMENT_WEIGHT", 2),
    newsLinkedBoost: getNumberEnv("MARKET_RANK_NEWS_LINKED_BOOST", 4),
    disputedPenalty: getNumberEnv("MARKET_RANK_DISPUTED_PENALTY", 20),
    overturnedPenalty: getNumberEnv("MARKET_RANK_OVERTURNED_PENALTY", 35),
    hostTimeoutPenalty: getNumberEnv("MARKET_RANK_HOST_TIMEOUT_PENALTY", 30),
    pendingChallengePenalty: getNumberEnv("MARKET_RANK_PENDING_CHALLENGE_PENALTY", 8),
    highParticipationThreshold: getNumberEnv("MARKET_RANK_HIGH_PARTICIPATION_THRESHOLD", 5)
  };
}

type RankedHostStats = {
  hostTrustScore?: number | null;
  cleanStreakCount?: number | null;
  recentHostTimeoutCount?: number | null;
  overturnedHostedMarketsCount?: number | null;
  publicHostingEligibility?: boolean | null;
};

export type RankedMarket = {
  id: string;
  title: string;
  category: MarketCategory;
  visibility: MarketVisibility;
  storyId?: string | null;
  createdAt: Date;
  totalParticipants: number;
  totalVolume: number;
  hostCommissionBps: number;
  poolRewardMode: PoolRewardMode;
  resolutionStatus: string;
  status: string;
  creator: {
    stats?: RankedHostStats | null;
  };
  _count?: {
    comments?: number;
  };
};

function getRecencyScore(createdAt: Date) {
  const config = getMarketRankingConfig();
  const hoursOld = Math.max(0, (Date.now() - createdAt.getTime()) / (1000 * 60 * 60));
  return Math.max(0, config.recencyWindowHours - hoursOld) / 4;
}

function getEngagementScore(comments: number) {
  const config = getMarketRankingConfig();
  return Math.min(12, comments * config.commentWeight);
}

function getFeeBonus(
  visibility: MarketVisibility,
  poolRewardMode: PoolRewardMode,
  hostCommissionBps: number
) {
  if (visibility !== "PRIVATE" || poolRewardMode !== "COMMISSION_BASED") {
    return 0;
  }

  if (hostCommissionBps === 0) {
    return 8;
  }

  if (hostCommissionBps <= 200) {
    return 5;
  }

  return 0;
}

function getCleanHostBonus(stats?: RankedHostStats | null) {
  if (!stats) {
    return 0;
  }

  if ((stats.cleanStreakCount ?? 0) >= 5) {
    return 5;
  }

  if ((stats.recentHostTimeoutCount ?? 0) === 0 && (stats.overturnedHostedMarketsCount ?? 0) === 0) {
    return 2;
  }

  return 0;
}

function getDisputePenalty(resolutionStatus: string) {
  const config = getMarketRankingConfig();

  if (resolutionStatus === "OVERTURNED") {
    return config.overturnedPenalty;
  }

  if (resolutionStatus === "DISPUTED") {
    return config.disputedPenalty;
  }

  if (resolutionStatus === "HOST_TIMEOUT") {
    return config.hostTimeoutPenalty;
  }

  if (resolutionStatus === "RESOLVED_PENDING_CHALLENGE") {
    return config.pendingChallengePenalty;
  }

  return 0;
}

export function computeMarketRankScore(market: RankedMarket) {
  const recencyScore = getRecencyScore(market.createdAt);
  const participantScore = Math.log1p(market.totalParticipants) * 10;
  const poolScore = Math.log1p(market.totalVolume) * 8;
  const engagementScore = getEngagementScore(market._count?.comments ?? 0);
  const hostTrustScore = (market.creator.stats?.hostTrustScore ?? 30) / 5;
  const feeBonus = getFeeBonus(market.visibility, market.poolRewardMode, market.hostCommissionBps);
  const cleanHostBonus = getCleanHostBonus(market.creator.stats);
  const disputePenalty = getDisputePenalty(market.resolutionStatus);
  const newsLinkedBoost = market.storyId ? getMarketRankingConfig().newsLinkedBoost : 0;

  return (
    recencyScore +
    participantScore +
    poolScore +
    engagementScore +
    hostTrustScore +
    feeBonus +
    cleanHostBonus +
    newsLinkedBoost -
    disputePenalty
  );
}

export function getMarketRankingLabels(market: RankedMarket) {
  const config = getMarketRankingConfig();
  const labels: string[] = [];

  if (
    market.visibility === "PRIVATE" &&
    market.poolRewardMode === "COMMISSION_BASED" &&
    market.hostCommissionBps <= 200
  ) {
    labels.push("Low Fee");
  }

  if (market.poolRewardMode === "BOND_BASED") {
    labels.push("Bond-backed host");
  }

  if (market.creator.stats?.publicHostingEligibility) {
    labels.push("Trusted Host");
  }

  if (market.totalParticipants >= config.highParticipationThreshold) {
    labels.push("High Participation");
  }

  if ((market.creator.stats?.cleanStreakCount ?? 0) >= 5) {
    labels.push("Clean Resolution Record");
  }

  return labels;
}

export function rankMarkets<T extends RankedMarket>(markets: T[]) {
  return [...markets].sort((left, right) => {
    const scoreDelta = computeMarketRankScore(right) - computeMarketRankScore(left);
    if (scoreDelta !== 0) {
      return scoreDelta;
    }

    return right.createdAt.getTime() - left.createdAt.getTime();
  });
}
