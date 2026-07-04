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
    isActive: true
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
    isActive: true
  },
  {
    // Reuters Agency RSS was retired (feed now 404s). Disabled until a working
    // Reuters endpoint is found; India/global GENERAL coverage comes from
    // Google News (IN), BBC, and NDTV in the meantime.
    id: "reuters-world",
    name: "Reuters",
    url: "https://www.reutersagency.com/feed/?taxonomy=best-sectors&post_type=best",
    categoryHint: "GENERAL",
    fallbackCategory: "GENERAL",
    isActive: false
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

  // ── India-focused general / sports / entertainment / tech feeds ──
  // Added to fix US/global skew: previously Sports = US ESPN only, Entertainment
  // had no dedicated source, General = BBC/Reuters. These give India-first coverage
  // per category. Google News "search" format is used (the "topic/BUSINESS" format
  // was deprecated by Google and returns empty). Verified returning items 2026-07.
  {
    id: "ndtv-top",
    name: "NDTV",
    url: "https://feeds.feedburner.com/ndtvnews-top-stories",
    categoryHint: "GENERAL",
    fallbackCategory: "GENERAL",
    isActive: true
  },
  {
    id: "espncricinfo",
    name: "ESPNcricinfo",
    url: "https://www.espncricinfo.com/rss/content/story/feeds/0.xml",
    categoryHint: "SPORTS",
    fallbackCategory: "SPORTS",
    isActive: true
  },
  {
    id: "gnews-in-sports",
    name: "Google News India Sports",
    url: "https://news.google.com/rss/search?q=india%20sports%20cricket&hl=en-IN&gl=IN&ceid=IN:en",
    categoryHint: "SPORTS",
    fallbackCategory: "SPORTS",
    isActive: true
  },
  {
    id: "gnews-in-entertainment",
    name: "Google News India Entertainment",
    url: "https://news.google.com/rss/search?q=bollywood%20entertainment&hl=en-IN&gl=IN&ceid=IN:en",
    categoryHint: "ENTERTAINMENT",
    fallbackCategory: "ENTERTAINMENT",
    isActive: true
  },
  {
    id: "gnews-in-business",
    name: "Google News India Business",
    url: "https://news.google.com/rss/search?q=india%20business%20markets&hl=en-IN&gl=IN&ceid=IN:en",
    categoryHint: "BUSINESS",
    fallbackCategory: "BUSINESS",
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

  // ── Curated Expert Opinion Feeds (highest extraction quality) ──
  // These feeds are specifically designed for analyst opinions and market strategy.
  // Articles match the strict expert-opinion allowlist in apps/api/lib/ai/extractExpertOpinions.ts
  // requiring named analysts making forward-looking market calls.
  //
  // Verified 2026-05-09:
  //   - ET expert-view (50649960): 50 items, 100% at /markets/expert-view/ — structured analyst calls
  //   - CNBC TV18 views.xml: 50 items at /views/ — curated market commentary
  //   - Seeking Alpha India: analyst articles tagged with India stocks — global expert calls
  //   - Mint Columns: opinion section with market strategy and analysis
  //
  // Sources REMOVED (not qualified for structured expert opinion extraction):
  //   - Business Today (general news, not structured analyst calls) — 0 opinions extracted
  //   - Moneycontrol (403 Akamai blocks, RSS endpoints unreliable)
  //   - DBS Bank (no public RSS, institutional research only)
  //   - LiveMint markets (generic market news, not expert columns)
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
  // ── Seeking Alpha (global analyst opinions with India coverage) ──
  {
    id: "seeking-alpha-india",
    name: "Seeking Alpha India",
    url: "https://seekingalpha.com/feed.xml?t=article&s=india",
    categoryHint: "BUSINESS",
    fallbackCategory: "BUSINESS",
    isActive: true
  },
  // ── Mint Columns (dedicated expert analysis and market views) ──
  {
    id: "mint-columns",
    name: "Mint Columns",
    url: "https://www.livemint.com/rss/opinion",
    categoryHint: "BUSINESS",
    fallbackCategory: "BUSINESS",
    isActive: true
  },
  // ── Global sources (Sprint 71) — included when indiaOnly=false ───────────────
  // All verified returning items 2026-07. These are listed in GLOBAL_ONLY_SOURCES
  // in queries.ts so they are excluded when the India toggle is ON.
  // Stored sourceName values come from each feed's channel.title element — verify
  // against prod after the first ingest cycle and correct GLOBAL_ONLY_SOURCES if any
  // channel titles differ from the display names used here.
  {
    id: "al-jazeera",
    name: "Al Jazeera",
    url: "https://www.aljazeera.com/xml/rss/all.xml",
    categoryHint: "GENERAL",
    fallbackCategory: "GENERAL",
    isActive: true,
  },
  {
    id: "guardian-world",
    name: "The Guardian",
    url: "https://www.theguardian.com/world/rss",
    categoryHint: "GENERAL",
    fallbackCategory: "GENERAL",
    isActive: true,
  },
  {
    id: "france24",
    name: "France 24",
    url: "https://www.france24.com/en/rss",
    categoryHint: "GENERAL",
    fallbackCategory: "GENERAL",
    isActive: true,
  },
  {
    id: "npr-news",
    name: "NPR",
    url: "https://feeds.npr.org/1001/rss.xml",
    categoryHint: "GENERAL",
    fallbackCategory: "GENERAL",
    isActive: true,
  },
  {
    id: "sky-news-world",
    name: "Sky News",
    url: "https://feeds.skynews.com/feeds/rss/world.xml",
    categoryHint: "GENERAL",
    fallbackCategory: "GENERAL",
    isActive: true,
  },
  {
    id: "cnn-top",
    name: "CNN",
    url: "http://rss.cnn.com/rss/edition.rss",
    categoryHint: "GENERAL",
    fallbackCategory: "GENERAL",
    isActive: true,
  },
  {
    id: "variety",
    name: "Variety",
    url: "https://variety.com/feed/",
    categoryHint: "ENTERTAINMENT",
    fallbackCategory: "ENTERTAINMENT",
    isActive: true,
  },
  {
    id: "espn-soccer",
    name: "ESPN Soccer",
    url: "https://www.espn.com/espn/rss/soccer/news",
    categoryHint: "SPORTS",
    fallbackCategory: "SPORTS",
    isActive: true,
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
