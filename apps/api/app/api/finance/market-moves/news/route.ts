/**
 * GET /api/finance/market-moves/news
 *
 * Market Pulse (Phase 1c) — paginated, reverse-chronological feed of
 * MarketMoveNews rows (readable Google News stock headlines), served from
 * the warm store written by the market-moves-news cron.
 *
 * Query params:
 *   cursor?: opaque pagination cursor (base64url JSON: { publishedAt, id })
 *   limit?: number (default 20, max 50)
 *   tickerSymbol?: filter to a single ticker
 *
 * Public endpoint — no auth required.
 * Response: { items: [...], nextCursor: string | null, hasMore: boolean }
 */

import { NextResponse } from "next/server";

import {
  EARNINGS_RESULTS_PATTERN,
  isMaterialHeadline,
  isRoundupHeadline,
  mostDistinctiveNameToken,
} from "@/lib/marketMoves/googleNews";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

const PAGE_SIZE_DEFAULT = 20;
const PAGE_SIZE_MAX = 50;

/** Near-duplicate collapse window (Decision 2): reworded stories about the same event. */
const NEAR_DUPLICATE_WINDOW_MS = 24 * 60 * 60 * 1000;

/** Per-ticker feed cap (Decision 3): at most this many rows per ticker per assembled page. */
const MAX_PER_TICKER_PER_PAGE = 2;

/**
 * Reputable-publisher tie-break for near-duplicate clusters — case-insensitive
 * substring match against the stored `publisher` field, checked in this
 * ranked order; first match wins. Falls back to earliest-published if no
 * cluster member matches any entry.
 */
const REPUTABLE_PUBLISHERS = [
  "moneycontrol",
  "economic times",
  "et now",
  "livemint",
  "mint",
  "business standard",
  "cnbc-tv18",
  "ndtv profit",
  "reuters",
  "bloomberg",
  "financial express",
  "zee business",
];

/**
 * Boilerplate words common to nearly every stock-news headline — stripped
 * (in addition to ordinary English stopwords) before computing Rule B's
 * shared "event token" overlap, so two headlines don't look similar merely
 * because they're both about "shares" "surging" on "results" day.
 */
const NEWS_BOILERPLATE_STOPWORDS = new Set([
  "shares", "share", "stock", "stocks", "surge", "surges", "jump", "jumps",
  "rally", "gain", "gains", "gainer", "gainers", "rise", "rises", "results",
  "result", "beat", "beats", "report", "reports", "reported", "announce",
  "announces", "announced", "update", "updates", "news", "today", "crore",
  "cr", "lakh", "percent", "set", "sets",
]);

/** Ordinary English stopwords — not finance-specific, just generic noise. */
const ENGLISH_STOPWORDS = new Set([
  "a", "an", "the", "of", "in", "on", "at", "to", "for", "and", "or", "is",
  "are", "was", "were", "by", "with", "from", "as", "its", "it", "this",
  "that", "after", "amid", "amidst", "amongst", "over", "up", "down", "will",
  "has", "have", "had", "be", "been", "not", "no", "so", "but", "if", "than",
  "then", "into", "out", "about", "across", "says", "say", "said",
]);

/**
 * Short finance acronyms that qualify as an "event token" for Rule B despite
 * being under the normal 4-character minimum. `&` is stripped before
 * tokenizing (same convention as googleNews.ts's stripAmpersand), so "M&A"
 * is represented here as "ma".
 */
const EVENT_TOKEN_ACRONYM_WHITELIST = new Set([
  "ai", "ipo", "ev", "jv", "mou", "eps", "ma", "esg", "egm", "agm", "nclt",
  "sebi", "rbi", "fy",
]);

type Cursor = { publishedAt: string; id: string };
type NewsRow = Awaited<ReturnType<typeof prisma.marketMoveNews.findMany>>[number];

function normalizeHeadlineTokens(headline: string): string[] {
  return headline
    .toLowerCase()
    .replace(/&/g, "")
    .replace(/[^\w\s]/g, " ")
    .split(/\s+/)
    .filter(Boolean);
}

function isQualifyingEventToken(token: string): boolean {
  return token.length >= 4 || EVENT_TOKEN_ACRONYM_WHITELIST.has(token);
}

/**
 * Rule B's "event token" set for one headline: lowercase, punctuation-
 * stripped tokens with the company-name distinctive token, the ticker
 * symbol, and both stopword lists removed, keeping only tokens that are
 * either >= 4 chars or a whitelisted finance acronym.
 */
