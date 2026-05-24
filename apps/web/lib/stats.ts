import { type MarketCategory, Prisma } from "@prisma/client";

import { calculateLevel } from "@/lib/constants";
import { buildHostPlatformBenchmarks, computeHostMetrics } from "@/lib/hosts/trust";

type TxClient = Prisma.TransactionClient;

function computeStreaks(results: boolean[]) {
  let current = 0;
  let best = 0;
  let running = 0;

  for (const result of results) {
    if (result) {
      running += 1;
      best = Math.max(best, running);
    } else {
      running = 0;
    }
  }

  for (let index = results.length - 1; index >= 0; index -= 1) {
    if (!results[index]) {
      break;
    }
    current += 1;
  }

  return { current, best };
}

export async function refreshUserStats(tx: TxClient, userId: string) {
  const user = await tx.user.findUnique({
    where: { id: userId },
    select: {
      createdAt: true
    }
  });
  if (!user) {
    return;
  }

  const positions = await tx.marketPosition.findMany({
    where: {
      userId,
      market: {
        status: {
          in: ["RESOLVED", "CANCELLED", "HOST_TIMEOUT"]
        }
      },
      settledAt: {
        not: null
      }
    },
    include: {
      market: true
    },
    orderBy: {
      settledAt: "asc"
    }
  });

  const createdMarkets = await tx.market.findMany({
    where: { creatorId: userId },
    include: {
      challenges: {
        select: {
          status: true
        }
      },
      positions: {
        select: {
          userId: true
        }
      }
    }
  });

  // Restrict to terminal-state markets only — open/pending markets do not
  // contribute to benchmarks and loading them on every stats refresh is wasteful.
  const platformHostedMarkets = await tx.market.findMany({
    where: {
      resolutionMode: {
        in: ["HOST", "TRUSTED_HOST", "HOST_RESOLVED"]
      },
      status: { in: ["RESOLVED", "CANCELLED", "HOST_TIMEOUT"] }
    },
    select: {
      creatorId: true,
      visibility: true,
      resolutionMode: true,
      resolutionStatus: true,
      status: true,
      totalParticipants: true,
      totalVolume: true,
      hostCommissionBps: true,
      closeAt: true,
      resolveAt: true,
      updatedAt: true,
      finalizationAt: true,
      isFlagged: true
    }
  });

  const gradedPositions = positions.filter(
    (position) =>
      position.market.outcome !== "CANCELLED" ||
      (position.market.marketType === "NUMERIC" && position.payoutAmount !== null)
  );
  const wins = gradedPositions.filter((position) => didPositionWin(position));
  const losses = gradedPositions.length - wins.length;
  const totalPredictions = gradedPositions.length;
  const totalPointsStaked = positions.reduce((sum, position) => sum + position.amount, 0);
  const totalNetPoints = positions.reduce(
    (sum, position) => sum + ((position.payoutAmount ?? 0) - position.amount),
    0
  );
  const accuracyScore = totalPredictions === 0 ? 0 : (wins.length / totalPredictions) * 100;
  const streakData = computeStreaks(gradedPositions.map((position) => didPositionWin(position)));
  const creatorResolved = createdMarkets.filter((market) => market.status === "RESOLVED").length;
  const creatorReputation = Math.max(
    0,
    40 + creatorResolved * 6 - createdMarkets.filter((market) => market.isFlagged).length * 8
  );
  const reputationScore = Math.round(
    Math.max(0, Math.min(100, 50 + accuracyScore * 0.3 + streakData.current * 2 + creatorReputation * 0.1))
  );
  const level = calculateLevel(reputationScore, totalPredictions);
  const existingStats = await tx.userStat.findUnique({
    where: {
      userId
    },
    select: {
      hostingSuspendedUntil: true
    }
  });
  const hostMetrics = computeHostMetrics({
    createdAt: user.createdAt,
    stats: existingStats,
    hostedMarkets: createdMarkets,
    platformBenchmarks: buildHostPlatformBenchmarks(platformHostedMarkets)
  });

  await tx.userStat.upsert({
    where: { userId },
    update: {
      totalPredictions,
      totalWins: wins.length,
      totalLosses: losses,
      totalMarketsCreated: createdMarkets.length,
      resolvedMarketsCreated: creatorResolved,
      creatorReputation,
      totalPointsStaked,
      totalNetPoints,
      streak: streakData.current,
      bestStreak: streakData.best,
      accuracyScore,
      lastPredictionAt: positions.at(-1)?.createdAt ?? null,
      hostTrustScore: hostMetrics.hostTrustScore,
      validFinalizedHostedMarketsCount: hostMetrics.validFinalizedHostedMarketsCount,
      hostedMarketsCount: hostMetrics.hostedMarketsCount,
      finalizedHostedMarketsCount: hostMetrics.finalizedHostedMarketsCount,
      overturnedHostedMarketsCount: hostMetrics.overturnedHostedMarketsCount,
      hostTimeoutCount: hostMetrics.hostTimeoutCount,
      recentHostTimeoutCount: hostMetrics.recentHostTimeoutCount,
      challengeCount: hostMetrics.challengeCount,
      upheldChallengesCount: hostMetrics.upheldChallengesCount,
      cleanFinalizationCount: hostMetrics.cleanFinalizationCount,
      upheldAfterChallengeCount: hostMetrics.upheldAfterChallengeCount,
      successfulResolutionsCount: hostMetrics.successfulResolutionsCount,
      moderationViolationCount: hostMetrics.moderationViolationCount,
      avgParticipantsPerHostedMarket: hostMetrics.avgParticipantsPerHostedMarket,
      avgPoolPerHostedMarket: hostMetrics.avgPoolPerHostedMarket,
      repeatJoinRate: hostMetrics.repeatJoinRate,
      avgHostCommissionBps: hostMetrics.avgHostCommissionBps,
      cleanStreakCount: hostMetrics.cleanStreakCount,
      publicHostingEligibility: hostMetrics.publicHostingEligibility,
      hostingLimit: hostMetrics.hostingLimit,
      currentActiveHostedMarketsCount: hostMetrics.currentActiveHostedMarketsCount,
      reversalRate: hostMetrics.reversalRate
    },
    create: {
      userId,
      totalPredictions,
      totalWins: wins.length,
      totalLosses: losses,
      totalMarketsCreated: createdMarkets.length,
      resolvedMarketsCreated: creatorResolved,
      creatorReputation,
      totalPointsStaked,
      totalNetPoints,
      streak: streakData.current,
      bestStreak: streakData.best,
      accuracyScore,
      lastPredictionAt: positions.at(-1)?.createdAt ?? null,
      hostTrustScore: hostMetrics.hostTrustScore,
      validFinalizedHostedMarketsCount: hostMetrics.validFinalizedHostedMarketsCount,
      hostedMarketsCount: hostMetrics.hostedMarketsCount,
      finalizedHostedMarketsCount: hostMetrics.finalizedHostedMarketsCount,
      overturnedHostedMarketsCount: hostMetrics.overturnedHostedMarketsCount,
      hostTimeoutCount: hostMetrics.hostTimeoutCount,
      recentHostTimeoutCount: hostMetrics.recentHostTimeoutCount,
      challengeCount: hostMetrics.challengeCount,
      upheldChallengesCount: hostMetrics.upheldChallengesCount,
      cleanFinalizationCount: hostMetrics.cleanFinalizationCount,
      upheldAfterChallengeCount: hostMetrics.upheldAfterChallengeCount,
      successfulResolutionsCount: hostMetrics.successfulResolutionsCount,
      moderationViolationCount: hostMetrics.moderationViolationCount,
      avgParticipantsPerHostedMarket: hostMetrics.avgParticipantsPerHostedMarket,
      avgPoolPerHostedMarket: hostMetrics.avgPoolPerHostedMarket,
      repeatJoinRate: hostMetrics.repeatJoinRate,
      avgHostCommissionBps: hostMetrics.avgHostCommissionBps,
      cleanStreakCount: hostMetrics.cleanStreakCount,
      publicHostingEligibility: hostMetrics.publicHostingEligibility,
      hostingLimit: hostMetrics.hostingLimit,
      currentActiveHostedMarketsCount: hostMetrics.currentActiveHostedMarketsCount,
      reversalRate: hostMetrics.reversalRate
    }
  });

  await tx.user.update({
    where: { id: userId },
    data: {
      accuracyScore,
      reputationScore,
      level,
      streak: streakData.current
    }
  });

  await syncCategoryStats(tx, userId, positions);
  await syncBadges(tx, userId);
}

