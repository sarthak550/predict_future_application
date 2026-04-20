import {
  type PoolRewardMode,
  type MarketVisibility,
  type ResolutionMode,
  type User,
  type UserStat
} from "@prisma/client";

import { evaluateHostEligibility } from "../hosts/trust";

function getNumberEnv(name: string, fallback: number) {
  const value = Number(process.env[name] ?? fallback);
  return Number.isFinite(value) ? value : fallback;
}

function getCsvNumberEnv(name: string, fallback: number[]) {
  const raw = process.env[name];
  if (!raw) {
    return fallback;
  }

  const parsed = raw
    .split(",")
    .map((chunk) => Number(chunk.trim()))
    .filter((value) => Number.isFinite(value))
    .map((value) => Math.max(0, Math.floor(value)));

  return parsed.length > 0 ? parsed : fallback;
}

export function normalizeResolutionMode(mode: ResolutionMode) {
  if (mode === "SOURCE_BASED") {
    return "VERIFIED" as const;
  }

  if (mode === "HOST_RESOLVED") {
    return "HOST" as const;
  }

  return mode;
}

export function isVerifiedResolutionMode(mode: ResolutionMode) {
  return normalizeResolutionMode(mode) === "VERIFIED";
}

export function isTrustedHostResolutionMode(mode: ResolutionMode) {
  return normalizeResolutionMode(mode) === "TRUSTED_HOST";
}

export function isHostResolvedMode(mode: ResolutionMode) {
  const normalized = normalizeResolutionMode(mode);
  return normalized === "HOST" || normalized === "TRUSTED_HOST";
}

export function canCreatorParticipateInMarket(mode: ResolutionMode) {
  return !isHostResolvedMode(mode);
}

export function getPoolRewardModeOptions() {
  return ["COMMISSION_BASED", "BOND_BASED"] as const satisfies readonly PoolRewardMode[];
}

export function getDefaultPoolRewardMode() {
  return "COMMISSION_BASED" as const satisfies PoolRewardMode;
}

export function normalizePoolRewardMode(input?: PoolRewardMode | null) {
  return input === "BOND_BASED" ? "BOND_BASED" : getDefaultPoolRewardMode();
}

export function getFixedTrustedHostCommissionBps() {
  return Math.max(0, getNumberEnv("TRUSTED_HOST_FIXED_COMMISSION_BPS", 200));
}

export function getPrivateHostCommissionPresets() {
  return Array.from(new Set(getCsvNumberEnv("PRIVATE_HOST_COMMISSION_PRESETS_BPS", [0, 200, 500]))).sort(
    (left, right) => left - right
  );
}

export function isAllowedPrivateHostCommissionBps(value: number) {
  return getPrivateHostCommissionPresets().includes(Math.max(0, Math.floor(value)));
}

export function getTrustedHostChallengeWindowHours() {
  return Math.max(1, getNumberEnv("TRUSTED_HOST_CHALLENGE_WINDOW_HOURS", 12));
}

export function getPrivateHostChallengeWindowOptions() {
  return Array.from(new Set(getCsvNumberEnv("PRIVATE_HOST_CHALLENGE_WINDOW_OPTIONS_HOURS", [6, 12, 24]))).sort(
    (left, right) => left - right
  );
}

export function getDefaultPrivateHostChallengeWindowHours() {
  return getPrivateHostChallengeWindowOptions()[0] ?? 12;
}

export function getMaxGracePeriodHours() {
  return Math.max(1, getNumberEnv("HOST_MAX_GRACE_PERIOD_HOURS", 48));
}

export function getDefaultGracePeriodHours() {
  return Math.min(getMaxGracePeriodHours(), Math.max(1, getNumberEnv("HOST_DEFAULT_GRACE_PERIOD_HOURS", 48)));
}

export function getDefaultTrustedHostBondCapAmount() {
  return Math.max(0, getNumberEnv("TRUSTED_HOST_DEFAULT_BOND_CAP", 500));
}

export function getMinimumHostBondCapAmount() {
  return Math.max(0, getNumberEnv("HOST_MINIMUM_BOND_CAP", 100));
}

export function normalizeHostCommissionBps(input: {
  visibility: MarketVisibility;
  resolutionMode: ResolutionMode;
  poolRewardMode: PoolRewardMode;
  requestedCommissionBps?: number | null;
}) {
  if (input.poolRewardMode === "BOND_BASED") {
    return 0;
  }

  const normalizedMode = normalizeResolutionMode(input.resolutionMode);
  if (normalizedMode === "TRUSTED_HOST") {
    return getFixedTrustedHostCommissionBps();
  }

  if (normalizedMode === "HOST") {
    const requested = Math.max(0, Math.floor(input.requestedCommissionBps ?? 0));
    if (isAllowedPrivateHostCommissionBps(requested)) {
      return requested;
    }

    return 0;
  }

  return 0;
}