function extractEventTokens(headline: string, companyName: string, tickerSymbol: string): Set<string> {
  const distinctiveToken = mostDistinctiveNameToken(companyName);
  const tickerToken = tickerSymbol.replace(/^BSE:/i, "").replace(/&/g, "").toLowerCase();

  const tokens = normalizeHeadlineTokens(headline).filter((token) => {
    if (token === distinctiveToken) return false;
    if (token === tickerToken) return false;
    if (ENGLISH_STOPWORDS.has(token)) return false;
    if (NEWS_BOILERPLATE_STOPWORDS.has(token)) return false;
    return isQualifyingEventToken(token);
  });

  return new Set(tokens);
}

function sharedTokenCount(a: Set<string>, b: Set<string>): number {
  let count = 0;
  for (const token of a) {
    if (b.has(token)) count++;
  }
  return count;
}

/**
 * Which row survives a near-duplicate cluster: prefer a REPUTABLE_PUBLISHERS
 * match (checked in ranked order), else the earliest-published row in the
 * cluster (deterministic, no randomness).
 */
function pickClusterRepresentative(cluster: NewsRow[]): NewsRow {
  if (cluster.length === 1) return cluster[0];

  for (const publisher of REPUTABLE_PUBLISHERS) {
    const match = cluster.find((row) => row.publisher.toLowerCase().includes(publisher));
    if (match) return match;
  }

  return cluster.reduce((earliest, row) =>
    row.publishedAt.getTime() < earliest.publishedAt.getTime() ? row : earliest
  );
}

/**
 * Decision 2 — near-duplicate collapse (pass 2, runs after the exact-headline
 * dedup Map above). Groups rows by tickerSymbol, then within each group
 * clusters rows within a 24h window via Rule A (both match
 * EARNINGS_RESULTS_PATTERN — the dominant reworded-results-headline case) or
 * Rule B (share >= 2 event tokens after stripping company/ticker/stopwords —
 * catches one-off events like a reworded investment announcement). One
 * representative row survives per cluster.
 */
function collapseNearDuplicates(rows: NewsRow[]): NewsRow[] {
  const byTicker = new Map<string, NewsRow[]>();
  for (const row of rows) {
    const group = byTicker.get(row.tickerSymbol);
    if (group) {
      group.push(row);
    } else {
      byTicker.set(row.tickerSymbol, [row]);
    }
  }

  const survivors: NewsRow[] = [];

  for (const group of byTicker.values()) {
    if (group.length === 1) {
      survivors.push(group[0]);
      continue;
    }

    // Union-find over the group's indices — clusters transitively (if A~B
    // and B~C, all three end up in one cluster even if A and C alone
    // wouldn't match).
    const parent = group.map((_, i) => i);
    const find = (i: number): number => {
      if (parent[i] !== i) parent[i] = find(parent[i]);
      return parent[i];
    };
    const union = (a: number, b: number) => {
      const rootA = find(a);
      const rootB = find(b);
      if (rootA !== rootB) parent[rootA] = rootB;
    };

    const matchesEarnings = group.map((row) => EARNINGS_RESULTS_PATTERN.test(row.headline));
    const eventTokens = group.map((row) => extractEventTokens(row.headline, row.companyName, row.tickerSymbol));

    for (let i = 0; i < group.length; i++) {
      for (let j = i + 1; j < group.length; j++) {
        const withinWindow =
          Math.abs(group[i].publishedAt.getTime() - group[j].publishedAt.getTime()) <=
          NEAR_DUPLICATE_WINDOW_MS;
        if (!withinWindow) continue;

        const ruleA = matchesEarnings[i] && matchesEarnings[j];
        const ruleB = !ruleA && sharedTokenCount(eventTokens[i], eventTokens[j]) >= 2;

        if (ruleA || ruleB) union(i, j);
      }
    }

    const clusters = new Map<number, NewsRow[]>();
    for (let i = 0; i < group.length; i++) {
      const root = find(i);
      const cluster = clusters.get(root);
      if (cluster) {
        cluster.push(group[i]);
      } else {
        clusters.set(root, [group[i]]);
      }
    }

    for (const cluster of clusters.values()) {
      survivors.push(pickClusterRepresentative(cluster));
    }
  }

  return survivors;
}

/**
 * Decision 3 — per-ticker feed cap (pass 3, runs after near-duplicate
 * collapse + re-sort). Walks the reverse-chron list keeping at most
 * MAX_PER_TICKER_PER_PAGE rows per ticker; scope is per-assembled-page, not a
 * global rolling cap, so a capped ticker can still surface older rows on a
 * later page.
 */
