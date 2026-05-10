export type AppLeagueTier =
  | "BRONZE"
  | "SILVER"
  | "GOLD"
  | "PLATINUM"
  | "DIAMOND";

/**
 * Controls whether a user's identity is shown as their real username or a
 * deterministic anonymous pseudonym ("AnonymousAnalyst_XXXXXX") on all
 * public-facing surfaces. Accuracy, league points, and quests accrue to the
 * real userId regardless of this setting.
 */
export type AppUserDisplayMode = "USERNAME" | "ANONYMOUS";

export type ApiLeagueEntry = {
  month: string;        // 'YYYY-MM'
  tier: AppLeagueTier;
  netPointsMonth: number;
  rank: number | null;
};

/** One entry in a paginated tier standings response. */
export type ApiLeagueTierStandingEntry = {
  rank: number | null;
  userId: string;
  username: string;
  netPointsMonth: number;
};

/** Paginated response for GET /api/leagues/standings. */
export type ApiLeagueStandingsPage = {
  tier: AppLeagueTier;
  month: string;
  entries: ApiLeagueTierStandingEntry[];
  nextCursor: string | null;
};

export type AppMarketCategory =
  | "GENERAL"
  | "SPORTS"
  | "BUSINESS"
  | "TECH"
  | "WEATHER"
  | "ENTERTAINMENT"
  | "PRODUCT"
  | "COMPANY"
  | "FINANCE";

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
export type AppMarketType = "BINARY" | "NUMERIC" | "MULTIPLE_CHOICE";

export type ApiMarketOption = {
  id: string;
  label: string;
  sortOrder: number;
  totalStaked: number;
  isWinner: boolean;
};
export type AppResolutionMode = "TRUSTED_HOST" | "HOST" | "GROUP_VOTE";
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

