/**
 * Scrape ET Expert View listing pages to backfill Jan–Apr 2026 FINANCE articles.
 *
 * Strategy:
 *   1. Walk listing pages 1..MAX_PAGES, collecting article URLs.
 *   2. Stop a page (and all subsequent) when every article on it predates SINCE.
 *   3. For each new URL not already in the DB, fetch the article page, extract
 *      headline/summary/date/image via meta tags, insert as FINANCE Story, then
 *      run AI expert-opinion extraction.
 *
 * Usage:
 *   cd apps/api
 *   FINANCE_AI_DAILY_CAP=300 npx tsx scripts/scrape-et-expert-view.ts
 *
 * Flags (env):
 *   DRY_RUN=1            — scrape & print without inserting or extracting
 *   SKIP_EXTRACT=1       — insert stories but skip AI extraction
 *   MAX_PAGES=55         — override default page ceiling
 *   SINCE=2026-01-01     — only import articles on/after this date
 */

import { prisma } from "../lib/prisma";
import { JSDOM } from "jsdom";
import { Readability } from "@mozilla/readability";
import {
  isApprovedFinanceSource,
  extractExpertOpinionsFromStory,
  persistExpertOpinions,
} from "../lib/ai/extractExpertOpinions";

const BASE_URL = "https://economictimes.indiatimes.com";
const LISTING_TEMPLATE = `${BASE_URL}/markets/expert-views/articlelist/msid-50649960,page-{PAGE}.cms`;
const SOURCE_NAME = "Economic Times";

const DRY_RUN = process.env.DRY_RUN === "1";
const SKIP_EXTRACT = process.env.SKIP_EXTRACT === "1";
const MAX_PAGES = parseInt(process.env.MAX_PAGES ?? "55", 10);
const SINCE = new Date(process.env.SINCE ?? "2026-01-01");

const DELAY_LISTING_MS = 800;
const DELAY_ARTICLE_MS = 1_200;
const FETCH_TIMEOUT_MS = 12_000;
const USER_AGENT =
  "Mozilla/5.0 (compatible; PredictFutureBot/1.0; +https://predictfuture.app)";

function sleep(ms: number) {
  return new Promise<void>((r) => setTimeout(r, ms));
}

async function fetchHtml(url: string): Promise<string | null> {
  const controller = new AbortController();
  const tid = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        "User-Agent": USER_AGENT,
        Accept: "text/html,application/xhtml+xml,*/*",
        "Accept-Language": "en-US,en;q=0.9",
      },
      redirect: "follow",
    });
    clearTimeout(tid);
    if (!res.ok) {
      console.warn(`  HTTP ${res.status} for ${url}`);
      return null;
    }
    return await res.text();
  } catch (err) {
    clearTimeout(tid);
    console.warn(`  Fetch error for ${url}: ${err instanceof Error ? err.message : String(err)}`);
    return null;
  }
}

/** Extract article paths from a listing page HTML. Returns deduplicated absolute URLs. */
function extractArticleUrls(html: string): string[] {
  const seen = new Set<string>();
  const urls: string[] = [];
  // Match paths like /markets/expert-view/<slug>/articleshow/<msid>.cms
  const re = /href="(\/markets\/expert-view\/[^"]+\/articleshow\/\d+\.cms)"/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    const path = m[1];
    const full = `${BASE_URL}${path}`;
    if (!seen.has(full)) {
      seen.add(full);
      urls.push(full);
    }
  }
  return urls;
}

type ArticleMeta = {
  headline: string;
  summary: string;
  publishedAt: Date;
  imageUrl: string | null;
  sourceUrl: string;
  slug: string;
  externalId: string;
  bodyText: string | null;
};

/** Extract og:* and datePublished from article HTML, also run Readability for body. */
function parseArticlePage(html: string, sourceUrl: string): ArticleMeta | null {
  let doc: Document;
  try {
    const dom = new JSDOM(html, { url: sourceUrl });
    doc = dom.window.document;

    const getMeta = (attr: string, value: string) =>
      doc.querySelector(`meta[${attr}="${value}"]`)?.getAttribute("content") ?? null;

    const headline =
      getMeta("property", "og:title") ??
      getMeta("name", "twitter:title") ??
      doc.title ??
      "";

    const summary =
      getMeta("property", "og:description") ??
      getMeta("name", "twitter:description") ??
      getMeta("name", "description") ??
      "";

    // datePublished from JSON-LD or meta
    let publishedAt: Date | null = null;
    const scripts = doc.querySelectorAll('script[type="application/ld+json"]');
    for (const s of scripts) {
      try {
        const json = JSON.parse(s.textContent ?? "");
        const dp = json.datePublished ?? json.dateCreated;
        if (dp) {
          const d = new Date(dp);
          if (!isNaN(d.getTime())) { publishedAt = d; break; }
        }
      } catch { /* continue */ }
    }
    // Fallback: search raw HTML for datePublished
    if (!publishedAt) {
      const m = html.match(/"datePublished"\s*:\s*"([^"]+)"/);
      if (m) {
        const d = new Date(m[1]);
        if (!isNaN(d.getTime())) publishedAt = d;
      }
    }
    if (!publishedAt) {
      console.warn(`  No publishedAt for ${sourceUrl}`);
      return null;
    }

    const imageUrl = getMeta("property", "og:image") ?? null;

    // Extract msid from URL for externalId
    const msidMatch = sourceUrl.match(/articleshow\/(\d+)\.cms/);
    if (!msidMatch) return null;
    const externalId = `et-${msidMatch[1]}`;

    // Slug from URL path
    const urlPath = new URL(sourceUrl).pathname;
    const slugMatch = urlPath.match(/\/markets\/expert-view\/([^/]+)\/articleshow/);
    const slug = slugMatch ? `et-${slugMatch[1]}` : externalId;

    // Readability body extraction
    let bodyText: string | null = null;
    try {
      const dom2 = new JSDOM(html, { url: sourceUrl });
      const reader = new Readability(dom2.window.document);
      const article = reader.parse();
      const text = article?.textContent?.trim() ?? null;
      if (text && text.length >= 200) {
        bodyText = text.length > 8000 ? text.slice(0, 8000) : text;
      }
    } catch { /* skip body */ }

    if (!headline.trim() || !summary.trim()) return null;

    return {
      headline: headline.trim(),
      summary: summary.trim(),
      publishedAt,
      imageUrl,
      sourceUrl,
      slug: slug.slice(0, 200),
      externalId,
      bodyText,
    };
  } catch (err) {
    console.warn(`  Parse error for ${sourceUrl}: ${err instanceof Error ? err.message : String(err)}`);
    return null;
  }
}