function capPerTicker(rows: NewsRow[], maxPerTicker: number): NewsRow[] {
  const counts = new Map<string, number>();
  const capped: NewsRow[] = [];

  for (const row of rows) {
    const count = counts.get(row.tickerSymbol) ?? 0;
    if (count >= maxPerTicker) continue;
    counts.set(row.tickerSymbol, count + 1);
    capped.push(row);
  }

  return capped;
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);

  const limitParam = parseInt(searchParams.get("limit") ?? "", 10);
  const limit = Math.min(
    Number.isFinite(limitParam) && limitParam > 0 ? limitParam : PAGE_SIZE_DEFAULT,
    PAGE_SIZE_MAX
  );

  const tickerSymbol = searchParams.get("tickerSymbol") || undefined;

  const cursorParam = searchParams.get("cursor");
  let cursor: Cursor | undefined;
  if (cursorParam) {
    try {
      cursor = JSON.parse(Buffer.from(cursorParam, "base64url").toString("utf8")) as Cursor;
    } catch {
      cursor = undefined; // malformed cursor — ignore, start from the beginning
    }
  }

  const where = {
    ...(tickerSymbol ? { tickerSymbol } : {}),
    ...(cursor
      ? {
          OR: [
            { publishedAt: { lt: new Date(cursor.publishedAt) } },
            { publishedAt: { equals: new Date(cursor.publishedAt) }, id: { gt: cursor.id } },
          ],
        }
      : {}),
  };

  // Over-fetch so we can collapse the same story stored under BOTH an NSE symbol
  // and its BSE scrip code (identical headline, two ticker keys). Dedup by
  // normalized headline, preferring the NSE-symbol row over the "BSE:<code>" one.
  // Over-fetch multiplier bumped 4 -> 6: two extra dedup/cap passes below
  // (near-duplicate collapse + per-ticker cap) remove more rows than the
  // single exact-match pass the original *4 was sized for.
  const fetchedRows = await prisma.marketMoveNews.findMany({
    where,
    orderBy: [{ publishedAt: "desc" }, { id: "asc" }],
    take: (limit + 1) * 6,
  });

  // Read-side material + roundup filter (belt-and-suspenders): the cron-side T1/T4
  // filters only affect NEW fetches, so rows stored before they shipped — and any
  // that slip through — are dropped here at display time so the feed is material-only.
  const rows = fetchedRows.filter(
    (r) => isMaterialHeadline(r.headline) && !isRoundupHeadline(r.headline)
  );

  const normHeadline = (h: string) => h.toLowerCase().replace(/[^a-z0-9]/g, "");
  const dedup = new Map<string, (typeof rows)[number]>();
  for (const r of rows) {
    const key = normHeadline(r.headline);
    const existing = dedup.get(key);
    if (!existing) {
      dedup.set(key, r);
    } else if (existing.tickerSymbol.startsWith("BSE:") && !r.tickerSymbol.startsWith("BSE:")) {
      dedup.set(key, r); // upgrade to the NSE-symbol version (Map keeps position)
    }
  }
  const exactDeduped = [...dedup.values()];

  // Pass 2 (Decision 2): collapse reworded near-duplicate headlines about the
  // same event, then restore reverse-chron order (a cluster's surviving row
  // isn't always the newest, per the reputable-publisher tie-break).
  const nearDupCollapsed = collapseNearDuplicates(exactDeduped).sort((a, b) => {
    const byTime = b.publishedAt.getTime() - a.publishedAt.getTime();
    return byTime !== 0 ? byTime : a.id.localeCompare(b.id);
  });

  // Pass 3 (Decision 3): cap to the freshest MAX_PER_TICKER_PER_PAGE rows per
  // ticker for this assembled page, before pagination slicing.
  const deduped = capPerTicker(nearDupCollapsed, MAX_PER_TICKER_PER_PAGE);

  const hasMore = deduped.length > limit;
  const page = hasMore ? deduped.slice(0, limit) : deduped;

  let nextCursor: string | null = null;
  if (hasMore && page.length > 0) {
    const last = page[page.length - 1];
    const raw: Cursor = { publishedAt: last.publishedAt.toISOString(), id: last.id };
    nextCursor = Buffer.from(JSON.stringify(raw), "utf8").toString("base64url");
  }

  return NextResponse.json({
    items: page.map((n) => ({
      id: n.id,
      tickerSymbol: n.tickerSymbol,
      companyName: n.companyName,
      headline: n.headline,
      publisher: n.publisher,
      sourceUrl: n.sourceUrl,
      publishedAt: n.publishedAt.toISOString(),
    })),
    nextCursor,
    hasMore,
  });
}
