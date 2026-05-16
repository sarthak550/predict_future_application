import { createHash } from "crypto";

import { mapExternalCategoryToInternal } from "@/lib/news/category-map";
import type { NormalizedNewsItem } from "@/lib/news/types";

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function trimSummary(input: string, maxWords = 48) {
  const words = input.trim().split(/\s+/).filter(Boolean);
  const trimmed = words.slice(0, maxWords).join(" ");
  return words.length > maxWords ? `${trimmed}...` : trimmed;
}

const NULL_STRINGS = new Set(["null", "undefined", "NULL", "Null"]);

export function normalizeSummary(summary: string | null | undefined, title: string) {
  const raw = (summary ?? "").trim().replace(/\s+/g, " ");
  const candidate = NULL_STRINGS.has(raw) ? "" : raw;
  if (!candidate) {
    return trimSummary(title, 20);
  }

  return trimSummary(candidate, 48);
}

export function buildExternalNewsId(provider: string, sourceUrl: string, publishedAt?: string) {
  const hash = createHash("sha1")
    .update(`${provider}:${sourceUrl}:${publishedAt ?? ""}`)
    .digest("hex");

  return `${provider}:${hash}`;
}

function normalizeTitleForDedupe(title: string) {
  return title
    .trim()
    .toLowerCase()
    .replace(/&amp;/gi, "&")
    .replace(/[^\w\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function getSourceDomain(sourceUrl: string) {
  try {
    return new URL(sourceUrl).hostname.replace(/^www\./i, "").toLowerCase();
  } catch {
    return sourceUrl.trim().toLowerCase();
  }
}

export function buildNewsDedupeKey(title: string, sourceUrl: string) {
  return createHash("sha1")
    .update(`${normalizeTitleForDedupe(title)}:${getSourceDomain(sourceUrl)}`)
    .digest("hex");
}

export async function fetchJsonWithRetry<T>(url: string, init?: RequestInit, retries = 2): Promise<T> {
  let attempt = 0;
  let lastError: Error | null = null;

  while (attempt <= retries) {
    const response = await fetch(url, init);

    if (response.ok) {
      return (await response.json()) as T;
    }

    if (response.status === 429 || response.status >= 500) {
      lastError = new Error(`News provider request failed with status ${response.status}.`);
      if (attempt < retries) {
        const backoffMs = 500 * (attempt + 1);
        await new Promise((resolve) => setTimeout(resolve, backoffMs));
        attempt += 1;
        continue;
      }
    }

    throw new Error(`News provider request failed with status ${response.status}.`);
  }

  throw lastError ?? new Error("Unknown news provider error.");
}

let gnewsRequestQueue: Promise<void> = Promise.resolve();
let lastGnewsRequestFinishedAt = 0;

function getGnewsMinDelayMs() {
  const configured = Number(process.env.GNEWS_REQUEST_DELAY_MS ?? 1200);
  if (!Number.isFinite(configured)) {
    return 1200;
  }

  return Math.max(1000, Math.floor(configured));
}

export async function runGnewsRateLimited<T>(task: () => Promise<T>) {
  const minDelayMs = getGnewsMinDelayMs();

  const scheduled = gnewsRequestQueue.then(async () => {
    const waitMs = Math.max(0, lastGnewsRequestFinishedAt + minDelayMs - Date.now());
    if (waitMs > 0) {
      await sleep(waitMs);
    }

    try {
      return await task();
    } finally {
      lastGnewsRequestFinishedAt = Date.now();
    }
  });

  gnewsRequestQueue = scheduled.then(
    () => undefined,
    () => undefined
  );

  return scheduled;
}

export function createNormalizedNewsItem(input: {
  provider: string;
  title: string;
  summary?: string | null;
  sourceName: string;
  sourceUrl: string;
  imageUrl?: string | null;
  publishedAt?: string | null;
  category?: string | null;
  rawPayloadJson?: Record<string, unknown>;
}): NormalizedNewsItem {
  const publishedAt = input.publishedAt ? new Date(input.publishedAt) : new Date();

  return {
    title: input.title.trim(),
    summary: normalizeSummary(input.summary, input.title),
    source_name: input.sourceName.trim(),
    source_url: input.sourceUrl,
    image_url: input.imageUrl || undefined,
    published_at: publishedAt,
    category: mapExternalCategoryToInternal(input.category),
    external_id: buildExternalNewsId(input.provider, input.sourceUrl, input.publishedAt ?? publishedAt.toISOString()),
    dedupe_key: buildNewsDedupeKey(input.title, input.sourceUrl),
    raw_payload_json: input.rawPayloadJson
  };
}
