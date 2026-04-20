import { buildAuthHeaders, type AuthTokenProvider } from "@predict-future/auth-shared";
import type {
  ApiGroupDetail,
  ApiHostEligibility,
  ApiHostStats,
  ApiMarketDetail,
  ApiMarketSummary,
  ApiNewsFeedItem,
  AppMarketCategory
} from "@predict-future/types";

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
};

export type PublicMarketsQuery = {
  status?: string;
  category?: AppMarketCategory;
  q?: string;
  featured?: boolean;
  sort?: "rank" | "new" | "closing" | "featured";
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
      return request<NewsFeedPage>("/api/news", query);
    },
    getNewsDebug() {
      return request<Record<string, unknown>>("/api/news/debug");
    },
    getPublicMarkets(query?: PublicMarketsQuery) {
      return request<{ markets: ApiMarketSummary[] }>("/api/markets/public", query);
    },
    getMarketById(marketId: string) {
      return request<ApiMarketDetail>(`/api/markets/${marketId}`);
    },
    getHostEligibility() {
      return request<{ eligibility: ApiHostEligibility }>("/api/hosts/eligibility", undefined, { auth: true });
    },
    getUserHostStats(userId: string) {
      return request<ApiHostStats>(`/api/users/${userId}/host-stats`);
    },
    getGroupById(groupId: string) {
      return request<ApiGroupDetail>(`/api/groups/${groupId}`, undefined, { auth: true });
    },
    createMarket(body: unknown) {
      return request<{ market: { id: string } }>(
        "/api/markets/create",
        undefined,
        {
          method: "POST",
          body: JSON.stringify(body),
          auth: true
        }
      );
    }
  };
}

function safeJsonParse(input: string) {
  try {
    return JSON.parse(input);
  } catch {
    return input;
  }
}
