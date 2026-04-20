import { type Market, type ResolutionMode, type User, type UserStat } from "@prisma/client";

function getNumberEnv(name: string, fallback: number) {
  const value = Number(process.env[name] ?? fallback);
  return Number.isFinite(value) ? value : fallback;
}

function getMaxCommissionBps() {
  return getNumberEnv("TRUSTED_HOST_MAX_COMMISSION_BPS", 500);
}

function clampPercentage(value: number) {
  return Math.max(0, Math.min(1, value));
}

function normalizeHostedResolutionMode(mode: ResolutionMode) {
  if (mode === "SOURCE_BASED") {
    return "VERIFIED" as const;
  }

  if (mode === "HOST_RESOLVED") {
    return "HOST" as const;
  }

  return mode;
}

function getMedian(values: number[]) {
  if (values.length === 0) {
    return 0;
  }

  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) {
    return (sorted[middle - 1] + sorted[middle]) / 2;
  }

  return sorted[middle];
}

export function getHostEligibilityThresholds() {
  return {
    minAccountAgeDays: getNumberEnv("TRUSTED_HOST_MIN_ACCOUNT_AGE_DAYS", 14),
    minValidFinalizedMarkets: getNumberEnv("TRUSTED_HOST_MIN_VALID_FINALIZED_MARKETS", 2),
    minTrustScore: getNumberEnv("TRUSTED_HOST_MIN_TRUST_SCORE", 55),
    maxRecentTimeoutCount: getNumberEnv("TRUSTED_HOST_MAX_RECENT_TIMEOUTS", 1),
    maxOverturnedCount: getNumberEnv("TRUSTED_HOST_MAX_OVERTURNED_MARKETS", 1),
    minimumPoolThreshold: getNumberEnv("TRUSTED_HOST_MINIMUM_POOL_THRESHOLD", 100),
    minimumDurationHours: getNumberEnv("TRUSTED_HOST_MINIMUM_DURATION_HOURS", 1),
    recentTimeoutWindowDays: getNumberEnv("TRUSTED_HOST_RECENT_TIMEOUT_WINDOW_DAYS", 90),
    repeatJoinThreshold: getNumberEnv("TRUSTED_HOST_REPEAT_JOIN_THRESHOLD", 0.25)
  };
}

export function isHostedResolutionMode(mode: ResolutionMode) {
  const normalized = normalizeHostedResolutionMode(mode);
  return normalized === "HOST" || normalized === "TRUSTED_HOST";
}

export type HostedMarketChallengeSnapshot = {
  status: "OPEN" | "REVIEWED" | "UPHELD" | "REJECTED";
};

export type HostedMarketPositionSnapshot = {
  userId: string;
};

export type HostedMarketSnapshot = Pick<
  Market,
  | "creatorId"
  | "visibility"
  | "resolutionMode"
  | "resolutionStatus"
  | "status"
  | "totalParticipants"
  | "totalVolume"
  | "hostCommissionBps"
  | "closeAt"
  | "resolveAt"
  | "updatedAt"
  | "finalizationAt"
  | "isFlagged"
> & {
  challenges?: HostedMarketChallengeSnapshot[];
  positions?: HostedMarketPositionSnapshot[];
};

export type HostPlatformBenchmarks = {
  medianParticipants: number;
  medianPool: number;
  repeatJoinThreshold: number;
};

export function isValidFinalizedHostedMarket(market: HostedMarketSnapshot) {
  const thresholds = getHostEligibilityThresholds();
  if (!isHostedResolutionMode(market.resolutionMode)) {
    return false;
  }

  if (market.resolutionStatus !== "FINALIZED" || market.status !== "RESOLVED") {
    return false;
  }

  if (market.totalParticipants < 2) {
    return false;
  }

  if (market.totalVolume < thresholds.minimumPoolThreshold) {
    return false;
  }

  const durationHours = (market.resolveAt.getTime() - market.closeAt.getTime()) / (1000 * 60 * 60);
  if (durationHours < thresholds.minimumDurationHours) {
    return false;
  }

  return true;
}

function getUniqueParticipantIds(markets: HostedMarketSnapshot[]) {
  const entries: string[] = [];

  for (const market of markets) {
    const marketParticipantIds = new Set<string>();
    for (const position of market.positions ?? []) {
      if (position.userId === market.creatorId) {
        continue;
      }

      marketParticipantIds.add(position.userId);
    }

    entries.push(...marketParticipantIds);
  }

  return entries;
}

function calculateRepeatJoinRate(markets: HostedMarketSnapshot[]) {
  const participantEntries = getUniqueParticipantIds(markets);
  if (participantEntries.length === 0) {
    return 0;
  }

  const uniqueParticipants = new Set(participantEntries);
  return clampPercentage((participantEntries.length - uniqueParticipants.size) / participantEntries.length);
}

