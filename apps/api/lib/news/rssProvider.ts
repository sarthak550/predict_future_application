import { createHash } from "crypto";
import Parser from "rss-parser";

import { inferCategoryFromRssItem, getRssSourceByUrl } from "@/lib/news/rssSources";
import { buildNewsDedupeKey, normalizeSummary } from "@/lib/news/providers/shared";
import type { NormalizedNewsItem } from "@/lib/news/types";

type ParserItem = {
  title?: string;
  link?: string;
  guid?: string;
  contentSnippet?: string;
  description?: string;
  content?: string;
  pubDate?: string;
  isoDate?: string;
  creator?: string;
  enclosure?: {
    url?: string;
    type?: string;
  };
};

type ParserFeed = {
  title?: string;
  items: ParserItem[];
};

const parser = new Parser<ParserFeed, ParserItem>();

function stripHtml(input: string) {
  return input.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

function decodeGoogleNewsSource(title: string, fallbackName: string) {
  const parts = title.split(" - ").map((part) => part.trim()).filter(Boolean);
  if (parts.length < 2) {
    return {
      cleanTitle: title,
      sourceName: fallbackName
    };
  }

  return {
    cleanTitle: parts.slice(0, -1).join(" - "),
    sourceName: parts.at(-1) ?? fallbackName
  };
}

function shouldDecodeSourceFromTitle(sourceUrl: string) {
  try {
    const hostname = new URL(sourceUrl).hostname.toLowerCase();
    return hostname.includes("news.google.");
  } catch {
    return false;
  }
}

function extractImageUrl(item: ParserItem) {
  if (item.enclosure?.url && (!item.enclosure.type || item.enclosure.type.startsWith("image/"))) {
    return item.enclosure.url;
  }

  const html = item.content ?? item.description ?? "";
  const imageMatch = html.match(/<img[^>]+src=["']([^"']+)["']/i);
  return imageMatch?.[1];
}

function buildExternalId(title: string, sourceUrl: string) {
  return `rss:${createHash("sha1").update(`${title}:${sourceUrl}`).digest("hex")}`;
}

function getMaxItemsPerSource() {
  const configured = Number(process.env.RSS_MAX_ITEMS_PER_SOURCE ?? 50);
  if (!Number.isFinite(configured)) {
    return 50;
  }

  return Math.max(10, Math.min(100, Math.floor(configured)));
}

function getCacheSeconds() {
  const configured = Number(process.env.RSS_CACHE_REVALIDATE_SECONDS ?? 900);
  if (!Number.isFinite(configured)) {
    return 900;
  }

  return Math.max(60, Math.floor(configured));
}

export async function fetchRSSFeed(url: string): Promise<NormalizedNewsItem[]> {
  const source = getRssSourceByUrl(url);

  const response = await fetch(url, {
    headers: {
      Accept: "application/rss+xml, application/xml, text/xml"
    },
    next: {
      revalidate: getCacheSeconds()
    }
  });

  if (!response.ok) {
    throw new Error(`RSS request failed with status ${response.status}.`);
  }

  const xml = await response.text();
  const feed = await parser.parseString(xml);

  const normalizedItems = (feed.items ?? [])
    .slice(0, getMaxItemsPerSource())
    .map<NormalizedNewsItem | null>((item) => {
      const rawTitle = item.title?.trim() ?? "";
      const sourceUrl = item.link?.trim() || item.guid?.trim() || "";
      if (!rawTitle || !sourceUrl) {
        return null;
      }

      const fallbackSourceName = source?.name ?? feed.title?.trim() ?? "RSS Source";
      const sourceMeta =
        source && shouldDecodeSourceFromTitle(sourceUrl)
          ? decodeGoogleNewsSource(rawTitle, source.name)
          : { cleanTitle: rawTitle, sourceName: fallbackSourceName };
      const summaryCandidate = stripHtml(item.contentSnippet ?? item.description ?? item.content ?? rawTitle);
      const publishedAt = item.isoDate ?? item.pubDate;

      const normalizedItem: NormalizedNewsItem = {
        title: sourceMeta.cleanTitle,
        summary: normalizeSummary(summaryCandidate, sourceMeta.cleanTitle),
        source_name: sourceMeta.sourceName,
        source_url: sourceUrl,
        image_url: extractImageUrl(item),
        published_at: publishedAt ? new Date(publishedAt) : new Date(),
        category: inferCategoryFromRssItem({
          title: sourceMeta.cleanTitle,
          sourceName: sourceMeta.sourceName,
          hintedCategory: source?.categoryHint
        }),
        external_id: buildExternalId(sourceMeta.cleanTitle, sourceUrl),
        dedupe_key: buildNewsDedupeKey(sourceMeta.cleanTitle, sourceUrl),
        feed_id: source?.id,
        feed_name: source?.name,
        raw_payload_json: {
          title: item.title ?? null,
          link: item.link ?? null,
          guid: item.guid ?? null,
          contentSnippet: item.contentSnippet ?? null,
          description: item.description ?? null,
          pubDate: item.pubDate ?? null,
          isoDate: item.isoDate ?? null,
          enclosure: item.enclosure ?? null
        }
      };

      return normalizedItem;
    });

  return normalizedItems.filter(
    (item): item is NormalizedNewsItem => item !== null && !Number.isNaN(item.published_at.getTime())
  );
}
