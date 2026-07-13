import { buildAuthHeaders, type AuthTokenProvider } from "@predict-future/auth-shared";
import type {
  ApiBigCallResponse,
  ApiCategoryTopResponse,
  ApiCricketMatchDetail,
  ApiDailyQuests,
  ApiExpertLeaderboardEntry,
  ApiExpertOpinionTallies,
  ApiExpertProfile,
  ApiFlagshipEvent,
  ApiF1SessionDetail,
  ApiFinanceExpertSentiment,
  ApiFinanceMarketsResponse,
  ApiInstrumentCatalogItem,
  ApiFollowerEntry,
  ApiFollowStatus,
  ApiFootballMatchDetail,
  ApiDiscoverGroupsResponse,
  ApiGroupDetail,
  ApiGroupJoinRequest,
  ApiGroupJoinRequestInboxItem,
  ApiGroupMember,
  ApiGroupSummary,
  AppGroupVisibility,
  AppMarketCategory as _AppMarketCategory,
  ApiHostEligibility,
  ApiHostStats,
  ApiLeaderboardResponse,
  ApiLeaderboardTimeWindow,
  ApiLeagueEntry,
  ApiLeagueStandingsPage,
  ApiLiveScore,
  ApiMarketComment,
  ApiMarketDetail,
  ApiMarketSummary,
  ApiMyProfile,
  ApiMyPositionsResponse,
  ApiTopExpertEntry,
  ApiNewsFeedItem,
  ApiNotification,
  ApiPhoneVerifyConfirmResponse,
  ApiPhoneVerifyResponse,
  ApiPlacePositionResponse,
  ApiPlatformStats,
  ApiProbabilityHistory,
  ApiReferralInfo,
  ApiStory,
  ApiUserCalibration,
  ApiUserPortfolio,
  ApiUserProfile,
  ApiVote,
  ProfileRecentCall,
  AppLeagueTier,
  AppMarketCategory,
  AppMarketStatus,
  AppUserDisplayMode,
  // S58: notification prefs + cover image
  ApiGroupNotifPref,
  ApiGroupCoverImageToken,
  ApiGroupCoverImageUpdate,
  ApiUserNotificationDefaults,
  GroupNotifLevel,
  // Legacy Market-based news polls ("Predict Now")
  ApiPollListItem,
  // S62: new Poll model (free-vote predictions)
  ApiPoll,
  ApiPollDetail,
  ApiPollPack,
  AppPollStatus,
  // S72: India Macro panel
  ApiFinanceMacroResponse,
  // Market Pulse (Phase 1)
  ApiMarketMoveEventsResponse,
  ApiMarketMoversResponse,
  // Market Pulse (Phase 1c) — Google News per-ticker headlines
  ApiMarketMoveNewsResponse,
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
  /** When true, authenticated users see stories boosted by followed-analyst signals. */
  personalized?: boolean;
  /** When set, restrict feed to stories that have at least one expert opinion tagged to this MarketEventCluster. */
  expertOpinionClusterId?: string;
  /** Direction filter — only stories with at least one matching opinion are returned. */
  expertOpinionDirection?: "BULLISH" | "BEARISH" | "NEUTRAL";
  /** True → only stories with at least one verified-analyst opinion. */
  expertOpinionVerified?: boolean;
  /** True → only stories with at least one RESOLVED_HIT / RESOLVED_MISS opinion. */
  expertOpinionResolved?: boolean;
  /** Substring match on opinion.instrument OR opinion.instrumentTicker (case-insensitive). */
  expertOpinionInstrument?: string;
  /** Restrict to opinions authored by this expertId. */
  expertOpinionAnalyst?: string;
  /** "ANALYST" → isSourceAttribution=false; "PUBLICATION" → isSourceAttribution=true. */
  expertOpinionSourceType?: "ANALYST" | "PUBLICATION";
  /**
   * When true, exclude stories from the 6 pure-global RSS sources (BBC World, ESPN,
   * TechCrunch, CNBC, The Verge, Ars Technica) — shows only India-relevant news.
   * When false or absent, full global mix is returned.
   */
  indiaOnly?: boolean;
};

