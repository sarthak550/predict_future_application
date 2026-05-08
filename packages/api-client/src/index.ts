import { buildAuthHeaders, type AuthTokenProvider } from "@predict-future/auth-shared";
import type {
  ApiCategoryTopResponse,
  ApiCricketMatchDetail,
  ApiDailyQuests,
  ApiExpertLeaderboardEntry,
  ApiExpertOpinionTallies,
  ApiExpertProfile,
  ApiFinanceExpertSentiment,
  ApiFinanceMarketsResponse,
  ApiFollowerEntry,
  ApiFollowStatus,
  ApiFootballMatchDetail,
  ApiGroupDetail,
  ApiGroupSummary,
  ApiHostEligibility,
  ApiHostStats,
  ApiLeaderboardResponse,
  ApiLeaderboardTimeWindow,
  ApiLeagueEntry,
  ApiLeagueStandingsPage,
  ApiLiveScore,
  ApiMarketDetail,
  ApiMarketSummary,
  ApiMyProfile,
  ApiNewsFeedItem,
  ApiNotification,
  ApiPlacePositionResponse,
  ApiPollListItem,
  ApiReferralInfo,
  ApiStory,
  ApiUserCalibration,
  ApiUserProfile,
  ApiVote,
  AppLeagueTier,
  AppMarketCategory,
  AppMarketStatus
} from "@predict-future/types";

export type { ApiLeaderboardTimeWindow };

export type NewsFeedPage = {
  items: ApiNewsFeedItem[];
  nextCursor: string | null;
  hasMore: boolean;
};

export type AuthFailureReason = "unauthorized" | "user_not_found";

export type ApiClientOptions = {
  baseUrl: string;
  getAuthToken?: AuthTokenProvider;
  fetchFn?: typeof fetch;
  onAuthFailure?: (reason: AuthFailureReason) => void;
};

export type NewsQuery = {
  limit?: number;
  cursor?: string | null;
  category?: AppMarketCategory;
  excludeCategory?: string;
  userId?: string;
  requireExpertOpinions?: boolean;
};

export type PublicMarketsQuery = {
  status?: string;
  category?: AppMarketCategory;
  q?: string;
  limit?: number;
  featured?: boolean;
  sort?: "rank" | "new" | "closing" | "close_at" | "featured" | "volume";
};

export type RequestOptions = RequestInit & {
  auth?: boolean;
};

export class ApiClientError extends Error {
  status: number;
  payload: unknown;

  constructor(message: string, status: number, payload: unknown) {
    super(message);
    this.name = "ApiClientError";
    this.status = status;
    this.payload = payload;
  }
}