function calculateCleanStreakCount(markets: HostedMarketSnapshot[]) {
  const recentHostedMarkets = [...markets].sort((left, right) => {
    const leftTime = (left.finalizationAt ?? left.updatedAt).getTime();
    const rightTime = (right.finalizationAt ?? right.updatedAt).getTime();
    return rightTime - leftTime;
  });

  let streak = 0;
  for (const market of recentHostedMarkets) {
    const clean =
      market.resolutionStatus === "FINALIZED" &&
      market.status === "RESOLVED" &&
      !market.isFlagged &&
      !market.challenges?.some((challenge) => challenge.status === "UPHELD");

    if (!clean) {
      break;
    }

    streak += 1;
  }

  return streak;
}

function getFeeFairnessBonus(input: { avgHostCommissionBps: number; repeatJoinRate: number }) {
  const thresholds = getHostEligibilityThresholds();
  const maxCommissionBps = getMaxCommissionBps();

  if (input.avgHostCommissionBps <= 200) {
    return 2;
  }

  if (input.avgHostCommissionBps <= 300) {
    return 1;
  }

  if (input.avgHostCommissionBps >= maxCommissionBps && input.repeatJoinRate < thresholds.repeatJoinThreshold) {
    return -3;
  }

  return 0;
}

function getParticipationBonus(avgParticipantsPerHostedMarket: number, medianParticipants: number) {
  if (avgParticipantsPerHostedMarket > medianParticipants && avgParticipantsPerHostedMarket > 0) {
    return 2;
  }

  return 0;
}

function getPoolBonus(avgPoolPerHostedMarket: number, medianPool: number) {
  if (avgPoolPerHostedMarket > medianPool && avgPoolPerHostedMarket > 0) {
    return 2;
  }

  return 0;
}

function getRepeatJoinBonus(repeatJoinRate: number) {
  return repeatJoinRate >= getHostEligibilityThresholds().repeatJoinThreshold ? 3 : 0;
}

function getConsistencyBonus(cleanStreakCount: number) {
  return cleanStreakCount >= 5 ? 5 : 0;
}

export function buildHostPlatformBenchmarks(markets: HostedMarketSnapshot[]): HostPlatformBenchmarks {
  const validMarkets = markets.filter((market) => isValidFinalizedHostedMarket(market));

  return {
    medianParticipants: getMedian(validMarkets.map((market) => market.totalParticipants)),
    medianPool: getMedian(validMarkets.map((market) => market.totalVolume)),
    repeatJoinThreshold: getHostEligibilityThresholds().repeatJoinThreshold
  };
}

type HostMetricsInput = {
  createdAt: Date;
  stats?: Pick<UserStat, "hostingSuspendedUntil"> | null;
  hostedMarkets: HostedMarketSnapshot[];
  platformBenchmarks?: HostPlatformBenchmarks;
};

