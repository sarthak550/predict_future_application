import { buildAuthHeaders, type AuthTokenProvider } from "@predict-future/auth-shared";
import type {
  ApiCricketMatchDetail,
  ApiFootballMatchDetail,
  ApiGroupDetail,
  ApiGroupSummary,
  ApiHostEligibility,
  ApiHostStats,
  ApiLeaderboardResponse,
  ApiLeaderboardTimeWindow,
  ApiLiveScore,
  ApiMarketDetail,
  ApiMarketSummary,
  ApiMyProfile,
  ApiNewsFeedItem,
  ApiNotification,
  ApiPollListItem,
  ApiUserProfile,
  ApiVote,
  AppMarketCategory,
  AppMarketStatus
} from "@predict-future/types";

export type { ApiLeaderboardTimeWindow };

export type NewsFeedPage = {
  items: ApiNewsFeedItem[];
  nextCursor: string | null;
  hasMore: boolean;
};

export type ApiClientOptions = {
  baseUrl: string;
  getAuthToken?: AuthTokenProvider;
  fetchFn?: typeof fetch;
};

export type NewsQuery = {
  limit?: number;
  cursor?: string | null;
  category?: AppMarketCategory;
  excludeCategory?: string;
  userId?: string;
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
        userVote?: { side: string | null; numericValue: number | null } | null;
      }>(`/api/markets/${marketId}`, query, { auth: true });
    },
    placePosition(marketId: string, body: { side?: string; numericValue?: number; amount: number }, query?: { userId?: string }) {
      return request<{ ok: boolean }>(
        `/api/markets/${marketId}/positions`,
        query,
        {
          method: "POST",
          body: JSON.stringify(body),
          auth: true,
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
      return request<{ user: ApiUserProfile }>(`/api/profile/${username}`);
    },
    getUserProfile(username: string) {
      return request<{ user: ApiUserProfile }>(`/api/profile/${username}`);
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
  };
}

function safeJsonParse(input: string) {
  try {
    return JSON.parse(input);
  } catch {
    return input;
  }
}
