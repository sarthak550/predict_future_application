export type AppMarketCategory =
  | "GENERAL"
  | "SPORTS"
  | "BUSINESS"
  | "TECH"
  | "WEATHER"
  | "ENTERTAINMENT"
  | "PRODUCT"
  | "COMPANY";

export type AppMarketStatus =
  | "DRAFT"
  | "PENDING_REVIEW"
  | "OPEN"
  | "CLOSED"
  | "AWAITING_RESOLUTION"
  | "RESOLVING"
  | "RESOLVED"
  | "REJECTED"
  | "CANCELLED"
  | "HOST_TIMEOUT";

export type AppMarketVisibility = "PUBLIC" | "PRIVATE";
export type AppMarketType = "BINARY" | "NUMERIC";
export type AppResolutionMode = "VERIFIED" | "TRUSTED_HOST" | "HOST" | "GROUP_VOTE";
export type AppResolutionStatus =
  | "OPEN"
  | "CLOSED"
  | "AWAITING_RESOLUTION"
  | "RESOLVED_PENDING_CHALLENGE"
  | "DISPUTED"
  | "FINALIZED"
  | "OVERTURNED"
  | "CANCELLED"
  | "HOST_TIMEOUT";
export type AppPositionSide = "YES" | "NO";

export type ApiCursorPage<T> = {
  items: T[];
  nextCursor: string | null;
  hasMore: boolean;
};

export type ApiNewsItem = {
  id: string;
  title: string;
  summary: string;
  sourceName: string;
  sourceUrl: string;
  imageUrl: string | null;
  category: AppMarketCategory;
  publishedAt: string;
  ingestedAt: string;
  status?: string;
};

export type ApiNewsFeedItem = {
  id: string;
  slug: string;
  headline: string;
  summary: string;
  category: AppMarketCategory;
  sourceName: string;
  sourceUrl: string;
  imageUrl: string | null;
  publishedAt: string;
  ingestedAt: string;
  isFeatured: boolean;
  isTrending: boolean;
  market: ApiMarketSummary | null;
};

export type ApiMarketSummary = {
  id: string;
  slug?: string;
  title: string;
  description?: string | null;
  category?: AppMarketCategory;
  status: AppMarketStatus;
  visibility?: AppMarketVisibility;
  marketType?: AppMarketType;
  resolutionMode?: AppResolutionMode;
  resolutionStatus?: AppResolutionStatus;
  poolRewardMode?: "COMMISSION_BASED" | "BOND_BASED";
  hostCommissionBps?: number | null;
  bondCap?: number | null;
  lockedBondAmount?: number | null;
  maxPoolAllowed?: number | null;
  closeAt?: string;
  resolveAt?: string;
  finalResolutionDeadline?: string | null;
  challengeWindowEndsAt?: string | null;
  yesPool?: number;
  noPool?: number;
  totalVolume?: number;
  totalParticipants?: number;
  marketRankScore?: number;
  creator?: {
    username: string;
    reputationScore?: number;
    stats?: {
      hostTrustScore?: number;
      cleanStreakCount?: number;
      recentHostTimeoutCount?: number;
      overturnedHostedMarketsCount?: number;
      publicHostingEligibility?: boolean;
    } | null;
  };
  _count?: {
    comments?: number;
  };
};

export type ApiMarketComment = {
  id: string;
  body: string;
  createdAt: string;
  user: {
    username: string;
  };
};

export type ApiMarketDetailMarket = ApiMarketSummary & {
  rulesText?: string | null;
  resolutionRuleText?: string | null;
  resolutionSourceName?: string | null;
  resolutionSourceUrl?: string | null;
  resolutionStatus?: AppResolutionStatus;
  resolvedAt?: string | null;
  winningSide?: AppPositionSide | null;
  group?: {
    ownerId: string;
    memberships?: Array<{ userId: string }>;
  } | null;
  comments?: ApiMarketComment[];
  resolution?: Record<string, unknown> | null;
};

export type ApiMarketDetail = {
  market: ApiMarketDetailMarket;
};

export type ApiHostEligibility = {
  eligible: boolean;
  reasons: string[];
  progress: {
    accountAgeDays: number;
    minAccountAgeDays: number;
    validFinalizedHostedMarketsCount: number;
    minValidFinalizedMarkets: number;
    hostTrustScore: number;
    minTrustScore: number;
    recentHostTimeoutCount: number;
    maxRecentTimeoutCount: number;
    overturnedHostedMarketsCount: number;
    maxOverturnedCount: number;
  };
};

export type ApiHostStats = {
  userId: string;
  username: string;
  hostStats: {
    hostTrustScore: number;
    validFinalizedHostedMarketsCount: number;
    hostedMarketsCount: number;
    finalizedHostedMarketsCount: number;
    cleanFinalizationCount: number;
    upheldAfterChallengeCount: number;
    hostTimeoutCount: number;
    overturnedHostedMarketsCount: number;
    moderationViolationCount: number;
    avgParticipantsPerHostedMarket: number;
    avgPoolPerHostedMarket: number;
    repeatJoinRate: number;
    avgHostCommissionBps: number;
    cleanStreakCount: number;
    publicHostingEligibility: boolean;
    hostingLimit: number;
  } | null;
};

export type ApiGroupSummary = {
  id: string;
  name: string;
  slug?: string;
  inviteCode?: string;
  description?: string | null;
};

export type ApiGroupDetail = {
  group: Record<string, unknown>;
};
