import type { InternalNewsCategory } from "@/lib/news/types";

export type RssSource = {
  id: string;
  name: string;
  url: string;
  categoryHint: InternalNewsCategory;
  isActive?: boolean;
  fallbackCategory?: InternalNewsCategory;
};

const defaultRssSources: RssSource[] = [
  {
    id: "google-news-general",
    name: "Google News",
    url: "https://news.google.com/rss?hl=en-IN&gl=IN&ceid=IN:en",
    categoryHint: "GENERAL",
    fallbackCategory: "GENERAL",
    isActive: false
  },
  {
    id: "bbc-world",
    name: "BBC World",
    url: "http://feeds.bbci.co.uk/news/rss.xml",
    categoryHint: "GENERAL",
    fallbackCategory: "GENERAL",
    isActive: true
  },
  {
    id: "espn-news",
    name: "ESPN",
    url: "https://www.espn.com/espn/rss/news",
    categoryHint: "SPORTS",
    fallbackCategory: "SPORTS",
    isActive: true
  },
  {
    id: "techcrunch",
    name: "TechCrunch",
    url: "https://techcrunch.com/feed/",
    categoryHint: "TECH",
    fallbackCategory: "TECH",
    isActive: true
  },
  {
    id: "cnbc-top",
    name: "CNBC",
    url: "https://www.cnbc.com/id/100003114/device/rss/rss.html",
    categoryHint: "BUSINESS",
    fallbackCategory: "BUSINESS",
    isActive: true
  },
  {
    id: "google-news-tech",
    name: "Google News Tech",
    url: "https://news.google.com/rss/search?q=technology&hl=en-IN&gl=IN&ceid=IN:en",
    categoryHint: "TECH",
    fallbackCategory: "TECH",
    isActive: false
  },
  {
    id: "reuters-world",
    name: "Reuters",
    url: "https://www.reutersagency.com/feed/?taxonomy=best-sectors&post_type=best",
    categoryHint: "GENERAL",
    fallbackCategory: "GENERAL",
    isActive: true
  },
  {
    id: "the-verge",
    name: "The Verge",
    url: "https://www.theverge.com/rss/index.xml",
    categoryHint: "TECH",
    fallbackCategory: "TECH",
    isActive: true
  },
  {
    id: "ars-technica",
    name: "Ars Technica",
    url: "https://feeds.arstechnica.com/arstechnica/index",
    categoryHint: "TECH",
    fallbackCategory: "TECH",
    isActive: true
  },

  // ── Indian Finance Sources (Sprint 13) ──
  // categoryHint is "BUSINESS" as the safe InternalNewsCategory default.
  // The FINANCE tag is applied later by evaluateFinanceTag() in rss-ingestion-service.ts
  // when the story's title/summary contains India-market keywords.
  {
    id: "moneycontrol-markets",
    name: "Moneycontrol",
    url: "https://www.moneycontrol.com/rss/marketreports.xml",
    categoryHint: "BUSINESS",
    fallbackCategory: "BUSINESS",
    isActive: true
  },
  {
    id: "economic-times-markets",
    name: "Economic Times",
    url: "https://economictimes.indiatimes.com/markets/rssfeeds/1977021501.cms",
    categoryHint: "BUSINESS",
    fallbackCategory: "BUSINESS",
    isActive: true
  },
  {
    id: "mint-markets",
    name: "Mint",
    url: "https://www.livemint.com/rss/markets",
    categoryHint: "BUSINESS",
    fallbackCategory: "BUSINESS",
    isActive: true
  },
  {
    id: "cnbctv18-markets",
    name: "CNBC TV18",
    url: "https://www.cnbctv18.com/commonfeeds/v1/cne/rss/market.xml",
    categoryHint: "BUSINESS",
    fallbackCategory: "BUSINESS",
    isActive: true
  },

  // ── Indian Finance Opinion / Analyst Columns (added to feed isApprovedFinanceSource allowlist) ──
  // These feeds publish articles whose URL paths match the strict analyst-opinion allowlist in
  // apps/api/lib/ai/extractExpertOpinions.ts, enabling AI extraction of expert opinions.
  //
  // Verified 2026-05-09:
  //   - ET expert-view (50649960): 50 items, all at /markets/expert-view/ — 100% allowlist match
  //   - CNBC TV18 views.xml: 200 items, ~54 at /views/ — matches cnbctv18.com /views/ allowlist
  //   - Business Today home feed: articles at /india/story/, /magazine/deep-dive/story/, /markets/stocks/story/
  //     — /india/story/ is in allowlist for AI extraction
  //
  // Feeds investigated but discarded:
  //   - moneycontrol.com: all RSS endpoints return 403 (Akamai blocks non-browser requests)
  //   - dbs.com: no public RSS feed available
  //   - ET opinion/columns (897228639): articles land at /opinion/et-commentary/ and /opinion/et-editorial/,
  //     NOT /opinion/columns/ — no matching allowlist path, no feed found that produces /opinion/columns/ URLs
  //   - livemint.com/rss/opinion: articles land at /opinion/online-views/, not /opinion/columns/
  //     or /market/mark-to-market — no specific RSS feed exists for either of those sections
  //   - ndtvprofit.com RSS: 403 (bqprime.com/rss/* redirects to ndtvprofit.com which also 403s)
  {
    id: "et-expert-view",
    name: "Economic Times Expert View",
    url: "https://economictimes.indiatimes.com/markets/expert-view/rssfeeds/50649960.cms",
    categoryHint: "BUSINESS",
    fallbackCategory: "BUSINESS",
    isActive: true
  },
  {
    id: "cnbctv18-views",
    name: "CNBC TV18 Views",
    url: "https://www.cnbctv18.com/commonfeeds/v1/cne/rss/views.xml",
    categoryHint: "BUSINESS",
    fallbackCategory: "BUSINESS",
    isActive: true
  },
  {
    id: "businesstoday-home",
    name: "Business Today",
    url: "https://www.businesstoday.in/rssfeeds/?id=home",
    categoryHint: "BUSINESS",
    fallbackCategory: "BUSINESS",
    isActive: true
  },
  // Bloomberg's public sitemap is a news sitemap (XML), not a standard RSS feed.
  // The sitemap_news.xml format is not compatible with rss-parser and would need
  // custom parsing. Adding as inactive until a Bloomberg-compatible RSS or API
  // endpoint is confirmed. Do NOT use web scraping (ToS risk).
  // {
  //   id: "bloomberg-india",
  //   name: "Bloomberg India",
  //   url: "https://www.bloomberg.com/feeds/sitemap_news.xml",
  //   categoryHint: "BUSINESS",
  //   fallbackCategory: "BUSINESS",
  //   isActive: false, // Requires sitemap XML parser — standard rss-parser won't work
  // },
];