export function computeHostMetrics(input: HostMetricsInput) {
  const thresholds = getHostEligibilityThresholds();
  const now = Date.now();
  const accountAgeDays = (now - input.createdAt.getTime()) / (1000 * 60 * 60 * 24);
  const hostedMarkets = input.hostedMarkets.filter((market) => isHostedResolutionMode(market.resolutionMode));
  const finalizedHostedMarkets = hostedMarkets.filter(
    (market) => market.resolutionStatus === "FINALIZED" && market.status === "RESOLVED"
  );
  const validFinalizedHostedMarkets = hostedMarkets.filter((market) => isValidFinalizedHostedMarket(market));
  const overturnedHostedMarkets = hostedMarkets.filter((market) => market.resolutionStatus === "OVERTURNED");
  const hostTimeoutMarkets = hostedMarkets.filter(
    (market) => market.status === "HOST_TIMEOUT" || market.resolutionStatus === "HOST_TIMEOUT"
  );
  const cutoff = now - thresholds.recentTimeoutWindowDays * 24 * 60 * 60 * 1000;
  const recentHostTimeoutMarkets = hostTimeoutMarkets.filter((market) =>
    (market.finalizationAt ?? market.updatedAt).getTime() >= cutoff
  );
  const activeHostedMarkets = hostedMarkets.filter(
    (market) =>
      !["FINALIZED", "OVERTURNED", "CANCELLED", "HOST_TIMEOUT"].includes(market.resolutionStatus) &&
      !["REJECTED", "CANCELLED", "HOST_TIMEOUT", "RESOLVED"].includes(market.status)
  );
  const moderationViolationCount = hostedMarkets.filter((market) => market.isFlagged || market.status === "REJECTED").length;
  const challengeCount = hostedMarkets.reduce((sum, market) => sum + (market.challenges?.length ?? 0), 0);
  const upheldChallengesCount = hostedMarkets.reduce(
    (sum, market) => sum + (market.challenges?.filter((challenge) => challenge.status === "UPHELD").length ?? 0),
    0
  );
  const cleanFinalizationCount = validFinalizedHostedMarkets.filter(
    (market) => (market.challenges?.length ?? 0) === 0
  ).length;
  const upheldAfterChallengeCount = validFinalizedHostedMarkets.filter(
    (market) => (market.challenges?.length ?? 0) > 0
  ).length;
  const avgParticipantsPerHostedMarket =
    validFinalizedHostedMarkets.length === 0
      ? 0
      : validFinalizedHostedMarkets.reduce((sum, market) => sum + market.totalParticipants, 0) /
        validFinalizedHostedMarkets.length;
  const avgPoolPerHostedMarket =
    validFinalizedHostedMarkets.length === 0
      ? 0
      : validFinalizedHostedMarkets.reduce((sum, market) => sum + market.totalVolume, 0) /
        validFinalizedHostedMarkets.length;
  const repeatJoinRate = calculateRepeatJoinRate(validFinalizedHostedMarkets);
  const avgHostCommissionBps =
    hostedMarkets.length === 0
      ? 0
      : hostedMarkets.reduce((sum, market) => sum + market.hostCommissionBps, 0) / hostedMarkets.length;
  const cleanStreakCount = calculateCleanStreakCount(hostedMarkets);
  const benchmarks = input.platformBenchmarks ?? buildHostPlatformBenchmarks(hostedMarkets);
  const participationBonus = getParticipationBonus(avgParticipantsPerHostedMarket, benchmarks.medianParticipants);
  const poolBonus = getPoolBonus(avgPoolPerHostedMarket, benchmarks.medianPool);
  const repeatJoinBonus = getRepeatJoinBonus(repeatJoinRate);
  const feeFairnessBonus = getFeeFairnessBonus({
    avgHostCommissionBps,
    repeatJoinRate
  });
  const consistencyBonus = getConsistencyBonus(cleanStreakCount);

  const hostTrustScore = Math.max(
    0,
    Math.min(
      100,
      30 +
        Math.min(validFinalizedHostedMarkets.length * 10, 30) +
        cleanFinalizationCount * 5 +
        upheldAfterChallengeCount * 3 +
        participationBonus +
        poolBonus +
        repeatJoinBonus +
        feeFairnessBonus +
        consistencyBonus -
        hostTimeoutMarkets.length * 15 -
        overturnedHostedMarkets.length * 20 -
        moderationViolationCount * 10
    )
  );

  const hostingLimit = hostTrustScore >= 85 ? 5 : hostTrustScore >= 70 ? 3 : 2;
  const publicHostingEligibility =
    accountAgeDays >= thresholds.minAccountAgeDays &&
    validFinalizedHostedMarkets.length >= thresholds.minValidFinalizedMarkets &&
    hostTrustScore >= thresholds.minTrustScore &&
    recentHostTimeoutMarkets.length <= thresholds.maxRecentTimeoutCount &&
    overturnedHostedMarkets.length <= thresholds.maxOverturnedCount &&
    !(input.stats?.hostingSuspendedUntil && input.stats.hostingSuspendedUntil > new Date()) &&
    activeHostedMarkets.length < hostingLimit;

  return {
    accountAgeDays,
    hostedMarketsCount: hostedMarkets.length,
    finalizedHostedMarketsCount: finalizedHostedMarkets.length,
    validFinalizedHostedMarketsCount: validFinalizedHostedMarkets.length,
    cleanFinalizationCount,
    upheldAfterChallengeCount,
    hostTimeoutCount: hostTimeoutMarkets.length,
    recentHostTimeoutCount: recentHostTimeoutMarkets.length,
    overturnedHostedMarketsCount: overturnedHostedMarkets.length,
    moderationViolationCount,
    challengeCount,
    upheldChallengesCount,
    successfulResolutionsCount: finalizedHostedMarkets.length,
    avgParticipantsPerHostedMarket,
    avgPoolPerHostedMarket,
    repeatJoinRate,
    avgHostCommissionBps,
    cleanStreakCount,
    participationBonus,
    poolBonus,
    repeatJoinBonus,
    feeFairnessBonus,
    consistencyBonus,
    hostTrustScore,
    reversalRate: finalizedHostedMarkets.length === 0 ? 0 : overturnedHostedMarkets.length / finalizedHostedMarkets.length,
    hostingLimit,
    currentActiveHostedMarketsCount: activeHostedMarkets.length,
    publicHostingEligibility,
    progress: {
      accountAgeDays: {
        current: Math.floor(accountAgeDays),
        target: thresholds.minAccountAgeDays
      },
      validFinalizedHostedMarkets: {
        current: validFinalizedHostedMarkets.length,
        target: thresholds.minValidFinalizedMarkets
      },
      hostTrustScore: {
        current: hostTrustScore,
        target: thresholds.minTrustScore
      },
      recentHostTimeoutCount: {
        current: recentHostTimeoutMarkets.length,
        target: thresholds.maxRecentTimeoutCount
      },
      overturnedHostedMarketsCount: {
        current: overturnedHostedMarkets.length,
        target: thresholds.maxOverturnedCount
      }
    }
  };
}

