import type { MarketCategory } from "@prisma/client";

import type { InternalNewsCategory } from "./types";

const INTERNAL_CATEGORY_MAP: Record<string, InternalNewsCategory> = {
  general: "GENERAL",
  world: "GENERAL",
  nation: "GENERAL",
  science: "GENERAL",
  health: "GENERAL",
  sports: "SPORTS",
  sport: "SPORTS",
  business: "BUSINESS",
  economy: "BUSINESS",
  technology: "TECH",
  tech: "TECH",
  entertainment: "ENTERTAINMENT",
  weather: "WEATHER"
};

export function mapExternalCategoryToInternal(category?: string | null): InternalNewsCategory {
  const normalized = category?.trim().toLowerCase() ?? "general";
  return INTERNAL_CATEGORY_MAP[normalized] ?? "GENERAL";
}

export function mapInternalCategoryToGNews(category?: MarketCategory | string | null) {
  const normalized = category?.toString().toUpperCase() ?? "GENERAL";

  if (normalized === "SPORTS") {
    return "sports";
  }
  if (normalized === "BUSINESS") {
    return "business";
  }
  if (normalized === "TECH") {
    return "technology";
  }
  if (normalized === "ENTERTAINMENT") {
    return "entertainment";
  }

  return "general";
}

export function mapInternalCategoryToNewsApi(category?: MarketCategory | string | null) {
  const normalized = category?.toString().toUpperCase() ?? "GENERAL";

  if (normalized === "SPORTS") {
    return "sports";
  }
  if (normalized === "BUSINESS") {
    return "business";
  }
  if (normalized === "TECH") {
    return "technology";
  }
  if (normalized === "ENTERTAINMENT") {
    return "entertainment";
  }

  return "general";
}
