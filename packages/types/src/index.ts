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

/**
 * Compact sibling-opinion shape — surfaces "other takes on the same article"
 * inline on each opinion card without forcing a follow-up request.
 */
export type ApiOpinionSibling = {
  id: string;
  expertId: string;
  expertName: string;
  expertOrganization: string;
  direction: "BULLISH" | "BEARISH" | "NEUTRAL";
  instrument?: string | null;
  verified?: boolean;
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
  /** ISO timestamp when the article carrying this opinion was published. Inherited from the source story. */
  publishedAt?: string;
  /**
   * ISO timestamp when the analyst actually made the call, if the article surfaced
   * a distinct date (e.g. "in a note dated 12 May"). Null when not stated — use
   * publishedAt as the fallback in UI ("Called X days ago") and downstream logic.
   */
  analystCallAt?: string | null;
  resolutionStatus: "PENDING" | "RESOLVED_HIT" | "RESOLVED_MISS" | "NOT_GRADED";
  resolvedAt?: string | null;
  resolutionNote?: string | null;
  /** Nullable FK to a MarketEventCluster (S18-T4) */
  eventClusterId?: string | null;
  /** True when sourced from a trusted publication (no named analyst) — display as "Market Analysis" instead of "Expert Opinion" */
  isSourceAttribution?: boolean;
  /** Human-readable instrument name, e.g. "Nifty 50", "HDFC Bank" — null until auto-resolution identifies it */
  instrument?: string | null;
  /** Yahoo Finance ticker symbol for the primary instrument, e.g. "^NSEI", "HDFCBANK.NS" */
  instrumentTicker?: string | null;
  /** FK to the source Story — drives "more takes on this story" navigation to /story/[id]. */
  storyId?: string | null;
  /** Other opinions extracted from the same article (excludes self). Empty when this opinion is the only take. */
  siblings?: ApiOpinionSibling[];
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
  /** Raw outcome of the market (mirror of DB field): 'YES' / 'NO' / 'UNRESOLVED' (null on unresolved markets). */
  outcome?: "YES" | "NO" | "UNRESOLVED" | null;
  /** Non-null for markets imported from external platforms (e.g. 'manifold'). */
  originPlatform?: string | null;
  /** Canonical source URL — set on imported markets; used for attribution badge link. */
  resolutionSourceUrl?: string | null;
  /** Crowd consensus probability (0..1) from origin platform — null for native markets. */
  externalProbability?: number | null;
  /** Total trading volume on origin platform (USD) — null for native markets. */
  externalVolume?: number | null;
  /** Unique trader count on origin platform — null for native markets. */
  externalTraderCount?: number | null;
  /** Whether the authenticated viewer has bookmarked this market. Undefined when not authenticated. */
  iSaved?: boolean;
  /** When set, this market is a Finance flagship event tied to a specific upcoming real-world date. */
  flagshipEventAt?: string | null;
  /** One of: 'RBI' | 'BUDGET' | 'GST' | 'GLOBAL' | 'FED' | 'OTHER'. */
  flagshipEventType?: string | null;
  /**
   * Arbitrary admin-authored metadata stored as JSON.
   * For RBI MPC poll-packs: `{ emiImpactLine: string }`.
   */
  structuredData?: Record<string, unknown> | null;
  /**
   * S55-T5: The group that hosts this market, if any. Non-null only on group-hosted (PRIVATE)
   * markets where the API includes the group relation. Used for the "Hosted by [Group]" chip
   * on MarketSummaryCard. Optional so existing callers that don't include the group relation
   * are unaffected.
   */
  group?: { id: string; name: string; slug: string } | null;
};

/**
 * Probability map for binary markets: { YES: 0.6, NO: 0.4 }
 * For MULTIPLE_CHOICE: { optionId1: 0.5, optionId2: 0.3, ... }
 */
export type ApiFlagshipProbabilityMap = Record<string, number>;