function didPositionWin(position: {
  amount: number;
  payoutAmount: number | null;
  side: "YES" | "NO" | null;
  market: { marketType: "BINARY" | "NUMERIC" | "MULTIPLE_CHOICE"; outcome: "YES" | "NO" | "CANCELLED" | "UNRESOLVED" };
}) {
  if (position.market.marketType === "NUMERIC" || position.market.marketType === "MULTIPLE_CHOICE") {
    return (position.payoutAmount ?? 0) > 0;
  }

  return (
    (position.side === "YES" && position.market.outcome === "YES") ||
    (position.side === "NO" && position.market.outcome === "NO")
  );
}

async function syncCategoryStats(
  tx: TxClient,
  userId: string,
  positions: Array<{
    amount: number;
    payoutAmount: number | null;
    side: "YES" | "NO" | null;
    market: {
      category: MarketCategory;
      marketType: "BINARY" | "NUMERIC" | "MULTIPLE_CHOICE";
      outcome: "YES" | "NO" | "CANCELLED" | "UNRESOLVED";
    };
  }>
) {
  const categories = new Map<
    MarketCategory,
    { predictions: number; wins: number; losses: number; netPoints: number }
  >();

  for (const position of positions) {
    if (position.market.outcome === "CANCELLED" || position.market.outcome === "UNRESOLVED") {
      continue;
    }

    const current = categories.get(position.market.category) ?? {
      predictions: 0,
      wins: 0,
      losses: 0,
      netPoints: 0
    };
    const won = didPositionWin(position);
    current.predictions += 1;
    current.wins += won ? 1 : 0;
    current.losses += won ? 0 : 1;
    current.netPoints += (position.payoutAmount ?? 0) - position.amount;
    categories.set(position.market.category, current);
  }

  const knownCategories: MarketCategory[] = [
    "GENERAL",
    "SPORTS",
    "BUSINESS",
    "TECH",
    "WEATHER",
    "ENTERTAINMENT",
    "PRODUCT",
    "COMPANY"
  ];
  for (const category of knownCategories) {
    const snapshot = categories.get(category) ?? {
      predictions: 0,
      wins: 0,
      losses: 0,
      netPoints: 0
    };
    const accuracyScore =
      snapshot.predictions === 0 ? 0 : (snapshot.wins / snapshot.predictions) * 100;

    await tx.userCategoryStat.upsert({
      where: {
        userId_category: {
          userId,
          category
        }
      },
      update: {
        totalPredictions: snapshot.predictions,
        totalWins: snapshot.wins,
        totalLosses: snapshot.losses,
        totalNetPoints: snapshot.netPoints,
        accuracyScore
      },
      create: {
        userId,
        category,
        totalPredictions: snapshot.predictions,
        totalWins: snapshot.wins,
        totalLosses: snapshot.losses,
        totalNetPoints: snapshot.netPoints,
        accuracyScore
      }
    });
  }
}

