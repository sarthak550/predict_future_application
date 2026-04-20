import type { MarketCategory } from "@prisma/client";

export type NormalizedNewsItem = {
  title: string;
  summary: string;
  source_name: string;
  source_url: string;
  image_url?: string;
  published_at: Date;
  category: string;
  external_id: string;
  dedupe_key: string;
  feed_id?: string;
  feed_name?: string;
  raw_payload_json?: Record<string, unknown>;
};

export type InternalNewsCategory = Extract<
  MarketCategory,
  "GENERAL" | "SPORTS" | "BUSINESS" | "TECH" | "ENTERTAINMENT" | "WEATHER"
>;
