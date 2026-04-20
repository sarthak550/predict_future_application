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
  }
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
