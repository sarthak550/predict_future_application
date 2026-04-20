import { mapInternalCategoryToNewsApi } from "@/lib/news/category-map";
import { createNormalizedNewsItem, fetchJsonWithRetry } from "@/lib/news/providers/shared";
import type { NormalizedNewsItem } from "@/lib/news/types";

type NewsApiResponse = {
  articles?: Array<{
    title?: string;
    description?: string;
    url?: string;
    urlToImage?: string;
    publishedAt?: string;
    source?: {
      name?: string;
    };
  }>;
};

const PAGE_SIZE = 10;
const TOP_HEADLINE_PAGES = 3;
const KEYWORD_PAGES = 2;

function getNewsApiKey() {
  const apiKey = process.env.NEWSAPI_API_KEY;
  if (!apiKey) {
    throw new Error("NEWSAPI_API_KEY is not configured.");
  }

  return apiKey;
}

function normalizeArticles(payload: NewsApiResponse, category?: string) {
  return (payload.articles ?? [])
    .filter((article) => article.title && article.url && article.source?.name)
    .map((article) =>
      createNormalizedNewsItem({
        provider: "newsapi",
        title: article.title ?? "",
        summary: article.description,
        sourceName: article.source?.name ?? "Unknown source",
        sourceUrl: article.url ?? "",
        imageUrl: article.urlToImage,
        publishedAt: article.publishedAt,
        category,
        rawPayloadJson: article as Record<string, unknown>
      })
    );
}

function dedupeItems(items: NormalizedNewsItem[]) {
  const seen = new Set<string>();

  return items.filter((item) => {
    if (seen.has(item.external_id)) {
      return false;
    }

    seen.add(item.external_id);
    return true;
  });
}

async function fetchTopHeadlinesPage(category: string, page: number) {
  const apiKey = getNewsApiKey();
  const endpoint = new URL("https://newsapi.org/v2/top-headlines");
  endpoint.searchParams.set("apiKey", apiKey);
  endpoint.searchParams.set("language", "en");
  endpoint.searchParams.set("country", "in");
  endpoint.searchParams.set("pageSize", String(PAGE_SIZE));
  endpoint.searchParams.set("page", String(page));
  endpoint.searchParams.set("category", category);

  const payload = await fetchJsonWithRetry<NewsApiResponse>(endpoint.toString(), {
    headers: {
      Accept: "application/json"
    },
    next: { revalidate: 0 }
  });

  return normalizeArticles(payload, category);
}

async function fetchKeywordPage(query: string, page: number) {
  const apiKey = getNewsApiKey();
  const endpoint = new URL("https://newsapi.org/v2/everything");
  endpoint.searchParams.set("apiKey", apiKey);
  endpoint.searchParams.set("language", "en");
  endpoint.searchParams.set("sortBy", "publishedAt");
  endpoint.searchParams.set("pageSize", String(PAGE_SIZE));
  endpoint.searchParams.set("page", String(page));
  endpoint.searchParams.set("q", query);

  const payload = await fetchJsonWithRetry<NewsApiResponse>(endpoint.toString(), {
    headers: {
      Accept: "application/json"
    },
    next: { revalidate: 0 }
  });

  return normalizeArticles(payload);
}

export async function fetchTopHeadlines(category?: string): Promise<NormalizedNewsItem[]> {
  const providerCategory = mapInternalCategoryToNewsApi(category);
  const pages = await Promise.all(
    Array.from({ length: TOP_HEADLINE_PAGES }, (_, index) => fetchTopHeadlinesPage(providerCategory, index + 1))
  );

  return dedupeItems(pages.flat());
}

export async function fetchByKeyword(query: string): Promise<NormalizedNewsItem[]> {
  const pages = await Promise.all(
    Array.from({ length: KEYWORD_PAGES }, (_, index) => fetchKeywordPage(query, index + 1))
  );

  return dedupeItems(pages.flat());
}