export function normalizeChallengeWindowHours(input: {
  visibility: MarketVisibility;
  resolutionMode: ResolutionMode;
  requestedChallengeWindowHours?: number | null;
}) {
  const normalizedMode = normalizeResolutionMode(input.resolutionMode);
  if (normalizedMode === "TRUSTED_HOST") {
    return getTrustedHostChallengeWindowHours();
  }

  if (normalizedMode === "HOST") {
    const requested = Math.max(1, Math.floor(input.requestedChallengeWindowHours ?? getDefaultPrivateHostChallengeWindowHours()));
    return getPrivateHostChallengeWindowOptions().includes(requested)
      ? requested
      : getDefaultPrivateHostChallengeWindowHours();
  }

  return Math.max(1, Math.floor(input.requestedChallengeWindowHours ?? 24));
}

export function normalizeGracePeriodHours(requestedGracePeriodHours?: number | null) {
  return Math.max(1, Math.min(getMaxGracePeriodHours(), Math.floor(requestedGracePeriodHours ?? getDefaultGracePeriodHours())));
}

export function calculateRequiredBondForPool(input: {
  poolRewardMode: PoolRewardMode;
  commissionBps: number;
  bondCap: number;
  totalPool: number;
}) {
  if (input.poolRewardMode === "BOND_BASED") {
    return Math.max(0, input.bondCap);
  }

  if (input.commissionBps <= 0 || input.totalPool <= 0) {
    return 0;
  }

  return Math.ceil((input.totalPool * input.commissionBps) / 10_000);
}

export function calculateMaxPoolAllowed(input: {
  poolRewardMode: PoolRewardMode;
  commissionBps: number;
  bondCap: number;
}) {
  if (input.poolRewardMode === "BOND_BASED") {
    return null;
  }

  if (input.commissionBps <= 0) {
    return null;
  }

  if (input.bondCap <= 0) {
    return 0;
  }

  return Math.floor((input.bondCap * 10_000) / input.commissionBps);
}

export function calculateBondMetrics(input: {
  poolRewardMode: PoolRewardMode;
  commissionBps: number;
  bondCap: number;
  totalPool: number;
}) {
  const currentRequiredBond = calculateRequiredBondForPool({
    poolRewardMode: input.poolRewardMode,
    commissionBps: input.commissionBps,
    bondCap: input.bondCap,
    totalPool: input.totalPool
  });
  const maxPoolAllowed = calculateMaxPoolAllowed({
    poolRewardMode: input.poolRewardMode,
    commissionBps: input.commissionBps,
    bondCap: input.bondCap
  });

  return {
    currentRequiredBond,
    maxPoolAllowed
  };
}

export function supportsProjectedPool(input: {
  poolRewardMode: PoolRewardMode;
  commissionBps: number;
  bondCap: number;
  projectedPool: number;
}) {
  const maxPoolAllowed = calculateMaxPoolAllowed(input);
  if (maxPoolAllowed === null) {
    return true;
  }

  return input.projectedPool <= maxPoolAllowed;
}

export function calculateBondBasedHostReward(input: {
  bondCap: number;
  totalPool: number;
}) {
  if (input.bondCap <= 0) {
    return 0;
  }

  return input.bondCap;
}

export function calculateHostReward(input: {
  poolRewardMode: PoolRewardMode;
  commissionBps: number;
  grossPool: number;
  losingPool: number;
  bondCap: number;
}) {
  if (input.poolRewardMode === "BOND_BASED") {
    return {
      amount: calculateBondBasedHostReward({
        bondCap: input.bondCap,
        totalPool: input.grossPool
      }),
      source: "bond" as const
    };
  }

  const rawCommission = input.commissionBps > 0 ? Math.floor((input.grossPool * input.commissionBps) / 10_000) : 0;
  return {
    amount: Math.min(rawCommission, input.losingPool),
    source: "commission" as const
  };
}