const sourceNameCategoryRules: Array<{ pattern: RegExp; category: InternalNewsCategory }> = [
  { pattern: /\bespn|cricbuzz|cricinfo|sky sports\b/i, category: "SPORTS" },
  { pattern: /\btech|verge|wired|techcrunch\b/i, category: "TECH" },
  { pattern: /\bbusiness|economy|finance|markets?\b/i, category: "BUSINESS" },
  { pattern: /\bentertainment|film|movie|music|celebrity\b/i, category: "ENTERTAINMENT" },
  { pattern: /\bweather\b/i, category: "WEATHER" }
];

const titleKeywordRules: Array<{ pattern: RegExp; category: InternalNewsCategory }> = [
  { pattern: /\b(match|vs\.?|versus|tournament|odi|test match|ipl|goal|final|semi-final|quarter-final)\b/i, category: "SPORTS" },
  { pattern: /\b(ai|artificial intelligence|tech|software|chip|startup|device|launch|app|smartphone|robot)\b/i, category: "TECH" },
  { pattern: /\b(stock|stocks|market|markets|shares|ipo|economy|economic|inflation|gdp|earnings|revenue)\b/i, category: "BUSINESS" },
  { pattern: /\b(box office|film|movie|cinema|trailer|album|streaming|actor|actress)\b/i, category: "ENTERTAINMENT" },
  { pattern: /\b(rain|rainfall|storm|forecast|temperature|weather|heatwave)\b/i, category: "WEATHER" }
];

function parseCsvEnv(value: string | undefined) {
  return (value ?? "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

export function getRssSources() {
  const configuredIds = new Set(parseCsvEnv(process.env.RSS_SOURCE_IDS).map((id) => id.toLowerCase()));
  const activeSources = defaultRssSources.filter((source) => source.isActive !== false);

  if (configuredIds.size === 0) {
    return activeSources;
  }

  const filteredSources = activeSources.filter((source) => configuredIds.has(source.id.toLowerCase()));
  return filteredSources.length > 0 ? filteredSources : activeSources;
}

export function getRssSourceByUrl(url: string) {
  return getRssSources().find((source) => source.url === url) ?? null;
}

export function inferCategoryFromRssItem(input: {
  title: string;
  sourceName: string;
  hintedCategory?: InternalNewsCategory;
}) {
  for (const rule of titleKeywordRules) {
    if (rule.pattern.test(input.title)) {
      return rule.category;
    }
  }

  for (const rule of sourceNameCategoryRules) {
    if (rule.pattern.test(input.sourceName)) {
      return rule.category;
    }
  }

  return input.hintedCategory ?? "GENERAL";
}