export function evaluateHostEligibility(input: {
  user: Pick<User, "role" | "createdAt">;
  stats:
    | Pick<
        UserStat,
        | "hostTrustScore"
        | "validFinalizedHostedMarketsCount"
        | "overturnedHostedMarketsCount"
        | "recentHostTimeoutCount"
        | "publicHostingEligibility"
        | "hostingLimit"
        | "currentActiveHostedMarketsCount"
        | "hostingSuspendedUntil"
      >
    | null;
}) {
  const thresholds = getHostEligibilityThresholds();
  const accountAgeDays = (Date.now() - input.user.createdAt.getTime()) / (1000 * 60 * 60 * 24);

  if (input.user.role === "ADMIN" || input.user.role === "MODERATOR") {
    return {
      eligible: true,
      hostTrustScore: input.stats?.hostTrustScore ?? 100,
      validFinalizedHostedMarketsCount: input.stats?.validFinalizedHostedMarketsCount ?? 0,
      accountAgeDays,
      reasonCodes: [] as string[],
      progress: {
        accountAgeDays: {
          current: Math.floor(accountAgeDays),
          target: thresholds.minAccountAgeDays
        },
        validFinalizedHostedMarkets: {
          current: input.stats?.validFinalizedHostedMarketsCount ?? 0,
          target: thresholds.minValidFinalizedMarkets
        },
        hostTrustScore: {
          current: input.stats?.hostTrustScore ?? 100,
          target: thresholds.minTrustScore
        },
        recentHostTimeoutCount: {
          current: input.stats?.recentHostTimeoutCount ?? 0,
          target: thresholds.maxRecentTimeoutCount
        },
        overturnedHostedMarketsCount: {
          current: input.stats?.overturnedHostedMarketsCount ?? 0,
          target: thresholds.maxOverturnedCount
        }
      }
    };
  }

  const reasonCodes: string[] = [];

  if (accountAgeDays < thresholds.minAccountAgeDays) {
    reasonCodes.push("account_age");
  }

  if ((input.stats?.validFinalizedHostedMarketsCount ?? 0) < thresholds.minValidFinalizedMarkets) {
    reasonCodes.push("valid_finalized_hosted_markets");
  }

  if ((input.stats?.hostTrustScore ?? 0) < thresholds.minTrustScore) {
    reasonCodes.push("host_trust_score");
  }

  if ((input.stats?.recentHostTimeoutCount ?? 0) > thresholds.maxRecentTimeoutCount) {
    reasonCodes.push("recent_host_timeouts");
  }

  if ((input.stats?.overturnedHostedMarketsCount ?? 0) > thresholds.maxOverturnedCount) {
    reasonCodes.push("overturned_markets");
  }

  if (input.stats?.hostingSuspendedUntil && input.stats.hostingSuspendedUntil > new Date()) {
    reasonCodes.push("hosting_suspension");
  }

  if (input.stats && !input.stats.publicHostingEligibility) {
    reasonCodes.push("eligibility_not_met");
  }

  return {
    eligible: reasonCodes.length === 0,
    hostTrustScore: input.stats?.hostTrustScore ?? 0,
    validFinalizedHostedMarketsCount: input.stats?.validFinalizedHostedMarketsCount ?? 0,
    accountAgeDays,
    reasonCodes,
    progress: {
      accountAgeDays: {
        current: Math.floor(accountAgeDays),
        target: thresholds.minAccountAgeDays
      },
      validFinalizedHostedMarkets: {
        current: input.stats?.validFinalizedHostedMarketsCount ?? 0,
        target: thresholds.minValidFinalizedMarkets
      },
      hostTrustScore: {
        current: input.stats?.hostTrustScore ?? 0,
        target: thresholds.minTrustScore
      },
      recentHostTimeoutCount: {
        current: input.stats?.recentHostTimeoutCount ?? 0,
        target: thresholds.maxRecentTimeoutCount
      },
      overturnedHostedMarketsCount: {
        current: input.stats?.overturnedHostedMarketsCount ?? 0,
        target: thresholds.maxOverturnedCount
      }
    }
  };
}