async function syncBadges(tx: TxClient, userId: string) {
  const user = await tx.user.findUnique({
    where: { id: userId },
    include: {
      stats: true,
      categoryStats: true
    }
  });

  if (!user?.stats) {
    return;
  }

  const badgeSlugs = new Set<string>();

  if (user.stats.totalPredictions >= 10 && user.stats.accuracyScore >= 60) {
    badgeSlugs.add("sharp-eye");
  }

  if (user.stats.bestStreak >= 5) {
    badgeSlugs.add("hot-streak");
  }

  if (user.stats.totalMarketsCreated >= 5 && user.stats.creatorReputation >= 50) {
    badgeSlugs.add("market-maker");
  }

  for (const categoryStat of user.categoryStats) {
    if (categoryStat.totalPredictions >= 5 && categoryStat.accuracyScore >= 65) {
      badgeSlugs.add(`expert-${categoryStat.category.toLowerCase()}`);
    }
  }

  const badges = await tx.badge.findMany({
    where: {
      slug: {
        in: Array.from(badgeSlugs)
      }
    }
  });

  for (const badge of badges) {
    await tx.userBadge.upsert({
      where: {
        userId_badgeId: {
          userId,
          badgeId: badge.id
        }
      },
      update: {},
      create: {
        userId,
        badgeId: badge.id
      }
    });
  }
}
