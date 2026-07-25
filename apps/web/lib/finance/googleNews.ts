/**
 * Instrument Page v2 (T4) — on-demand Google News RSS fetch for a single
 * ticker, used by enrichment.ts to fill the long-tail coverage gap (Decision
 * 4 in the CTO assignment brief). Deliberately DUPLICATED, not imported,
 * from apps/api/lib/marketMoves/googleNews.ts's `fetchGoogleNewsForTicker` —
 * apps/web and apps/api are separate deployed Next apps with no cross-app
 * import path (same reasoning apps/api's own file gives for duplicating
 * decodeGoogleNewsSource out of rssProvider.ts: "keep marketMoves/
 * self-contained, per the module boundary already established").
 *
 * The relevance/recency/quality RULES themselves are NOT duplicated — they
 * live once in @predict-future/business-rules/marketPulse/newsQuality,
 * imported here exactly as apps/api's cron does, so both the cron's
 * universe-wide sweep and this on-demand path apply byte-identical
 * filtering. Only the RSS fetch/parse/dedupe plumbing is copied.
 *
 * Never throws — every failure resolves to an empty array, matching
 * fundamentals.ts's contract, so a bad ticker never breaks a page render.
 */

import { createHash } from "crypto";
import Parser from "rss-parser";

import {
  isBlockedPublisher,
  isMaterialHeadline,
  isRoundupHeadline,
  mostDistinctiveNameToken,
  stripCorporateSuffix,
} from "@predict-future/business-rules";

type ParserItem = {
  title?: string;
  link?: string;
  guid?: string;
  pubDate?: string;
  isoDate?: string;
};

type ParserFeed = {
  items: ParserItem[];
};

const parser = new Parser<ParserFeed, ParserItem>();

const FETCH_TIMEOUT_MS = 8_000;
const RECENCY_LIMIT_MS = 48 * 60 * 60 * 1000; // 48h defensive recency guard, same as the cron.
const MAX_ITEMS_PER_TICKER = 3;

/** One relevance-checked, recency-checked, deduped Google News story for a ticker. */
export type GoogleNewsItem = {
  tickerSymbol: string;
  companyName: string;
  headline: string;
  publisher: string;
  sourceUrl: string;
  dedupeKey: string;
  publishedAt: Date;
};

function buildGoogleNewsQuery(companyName: string, tickerSymbol: string): string {
  const cleanName = stripCorporateSuffix((companyName || tickerSymbol).trim()) || tickerSymbol;
  return `"${cleanName}" (share OR shares OR stock) when:2d`;
}

function buildGoogleNewsSearchUrl(companyName: string, tickerSymbol: string): string {
  const query = buildGoogleNewsQuery(companyName, tickerSymbol);
  return `https://news.google.com/rss/search?q=${encodeURIComponent(query)}&hl=en-IN&gl=IN&ceid=IN:en`;
}

function decodeGoogleNewsSource(title: string): { cleanTitle: string; sourceName: string } {
  const parts = title.split(" - ").map((part) => part.trim()).filter(Boolean);
  if (parts.length < 2) {
    return { cleanTitle: title.trim(), sourceName: "" };
  }
  return { cleanTitle: parts.slice(0, -1).join(" - "), sourceName: parts.at(-1) ?? "" };
}

function normalizeForMatch(input: string): string {
  return input.toLowerCase().replace(/[^\w\s]/g, " ").replace(/\s+/g, " ").trim();
}

function escapeRegExp(input: string): string {
  return input.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function stripAmpersand(input: string): string {
  return input.replace(/&/g, "");
}

function containsWholeWord(haystack: string, needle: string): boolean {
  const trimmedNeedle = needle.trim();
  if (!trimmedNeedle) return false;
  const pattern = new RegExp(`\\b${escapeRegExp(stripAmpersand(trimmedNeedle))}\\b`, "i");
  return pattern.test(stripAmpersand(haystack));
}

function isRelevantHeadline(cleanTitle: string, tickerSymbol: string, companyName: string): boolean {
  if (tickerSymbol && containsWholeWord(cleanTitle, tickerSymbol)) return true;
  const distinctiveToken = mostDistinctiveNameToken(companyName);
  if (distinctiveToken && containsWholeWord(cleanTitle, distinctiveToken)) return true;
  return false;
}

/** Idempotency key, byte-identical formula to apps/api's buildNewsDedupeKey — MUST match so both ingestion paths dedupe onto the same MarketMoveNews row. */
export function buildNewsDedupeKey(tickerSymbol: string, headline: string): string {
  return createHash("sha1").update(`${tickerSymbol.trim().toUpperCase()}:${normalizeForMatch(headline)}`).digest("hex");
}

async function fetchWithTimeout(url: string, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, {
      headers: { Accept: "application/rss+xml, application/xml, text/xml" },
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Fetches, parses, filters, and dedupes Google News RSS results for one
 * ticker. Returns at most MAX_ITEMS_PER_TICKER freshest relevant items,
 * newest first. Never throws.
 */
export async function fetchGoogleNewsForTicker(tickerSymbol: string, companyName: string): Promise<GoogleNewsItem[]> {
  const url = buildGoogleNewsSearchUrl(companyName, tickerSymbol);

  let xml: string;
  try {
    const response = await fetchWithTimeout(url, FETCH_TIMEOUT_MS);
    if (!response.ok) {
      console.warn(`[web/googleNews] ${tickerSymbol}: request failed with status ${response.status}`);
      return [];
    }
    xml = await response.text();
  } catch (err) {
    console.warn(`[web/googleNews] ${tickerSymbol}: fetch error: ${err instanceof Error ? err.message : err}`);
    return [];
  }

  let feed: ParserFeed;
  try {
    feed = await parser.parseString(xml);
  } catch (err) {
    console.warn(`[web/googleNews] ${tickerSymbol}: RSS parse error: ${err instanceof Error ? err.message : err}`);
    return [];
  }

  const now = Date.now();
  const seenDedupeKeys = new Set<string>();
  const items: GoogleNewsItem[] = [];

  for (const item of feed.items ?? []) {
    const rawTitle = item.title?.trim();
    const sourceUrl = item.link?.trim() || item.guid?.trim();
    if (!rawTitle || !sourceUrl) continue;

    const publishedRaw = item.isoDate ?? item.pubDate;
    const publishedAt = publishedRaw ? new Date(publishedRaw) : null;
    if (!publishedAt || Number.isNaN(publishedAt.getTime())) continue;
    if (now - publishedAt.getTime() > RECENCY_LIMIT_MS) continue;

    const { cleanTitle, sourceName } = decodeGoogleNewsSource(rawTitle);
    if (!cleanTitle) continue;
    if (isBlockedPublisher({ publisher: sourceName, sourceUrl })) continue;
    if (!isRelevantHeadline(cleanTitle, tickerSymbol, companyName)) continue;
    if (isRoundupHeadline(cleanTitle)) continue;
    if (!isMaterialHeadline(cleanTitle)) continue;

    const dedupeKey = buildNewsDedupeKey(tickerSymbol, cleanTitle);
    if (seenDedupeKeys.has(dedupeKey)) continue;
    seenDedupeKeys.add(dedupeKey);

    items.push({
      tickerSymbol,
      companyName,
      headline: cleanTitle,
      publisher: sourceName || "Google News",
      sourceUrl,
      dedupeKey,
      publishedAt,
    });
  }

  return items.sort((a, b) => b.publishedAt.getTime() - a.publishedAt.getTime()).slice(0, MAX_ITEMS_PER_TICKER);
}
