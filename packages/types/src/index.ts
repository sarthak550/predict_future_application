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

export type ApiLeaderboardEntry = {
  id: string;
  username: string;
  reputationScore: number;
  accuracyScore: number;
  totalPredictions?: number;
  totalNetPoints?: number;
  stats?: {
    totalPredictions?: number;
    totalNetPoints?: number;
  } | null;
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
  username: string;
  reputationScore: number;
  accuracyScore: number;
  level?: number;
  streak?: number;
  lastPredictionAt?: string | null;
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
  type: "RESOLUTION" | "CHALLENGE" | "GENERAL" | string;
};
