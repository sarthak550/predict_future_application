import type { MarketCategory, SourceTrustTier } from "@prisma/client";

const defaultIngestionCategories: MarketCategory[] = [
  "GENERAL",
  "SPORTS",
  "BUSINESS",
  "TECH",
  "ENTERTAINMENT"
];

const defaultTrustedSourceNames = [
  "Reuters",
  "Associated Press",
  "AP News",
  "BBC News",
  "BBC Sport",
  "ESPN",
  "CNBC",
  "Bloomberg",
  "TechCrunch",
  "The Verge",
  "Variety",
  "Deadline",
  "The Weather Channel"
];

function parseBooleanEnv(value: string | undefined, fallback = false) {
  if (!value) {
    return fallback;
  }

  const normalized = value.trim().toLowerCase();
  return normalized === "1" || normalized === "true" || normalized === "yes" || normalized === "on";
}

function parseCsvEnv(value: string | undefined) {
  return (value ?? "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function normalizeSourceName(input: string) {
  return input.trim().toLowerCase().replace(/\s+/g, " ");
}

const allowedCategorySet = new Set<MarketCategory>([
  "GENERAL",
  "SPORTS",
  "BUSINESS",
  "TECH",
  "WEATHER",
  "ENTERTAINMENT",
  "PRODUCT",
  "COMPANY"
]);

export function getConfiguredIngestionCategories() {
  const configuredCategories = parseCsvEnv(process.env.NEWS_INGESTION_CATEGORIES)
    .map((value) => value.toUpperCase())
    .filter((value): value is MarketCategory => allowedCategorySet.has(value as MarketCategory));

  return configuredCategories.length > 0 ? configuredCategories : defaultIngestionCategories;
}

export function getTrustedSourceNames() {
  const configured = parseCsvEnv(process.env.AUTO_APPROVE_SOURCE_NAMES);
  const sourceNames = configured.length > 0 ? configured : defaultTrustedSourceNames;
  return new Set(sourceNames.map(normalizeSourceName));
}

export function isTrustedSourceName(sourceName: string) {
  return getTrustedSourceNames().has(normalizeSourceName(sourceName));
}

export function getPreferredSourceTrustTier(sourceName: string): SourceTrustTier {
  return isTrustedSourceName(sourceName) ? "VERIFIED" : "REPUTABLE";
}

export function shouldAutoApproveIngestedStory(input: {
  sourceName: string;
  hasPrediction: boolean;
}) {
  if (!parseBooleanEnv(process.env.AUTO_APPROVE_INGESTED_STORIES)) {
    return false;
  }

  const requiresPrediction = parseBooleanEnv(process.env.AUTO_APPROVE_REQUIRE_PREDICTION, true);
  if (requiresPrediction && !input.hasPrediction) {
    return false;
  }

  return isTrustedSourceName(input.sourceName);
}

export function shouldSeedTrendingStory(input: {
  category: MarketCategory;
  publishedAt: Date;
  hasPrediction: boolean;
}) {
  if (!input.hasPrediction) {
    return false;
  }

  const hoursOld = (Date.now() - input.publishedAt.getTime()) / (1000 * 60 * 60);
  if (hoursOld > 18) {
    return false;
  }

  return ["SPORTS", "BUSINESS", "TECH", "ENTERTAINMENT"].includes(input.category);
}
