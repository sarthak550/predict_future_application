import {
  MarketCategory,
  MarketStatus,
  ResolutionSourceType,
  StoryStatus
} from "@prisma/client";
import { z } from "zod";

import { attachedPredictionSchema } from "./story";

export const newsFeedQuerySchema = z.object({
  category: z.nativeEnum(MarketCategory).optional(),
  view: z.enum(["for-you", "latest", "trending", "resolved"]).optional(),
  page: z.coerce.number().int().min(1).max(1000).optional(),
  pageSize: z.coerce.number().int().min(1).max(20).optional()
});

export const adminStoryDecisionSchema = z.object({
  storyId: z.string().min(1),
  note: z.string().max(500).optional().or(z.literal(""))
});

export const adminBulkStoryApproveSchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).optional(),
  trustedOnly: z.boolean().optional()
});

export const adminStoryRejectSchema = z.object({
  storyId: z.string().min(1),
  reason: z.string().min(8).max(500)
});

export const adminStoryUpdateSchema = z.object({
  headline: z.string().min(12).max(180).optional(),
  summary: z.string().min(20).max(500),
  category: z.nativeEnum(MarketCategory),
  isFeatured: z.boolean().optional(),
  isTrending: z.boolean().optional(),
  prediction: attachedPredictionSchema.optional(),
  clearPrediction: z.boolean().optional()
});

export const adminStoryIngestSchema = z.object({
  categories: z.array(z.nativeEnum(MarketCategory)).max(10).optional()
});

export const storyMarketStatusSchema = z.enum([
  MarketStatus.DRAFT,
  MarketStatus.PENDING_REVIEW,
  MarketStatus.OPEN,
  MarketStatus.CLOSED,
  MarketStatus.RESOLVING,
  MarketStatus.RESOLVED,
  MarketStatus.REJECTED,
  MarketStatus.CANCELLED
]);

export const approvedStoryStatuses: StoryStatus[] = ["APPROVED", "PUBLISHED"];
export const pendingStoryStatuses: StoryStatus[] = ["DRAFT", "PENDING_REVIEW"];
export const editableResolutionSourceTypes: ResolutionSourceType[] = [
  "MANUAL",
  "WEATHER_API",
  "SPORTS_API",
  "BOX_OFFICE_SOURCE",
  "PRESS_RELEASE",
  "CUSTOM_JSON"
];