export type PublicMarketsQuery = {
  status?: string;
  category?: AppMarketCategory;
  q?: string;
  limit?: number;
  cursor?: string | null;
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
      return request<{ markets: ApiMarketSummary[]; nextCursor?: string | null; hasMore?: boolean }>("/api/markets/public", query);
    },
    getMarketById(marketId: string, query?: { userId?: string }) {
      return request<ApiMarketDetail & {
        userPositions?: Array<{ id: string; side: string | null; amount: number; numericValue: number | null; createdAt: string }>;
        userMultiChoicePositions?: Array<{ optionId: string; amount: number }>;
        userVote?: { side: string | null; numericValue: number | null } | null;
      }>(`/api/markets/${marketId}`, query, { auth: true });
    },
    placePosition(marketId: string, body: { side?: string; numericValue?: number; amount: number; reasoning?: string }, query?: { userId?: string }) {
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
    placeMultiChoicePosition(marketId: string, body: { optionId: string; amount: number; reasoning?: string | null }) {
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
    /**
     * Fetch full F1 session detail: leaderboard, lap times, gaps, tire stints.
     * Public endpoint — no auth required.
     * sessionKey is the OpenF1 session_key (numeric), extracted from the match id "f1-{N}".
     */
    getF1SessionDetail(sessionKey: number, init?: RequestOptions) {
      return request<ApiF1SessionDetail>(`/api/sports/f1/session/${sessionKey}`, undefined, init);
    },
    getLeaderboard(query?: { category?: AppMarketCategory; timeWindow?: ApiLeaderboardTimeWindow }) {
      return request<ApiLeaderboardResponse>("/api/leaderboard", query, { auth: true });
    },
    getProfile(username: string) {
      return request<{ user: ApiUserProfile; recentCalls: ProfileRecentCall[] }>(`/api/profile/${username}`, undefined, { auth: true });
    },
    getUserProfile(username: string) {
      return request<{ user: ApiUserProfile; recentCalls: ProfileRecentCall[] }>(`/api/profile/${username}`, undefined, { auth: true });
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
    /**
     * Fetch the authenticated user's full positions list (no take:10 cap).
     * Use this to power the "My Bets" screen. Auth: required.
     */
    getMyPositions() {
      return request<ApiMyPositionsResponse>(
        "/api/profile/me/positions",
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
    createGroup(
      body: {
        name: string;
        description?: string;
        visibility?: AppGroupVisibility;
        category?: _AppMarketCategory | null;
        coverImageUrl?: string | null;
      },
      query?: { userId?: string }
    ) {
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
    joinOpenGroup(groupId: string) {
      return request<{ group: { id: string; name: string; slug: string } }>(
        `/api/groups/${groupId}/join`,
        undefined,
        { method: "POST", auth: true }
      );
    },
    discoverGroups(query?: {
      category?: _AppMarketCategory;
      sort?: "members" | "recent" | "new";
      cursor?: string;
      limit?: number;
    }) {
      return request<ApiDiscoverGroupsResponse>("/api/groups/discover", query);
    },
    getGroupMembers(groupId: string, query?: { cursor?: string; limit?: number }) {
      return request<{ members: ApiGroupMember[]; nextCursor: string | null }>(
        `/api/groups/${groupId}/members`,
        query,
        { auth: true }
      );
    },
    removeGroupMember(groupId: string, userId: string) {
      return request<void>(
        `/api/groups/${groupId}/members/${userId}`,
        undefined,
        { method: "DELETE", auth: true }
      );
    },
    banGroupMember(groupId: string, body: { userId: string; reason?: string }) {
      return request<{ banned: boolean }>(
        `/api/groups/${groupId}/ban`,
        undefined,
        { method: "POST", body: JSON.stringify(body), auth: true }
      );
    },
    unbanGroupMember(groupId: string, body: { userId: string }) {
      return request<{ banned: boolean }>(
        `/api/groups/${groupId}/unban`,
        undefined,
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

    // ── S56: Join-request flow ──────────────────────────────────────────

    /** Submit a join request to a REQUEST_TO_JOIN group. */
    submitGroupJoinRequest(groupId: string) {
      return request<{ requestId: string; status: "PENDING" } | { alreadyMember: true }>(
        `/api/groups/${groupId}/join-request`,
        undefined,
        { method: "POST", auth: true }
      );
    },

    /** Cancel a pending join request (requester only). */
    cancelGroupJoinRequest(groupId: string, requestId: string) {
      return request<void>(
        `/api/groups/${groupId}/join-request/${requestId}`,
        undefined,
        { method: "DELETE", auth: true }
      );
    },

    /** Approve a pending join request (OWNER/ADMIN only). */
    approveGroupJoinRequest(groupId: string, requestId: string) {
      return request<{ approved: boolean }>(
        `/api/groups/${groupId}/join-request/${requestId}/approve`,
        undefined,
        { method: "POST", auth: true }
      );
    },

    /** Reject a pending join request (OWNER/ADMIN only). */
    rejectGroupJoinRequest(groupId: string, requestId: string, body?: { note?: string }) {
      return request<{ rejected: boolean }>(
        `/api/groups/${groupId}/join-request/${requestId}/reject`,
        undefined,
        { method: "POST", body: JSON.stringify(body ?? {}), auth: true }
      );
    },

    /** Get paginated pending join requests for a group (OWNER/ADMIN only). */
    getGroupJoinRequests(
      groupId: string,
      query?: { status?: "PENDING" | "APPROVED" | "REJECTED"; cursor?: string; limit?: number }
    ) {
      return request<{ requests: ApiGroupJoinRequestInboxItem[]; nextCursor: string | null }>(
        `/api/groups/${groupId}/join-requests`,
        query as Record<string, string | number | boolean | undefined>,
        { auth: true }
      );
    },

    /** Get the calling user's own join requests across all groups. */
    getMyGroupJoinRequests() {
      return request<{ requests: ApiGroupJoinRequest[] }>(
        "/api/groups/join-requests/mine",
        undefined,
        { auth: true }
      );
    },

    // ── S57: Member self-service ────────────────────────────────────────

    /**
     * Voluntarily leave a group. Caller must be ADMIN or MEMBER.
     * OWNERs are rejected with code owner_must_transfer_or_archive (409).
     */
    leaveGroup(groupId: string) {
      return request<{ left: boolean }>(
        `/api/groups/${groupId}/leave`,
        undefined,
        { method: "POST", auth: true }
      );
    },

    /**
     * Transfer group ownership to another non-banned member.
     * Caller must be OWNER. Outgoing owner is demoted to ADMIN.
     */
    transferOwnership(groupId: string, body: { newOwnerId: string }) {
      return request<{ transferred: boolean; newOwnerId: string }>(
        `/api/groups/${groupId}/transfer-ownership`,
        undefined,
        { method: "POST", body: JSON.stringify(body), auth: true }
      );
    },

    /**
     * Archive a group (OWNER only). Flips isArchived = true. Not reversible in v1.
     * Idempotent — calling on an already-archived group returns 200.
     */
    archiveGroup(groupId: string) {
      return request<{ archived: boolean }>(
        `/api/groups/${groupId}/archive`,
        undefined,
        { method: "POST", auth: true }
      );
    },

    /**
     * Update a group's name and/or description (OWNER or ADMIN only).
     * S58-T6: used by the group edit screen.
     */
    updateGroup(
      groupId: string,
      body: { name?: string; description?: string }
    ) {
      return request<{ group: ApiGroupSummary }>(
        `/api/groups/${groupId}`,
        undefined,
        { method: "PATCH", body: JSON.stringify(body), auth: true }
      );
    },

    // ── S58: Notification preferences ────────────────────────────────────────

    /**
     * Get the calling user's notification preference for a specific group.
     * Returns { level: "ALL" | "MENTIONS_ONLY" | "NONE" }.
     * If no pref row exists, returns { level: "ALL" } without creating a row.
     */
    getGroupNotifPref(groupId: string) {
      return request<ApiGroupNotifPref>(
        `/api/groups/${groupId}/notification-preference`,
        undefined,
        { auth: true }
      );
    },

    /**
     * Upsert the calling user's notification preference for a specific group.
     * Returns { level } with the saved value.
     */
    setGroupNotifPref(
      groupId: string,
      body: { level: GroupNotifLevel }
    ) {
      return request<ApiGroupNotifPref>(
        `/api/groups/${groupId}/notification-preference`,
        undefined,
        { method: "PATCH", body: JSON.stringify(body), auth: true }
      );
    },

    // ── S58: Cover image upload ───────────────────────────────────────────────

    /**
     * Request a short-lived Vercel Blob client upload token for a group cover image.
     * Returns { clientToken, url } — use clientToken to upload directly to Blob.
     */
    getGroupCoverImageUploadToken(
      groupId: string,
      body: { filename: string; contentType: string }
    ) {
      return request<ApiGroupCoverImageToken>(
        `/api/groups/${groupId}/cover-image`,
        undefined,
        { method: "POST", body: JSON.stringify(body), auth: true }
      );
    },

    /**
     * Persist the Vercel Blob URL to Group.coverImageUrl.
     * Server validates the URL starts with the Vercel Blob hostname.
     */
    updateGroupCoverImage(
      groupId: string,
      body: { coverImageUrl: string }
    ) {
      return request<ApiGroupCoverImageUpdate>(
        `/api/groups/${groupId}/cover-image`,
        undefined,
        { method: "PATCH", body: JSON.stringify(body), auth: true }
      );
    },

    // ── S59-T2: User-level notification defaults ──────────────────────────────

    /**
     * Get the calling user's global default group notification level.
     * Server-authoritative; replaces AsyncStorage "@groups_notif_default" key from S58.
     */
    getUserNotificationDefaults() {
      return request<ApiUserNotificationDefaults>(
        "/api/users/me/notification-defaults",
        undefined,
        { auth: true }
      );
    },

    /**
     * Update the calling user's global default group notification level.
     * Returns the saved value.
     */
    updateUserNotificationDefaults(body: { defaultGroupNotificationLevel: GroupNotifLevel }) {
      return request<ApiUserNotificationDefaults>(
        "/api/users/me/notification-defaults",
        undefined,
        { method: "PATCH", body: JSON.stringify(body), auth: true }
      );
    },

    // ── S59-T4: Bulk approve/reject join requests ─────────────────────────────

    /**
     * Bulk-approve up to 50 pending join requests in one call.
     * Per-row try/catch — single bad ID doesn't poison the batch.
     */
    bulkApproveGroupJoinRequests(
      groupId: string,
      body: { requestIds: string[] }
    ) {
      return request<{ results: Array<{ requestId: string; success: boolean; error?: string }> }>(
        `/api/groups/${groupId}/join-requests/bulk-approve`,
        undefined,
        { method: "POST", body: JSON.stringify(body), auth: true }
      );
    },

    /**
     * Bulk-reject up to 50 pending join requests in one call.
     * Per-row try/catch — single bad ID doesn't poison the batch.
     */
    bulkRejectGroupJoinRequests(
      groupId: string,
      body: { requestIds: string[]; note?: string }
    ) {
      return request<{ results: Array<{ requestId: string; success: boolean; error?: string }> }>(
        `/api/groups/${groupId}/join-requests/bulk-reject`,
        undefined,
        { method: "POST", body: JSON.stringify(body), auth: true }
      );
    },

    // ── S59-T5: Featured group admin route ────────────────────────────────────

    /**
     * Set or clear the isFeatured flag on a group.
     * Requires platform ADMIN or MODERATOR role.
     */
    featureGroup(groupId: string, body: { featured: boolean }) {
      return request<{ isFeatured: boolean }>(
        `/api/admin/groups/${groupId}/feature`,
        undefined,
        { method: "POST", body: JSON.stringify(body), auth: true }
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
      return request<{ comments: ApiMarketComment[] }>(
        `/api/markets/${marketId}/comments`
      );
    },
    postMarketComment(marketId: string, body: { content: string }) {
      return request<{ comment: ApiMarketComment }>(
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

    /** Locks the user's IMPLICATION vote (one-way). Returns updated tallies. */
    lockExpertOpinionVote(opinionId: string) {
      return request<ApiExpertOpinionTallies>(
        `/api/finance/expert-opinions/${opinionId}/lock-vote`,
        undefined,
        { method: "POST", auth: true }
      );
    },

    // ─── Finance: Expert Sentiment Aggregate ──────────────────────────────
    getFinanceExpertSentiment() {
      return request<ApiFinanceExpertSentiment>("/api/finance/expert-sentiment");
    },

    // ─── Finance: Instrument Catalog (S44-T1) ─────────────────────────────
    /** Fetch the full instrument catalog sorted by opinion count. No auth required. */
    getFinanceInstruments() {
      return request<{ items: ApiInstrumentCatalogItem[] }>("/api/finance/instruments");
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

    searchExperts(q: string) {
      return request<import("@predict-future/types").ApiExpertSearchResult[]>(
        `/api/finance/experts/search`,
        { q }
      );
    },

    /**
     * Top experts ranked by hit-rate over a rolling 7-day window.
     * Only experts with >= 3 resolved calls qualify.
     * Public endpoint — no auth required.
     */
    getTopWeeklyExperts() {
      return request<ApiTopExpertEntry[]>("/api/experts/top-weekly");
    },

    getVerifiedCalls() {
      return request<import("@predict-future/types").ApiVerifiedCall[]>(
        `/api/finance/verified-calls`
      );
    },

    // ─── Finance: My Calls Digest (S33-T2) ────────────────────────────────
    getMyCallsDigest() {
      return request<import("@predict-future/types").ApiMyCallsDigest>(
        `/api/finance/my-calls-digest`,
        undefined,
        { auth: true }
      );
    },

    // ─── Finance: Today's Big Call spotlight (S35-T2, window-aware S37-T2) ──
    getFinanceBigCall() {
      return request<import("@predict-future/types").ApiFinanceBigCallResponse>(
        `/api/finance/big-call`
      );
    },

    // ─── Finance: India Macro panel (S72) ─────────────────────────────────
    /**
     * Returns the latest MacroSnapshot from the warm store.
     * Served from the DB (not live-fetched from IMF/RBI on request).
     * Returns 404 if the cron has not yet seeded the first snapshot.
     */
    getFinanceMacro() {
      return request<ApiFinanceMacroResponse>(`/api/finance/macro`);
    },

    // ─── Market Pulse: NSE/BSE announcements + movers (Phase 1) ───────────
    /** Paginated, reverse-chronological corporate-announcements feed. No auth required. */
    getMarketMoveEvents(params?: { cursor?: string; limit?: number; tickerSymbol?: string }) {
      return request<ApiMarketMoveEventsResponse>(
        "/api/finance/market-moves/events",
        params
      );
    },

    /** Today's top gainers/losers over the curated NIFTY 200 universe. No auth required. */
    getMarketMovers() {
      return request<ApiMarketMoversResponse>("/api/finance/market-moves/movers");
    },

    // ─── Market Pulse: Google News per-ticker headlines (Phase 1c) ────────
    /** Paginated, reverse-chronological readable news feed. No auth required. */
    getMarketMoveNews(params?: { cursor?: string; limit?: number; tickerSymbol?: string }) {
      return request<ApiMarketMoveNewsResponse>(
        "/api/finance/market-moves/news",
        params
      );
    },

    /** Fetch a single ExpertOpinion's full detail by id. */
    getFinanceOpinion(opinionId: string) {
      return request<import("@predict-future/types").ApiFinanceOpinionDetail>(
        `/api/finance/expert-opinions/${opinionId}`
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

    // ─── Platform stats (S25-T1) ───────────────────────────────────────────────

    /**
     * Fetch aggregate platform accuracy stats.
     * Public endpoint — no auth required. Cached for 10 minutes.
     */
    getPlatformStats() {
      return request<ApiPlatformStats>("/api/platform/stats");
    },

    // ─── Phone verification (S25-T6) ──────────────────────────────────────────

    /**
     * Initiate phone verification: generate + store OTP, save phone on user.
     * In dev mode (PHONE_VERIFY_MODE != "prod") the response includes the OTP.
     * Auth: required.
     */
    requestPhoneVerification(phone: string) {
      return request<ApiPhoneVerifyResponse>(
        "/api/users/me/verify-phone",
        undefined,
        {
          method: "POST",
          body: JSON.stringify({ phone }),
          auth: true,
        }
      );
    },

    /**
     * Confirm a phone verification OTP.
     * On success awards +100 DAILY_BONUS pts and sets phoneVerified=true.
     * Idempotent — returns { alreadyVerified: true } if already verified.
     * Auth: required.
     */
    confirmPhoneVerification(otp: string) {
      return request<ApiPhoneVerifyConfirmResponse>(
        "/api/users/me/verify-phone/confirm",
        undefined,
        {
          method: "POST",
          body: JSON.stringify({ otp }),
          auth: true,
        }
      );
    },

    // ─── Comment tips (S26-T2) ────────────────────────────────────────────────

    /**
     * Tip a comment a fixed amount of points.
     * Default amount: 5 pts. Max: 50 pts. Daily cap: 50 pts total given.
     * Returns updated tipsReceived on the comment and remaining daily budget.
     * Auth: required.
     */
    tipComment(commentId: string, amount?: number) {
      return request<{ ok: boolean; newTipsReceived: number; dailyTipsRemaining: number }>(
        `/api/comments/${commentId}/tip`,
        undefined,
        {
          method: "POST",
          body: JSON.stringify({ amount }),
          auth: true,
        }
      );
    },

    // ─── Shareable Portfolio (S26-T4) ─────────────────────────────────────────

    /**
     * Fetch a user's public portfolio snapshot.
     * Public endpoint — no auth required.
     * Contains accuracy, predictions, net points, streak, followers,
     * recent resolved markets, and open markets.
     * Sensitive fields (email, phone, wallet balance, referral code) are
     * deliberately excluded by the server.
     */
    getUserPortfolio(username: string) {
      return request<ApiUserPortfolio>(`/api/portfolio/${username}`);
    },

    // ─── Anonymous mode (S26-T5) ──────────────────────────────────────────────

    /**
     * Update the authenticated user's display mode.
     *
     * When set to ANONYMOUS, the user appears as "AnonymousAnalyst_XXXXXX"
     * (a deterministic pseudonym based on sha256(userId)) across all public
     * surfaces: leaderboard, market creator, comment author, followers/following
     * lists, and public profiles.
     *
     * Accuracy, league tier, quests, and wallet balance are unaffected — they
     * continue to accrue to the real userId regardless of this setting.
     *
     * Auth: required.
     */
    setDisplayMode(displayMode: AppUserDisplayMode) {
      return request<{ displayMode: AppUserDisplayMode }>(
        "/api/users/me/display-mode",
        undefined,
        {
          method: "PATCH",
          body: JSON.stringify({ displayMode }),
          auth: true,
        }
      );
    },

    // ─── Big Call (S27-T1) ────────────────────────────────────────────────────

    /**
     * Fetch today's Big Call market (IST day).
     * Returns { market: null } if no Big Call has been designated today.
     * Public endpoint — no auth required. Cached for 60s on the CDN.
     */
    getTodayBigCall() {
      return request<ApiBigCallResponse>("/api/markets/today-big-call");
    },

    /**
     * Fire-and-forget tap tracking for the Big Call card.
     * Increments bigCallNotificationOpenedCount on the market by 1.
     * No auth required. Failures are swallowed — analytics must not block navigation.
     */
    trackBigCallOpened(marketId: string) {
      return request<{ count: number }>(
        `/api/markets/${marketId}/big-call-tap`,
        undefined,
        { method: "POST" }
      );
    },

    /**
     * Designate a market as today's Big Call. Admin only.
     * Clears any existing Big Call for the same date first.
     * Optional body: { date?: string } (YYYY-MM-DD) — defaults to today IST.
     * Auth: required (admin).
     */
    markMarketAsBigCall(marketId: string, date?: string) {
      return request<{ marketId: string; isBigCallDate: string | null }>(
        `/api/admin/markets/${marketId}/mark-big-call`,
        undefined,
        {
          method: "POST",
          body: JSON.stringify(date ? { date } : {}),
          auth: true,
        }
      );
    },

    /**
     * Fetch probability history snapshots for the consensus-line chart.
     * Returns all hourly points for markets <= 7 days old; daily aggregates for older markets.
     * Public endpoint — no auth required. Cached for 5 minutes on the CDN.
     */
    getProbabilityHistory(marketId: string) {
      return request<ApiProbabilityHistory>(
        `/api/markets/${marketId}/probability-history`
      );
    },

    // ─── Expert Follow System (S28-T1) ────────────────────────────────────────

    /**
     * Follow a named expert analyst. Auth required.
     * Idempotent — safe to call if already following.
     * Returns { following: true }
     */
    followExpert(expertId: string) {
      return request<{ following: boolean }>(
        `/api/finance/experts/${expertId}/follow`,
        undefined,
        { method: "POST", auth: true }
      );
    },

    /**
     * Unfollow a named expert analyst. Auth required.
     * Idempotent — safe to call even if not currently following.
     * Returns { following: false }
     */
    unfollowExpert(expertId: string) {
      return request<{ following: boolean }>(
        `/api/finance/experts/${expertId}/follow`,
        undefined,
        { method: "DELETE", auth: true }
      );
    },

    /**
     * Fetch the list of expert IDs the current user follows.
     * Returns an empty array when unauthenticated.
     * Auth: optional (returns [] when unauthenticated).
     */
    getFollowedExperts() {
      return request<{ expertIds: string[] }>(
        "/api/finance/experts/followed",
        undefined,
        { auth: true }
      ).then((res) => res.expertIds);
    },

    // ─── Reasoning upvotes (S30-T1) ───────────────────────────────────────────

    /**
     * Toggle upvote on a position's reasoning. Auth required.
     * Cannot upvote own positions (403).
     * Returns { upvoted: boolean; count: number }.
     */
    upvotePositionReasoning(positionId: string) {
      return request<{ upvoted: boolean; count: number }>(
        `/api/positions/${positionId}/upvote-reasoning`,
        undefined,
        { method: "POST", auth: true }
      );
    },

    /**
     * Update the reasoning text on an existing position (used for flagship polls
     * where the side is locked but the reasoning can be refined).
     */
    updatePositionReasoning(positionId: string, reasoning: string | null) {
      return request<{ ok: true; reasoning: string | null }>(
        `/api/positions/${positionId}/reasoning`,
        undefined,
        { method: "PATCH", body: JSON.stringify({ reasoning }), auth: true }
      );
    },

    // ─── Notifications: unread count + mark all read (S30-T4) ─────────────────

    /**
     * Fetch the current user's unread notification count.
     * Auth: required. Cache-Control: no-store.
     */
    getNotificationsUnreadCount() {
      return request<{ count: number }>(
        "/api/notifications/unread-count",
        undefined,
        { auth: true }
      );
    },

    /**
     * Mark all unread notifications for the current user as read.
     * Auth: required.
     * Returns { updated: number }.
     */
    markAllNotificationsRead() {
      return request<{ updated: number }>(
        "/api/notifications/mark-all-read",
        undefined,
        { method: "POST", auth: true }
      );
    },

    // ─── Saved/Bookmarked Markets (S31-T5) ────────────────────────────────────

    /**
     * Toggle bookmark on a market. Auth required.
     * Idempotent: calling again unsaves.
     * Returns { saved: boolean }.
     */
    toggleSaveMarket(marketId: string) {
      return request<{ saved: boolean }>(
        `/api/markets/${marketId}/save`,
        undefined,
        { method: "POST", auth: true }
      );
    },

    /**
     * Fetch the authenticated user's bookmarked markets, cursor-paginated.
     * Auth: required.
     */
    getSavedMarkets(query?: { limit?: number; cursor?: string }) {
      return request<{
        markets: ApiMarketSummary[];
        nextCursor: string | null;
        hasMore: boolean;
      }>(
        "/api/users/me/saved-markets",
        query,
        { auth: true }
      );
    },

    /** The authenticated user's OWN created markets (for the "My Markets" filter). */
    getMyCreatedMarkets(query?: { limit?: number; cursor?: string }) {
      return request<{
        markets: ApiMarketSummary[];
        nextCursor: string | null;
        hasMore: boolean;
      }>(
        "/api/users/me/created-markets",
        query,
        { auth: true }
      );
    },

    // ─── Flagship Events (S32-T1) ─────────────────────────────────────────────

    /**
     * Fetch the upcoming flagship finance events carousel.
     * Returns OPEN markets with flagshipEventAt in the future, sorted ASC.
     * Public endpoint — no auth required.
     */
    getFlagshipEvents() {
      return request<{ events: ApiFlagshipEvent[] }>(
        "/api/finance/flagship-events"
      );
    },

    /**
     * Set or clear the flagship event designation on a market.
     * Pass null for both fields to clear the designation.
     * Auth: required (admin/moderator).
     */
    markMarketAsFlagship(
      marketId: string,
      data: { flagshipEventAt: string | null; flagshipEventType: string | null }
    ) {
      return request<{
        market: {
          id: string;
          title: string;
          status: string;
          flagshipEventAt: string | null;
          flagshipEventType: string | null;
        };
      }>(
        `/api/admin/markets/${marketId}/mark-flagship`,
        undefined,
        { method: "POST", body: JSON.stringify(data), auth: true }
      );
    },

    /**
     * Fire-and-forget analytics event tracker.
     *
     * Posts a named event with an optional payload to the analytics endpoint.
     * No auth required. Failures are swallowed — analytics must never block UX.
     *
     * Usage:
     *   void mobileApi.track("analysts_footer_tapped").catch(() => {});
     *   void mobileApi.track("analysts_badge_tapped", { surface: "feed_card" }).catch(() => {});
     */
    track(eventName: string, payload?: Record<string, unknown>) {
      return request<{ ok: boolean }>(
        "/api/analytics/events",
        undefined,
        {
          method: "POST",
          body: JSON.stringify({ event: eventName, payload: payload ?? {} }),
        }
      );
    },

    // ── S62: Poll model ───────────────────────────────────────────────────

    /**
     * List Poll-model polls.
     * Public — no auth required.
     *
     * @param query.packId  - Restrict to polls sharing this packId.
     * @param query.status  - "open" (default) | "closed" | "resolved" | "all"
     */
    getPolls(query?: { status?: "open" | "closed" | "all"; category?: AppMarketCategory }) {
      // Legacy: Market-based news polls ("Predict Now"). Stays on Market until Phase 2.
      return request<{ polls: ApiPollListItem[] }>("/api/polls", query, { auth: true });
    },

    /**
     * List NEW Poll-model polls (RBI MPC packs etc.) — distinct from the legacy
     * Market-based `getPolls` above. Mobile groups the result by `packId`.
     */
    getPollPacks(query?: { packId?: string; status?: "open" | "closed" | "resolved" | "all" }) {
      return request<{ polls: ApiPoll[] }>("/api/polls/packs", query, { auth: true });
    },

    /**
     * Fetch a single poll with per-option vote counts and (if authed) the
     * caller's existing vote.
     * Auth: optional.
     */
    getPoll(pollId: string) {
      return request<{ poll: ApiPollDetail }>(`/api/polls/${pollId}`, undefined, {
        auth: true,
      });
    },

    /**
     * Cast or update a free-vote prediction on a Poll.
     * Auth: required.
     *
     * @param pollId   - The poll to vote on.
     * @param optionId - The PollOption.id the user is selecting.
     */
    votePoll(pollId: string, optionId: string) {
      return request<{
        ok: boolean;
        userVote: { optionId: string; lockedAt: string };
        options: ApiPoll["options"];
        totalVotes: number;
      }>(
        `/api/polls/${pollId}/vote`,
        undefined,
        {
          method: "POST",
          body: JSON.stringify({ optionId }),
          auth: true,
        }
      );
    },
  };
}

export type { ApiPoll, ApiPollDetail, ApiPollPack, AppPollStatus };

function safeJsonParse(input: string) {
  try {
    return JSON.parse(input);
  } catch {
    return input;
  }
}