/** A flagship event returned by GET /api/finance/flagship-events */
export type ApiFlagshipEvent = ApiMarketSummary & {
  flagshipEventAt: string;
  flagshipEventType: string;
  /**
   * Arbitrary admin-authored metadata stored as JSON on the market.
   * For RBI MPC poll-packs this contains `{ emiImpactLine: string }`.
   */
  structuredData?: Record<string, unknown> | null;
  /** FK to the MarketEventCluster this flagship market belongs to (if any). */
  eventClusterId?: string | null;
  /** Crowd (all participants) probability map. Null if no positions yet. */
  crowdProbability: ApiFlagshipProbabilityMap | null;
  /** Expert-only probability map. Null if fewer than 3 expert participants. */
  expertProbability: ApiFlagshipProbabilityMap | null;
  /** Count of expert participants used for the expert probability computation. */
  expertCount?: number;
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

/** An analyst's position on a market, shown on the market detail screen for reasoning upvote UI (S30-T1). */
export type ApiAnalystPosition = {
  id: string;
  userId: string;
  side: AppPositionSide | null;
  reasoning: string | null;
  reasoningUpvotes: number;
  /** True when the current authenticated viewer has upvoted this reasoning. */
  iUpvotedReasoning: boolean;
  createdAt: string;
  user: {
    username: string;
    isVerifiedAnalyst: boolean;
    analystTier?: AppAnalystTier;
  };
};

export type ApiMarketDetail = {
  market: ApiMarketDetailMarket;
  /** Percentile rank for the authenticated user on this market (only set when market is RESOLVED and user won). */
  userPercentileRank?: number | null;
  /** Top-5 positions with reasoning from other analysts, sorted by upvotes desc (S30-T1). */
  analystPositions?: ApiAnalystPosition[];
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
  /** True when this user has the ADMIN role — drives admin-only UI affordances like the flagship-event toggle. */
  isAdmin: boolean;
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

export type AppGroupVisibility = "INVITE_ONLY" | "OPEN" | "REQUEST_TO_JOIN";

/** S58: Notification level for group-scoped push notifications. */
export type GroupNotifLevel = "ALL" | "MENTIONS_ONLY" | "NONE";

/** S58: Response shape for GET/PATCH /api/groups/:id/notification-preference. */
export type ApiGroupNotifPref = { level: GroupNotifLevel };

/** S58: Response shape for POST /api/groups/:id/cover-image (upload token). */
export type ApiGroupCoverImageToken = {
  clientToken: string;
  url: string;
};

/** S58: Response shape for PATCH /api/groups/:id/cover-image. */
export type ApiGroupCoverImageUpdate = {
  coverImageUrl: string;
};

export type AppGroupJoinRequestStatus = "PENDING" | "APPROVED" | "REJECTED";

export type ApiGroupJoinRequest = {
  id: string;
  groupId: string;
  groupName: string;
  groupSlug: string;
  status: AppGroupJoinRequestStatus;
  requestedAt: string;
  decidedAt: string | null;
  decisionNote: string | null;
};

export type ApiGroupJoinRequestInboxItem = {
  id: string;
  userId: string;
  username: string;
  avatarUrl: string | null;
  requestedAt: string;
  status: AppGroupJoinRequestStatus;
};
export type AppGroupRole = "OWNER" | "ADMIN" | "MEMBER";

export type ApiGroupSummary = {
  id: string;
  name: string;
  slug?: string;
  inviteCode?: string;
  description?: string | null;
  role?: AppGroupRole;
  memberCount?: number;
  marketCount?: number;
  visibility?: AppGroupVisibility;
  category?: AppMarketCategory | null;
  coverImageUrl?: string | null;
};

export type ApiDiscoverGroup = {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  category: AppMarketCategory | null;
  memberCount: number;
  coverImageUrl: string | null;
  ownerUsername: string;
  recentMarketCount: number;
  /** S56: Visibility tier — mobile browse card uses this to render "Join" vs "Request to Join" CTA. */
  visibility: AppGroupVisibility;
  /** S59-T5: Editorial curation flag. Featured groups appear first in the discover rail. */
  isFeatured: boolean;
};

export type ApiDiscoverGroupsResponse = {
  groups: ApiDiscoverGroup[];
  nextCursor: string | null;
};

export type ApiGroupMember = {
  id: string;
  userId: string;
  role: AppGroupRole;
  joinedAt: string;
  bannedAt: string | null;
  user: {
    id: string;
    username: string;
    avatarUrl?: string | null;
  };
};

export type ApiGroupDetail = {
  group: {
    id: string;
    slug: string;
    name: string;
    description: string | null;
    ownerId: string;
    visibility: AppGroupVisibility;
    category: AppMarketCategory | null;
    memberCap: number;
    coverImageUrl: string | null;
    inviteCode?: string;
    owner?: { username: string };
    memberships?: ApiGroupMember[];
    markets?: Array<{
      id: string;
      title: string;
      status: string;
      category: AppMarketCategory;
      totalVolume?: number;
      totalParticipants?: number;
      closeAt?: string;
      creator?: { username: string };
    }>;
    /** S56: Caller's current join request (PENDING or decided in last 7 days). Null if none. */
    callerJoinRequest?: {
      id: string;
      status: AppGroupJoinRequestStatus;
      decisionNote: string | null;
    } | null;
    /** S56: Count of PENDING join requests. Only populated for OWNER/ADMIN callers. */
    pendingRequestCount?: number | null;
  };
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
  /** Globally-unique React key. May embed competitor ids to disambiguate matches that share an ESPN event id (e.g. tennis Grand Slam draws). */
  id: string;
  /** Raw ESPN event id (no league prefix) used to fetch match detail. Absent on older API responses. */
  eventId?: string;
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
  /** ESPN league slug used to fetch football match detail (e.g. "eng.1", "fifa.world"). */
  leaguePath?: string;
  /** ESPN numeric league id used to fetch cricket match detail (e.g. "8048", "8042"). */
  leagueId?: string;
  homeTeam: ApiTeamDetail;
  awayTeam: ApiTeamDetail;
  leaderboard?: Array<{
    position: number;
    name: string;
    abbreviation: string;
    logo: string;
    team: string;
    teamColour?: string;
  }>;
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

/** Analyst tier earned through prediction accuracy and volume. */
export type AppAnalystTier = "ROOKIE" | "ANALYST" | "SENIOR_ANALYST" | "CHIEF_ANALYST";

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
  /**
   * Change in rank position since the previous snapshot.
   * Positive = rank improved (moved up the board), negative = dropped.
   * Null when historical snapshot data is unavailable.
   */
  rankDelta?: number | null;
  analystTier?: AppAnalystTier;
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

export type ApiMarketPosition = {
  id: string;
  side: AppPositionSide | null;
  numericValue?: number | null;
  amount: number;
  probabilityAtEntry?: number | null;
  estimatedReturnAtEntry?: number | null;
  /** Optional analyst rationale attached at position creation (max 500 chars). */
  reasoning?: string | null;
  /** Running total of upvotes received on the reasoning (S30-T1). */
  reasoningUpvotes?: number;
  /** True when the current authenticated user has upvoted this reasoning (S30-T1). */
  iUpvotedReasoning?: boolean;
  createdAt: string;
};

export type ApiPositionSummary = {
  id: string;
  side: AppPositionSide;
  amount: number;
  /** Optional analyst rationale (max 500 chars). */
  reasoning?: string | null;
  /** Running total of upvotes received on the reasoning (S30-T1). */
  reasoningUpvotes?: number;
  /** True when the current authenticated user has upvoted this reasoning (S30-T1). */
  iUpvotedReasoning?: boolean;
  createdAt: string;
  market: {
    id: string;
    title: string;
    status: AppMarketStatus;
    winningSide?: AppPositionSide | null;
  };
};

/**
 * Response from GET /api/profile/me/positions.
 * Returns the authenticated user's complete positions list.
 */
export type ApiMyPositionsResponse = {
  positions: ApiPositionSummary[];
  total: number;
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

/** One entry in the "Recent Calls" section on public profiles (S30-T3). */
export type ProfileRecentCall = {
  marketId: string;
  marketTitle: string;
  side: string;
  reasoning: string | null;
  reasoningUpvotes: number;
  createdAt: string;
  marketStatus: string;
  outcome: string | null;
};

export type ApiTierProgress = {
  currentTier: AppAnalystTier;
  nextTier: AppAnalystTier | null;
  /** Predictions required to unlock the next tier. */
  predictionsNeeded: number;
  /** Predictions still needed to reach the threshold (0 when met). */
  predictionsToGo: number;
  /** Net PnL (integer points) required to unlock the next tier. */
  pnlNeeded: number;
  /**
   * The user's current lifetime net PnL in points.
   * Can be negative when cumulative losses exceed wins.
   */
  currentNetPoints: number;
  /** True when both predictions and net PnL thresholds are met (and verified if required). */
  isEligible: boolean;
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
  /** Analyst tier — ROOKIE / ANALYST / SENIOR_ANALYST / CHIEF_ANALYST. */
  analystTier?: AppAnalystTier;
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
  /** Analyst tier progression data — only present on /api/profile/me. */
  tierProgress?: ApiTierProgress;
  /** Sum of reasoningUpvotes across all positions (S30-T1). */
  totalReasoningUpvotes?: number;
  /** Recent calls on public markets — present on /api/profile/[username] (S30-T3). */
  recentCalls?: ProfileRecentCall[];
  /** Finance streak + accuracy — present on /api/profile/[username] (S35-T3). */
  financeStreak?: number;
  financeAccuracy?: number | null;
  financeTotalVotes?: number;
  financeResolvedVotes?: number;
  /** S59-T2: server-authoritative global default for group push notifications. Present on /api/profile/me. */
  defaultGroupNotificationLevel?: GroupNotifLevel;
};

/** S59-T2: Response shape for GET/PATCH /api/users/me/notification-defaults. */
export type ApiUserNotificationDefaults = {
  defaultGroupNotificationLevel: GroupNotifLevel;
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

export type ApiExpertOpinionPollType = "IMPLICATION";

/** Poll A (IMPLICATION) 5-bucket agreement choices (v3). */
export type ApiImplicationChoice =
  | "STRONGLY_DISAGREE"
  | "DISAGREE"
  | "NEUTRAL"
  | "AGREE"
  | "STRONGLY_AGREE";

export type ApiExpertOpinionVoteChoice = ApiImplicationChoice;

export interface ApiExpertOpinionTallies {
  implication: {
    stronglyDisagree: number;
    disagree: number;
    neutral: number;
    agree: number;
    stronglyAgree: number;
    /** Count of locked votes (drives the bucket counts above). */
    total: number;
    /** Count of unlocked draft votes — for nudging committed participation. */
    draftTotal: number;
    userChoice: ApiImplicationChoice | null;
    /** ISO timestamp when the user locked their vote; null = draft or hasn't voted. */
    userLockedAt: string | null;
    /** 0=STRONGLY_DISAGREE, 1=DISAGREE, 2=NEUTRAL, 3=AGREE, 4=STRONGLY_AGREE; null when total === 0 */
    medianBucket: 0 | 1 | 2 | 3 | 4 | null;
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
  /** Human-readable instrument name, e.g. "Nifty 50" — null until auto-resolution identifies it */
  instrument?: string | null;
  /** Yahoo Finance ticker symbol, e.g. "^NSEI" */
  instrumentTicker?: string | null;
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
  followerCount: number;
  recentCalls: ApiExpertCall[];
}

export interface ApiExpertLeaderboardEntry {
  rank: number;
  expert: ApiExpertProfile & { hitCount: number; missCount: number };
}

export interface ApiVerifiedCall {
  id: string;
  expertId: string;
  expertName: string;
  expertOrganization: string;
  expertVerified: boolean;
  expertAvatarUrl: string | null;
  direction: "BULLISH" | "BEARISH" | "NEUTRAL";
  quote: string;
  resolutionStatus: "RESOLVED_HIT" | "RESOLVED_MISS";
  resolutionNote: string | null;
  resolvedAt: string | null;
  publishedAt: string;
  storyId: string | null;
  storyHeadline: string | null;
  instrument: string | null;
}

export interface ApiExpertSearchResult {
  id: string;
  name: string;
  organization: string;
  verified: boolean;
  avatarUrl: string | null;
  totalOpinions: number;
  credibilityScore: number | null;
  provisional: boolean;
  resolvedCount: number;
  followerCount: number;
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

// ─── Finance: My Calls Digest (S33-T2 / S33-T3) ───────────────────────────────

/**
 * One resolved expert-opinion entry in the user's calls digest.
 * userAgreed: true = AGREE/STRONGLY_AGREE bucket; false = DISAGREE/STRONGLY_DISAGREE; null = NEUTRAL.
 * userWasCorrect: true when the user's stance matched the resolution outcome; null for NEUTRAL.
 */
export interface ApiDigestOpinion {
  opinionId: string;
  expertId: string;
  expertName: string;
  expertOrganization: string;
  expertVerified: boolean;
  expertAvatarUrl: string | null;
  instrument: string | null;
  instrumentTicker: string | null;
  direction: "BULLISH" | "BEARISH" | "NEUTRAL";
  quote: string;
  /** PENDING for pending opinions; RESOLVED_HIT/RESOLVED_MISS for graded ones. */
  resolutionStatus: "PENDING" | "RESOLVED_HIT" | "RESOLVED_MISS";
  /** ISO for resolved; null for pending. */
  resolvedAt: string | null;
  /** ISO when analyst made the call. */
  publishedAt: string;
  /** ISO when the user locked the vote. */
  votedAt: string;
  userChoice: string;
  /** Null when pending OR neutral vote. */
  userWasCorrect: boolean | null;
  userAgreed: boolean | null;
  storyId: string | null;
  storyHeadline: string | null;
}

/** Response shape of GET /api/finance/my-calls-digest */
export interface ApiMyCallsDigest {
  /** Calls where the user's stance was correct (agreed-on-HIT or disagreed-on-MISS) */
  hits: number;
  /** Calls where the user's stance was incorrect */
  misses: number;
  /** Resolved opinions where user voted NEUTRAL (not scored) */
  neutrals: number;
  /** Opinions the user voted on that are still PENDING resolution */
  pending: number;
  /** Total IMPLICATION votes cast by this user across all time */
  totalVoted: number;
  resolvedOpinions: ApiDigestOpinion[];
  /** S38: pending opinion details so My Calls can show them. */
  pendingOpinions: ApiDigestOpinion[];
}

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

// ─── Finance Big Call spotlight (S35-T2) ─────────────────────────────────────

/**
 * Spotlight opinion returned by GET /api/finance/big-call.
 * Highest-scored PENDING ExpertOpinion or a post-resolution HIT spotlight.
 */
export type ApiFinanceBigCallOpinion = {
  id: string;
  expertId: string;
  expertName: string;
  expertOrganization: string;
  avatarUrl: string | null;
  analystTier: AppAnalystTier;
  accuracyScore: number | null;
  quote: string;
  /** 4-6 word server-generated headline. Null until backfilled. */
  headline: string | null;
  direction: "BULLISH" | "BEARISH" | "NEUTRAL";
  instrument: string | null;
  instrumentTicker: string | null;
  sourceUrl: string;
  publishedAt: string;
  resolutionStatus: "PENDING" | "RESOLVED_HIT" | "RESOLVED_MISS" | "NOT_GRADED";
  resolvedAt: string | null;
  resolutionNote: string | null;
  /** True when this opinion is in the post-resolution 24h spotlight window. */
  isPostResolution: boolean;
  /** Number of Poll A (IMPLICATION) votes cast on this opinion. */
  pollAVotes: number;
  /** Percentage of voters who agreed (AGREE + STRONGLY_AGREE). Null if no votes. */
  agreePercent: number | null;
  /** Raw algorithm score — exposed for debugging; not displayed to users. */
  score: number;
};

export type ApiFinanceBigCallResponse = {
  opinion: ApiFinanceBigCallOpinion | null;
  /** IST market window the hero was curated for. */
  window?: "live" | "closing-wrap" | "after-hours" | "pre-market" | "weekend" | "holiday";
  /** Window-appropriate label, e.g. "Today's Big Call" / "Call of the Week". */
  windowLabel?: string;
};

/**
 * Full ExpertOpinion detail returned by GET /api/finance/expert-opinions/:id.
 * Used by the dedicated opinion detail screen (independent of any market).
 */
export type ApiFinanceOpinionDetail = {
  id: string;
  expertId: string;
  expertName: string;
  expertOrganization: string;
  avatarUrl: string | null;
  analystTier: AppAnalystTier;
  quote: string;
  headline: string | null;
  direction: "BULLISH" | "BEARISH" | "NEUTRAL";
  instrument: string | null;
  instrumentTicker: string | null;
  sourceUrl: string;
  publishedAt: string;
  resolutionStatus: "PENDING" | "RESOLVED_HIT" | "RESOLVED_MISS" | "NOT_GRADED";
  resolvedAt: string | null;
  resolutionNote: string | null;
  isSourceAttribution: boolean;
  eventCluster: { id: string; slug: string; name: string } | null;
};

// ─── Finance streak + accuracy for profile (S35-T3) ─────────────────────────

export type ApiFinancePersonalStats = {
  /** Consecutive IST calendar days with at least one Poll A vote. */
  financeStreak: number;
  /** Accuracy: (agreed votes where opinion resolved HIT) / total resolved votes. Null if no resolved votes. */
  financeAccuracy: number | null;
  /** Total Poll A votes cast by this user. */
  financeTotalVotes: number;
  /** Number of resolved opinions the user voted on. */
  financeResolvedVotes: number;
};

// ─── Finance: Instrument Catalog (S44-T1) ────────────────────────────────────

/**
 * One entry in the instrument catalog returned by GET /api/finance/instruments.
 * The catalog is built from all non-suppressed ExpertOpinion rows, collapsed
 * through the NORMALIZATION_MAP so variants (e.g. "Nifty 50 Index") merge into
 * their canonical form ("Nifty 50").
 */
export type ApiInstrumentCatalogItem = {
  /** Canonical display label, e.g. "Nifty 50", "USD/INR", "Silver". */
  label: string;
  /** Yahoo Finance ticker for the canonical instrument, e.g. "^NSEI", "INR=X". */
  ticker: string;
  /** Total number of non-suppressed opinions tagged to this instrument (after normalization). */
  count: number;
  /** True for the top-10 instruments by opinion count; false for the rest. */
  isPopular: boolean;
};

// ─── Expert Top Weekly (S49-T1) ──────────────────────────────────────────────

/**
 * One entry in the top-weekly experts ranking returned by
 * GET /api/experts/top-weekly.
 *
 * Ranked descending by hitRate over a rolling 7-day window.
 * Only experts with totalResolved >= 3 qualify.
 * isSourceAttribution=true opinions are excluded (named analysts only).
 */
export type ApiTopExpertEntry = {
  rank: number;
  expertId: string;
  expertName: string;
  organization: string;
  /** Hit rate as a fraction 0.0–1.0, e.g. 0.87 = 87%. */
  hitRate: number;
  resolvedCount: number;
  hitCount: number;
};

// ─── F1 Session Detail (S47-T1) ──────────────────────────────────────────────

export type ApiF1TireCompound = "HARD" | "MEDIUM" | "SOFT" | "INTERMEDIATE" | "WET";

export type ApiF1Driver = {
  driverNumber: number;
  position: number;
  name: string;
  abbreviation: string;
  /** URL to the driver headshot image from OpenF1. May be absent for some drivers. */
  headshot?: string;
  team: string;
  /** Hex colour string with # prefix, e.g. "#E8002D". Defaults to "#888888" if OpenF1 omits it. */
  teamColour: string;
  lastLap?: {
    duration: number;
    lapNumber: number;
    isPitOut: boolean;
  };
  fastestLap?: {
    duration: number;
    lapNumber: number;
  };
  /** True on exactly one driver per session — the driver with the session-wide minimum lap_duration. */
  fastestLapOverall: boolean;
  /** Seconds gap to P1. Populated only for Race / Sprint sessions. */
  gapToLeader?: number;
  /** Seconds gap to the driver immediately ahead. Populated only for Race / Sprint sessions. */
  intervalAhead?: number;
  tireCompound?: ApiF1TireCompound;
};

export type ApiF1SessionDetail = {
  session: {
    key: number;
    /** Human-readable name, e.g. "Race", "Qualifying", "Practice 1". */
    name: string;
    /** One of: "Race" | "Qualifying" | "Practice" | "Sprint". */
    type: string;
    circuit: string;
    country: string;
    dateStart: string;
    dateEnd: string;
    /** "upcoming" = before dateStart; "live" = within session window; "finished" = after dateEnd + 2h grace. */
    status: "upcoming" | "live" | "finished";
  };
  drivers: ApiF1Driver[];
};

// ─── RBI MPC Poll-Pack (Sprint 61) ───────────────────────────────────────────

/**
 * A single MULTIPLE_CHOICE market that is part of an RBI MPC poll-pack.
 * The `structuredData` field carries the static EMI-impact line authored by admin.
 */
export type ApiMpcPollMarket = ApiFlagshipEvent & {
  structuredData: { emiImpactLine: string } | null;
};

/**
 * An RBI MPC "poll-pack": one MarketEventCluster with exactly two MULTIPLE_CHOICE
 * flagship markets — Q1 (Repo Rate) and Q2 (Stance).
 *
 * Produced by `groupFlagshipEventsIntoPacks()` from the flagship-events list.
 */
export type ApiMpcPollPack = {
  /** The MarketEventCluster id shared by both markets. */
  clusterId: string;
  /** The flagshipEventAt date of the MPC meeting (ISO string). Both markets share the same date. */
  meetingAt: string;
  /**
   * The two MULTIPLE_CHOICE markets in canonical order:
   *   index 0 = Repo Rate question
   *   index 1 = Stance question
   * Mobile UI should render them in this order but must not hard-code the index.
   */
  markets: [ApiMpcPollMarket, ApiMpcPollMarket];
};

/**
 * Group a list of flagship events into RBI MPC poll-packs.
 *
 * Rules:
 *  - Only markets with `flagshipEventType === "RBI"` and a non-null `eventClusterId`
 *    are eligible.
 *  - Markets are grouped by their `eventClusterId`.
 *  - A cluster must have exactly 2 eligible markets to form a valid pack; clusters
 *    with 1 or 3+ markets are silently dropped (admin data-entry error).
 *  - The two markets within a pack are sorted by their `title` so the order is
 *    deterministic: "Repo Rate" sorts before "Stance" alphabetically.
 *
 * This function is pure and has no side-effects — it can be called safely in both
 * the API layer and the mobile/web UI without any runtime dependencies.
 *
 * @param events - The full array of flagship events from GET /api/finance/flagship-events.
 * @returns       Packs sorted by `meetingAt` ascending (nearest MPC first).
 */
export function groupFlagshipEventsIntoPacks(
  events: ApiFlagshipEvent[]
): ApiMpcPollPack[] {
  // Collect only RBI MULTIPLE_CHOICE markets that belong to a cluster.
  const eligible = events.filter(
    (e): e is ApiMpcPollMarket & { eventClusterId: string } =>
      e.flagshipEventType === "RBI" &&
      e.marketType === "MULTIPLE_CHOICE" &&
      typeof e.eventClusterId === "string" &&
      e.eventClusterId.length > 0
  );

  // Group by clusterId.
  const byCluster = new Map<string, typeof eligible>();
  for (const market of eligible) {
    const group = byCluster.get(market.eventClusterId) ?? [];
    group.push(market);
    byCluster.set(market.eventClusterId, group);
  }

  const packs: ApiMpcPollPack[] = [];
  for (const [clusterId, clusterMarkets] of byCluster.entries()) {
    // A valid pack has exactly 2 markets.
    if (clusterMarkets.length !== 2) continue;

    // Sort deterministically by title so Repo Rate always precedes Stance.
    const sorted = [...clusterMarkets].sort((a, b) =>
      a.title.localeCompare(b.title)
    ) as [ApiMpcPollMarket, ApiMpcPollMarket];

    packs.push({
      clusterId,
      meetingAt: sorted[0].flagshipEventAt,
      markets: sorted,
    });
  }

  // Sort packs by meeting date ascending (nearest first).
  packs.sort((a, b) => a.meetingAt.localeCompare(b.meetingAt));

  return packs;
}

// ─── S62: Poll model types ──────────────────────────────────────────────────

export type AppPollStatus = "OPEN" | "CLOSED" | "RESOLVED";

/** One selectable option in a Poll, including live vote count. */
export type ApiPollOption = {
  id: string;
  label: string;
  sortOrder: number;
  voteCount: number;
};

/**
 * A Poll as returned by GET /api/polls (list), GET /api/polls/packs,
 * and GET /api/polls/[pollId] (without the caller's vote).
 * Suitable for rendering cards and carousels.
 *
 * `userVote` is present only when the caller is authenticated and has voted.
 * The packs endpoint does a left-join on PollVote so mobile can lock chips
 * without fetching each poll detail individually.
 */
export type ApiPoll = {
  id: string;
  question: string;
  description: string | null;
  category: AppMarketCategory;
  status: AppPollStatus;
  closeAt: string;
  eventAt: string | null;
  packId: string | null;
  structuredData: Record<string, unknown> | null;
  winningOptionId: string | null;
  resolvedAt: string | null;
  createdAt: string;
  options: ApiPollOption[];
  totalVotes: number;
  /** Present when the authenticated caller has already voted on this poll. */
  userVote?: { optionId: string; lockedAt: string | null } | null;
};

/**
 * Poll detail — extends ApiPoll with the authenticated caller's vote.
 * Returned by GET /api/polls/[pollId].
 */
export type ApiPollDetail = ApiPoll & {
  userVote: {
    optionId: string;
    lockedAt: string | null;
    createdAt: string;
  } | null;
};

/**
 * A group of Polls that share a packId (one RBI MPC event = 3 polls: Repo / CRR / SLR).
 * Returned by POST /api/admin/polls/rbi-mpc-pack (and reconstructible
 * from GET /api/polls?packId=<packId>).
 */
export type ApiPollPack = {
  packId: string;
  polls: ApiPoll[];
};

// ─── India Macro: GET /api/finance/macro ─────────────────────────────────────

/** RBI policy rates group returned by the macro endpoint. */
export type ApiMacroRbi = {
  repoRate: number | null;
  crr: number | null;
  slr: number | null;
};

/** IMF macro projections group returned by the macro endpoint. */
export type ApiMacroImf = {
  gdpGrowth: number | null;
  gdpGrowthYear: number | null;
  cpiInflation: number | null;
  cpiInflationYear: number | null;
};

/**
 * Response shape for GET /api/finance/macro.
 * `asOf` is the ISO timestamp of the most recent fetch (used for "Updated d Mon" microcopy).
 * Individual values may be null if the cron has not yet fetched them.
 */
export type ApiFinanceMacroResponse = {
  rbi: ApiMacroRbi;
  imf: ApiMacroImf;
  asOf: string | null;
};