export function evaluateTrustedHostEligibility(input: {
  user: Pick<User, "role" | "createdAt" | "reputationScore">;
  stats: Pick<
    UserStat,
    | "hostTrustScore"
    | "validFinalizedHostedMarketsCount"
    | "overturnedHostedMarketsCount"
    | "recentHostTimeoutCount"
    | "publicHostingEligibility"
    | "hostingLimit"
    | "currentActiveHostedMarketsCount"
    | "hostingSuspendedUntil"
  > | null;
}) {
  const fixedCommissionBps = getFixedTrustedHostCommissionBps();
  const challengeWindowHours = getTrustedHostChallengeWindowHours();
  const defaultBondCap = getDefaultTrustedHostBondCapAmount();
  const privateCommissionPresets = getPrivateHostCommissionPresets();
  const privateChallengeWindowOptions = getPrivateHostChallengeWindowOptions();
  const maxGracePeriodHours = getMaxGracePeriodHours();
  if (input.user.role === "ADMIN" || input.user.role === "MODERATOR") {
    return {
      eligible: true,
      reasons: [] as string[],
      hostTrustScore: input.stats?.hostTrustScore ?? 100,
      validFinalizedHostedMarketsCount: input.stats?.validFinalizedHostedMarketsCount ?? 0,
      accountAgeDays: (Date.now() - input.user.createdAt.getTime()) / (1000 * 60 * 60 * 24),
      progress: {
        accountAgeDays: {
          current: Math.floor((Date.now() - input.user.createdAt.getTime()) / (1000 * 60 * 60 * 24)),
          target: getNumberEnv("TRUSTED_HOST_MIN_ACCOUNT_AGE_DAYS", 14)
        },
        validFinalizedHostedMarkets: {
          current: input.stats?.validFinalizedHostedMarketsCount ?? 0,
          target: getNumberEnv("TRUSTED_HOST_MIN_VALID_FINALIZED_MARKETS", 2)
        },
        hostTrustScore: {
          current: input.stats?.hostTrustScore ?? 100,
          target: getNumberEnv("TRUSTED_HOST_MIN_TRUST_SCORE", 55)
        },
        recentHostTimeoutCount: {
          current: input.stats?.recentHostTimeoutCount ?? 0,
          target: getNumberEnv("TRUSTED_HOST_MAX_RECENT_TIMEOUTS", 1)
        },
        overturnedHostedMarketsCount: {
          current: input.stats?.overturnedHostedMarketsCount ?? 0,
          target: getNumberEnv("TRUSTED_HOST_MAX_OVERTURNED_MARKETS", 1)
        }
      },
      hostingLimit: input.stats?.hostingLimit ?? 10,
      challengeWindowHours,
      fixedCommissionBps,
      defaultBondCap,
      privateCommissionPresets,
      privateChallengeWindowOptions,
      maxGracePeriodHours
    };
  }

  const trustEligibility = evaluateHostEligibility({
    user: {
      role: input.user.role,
      createdAt: input.user.createdAt
    },
    stats: input.stats
  });
  const reasons: string[] = [];
  const minReputationScore = getNumberEnv("TRUSTED_HOST_MIN_REPUTATION_SCORE", 65);

  if (input.user.reputationScore < minReputationScore) {
    reasons.push(`Reputation score must be at least ${minReputationScore}.`);
  }

  if (trustEligibility.reasonCodes.includes("account_age")) {
    reasons.push("Account must be at least 14 days old.");
  }

  if (trustEligibility.reasonCodes.includes("valid_finalized_hosted_markets")) {
    reasons.push("Need at least 2 valid finalized hosted markets.");
  }

  if (trustEligibility.reasonCodes.includes("host_trust_score")) {
    reasons.push("Host trust score is below the trusted-host requirement.");
  }

  if (trustEligibility.reasonCodes.includes("recent_host_timeouts")) {
    reasons.push("Recent host timeouts are too high.");
  }

  if (trustEligibility.reasonCodes.includes("overturned_markets")) {
    reasons.push("Too many overturned hosted markets.");
  }

  if (trustEligibility.reasonCodes.includes("hosting_suspension")) {
    reasons.push("Public hosting is currently suspended for this account.");
  }

  if (
    input.stats?.hostingLimit !== undefined &&
    input.stats.currentActiveHostedMarketsCount >= input.stats.hostingLimit
  ) {
    reasons.push(`Hosting limit reached (${input.stats.hostingLimit} active hosted markets).`);
  }

  return {
    eligible: reasons.length === 0,
    reasons,
    hostTrustScore: trustEligibility.hostTrustScore,
    validFinalizedHostedMarketsCount: trustEligibility.validFinalizedHostedMarketsCount,
    accountAgeDays: trustEligibility.accountAgeDays,
    progress: trustEligibility.progress,
    hostingLimit: input.stats?.hostingLimit ?? getNumberEnv("TRUSTED_HOST_DEFAULT_HOSTING_LIMIT", 2),
    challengeWindowHours,
    fixedCommissionBps,
    defaultBondCap,
    privateCommissionPresets,
    privateChallengeWindowOptions,
    maxGracePeriodHours
  };
}
