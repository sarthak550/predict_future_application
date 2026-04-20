import { mapInternalCategoryToGNews } from "@/lib/news/category-map";
import {
  createNormalizedNewsItem,
  fetchJsonWithRetry,
  runGnewsRateLimited
} from "@/lib/news/providers/shared";
import type { NormalizedNewsItem } from "@/lib/news/types";

type GNewsResponse = {
  articles?: Array<{
    title?: string;
    description?: string;
    url?: string;
    image?: string;
    publishedAt?: string;
    source?: {
      name?: string;
      url?: string;
    };
  }>;
};

const PAGE_SIZE = 10;
const DEFAULT_TOP_HEADLINE_PAGES = 1;
const DEFAULT_KEYWORD_PAGES = 1;

function getPageCount(envKey: "GNEWS_TOP_HEADLINE_PAGES" | "GNEWS_KEYWORD_PAGES", fallback: number) {
  const configured = Number(process.env[envKey] ?? fallback);
  if (!Number.isFinite(configured)) {
    return fallback;
  }

  return Math.max(1, Math.min(5, Math.floor(configured)));
}

function getGNewsApiKey() {
  const apiKey = process.env.GNEWS_API_KEY;
  if (!apiKey) {
    throw new Error("GNEWS_API_KEY is not configured.");
  }

  return apiKey;
}

function normalizeArticles(payload: GNewsResponse, category?: string) {
  return (payload.articles ?? [])
    .filter((article) => article.title && article.url && article.source?.name)
    .map((article) =>
      createNormalizedNewsItem({
        provider: "gnews",
        title: article.title ?? "",
        summary: article.description,
        sourceName: article.source?.name ?? "Unknown source",
        sourceUrl: article.url ?? article.source?.url ?? "",
        imageUrl: article.image,
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
  const apiKey = getGNewsApiKey();
  const endpoint = new URL("https://gnews.io/api/v4/top-headlines");
  endpoint.searchParams.set("apikey", apiKey);
  endpoint.searchParams.set("lang", "en");
  endpoint.searchParams.set("country", "in");
  endpoint.searchParams.set("max", String(PAGE_SIZE));
  endpoint.searchParams.set("page", String(page));
  endpoint.searchParams.set("category", category);

  const payload = await runGnewsRateLimited(() =>
    fetchJsonWithRetry<GNewsResponse>(endpoint.toString(), {
      headers: {
        Accept: "application/json"
      },
      next: { revalidate: 0 }
    })
  );

  return normalizeArticles(payload, category);
}

async function fetchKeywordPage(query: string, page: number) {
  const apiKey = getGNewsApiKey();
  const endpoint = new URL("https://gnews.io/api/v4/search");
  endpoint.searchParams.set("apikey", apiKey);
  endpoint.searchParams.set("lang", "en");
  endpoint.searchParams.set("country", "in");
  endpoint.searchParams.set("max", String(PAGE_SIZE));
  endpoint.searchParams.set("page", String(page));
  endpoint.searchParams.set("q", query);

  const payload = await runGnewsRateLimited(() =>
    fetchJsonWithRetry<GNewsResponse>(endpoint.toString(), {
      headers: {
        Accept: "application/json"
      },
      next: { revalidate: 0 }
    })
  );

  return normalizeArticles(payload);
}

export async function fetchTopHeadlines(category?: string): Promise<NormalizedNewsItem[]> {
  const providerCategory = mapInternalCategoryToGNews(category);
  const pageCount = getPageCount("GNEWS_TOP_HEADLINE_PAGES", DEFAULT_TOP_HEADLINE_PAGES);
  const pages: NormalizedNewsItem[][] = [];

  for (let index = 0; index < pageCount; index += 1) {
    pages.push(await fetchTopHeadlinesPage(providerCategory, index + 1));
  }

  return dedupeItems(pages.flat());
}

export async function fetchByKeyword(query: string): Promise<NormalizedNewsItem[]> {
  const pageCount = getPageCount("GNEWS_KEYWORD_PAGES", DEFAULT_KEYWORD_PAGES);
  const pages: NormalizedNewsItem[][] = [];

  for (let index = 0; index < pageCount; index += 1) {
    pages.push(await fetchKeywordPage(query, index + 1));
  }

  return dedupeItems(pages.flat());
}
