/**
 * Market Pulse (Phase 1c) — Google News RSS fetcher for readable, real-time
 * per-ticker stock headlines. Replaces raw NSE/BSE filing text as the primary
 * read surface (see MarketMoveNews in schema.prisma / the CTO assignment
 * brief for the "better source, not a better summarizer" reasoning).
 *
 * Endpoint: https://news.google.com/rss/search?q=<query>&hl=en-IN&gl=IN&ceid=IN:en
 * This is the same Google News RSS search endpoint already polled by
 * apps/api/lib/news/rssSources.ts / rssProvider.ts for topic feeds (business,
 * technology, ...) via the same `rss-parser` dependency — a proven pattern in
 * this codebase, not new infra. `decodeGoogleNewsSource()` is intentionally
 * duplicated (not imported) from rssProvider.ts here to keep marketMoves/
 * self-contained, per the module boundary already established for the
 * NSE/BSE fetchers in this directory.
 *
 * Never throws — every failure mode (network error, timeout, malformed XML,
 * zero results) resolves to an empty array so a single bad ticker never
 * takes down the cron's batch loop.
 */

import { createHash } from "crypto";
import Parser from "rss-parser";

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
const RECENCY_LIMIT_MS = 48 * 60 * 60 * 1000; // 48h defensive recency guard
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

/** Corporate-suffix tokens stripped only when they trail the company name (case-insensitive). */
const TRAILING_SUFFIX_PATTERN =
  /\s+(private\s+limited|pvt\.?\s*ltd\.?|limited|ltd\.?)\s*$/i;

/**
 * Strips a trailing corporate-suffix token ("Limited", "Ltd", "Ltd.", "Pvt
 * Ltd", "Private Limited") from the end of a company name only — mid-name
 * words like "Industries" (e.g. "Reliance Industries") are never touched
 * because the pattern is anchored to the end of the string.
 */
export function stripCorporateSuffix(companyName: string): string {
  const stripped = companyName.replace(TRAILING_SUFFIX_PATTERN, "").trim();
  return stripped || companyName.trim();
}

/** Builds the Google News search query per Decision 3: `"<name>" (share OR shares OR stock) when:2d`. */
export function buildGoogleNewsQuery(companyName: string, tickerSymbol: string): string {
  const cleanName = stripCorporateSuffix((companyName || tickerSymbol).trim()) || tickerSymbol;
  return `"${cleanName}" (share OR shares OR stock) when:2d`;
}

export function buildGoogleNewsSearchUrl(companyName: string, tickerSymbol: string): string {
  const query = buildGoogleNewsQuery(companyName, tickerSymbol);
  return `https://news.google.com/rss/search?q=${encodeURIComponent(query)}&hl=en-IN&gl=IN&ceid=IN:en`;
}

/**
 * Splits a Google News RSS `<title>` ("Cupid shares jump 6% - Moneycontrol")
 * into `{ cleanTitle, sourceName }`. Duplicated from
 * apps/api/lib/news/rssProvider.ts's decodeGoogleNewsSource — see file doc
 * comment for why duplication (not import) is deliberate here.
 */
function decodeGoogleNewsSource(title: string): { cleanTitle: string; sourceName: string } {
  const parts = title.split(" - ").map((part) => part.trim()).filter(Boolean);
  if (parts.length < 2) {
    return { cleanTitle: title.trim(), sourceName: "" };
  }

  return {
    cleanTitle: parts.slice(0, -1).join(" - "),
    sourceName: parts.at(-1) ?? "",
  };
}

/** lowercase, strip punctuation, collapse whitespace — for both relevance matching and dedupe. */
function normalizeForMatch(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^\w\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** First alphabetic token of the company name (>=3 chars), used as a loose relevance anchor. */
function primaryNameToken(companyName: string): string | null {
  const cleanName = stripCorporateSuffix(companyName);
  const token = normalizeForMatch(cleanName).split(" ").find((word) => word.length >= 3);
  return token ?? null;
}

/**
 * Relevance guard: the decoded headline must contain the ticker symbol OR a
 * normalized token of the company name — defends against Google loosely
 * matching a generic-word overlap unrelated to the actual stock.
 */
function isRelevantHeadline(cleanTitle: string, tickerSymbol: string, companyName: string): boolean {
  const normalizedTitle = normalizeForMatch(cleanTitle);
  const normalizedTicker = normalizeForMatch(tickerSymbol);
  if (normalizedTicker && normalizedTitle.includes(normalizedTicker)) {
    return true;
  }

  const nameToken = primaryNameToken(companyName);
  if (nameToken && normalizedTitle.includes(nameToken)) {
    return true;
  }

  return false;
}

export function buildNewsDedupeKey(tickerSymbol: string, headline: string): string {
  return createHash("sha1")
    .update(`${tickerSymbol.trim().toUpperCase()}:${normalizeForMatch(headline)}`)
    .digest("hex");
}

async function fetchWithTimeout(url: string, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, {
      headers: {
        Accept: "application/rss+xml, application/xml, text/xml",
      },
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
export async function fetchGoogleNewsForTicker(
  tickerSymbol: string,
  companyName: string
): Promise<GoogleNewsItem[]> {
  const url = buildGoogleNewsSearchUrl(companyName, tickerSymbol);

  let xml: string;
  try {
    const response = await fetchWithTimeout(url, FETCH_TIMEOUT_MS);
    if (!response.ok) {
      console.warn(`[marketMoves/googleNews] ${tickerSymbol}: request failed with status ${response.status}`);
      return [];
    }
    xml = await response.text();
  } catch (err) {
    console.warn(
      `[marketMoves/googleNews] ${tickerSymbol}: fetch error: ${err instanceof Error ? err.message : err}`
    );
    return [];
  }

  let feed: ParserFeed;
  try {
    feed = await parser.parseString(xml);
  } catch (err) {
    console.warn(
      `[marketMoves/googleNews] ${tickerSymbol}: RSS parse error: ${err instanceof Error ? err.message : err}`
    );
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
    if (now - publishedAt.getTime() > RECENCY_LIMIT_MS) continue; // 48h recency guard

    const { cleanTitle, sourceName } = decodeGoogleNewsSource(rawTitle);
    if (!cleanTitle) continue;
    if (!isRelevantHeadline(cleanTitle, tickerSymbol, companyName)) continue;

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

  return items
    .sort((a, b) => b.publishedAt.getTime() - a.publishedAt.getTime())
    .slice(0, MAX_ITEMS_PER_TICKER);
}