function buildUrl(baseUrl: string, path: string, query?: Record<string, string | number | boolean | null | undefined>) {
  const url = new URL(path, baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`);
  for (const [key, value] of Object.entries(query ?? {})) {
    if (value === undefined || value === null || value === "") {
      continue;
    }

    url.searchParams.set(key, String(value));
  }
  return url.toString();
}

export function createApiClient(options: ApiClientOptions) {
  const fetchFn = options.fetchFn ?? fetch;

  async function request<T>(
    path: string,
    query?: Record<string, string | number | boolean | null | undefined>,
    init?: RequestOptions
  ) {
    const headers = new Headers(init?.headers ?? {});
    const authHeaders = init?.auth ? await buildAuthHeaders(options.getAuthToken) : undefined;
    for (const [key, value] of Object.entries(authHeaders ?? {})) {
      headers.set(key, value);
    }

    if (!headers.has("Content-Type") && init?.body) {
      headers.set("Content-Type", "application/json");
    }

    const response = await fetchFn(buildUrl(options.baseUrl, path, query), {
      ...init,
      headers
    });

    const text = await response.text();
    const payload = text ? safeJsonParse(text) : null;

    if (!response.ok) {
      const message =
        typeof payload === "object" && payload && "error" in payload && typeof payload.error === "string"
          ? payload.error
          : `Request failed with status ${response.status}.`;

      if (options.onAuthFailure) {
        if (response.status === 401 && init?.auth) {
          options.onAuthFailure("unauthorized");
        } else if (response.status === 404 && path === "/api/profile/me") {
          options.onAuthFailure("user_not_found");
        }
      }

      throw new ApiClientError(message, response.status, payload);
    }

    return payload as T;
  }

  return {
    request,
    getNews(query?: NewsQuery) {
      return request<NewsFeedPage>("/api/news", query, { auth: true });
    },
    getNewsDebug() {
      return request<Record<string, unknown>>("/api/news/debug");
    },
    getPublicMarkets(query?: PublicMarketsQuery) {
      return request<{ markets: ApiMarketSummary[] }>("/api/markets/public", query);
    },
    getPolls(query?: { status?: "open" | "closed" | "all"; category?: AppMarketCategory }) {
      return request<{ polls: ApiPollListItem[] }>("/api/polls", query, { auth: true });
    },
    getMarketById(marketId: string, query?: { userId?: string }) {
      return request<ApiMarketDetail & {
        userPositions?: Array<{ id: string; side: string | null; amount: number; numericValue: number | null; createdAt: string }>;
        userMultiChoicePositions?: Array<{ optionId: string; amount: number }>;
        userVote?: { side: string | null; numericValue: number | null } | null;
      }>(`/api/markets/${marketId}`, query, { auth: true });
    },
    placePosition(marketId: string, body: { side?: string; numericValue?: number; amount: number }, query?: { userId?: string }) {
      return request<ApiPlacePositionResponse>(
        `/api/markets/${marketId}/positions`,
        query,
        {
          method: "POST",
          body: JSON.stringify(body),
          auth: true,
        }
      );
    },
    placeMultiChoicePosition(marketId: string, body: { optionId: string; amount: number }) {
      return request<{ ok: boolean; questRewards: Array<{ questId: string; reward: number }> }>(
        `/api/markets/${marketId}/positions/multi-choice`,
        undefined,
        {
          method: "POST",
          body: JSON.stringify(body),
          auth: true
        }
      );
    },
    resolveMultiChoiceMarket(marketId: string, body: { winningOptionId: string }) {
      return request<{ ok: boolean }>(
        `/api/markets/${marketId}/resolve-multi-choice`,
        undefined,
        {
          method: "POST",
          body: JSON.stringify(body),
          auth: true
        }
      );
    },
    getHostEligibility() {
      return request<{ eligibility: ApiHostEligibility }>("/api/hosts/eligibility", undefined, { auth: true });
    },
    getUserHostStats(userId: string) {
      return request<ApiHostStats>(`/api/users/${userId}/host-stats`);
    },
    getGroupById(groupId: string, query?: { userId?: string }) {
      return request<ApiGroupDetail>(`/api/groups/${groupId}`, query, { auth: true });
    },
    createMarket(body: unknown, query?: { userId?: string }) {
      return request<{ market: { id: string; status: AppMarketStatus } }>(
        "/api/markets/create",
        query,
        {
          method: "POST",
          body: JSON.stringify(body),
          auth: true
        }
      );
    },
    castVote(marketId: string, body: { side?: string; numericValue?: number }, query?: { userId?: string }) {
      return request<{ ok: boolean }>(
        `/api/markets/${marketId}/vote`,
        query,
        {
          method: "POST",
          body: JSON.stringify(body),
          auth: true
        }
      );
    },
    refreshNewsFeed(query?: { userId?: string }) {
      return request<Record<string, unknown>>(
        "/api/news/refresh",
        query,
        { method: "POST", auth: true }
      );
    },
    getLiveScores() {
      return request<{ scores: ApiLiveScore[] }>("/api/sports/scores");
    },
    getCricketMatchDetail(matchId: string, leagueId: string) {
      return request<ApiCricketMatchDetail>(`/api/sports/match/${matchId}`, { league: leagueId });
    },
    getFootballMatchDetail(matchId: string, leaguePath: string) {
      return request<ApiFootballMatchDetail>(`/api/sports/match/${matchId}`, { league: leaguePath });
    },
    getLeaderboard(query?: { category?: AppMarketCategory; timeWindow?: ApiLeaderboardTimeWindow }) {
      return request<ApiLeaderboardResponse>("/api/leaderboard", query, { auth: true });
    },
    getProfile(username: string) {
      return request<{ user: ApiUserProfile }>(`/api/profile/${username}`, undefined, { auth: true });
    },
    getUserProfile(username: string) {
      return request<{ user: ApiUserProfile }>(`/api/profile/${username}`, undefined, { auth: true });
    },
    getMyProfile(query?: { userId?: string }) {
      return request<ApiMyProfile>("/api/profile/me", query, { auth: true });
    },
    getMyMarkets() {
      return request<{ createdPolls: ApiMyProfile["createdPolls"]; votes: ApiMyProfile["votes"] }>(
        "/api/profile/me/markets",
        undefined,
        { auth: true }
      );
    },
    getMyGroups(query?: { userId?: string }) {
      return request<{ groups: Array<ApiGroupSummary & { memberCount?: number; marketCount?: number }> }>(
        "/api/groups",
        query,
        { auth: true }
      );
    },
    createGroup(body: { name: string; description?: string }, query?: { userId?: string }) {
      return request<{ group: ApiGroupSummary }>(
        "/api/groups/create",
        query,
        { method: "POST", body: JSON.stringify(body), auth: true }
      );
    },
    getGroupPreview(inviteCode: string) {
      return request<{ id: string; name: string; description: string | null; memberCount: number }>(
        "/api/groups/preview",
        { inviteCode }
      );
    },
    joinGroup(body: { inviteCode: string }, query?: { userId?: string }) {
      return request<{ group: ApiGroupSummary }>(
        "/api/groups/join",
        query,
        { method: "POST", body: JSON.stringify(body), auth: true }
      );
    },
    launchGroup(groupId: string) {
      return request<{ launched: number; marketIds: string[] }>(
        `/api/groups/${groupId}/launch`,
        undefined,
        { method: "POST", auth: true }
      );
    },
    signIn(body: { email: string; password: string }) {
      return request<{ user: { id: string; username: string }; token: string }>(
        "/api/auth/mobile/login",
        undefined,
        { method: "POST", body: JSON.stringify(body) }
      );
    },
    register(body: { username: string; email: string; password: string }) {
      return request<{ user: { id: string; username: string }; token: string }>(
        "/api/auth/mobile/register",
        undefined,
        { method: "POST", body: JSON.stringify(body) }
      );
    },
    registerPushToken(body: { token: string }) {
      return request<{ ok: boolean }>(
        "/api/users/push-token",
        undefined,
        { method: "POST", body: JSON.stringify(body), auth: true }
      );
    },
    resolveMarket(
      marketId: string,
      body: {
        outcome?: "YES" | "NO";
        actualValue?: number;
        resolutionNote: string;
        evidenceText?: string;
        evidenceUrl?: string;
      }
    ) {
      return request<{ ok: boolean }>(
        `/api/markets/${marketId}/resolve`,
        undefined,
        { method: "POST", body: JSON.stringify(body), auth: true }
      );
    },
    getMarketComments(marketId: string) {
      return request<{ comments: Array<{ id: string; content: string; createdAt: string; user: { username: string } }> }>(
        `/api/markets/${marketId}/comments`
      );
    },
    postMarketComment(marketId: string, body: { content: string }) {
      return request<{ comment: { id: string; content: string; createdAt: string; user: { username: string } } }>(
        `/api/markets/${marketId}/comments`,
        undefined,
        { method: "POST", body: JSON.stringify(body), auth: true }
      );
    },
    getNotifications(query?: { limit?: number }) {
      return request<{ notifications: ApiNotification[]; unreadCount: number }>(
        "/api/notifications",
        query ? { limit: String(query.limit ?? 20) } : undefined,
        { auth: true }
      );
    },
    markNotificationsRead() {
      return request<{ ok: boolean }>(
        "/api/notifications/read",
        undefined,
        { method: "POST", auth: true }
      );
    },
    markNotificationRead(id: string) {
      return request<{ ok: boolean }>(
        `/api/notifications/${id}/read`,
        undefined,
        { method: "PATCH", auth: true }
      );
    },

    // ─── Finance: Expert Opinion Polls ────────────────────────────────────
    castExpertOpinionVote(
      opinionId: string,
      body: { pollType: string; choice: string }
    ) {
      return request<ApiExpertOpinionTallies>(
        `/api/finance/expert-opinions/${opinionId}/vote`,
        undefined,
        { method: "POST", auth: true, body: JSON.stringify(body) }
      );
    },

    getExpertOpinionTallies(opinionId: string) {
      return request<ApiExpertOpinionTallies>(
        `/api/finance/expert-opinions/${opinionId}/tallies`,
        undefined,
        { auth: true }
      );
    },

    // ─── Finance: Expert Sentiment Aggregate ──────────────────────────────
    getFinanceExpertSentiment() {
      return request<ApiFinanceExpertSentiment>("/api/finance/expert-sentiment");
    },

    // ─── Finance: Markets Feed ─────────────────────────────────────────────
    getFinanceMarkets(params?: { cursor?: string }) {
      return request<ApiFinanceMarketsResponse>(
        `/api/finance/markets`,
        params
      );
    },

    // ─── Finance: Expert Profile + Leaderboard ────────────────────────────
    getExpertProfile(expertId: string) {
      return request<ApiExpertProfile>(
        `/api/finance/experts/${expertId}`
      );
    },

    getExpertCalls(expertId: string, params?: { cursor?: string }) {
      return request<{ items: import("@predict-future/types").ApiExpertCall[]; nextCursor: string | null }>(
        `/api/finance/experts/${expertId}/calls`,
        params
      );
    },

    getExpertLeaderboard(params?: { org?: string }) {
      return request<ApiExpertLeaderboardEntry[]>(
        `/api/finance/experts/leaderboard`,
        params
      );
    },

    // ─── Story detail ──────────────────────────────────────────────────────
    getStory(storyId: string) {
      return request<{ story: ApiStory }>(`/api/news/${storyId}`);
    },

    // ─── Calibration scorecard ─────────────────────────────────────────────
    /** Fetch a user's calibration data — overall accuracy + per-category breakdown. Auth: none. */
    getUserCalibration(userId: string) {
      return request<ApiUserCalibration>(`/api/users/${userId}/calibration`);
    },

    /** Fetch the top-N users in a given category by accuracy. Auth: none. */
    getCategoryTop(params: { category: AppMarketCategory; limit?: number }) {
      return request<ApiCategoryTopResponse>("/api/leaderboard", {
        top: "true",
        category: params.category,
        limit: params.limit ?? 10,
      });
    },

    // ─── Follow system (S24-T2) ────────────────────────────────────────────

    /**
     * Follow a user. Auth required.
     * Idempotent — safe to call if already following.
     */
    followUser(userId: string) {
      return request<ApiFollowStatus>(
        `/api/users/${userId}/follow`,
        undefined,
        { method: "POST", auth: true }
      );
    },

    /**
     * Unfollow a user. Auth required.
     * Idempotent — safe to call even if not currently following.
     */
    unfollowUser(userId: string) {
      return request<ApiFollowStatus>(
        `/api/users/${userId}/follow`,
        undefined,
        { method: "DELETE", auth: true }
      );
    },

    /**
     * Get a user's followers (paginated). Auth: none.
     */
    getFollowers(userId: string, params?: { cursor?: string }) {
      return request<{ items: ApiFollowerEntry[]; nextCursor: string | null }>(
        `/api/users/${userId}/followers`,
        params
      );
    },

    /**
     * Get the users a user follows (paginated). Auth: none.
     */
    getFollowing(userId: string, params?: { cursor?: string }) {
      return request<{ items: ApiFollowerEntry[]; nextCursor: string | null }>(
        `/api/users/${userId}/following`,
        params
      );
    },

    // ─── Daily quests (S24-T4) ────────────────────────────────────────────────

    /**
     * Fetch today's daily quests for the authenticated user.
     * Returns quest progress, completion status, and total points earned today.
     * Auth: required.
     */
    getQuestsToday() {
      return request<ApiDailyQuests>("/api/quests/today", undefined, { auth: true });
    },

    // ─── Referral rewards (S24-T6) ────────────────────────────────────────────

    /**
     * Fetch the authenticated user's referral code and stats.
     * Lazily generates and persists a code if one does not exist.
     * Auth: required.
     */
    getMyReferralCode() {
      return request<ApiReferralInfo>(
        "/api/users/me/referral-code",
        undefined,
        { auth: true }
      );
    },

    // ─── Monthly leagues (S24-T7) ─────────────────────────────────────────────

    /**
     * Fetch the authenticated user's MonthlyLeagueEntry for the current IST month.
     * Auto-creates the entry at BRONZE tier if it does not exist.
     * Auth: required.
     */
    getMyCurrentLeague() {
      return request<ApiLeagueEntry>(
        "/api/leagues/current",
        undefined,
        { auth: true }
      );
    },

    // ─── Monthly leagues (S24-T8) ─────────────────────────────────────────────

    /**
     * Fetch paginated standings for a given tier and month.
     * Auth: not required.
     */
    getLeagueStandings(params: { tier: AppLeagueTier; month: string; cursor?: string }) {
      return request<ApiLeagueStandingsPage>(
        "/api/leagues/standings",
        {
          tier: params.tier,
          month: params.month,
          ...(params.cursor ? { cursor: params.cursor } : {}),
        }
      );
    },

    /**
     * Trigger month-end promotion/relegation processing. Admin only.
     * Defaults to the previous IST calendar month when month is omitted.
     */
    processLeagueMonthEnd(params?: { month?: string }) {
      return request<
        | { month: string; processed: number; promoted: number; relegated: number }
        | { alreadyProcessed: true }
      >(
        "/api/admin/leagues/process-month-end",
        undefined,
        {
          method: "POST",
          body: JSON.stringify(params ?? {}),
          auth: true,
        }
      );
    },
  };
}

function safeJsonParse(input: string) {
  try {
    return JSON.parse(input);
  } catch {
    return input;
  }
}