async function main() {
  console.log(`\nET Expert View Scraper`);
  console.log(`  SINCE=${SINCE.toISOString().slice(0, 10)}, MAX_PAGES=${MAX_PAGES}`);
  console.log(`  DRY_RUN=${DRY_RUN}, SKIP_EXTRACT=${SKIP_EXTRACT}\n`);

  let totalInserted = 0;
  let totalSkipped = 0;
  let totalExtracted = 0;
  let totalFailed = 0;
  let done = false;

  for (let page = 1; page <= MAX_PAGES && !done; page++) {
    const listingUrl = LISTING_TEMPLATE.replace("{PAGE}", String(page));
    console.log(`[Page ${page}/${MAX_PAGES}] ${listingUrl}`);

    const listingHtml = await fetchHtml(listingUrl);
    if (!listingHtml) {
      console.warn(`  Could not fetch listing page ${page}, stopping.`);
      break;
    }

    const articleUrls = extractArticleUrls(listingHtml);
    console.log(`  Found ${articleUrls.length} article URLs`);

    if (articleUrls.length === 0) {
      console.log("  Empty page — stopping.");
      break;
    }

    let pageAllOld = true;

    for (const articleUrl of articleUrls) {
      // Check if already in DB
      const existing = await prisma.story.findUnique({
        where: { sourceUrl: articleUrl },
        select: { id: true, publishedAt: true },
      });

      if (existing) {
        if (existing.publishedAt >= SINCE) {
          pageAllOld = false;
        }
        totalSkipped++;
        continue;
      }

      // Fetch article page
      await sleep(DELAY_ARTICLE_MS);
      const html = await fetchHtml(articleUrl);
      if (!html) { totalFailed++; continue; }

      const meta = parseArticlePage(html, articleUrl);
      if (!meta) { totalFailed++; continue; }

      if (meta.publishedAt >= SINCE) {
        pageAllOld = false;
      } else {
        // Article predates our cutoff — still insert if close, but flag page
        continue;
      }

      if (DRY_RUN) {
        console.log(`  [DRY] ${meta.publishedAt.toISOString().slice(0, 10)} — ${meta.headline.slice(0, 70)}`);
        totalInserted++;
        continue;
      }

      // Insert story
      try {
        const story = await prisma.story.create({
          data: {
            slug: meta.slug,
            headline: meta.headline,
            summary: meta.summary,
            category: "FINANCE",
            sourceName: SOURCE_NAME,
            sourceUrl: meta.sourceUrl,
            imageUrl: meta.imageUrl,
            publishedAt: meta.publishedAt,
            status: "PUBLISHED",
            ingestionType: "MANUAL",
            externalId: meta.externalId,
            bodyText: meta.bodyText,
            bodyFetchedAt: meta.bodyText ? new Date() : undefined,
          },
        });

        totalInserted++;
        console.log(`  ✓ Inserted [${meta.publishedAt.toISOString().slice(0, 10)}] ${meta.headline.slice(0, 70)}`);

        if (!SKIP_EXTRACT && isApprovedFinanceSource(meta.sourceUrl)) {
          const content = meta.bodyText ?? meta.summary;
          try {
            const opinions = await extractExpertOpinionsFromStory({
              id: story.id,
              title: meta.headline,
              content,
              sourceUrl: meta.sourceUrl,
              publishedAt: meta.publishedAt,
            });
            if (opinions.length > 0) {
              await persistExpertOpinions(prisma, story.id, meta.sourceUrl, meta.publishedAt, opinions);
              totalExtracted += opinions.length;
              console.log(`    → ${opinions.length} opinion(s) extracted`);
            }
          } catch (err) {
            console.warn(`    AI extraction failed: ${err instanceof Error ? err.message : String(err)}`);
          }
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (msg.includes("Unique constraint") || msg.includes("unique")) {
          totalSkipped++;
        } else {
          console.warn(`  DB insert failed: ${msg}`);
          totalFailed++;
        }
      }
    }

    if (pageAllOld) {
      console.log(`  All articles on page ${page} predate ${SINCE.toISOString().slice(0, 10)} — stopping.`);
      done = true;
    }

    await sleep(DELAY_LISTING_MS);
  }

  const totalOpinions = await prisma.expertOpinion.count({ where: { suppressedAt: null } });
  const financeStoriesTotal = await prisma.story.count({ where: { category: "FINANCE" } });

  console.log(`\n═══════════════════════════════`);
  console.log(`  Inserted:  ${totalInserted} new stories`);
  console.log(`  Skipped:   ${totalSkipped} already in DB`);
  console.log(`  Failed:    ${totalFailed} fetch/parse errors`);
  console.log(`  Extracted: ${totalExtracted} new expert opinions`);
  console.log(`  DB totals: ${financeStoriesTotal} FINANCE stories, ${totalOpinions} opinions`);
  console.log(`═══════════════════════════════\n`);

  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
