import * as gnewsProvider from "@/lib/news/providers/gnewsProvider";
import * as newsApiProvider from "@/lib/news/providers/newsApiProvider";
import type { NormalizedNewsItem } from "@/lib/news/types";

async function withFallback<T>(primary: () => Promise<T>, fallback?: () => Promise<T>) {
  try {
    return await primary();
  } catch (error) {
    console.error("Primary news provider failed.", error);

    if (!fallback) {
      throw error;
    }

    return fallback();
  }
}

export async function fetchTopHeadlines(category?: string): Promise<NormalizedNewsItem[]> {
  const canFallback = Boolean(process.env.NEWSAPI_API_KEY);

  return withFallback(
    () => gnewsProvider.fetchTopHeadlines(category),
    canFallback ? () => newsApiProvider.fetchTopHeadlines(category) : undefined
  );
}

export async function fetchByKeyword(query: string): Promise<NormalizedNewsItem[]> {
  const canFallback = Boolean(process.env.NEWSAPI_API_KEY);

  return withFallback(
    () => gnewsProvider.fetchByKeyword(query),
    canFallback ? () => newsApiProvider.fetchByKeyword(query) : undefined
  );
}