export type ApiExpertOpinionItem = {
  id: string;
  expertId: string;
  expertName: string;
  expertOrganization: string;
  avatarUrl?: string | null;
  verified?: boolean;
  quote: string;
  direction: "BULLISH" | "BEARISH" | "NEUTRAL";
  sourceUrl: string;
  resolutionStatus: "PENDING" | "RESOLVED_HIT" | "RESOLVED_MISS" | "NOT_GRADED";
  resolvedAt?: string | null;
  /** Nullable FK to a MarketEventCluster (S18-T4) */
  eventClusterId?: string | null;
  /** True when sourced from a trusted publication (no named analyst) — display as "Market Analysis" instead of "Expert Opinion" */
  isSourceAttribution?: boolean;
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
  poll: ApiPollSummary | null;
  expertOpinions?: ApiExpertOpinionItem[];
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
  unit?: string | null;
  minValue?: number | null;
  maxValue?: number | null;
  precision?: number | null;
  averageNumericValue?: number | null;
  yesCount?: number;
  noCount?: number;
  totalVotes?: number;
  creator?: {
    username: string;
    reputationScore?: number;
    isVerifiedAnalyst?: boolean;
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
  /** Populated for MULTIPLE_CHOICE markets */
  options?: ApiMarketOption[];
  winningOptionId?: string | null;
  /** Populated on market detail responses for authenticated users of MULTIPLE_CHOICE markets */
  userMultiChoicePositions?: Array<{ optionId: string; amount: number }>;
  /** Non-null for markets imported from external platforms (e.g. 'manifold'). */
  originPlatform?: string | null;
  /** Canonical source URL — set on imported markets; used for attribution badge link. */
  resolutionSourceUrl?: string | null;
};

/**
 * Commenter's active position on the market this comment belongs to.
 * Discriminated union by `kind`:
 *   - 'binary'      → side (YES|NO) + amount
 *   - 'multi-choice' → optionId + optionLabel + amount
 *   - 'numeric'     → value (predicted float) + amount
 */
export type ApiCommenterPosition =
  | { kind: 'binary'; side: 'YES' | 'NO'; amount: number }
  | { kind: 'multi-choice'; optionId: string; optionLabel: string; amount: number }
  | { kind: 'numeric'; value: number; amount: number };

export type ApiMarketComment = {
  id: string;
  /** The comment text. Wire field name: "content". */
  content: string;
  createdAt: string;
  /** Lifetime tip points received on this comment (S26-T2). */
  tipsReceived: number;
  user: {
    id: string;
    /** Display name — pseudonym when displayMode=ANONYMOUS, real username otherwise. */
    username: string;
    isVerifiedAnalyst: boolean;
  };
  /** Present when the commenter holds an active position on this market (S26-T1). */
  commenterPosition?: ApiCommenterPosition | null;
};

export type ApiMarketDetailMarket = ApiMarketSummary & {
  storyId?: string | null;
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
  resolution?: {
    rationale: string;
    resolvedBy: { username: string } | null;
    createdAt: string;
    wasOverturned: boolean;
  } | null;
};

export type ApiMarketDetail = {
  market: ApiMarketDetailMarket;
  /** Percentile rank for the authenticated user on this market (only set when market is RESOLVED and user won). */
  userPercentileRank?: number | null;
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

// --- Sports types ---

export type ApiTeamDetail = {
  name: string;
  abbreviation: string;
  logo: string;
  score: string;
  record?: string;
  linescores?: string[];
};

export type ApiLiveScore = {
  id: string;
  sport: string;
  league: string;
  status: "pre" | "in" | "post";
  statusDetail: string;
  shortDetail: string;
  startTime: string;
  venue?: string;
  venueCity?: string;
  statusSummary?: string;
  broadcast?: string;
  homeTeam: ApiTeamDetail;
  awayTeam: ApiTeamDetail;
};

// ---- Cricket match detail types ----

export type ApiCricketBatter = {
  name: string;
  runs: number;
  balls: number;
  fours: number;
  sixes: number;
  strikeRate: string;
  dismissal: string;
  isNotOut: boolean;
};

export type ApiCricketBowler = {
  name: string;
  overs: string;
  maidens: number;
  runs: number;
  wickets: number;
  economy: string;
};

export type ApiCricketFow = {
  wicketNum: number;
  runs: number;
  overs: string;
  batter?: string;
};

export type ApiCricketPartnership = {
  wicketNum: number;
  runs: number;
  batsmen: Array<{ name: string; runs: number; balls: number }>;
};

export type ApiCricketInnings = {
  teamAbbr: string;
  score: string;
  runRate?: string;
  batting: ApiCricketBatter[];
  bowling: ApiCricketBowler[];
  fow: ApiCricketFow[];
  partnerships: ApiCricketPartnership[];
  extras: {
    total: number;
    wides: number;
    noBalls: number;
    byes: number;
    legByes: number;
  };
};

export type ApiCricketTeamDetail = {
  name: string;
  abbreviation: string;
  logo: string;
  score: string;
};

export type ApiCricketMatchDetail = {
  homeTeam: ApiCricketTeamDetail;
  awayTeam: ApiCricketTeamDetail;
  innings: ApiCricketInnings[];
  statusSummary?: string;
  statusDetail?: string;
  toss?: string;
  venue?: string;
  venueCity?: string;
  umpires: string[];
};

// ---- Football match detail types ----

export type ApiFootballTeamDetail = {
  name: string;
  abbreviation: string;
  logo: string;
  score: string;
};

export type ApiFootballEvent = {
  type: "goal" | "yellow" | "red" | "sub" | string;
  player: string;
  team: string;
  minute?: string;
};

export type ApiFootballStat = {
  name: string;
  home: string;
  away: string;
};

export type ApiFootballPlayer = {
  name: string;
  jersey: string;
  position: string;
};

export type ApiFootballLineup = {
  formation?: string;
  starters: ApiFootballPlayer[];
  subs: ApiFootballPlayer[];
};

export type ApiFootballMatchDetail = {
  homeTeam: ApiFootballTeamDetail;
  awayTeam: ApiFootballTeamDetail;
  clock?: string;
  statusDetail?: string;
  venue?: string;
  attendance?: string;
  referee?: string;
  events: ApiFootballEvent[];
  stats: ApiFootballStat[];
  homeLineup: ApiFootballLineup;
  awayLineup: ApiFootballLineup;
};

// --- Poll / Vote types (used by news feed polls) ---

export type AppVoteSide = "YES" | "NO";

export type ApiVote = {
  id: string;
  side: AppVoteSide | null;
  numericValue: number | null;
  createdAt: string;
};

export type ApiLeaderboardTimeWindow = "week" | "month" | "all";

export type ApiLeaderboardEntry = {
  id: string;
  /** Display name — pseudonym when displayMode=ANONYMOUS, real username otherwise. */
  username: string;
  reputationScore: number;
  accuracyScore: number;
  isVerifiedAnalyst: boolean;
  followerCount: number;
  totalPredictions?: number;
  totalNetPoints?: number;
  stats?: {
    totalPredictions?: number;
    totalNetPoints?: number;
  } | null;
};

export type ApiLeaderboardUserContext = {
  rank: number;
  score: number;
  targetUsername: string | null;
  targetRank: number | null;
  targetScore: number | null;
  gap: number | null;
  gapUnit: "rep" | "accuracy";
};

export type ApiLeaderboardResponse = {
  entries: ApiLeaderboardEntry[];
  userRank: number | null;
  userContext: ApiLeaderboardUserContext | null;
};

export type ApiBadge = {
  id: string;
  name: string;
  description?: string;
  earnedAt?: string;
};

export type ApiCategoryStat = {
  category: AppMarketCategory;
  accuracyScore: number;
  totalPredictions?: number;
  totalNetPoints?: number;
};

export type ApiPositionSummary = {
  id: string;
  side: AppPositionSide;
  amount: number;
  createdAt: string;
  market: {
    id: string;
    title: string;
    status: AppMarketStatus;
    winningSide?: AppPositionSide | null;
  };
};

export type ApiPredictionSuggestion = {
  title: string;
  category?: AppMarketCategory;
  description?: string;
};

export type ApiPnlSummary = {
  totalStaked: number;
  totalReturned: number;
  netPnl: number;
  resolvedMarketCount: number;
  lastUpdatedAt: string;
};

export type ApiUserProfile = {
  id: string;
  /** Display name — pseudonym when displayMode=ANONYMOUS, real username otherwise. */
  username: string;
  /**
   * The user's current display preference. Present on all profile responses.
   * When ANONYMOUS, username is replaced with the deterministic pseudonym.
   */
  displayMode?: AppUserDisplayMode;
  reputationScore: number;
  accuracyScore: number;
  level?: number;
  streak?: number;
  lastPredictionAt?: string | null;
  /** Whether this analyst has been credentialed by an admin (S25-T2). */
  isVerifiedAnalyst?: boolean;
  /** Whether the user has completed phone verification (S25-T6). */
  phoneVerified?: boolean;
  stats?: {
    totalPredictions?: number;
    totalNetPoints?: number;
    totalVolume?: number;
  } | null;
  wallet?: {
    balance: number;
  } | null;
  badges?: Array<{ badge: ApiBadge }>;
  categoryStats?: ApiCategoryStat[];
  positions?: ApiPositionSummary[];
  createdMarkets?: Array<{
    id: string;
    title: string;
    status: AppMarketStatus;
  }>;
  hostStats?: ApiHostStats["hostStats"];
  /** Social graph counts — present on all profile responses (S24-T2/T3). */
  followerCount?: number;
  followingCount?: number;
  /** Whether the currently-authenticated viewer follows this user. False when unauthenticated. */
  isFollowedByMe?: boolean;
  /** Lifetime tip points received across all comments (S26-T2). */
  tipsReceivedTotal?: number;
};

// ── Phone verification (S25-T6) ───────────────────────────────────────────────

export type ApiPhoneVerifyRequest = {
  phone: string;
};

export type ApiPhoneVerifyResponse = {
  ok: boolean;
  /** Present only in dev mode (PHONE_VERIFY_MODE != "prod"). */
  otp?: string;
};

export type ApiPhoneVerifyConfirmResponse = {
  ok: boolean;
  phoneVerified: boolean;
  bonusCredited: number;
  alreadyVerified?: boolean;
};

export type ApiMyProfile = {
  user: ApiUserProfile;
  pnl?: ApiPnlSummary | null;
  createdPolls: Array<{
    id: string;
    title: string;
    status: AppMarketStatus;
    category: AppMarketCategory;
    yesCount: number;
    noCount: number;
    totalVotes: number;
    closeAt: string;
    createdAt: string;
  }>;
  votes: Array<{
    id: string;
    side: AppVoteSide | null;
    numericValue: number | null;
    createdAt: string;
    market: {
      id: string;
      title: string;
      status: AppMarketStatus;
      category: AppMarketCategory;
      yesCount: number;
      noCount: number;
    };
  }>;
};

export type ApiPollListItem = {
  id: string;
  title: string;
  category: AppMarketCategory;
  status: AppMarketStatus;
  marketType: AppMarketType;
  closeAt: string | null;
  yesCount: number;
  noCount: number;
  totalVotes: number;
  unit: string | null;
  minValue: number | null;
  maxValue: number | null;
  averageNumericValue: number | null;
  storyHeadline: string | null;
  storySummary: string | null;
  storySourceUrl: string | null;
  storySourceName: string | null;
  storyImageUrl: string | null;
  userVote: { side: string | null; numericValue: number | null } | null;
};

export type ApiPollSummary = {
  id: string;
  title: string;
  description?: string | null;
  status: AppMarketStatus;
  marketType?: AppMarketType;
  yesCount: number;
  noCount: number;
  totalVotes: number;
  averageNumericValue?: number | null;
  closeAt?: string | null;
  unit?: string | null;
  minValue?: number | null;
  maxValue?: number | null;
  userVote?: { side?: string | null; numericValue?: number | null } | null;
};

export type ApiNotification = {
  id: string;
  title: string;
  body: string;
  isRead: boolean;
  createdAt: string;
  marketId?: string | null;
  href?: string | null;
  type: "RESOLUTION" | "CHALLENGE" | "GENERAL" | string;
};

// ─── Finance: Expert Opinion Polls ────────────────────────────────────────────

export type ApiExpertOpinionPollType = "IMPLICATION" | "RETROSPECTIVE";

/** Poll A (IMPLICATION) 5-bucket agreement choices (v3). */
export type ApiImplicationChoice =
  | "STRONGLY_DISAGREE"
  | "DISAGREE"
  | "NEUTRAL"
  | "AGREE"
  | "STRONGLY_AGREE";

export type ApiExpertOpinionVoteChoice =
  | ApiImplicationChoice
  | "HIT"
  | "MISS";

export interface ApiExpertOpinionTallies {
  implication: {
    stronglyDisagree: number;
    disagree: number;
    neutral: number;
    agree: number;
    stronglyAgree: number;
    total: number;
    userChoice: ApiImplicationChoice | null;
    /** 0=STRONGLY_DISAGREE, 1=DISAGREE, 2=NEUTRAL, 3=AGREE, 4=STRONGLY_AGREE; null when total === 0 */
    medianBucket: 0 | 1 | 2 | 3 | 4 | null;
  };
  retrospective: {
    hit: number;
    miss: number;
    total: number;
    userChoice: "HIT" | "MISS" | null;
    isLocked: boolean;
    unlockReason: string | null;
  };
}

// ─── Finance: Market Event Clusters ───────────────────────────────────────────

export interface ClusterDataPoint {
  label: string;
  value: string;
  subtext?: string;
  date?: string;
}

export interface ApiMarketEventCluster {
  id: string;
  slug: string;
  name: string;
  description?: string | null;
  startsAt: string; // ISO
  endsAt: string; // ISO
  bannerEmoji?: string | null;
  category: string;
}

// ─── Finance: Expert Profile + Calls ──────────────────────────────────────────

export interface ApiExpertCall {
  id: string;
  quote: string;
  direction: string;
  publishedAt: string;
  resolutionStatus: string;
  resolvedAt?: string | null;
  resolutionNote?: string | null;
  storyId?: string | null;
  storyHeadline?: string | null;
  retrospectiveTallies?: { hit: number; miss: number; total: number };
}

export interface ApiExpertProfile {
  id: string;
  name: string;
  organization: string;
  verified: boolean;
  bio?: string | null;
  avatarUrl?: string | null;
  credibilityScore: number | null;
  provisional: boolean;
  totalOpinions: number;
  resolvedCount: number;
  recentCalls: ApiExpertCall[];
}

export interface ApiExpertLeaderboardEntry {
  rank: number;
  expert: ApiExpertProfile & { hitCount: number; missCount: number };
}

// ─── Finance: Expert Sentiment Aggregate ──────────────────────────────────────

export interface ApiFinanceExpertSentiment {
  bullishCount: number;
  bearishCount: number;
  neutralCount: number;
  totalCount: number;
  /** 0–100, rounded to 1 decimal */
  bullishPercent: number;
  bearishPercent: number;
  neutralPercent: number;
  dominantLean: "BULLISH" | "BEARISH" | "NEUTRAL" | "MIXED";
  samplePeriod: "7d";
}

// ─── Finance: Markets Feed ─────────────────────────────────────────────────────

export interface ApiFinanceSentiment {
  marketId: string;
  marketTitle: string;
  yesPercent: number;
  noPercent: number;
  totalVotes: number;
  leanLabel: "Bullish" | "Bearish" | "Uncertain";
  /** yesPercent from the previous calendar day for the same market, null if no data */
  previousDayScore: number | null;
}

export interface ApiFinanceEventCluster extends ApiMarketEventCluster {
  markets: ApiMarketSummary[];
  dataPoints: ClusterDataPoint[];
  expertTakeCount: number;
}

export interface ApiFinanceMarketsResponse {
  sentimentToday: ApiFinanceSentiment | null;
  eventClusters: ApiFinanceEventCluster[];
  unclusteredMarkets: {
    items: ApiMarketSummary[];
    nextCursor: string | null;
    total: number;
  };
}

// ─── Calibration scorecard ─────────────────────────────────────────────────────

export type ApiCalibrationCategoryBreakdown = {
  category: string;
  totalPredictions: number;
  totalWins: number;
  accuracyScore: number;
  totalNetPoints: number;
};

export type ApiUserCalibration = {
  overallAccuracy: number;
  totalPredictions: number;
  totalWins: number;
  bestStreak: number;
  categoryBreakdown: ApiCalibrationCategoryBreakdown[];
};

export type ApiCategoryTopEntry = {
  rank: number;
  id: string;
  username: string;
  accuracyScore: number;
  totalPredictions: number;
  followerCount: number;
};

export type ApiCategoryTopResponse = {
  category: string;
  entries: ApiCategoryTopEntry[];
};

// ─── Story detail (single story + attached expert opinions) ───────────────────

export interface ApiStoryExpertOpinion extends ApiExpertOpinionItem {
  verified: boolean; // Always present on story detail responses (not optional)
}

export interface ApiStory {
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
  expertOpinions: ApiStoryExpertOpinion[];
}

// ─── Follow system (S24-T2) ───────────────────────────────────────────────────

/** Returned by POST /api/users/[userId]/follow and DELETE /api/users/[userId]/follow */
export type ApiFollowStatus = {
  following: boolean;
};

/** One entry in the followers/following paginated list */
export type ApiFollowerEntry = {
  userId: string;
  username: string;
  avatarUrl: string | null;
  accuracyScore: number;
};

// ─── Daily quests (S24-T4) ────────────────────────────────────────────────────

/** Valid daily quest type identifiers. */
export type AppQuestType = "PREDICT_3" | "PREDICT_5" | "VOTE_ON_POLL" | "CREATE_MARKET";

/**
 * A single daily quest entry as returned by GET /api/quests/today.
 * progress/goal give the raw counts; completed is the definitive flag.
 */
export type ApiDailyQuestEntry = {
  questType: AppQuestType;
  description: string;
  reward: number;
  completed: boolean;
  completedAt: string | null; // ISO datetime, null if not yet completed
  progress: number;
  goal: number;
};

/**
 * Full response shape of GET /api/quests/today.
 */
export type ApiDailyQuests = {
  date: string; // 'YYYY-MM-DD' IST
  quests: ApiDailyQuestEntry[];
  totalEarnedToday: number;
  streak: number; // current win streak from UserStat
};

/**
 * A single quest reward returned inline in bet/vote API responses so the
 * mobile client can show a "Quest complete! +N pts" toast without a refetch.
 */
export type ApiQuestReward = {
  questType: string;
  reward: number;
};

/**
 * Response shape of POST /api/markets/[marketId]/positions.
 */
export type ApiPlacePositionResponse = {
  ok: boolean;
  questRewards: ApiQuestReward[];
};

/**
 * Response shape of GET /api/users/me/referral-code (S24-T6).
 */
export type ApiReferralInfo = {
  referralCode: string;
  referralCount: number;
  totalEarned: number;
};

/**
 * Response shape of GET /api/portfolio/[username] (S26-T4).
 * Public endpoint — no auth required. Cache-Control: public, max-age=120.
 */
export type ApiUserPortfolio = {
  username: string;
  isVerifiedAnalyst: boolean;
  /** Displayed name (username, or pseudonym when anonymous mode is active in a future sprint). */
  displayName: string;
  accuracyScore: number;
  totalPredictions: number;
  totalNetPoints: number;
  bestStreak: number;
  followerCount: number;
  recentResolvedMarkets: Array<{
    id: string;
    title: string;
    outcome: string;
    resolvedAt: string;
    /** The user's own position on this market, if any. */
    userCall: { side: string; amount: number } | null;
  }>;
  openMarkets: Array<{
    id: string;
    title: string;
    /** The user's own position on this market, if any. */
    userCall: { side: string; amount: number } | null;
  }>;
  /** ISO timestamp at which this payload was assembled on the server. */
  generatedAt: string;
};

/**
 * Response shape of GET /api/platform/stats (S25-T1).
 * Public endpoint — no auth required. Cache-Control: public, max-age=600.
 */
export type ApiPlatformStats = {
  /** Count of Market rows where resolutionStatus = FINALIZED. */
  totalResolvedMarkets: number;
  /** Count of users with totalPredictions >= 5. */
  totalActiveAnalysts: number;
  /** Average accuracyScore across UserStat rows with totalPredictions >= 5 (4 decimal places). */
  avgAccuracyScore: number;
  /** Sum of UserStat.totalPredictions across all active analysts. */
  totalPredictions: number;
  /** Category with the highest average accuracy (UserCategoryStat, totalPredictions >= 10). */
  topCategoryByAccuracy: { category: string; avgAccuracy: number } | null;
  /** ISO timestamp when this payload was computed. */
  lastUpdatedAt: string;
};

// ─── Big Call (S27-T1) ────────────────────────────────────────────────────────

/**
 * A Big Call market as returned by GET /api/markets/today-big-call.
 * Extends ApiMarketSummary with Big-Call-specific fields.
 */
export type ApiBigCallMarket = {
  id: string;
  title: string;
  description: string | null;
  category: AppMarketCategory;
  status: AppMarketStatus;
  marketType: AppMarketType;
  yesPool: number;
  noPool: number;
  totalVolume: number;
  totalParticipants: number;
  yesCount: number;
  noCount: number;
  totalVotes: number;
  closeAt: string;
  resolveAt: string;
  /** ISO string of the IST midnight UTC when this market was designated as a Big Call. */
  isBigCallDate: string;
  /** Number of times users have tapped through from the Big Call card or notification. */
  bigCallNotificationOpenedCount: number;
  creator: {
    username: string;
    isVerifiedAnalyst: boolean;
  };
};

/**
 * Response shape of GET /api/markets/today-big-call (S27-T1).
 * Public endpoint — no auth required. Cache-Control: public, max-age=60.
 * `market` is null if no Big Call has been designated for today.
 */
export type ApiBigCallResponse = {
  market: ApiBigCallMarket | null;
};

// ────────────────────────────────────────────────────────────────────────────
// S27-T2: Probability history — consensus-line chart
// ────────────────────────────────────────────────────────────────────────────

/**
 * A single point in the probability history timeline.
 * `at` is an ISO-8601 string; `probability` is a fraction 0.0–1.0.
 */
export type ApiProbabilitySnapshot = {
  at: string;
  probability: number;
};

/**
 * Response shape of GET /api/markets/[marketId]/probability-history (S27-T2).
 * Public endpoint — no auth required. Cache-Control: public, max-age=300.
 *
 * - `snapshots`: ordered array of probability points.
 * - `resolvedProbability`: 1.0 (YES) or 0.0 (NO) for resolved markets; null otherwise.
 */
export type ApiProbabilityHistory = {
  marketId: string;
  snapshots: ApiProbabilitySnapshot[];
  resolvedProbability: number | null;
};
