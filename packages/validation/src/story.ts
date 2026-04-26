import {
  MarketCategory,
  MarketTemplate,
  ResolutionSourceType,
  StoryIngestionType,
  StoryStatus
} from "@prisma/client";
import { z } from "zod";

const isoDateString = z
  .string()
  .refine((value) => !Number.isNaN(new Date(value).getTime()), "Enter a valid date and time.");

function wordCount(input: string) {
  return input.trim().split(/\s+/).filter(Boolean).length;
}

export const attachedPredictionSchema = z
  .object({
    title: z.string().min(12).max(180),
    description: z.string().min(24).max(1000),
    template: z.nativeEnum(MarketTemplate),
    closeAt: isoDateString,
    resolveAt: isoDateString,
    resolutionSourceType: z.nativeEnum(ResolutionSourceType),
    resolutionSourceName: z.string().min(2).max(120),
    resolutionSourceUrl: z.string().url().optional().or(z.literal("")),
    resolutionRuleText: z.string().min(16).max(1000),
    fallbackRuleText: z.string().max(1000).optional().or(z.literal("")),
    structuredData: z.record(z.any()).optional(),
    marketType: z.enum(["BINARY", "NUMERIC"]).optional(),
    unit: z.string().max(50).optional(),
    minValue: z.number().optional(),
    maxValue: z.number().optional(),
    precision: z.number().int().min(0).max(6).optional()
  })
  .superRefine((value, ctx) => {
    if (new Date(value.closeAt) >= new Date(value.resolveAt)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Prediction close time must be before resolution time.",
        path: ["closeAt"]
      });
    }
  });

export const storyInputSchema = z
  .object({
    headline: z.string().min(12).max(180),
    summary: z.string().min(20).max(500),
    category: z.nativeEnum(MarketCategory),
    sourceName: z.string().min(2).max(120),
    sourceUrl: z.string().url(),
    sourceHomepageUrl: z.string().url().optional().or(z.literal("")),
    imageUrl: z.string().url().optional().or(z.literal("")),
    publishedAt: isoDateString,
    language: z.string().min(2).max(10).default("en"),
    status: z.nativeEnum(StoryStatus).optional(),
    ingestionType: z.nativeEnum(StoryIngestionType).optional(),
    ingestionFeedId: z.string().max(120).optional().or(z.literal("")),
    ingestionFeedName: z.string().max(120).optional().or(z.literal("")),
    externalId: z.string().max(120).optional().or(z.literal("")),
    dedupeKey: z.string().max(120).optional().or(z.literal("")),
    rawPayloadJson: z.record(z.any()).optional(),
    ingestedAt: isoDateString.optional(),
    isFeatured: z.boolean().optional(),
    isTrending: z.boolean().optional(),
    attachedPrediction: attachedPredictionSchema.optional()
  })
  .superRefine((value, ctx) => {
    if (wordCount(value.summary) > 90) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Keep summaries concise for the short-form feed.",
        path: ["summary"]
      });
    }
  });

export const storiesIngestSchema = z.object({
  stories: z.array(storyInputSchema).min(1).max(50)
});

export const storyQuerySchema = z.object({
  category: z.nativeEnum(MarketCategory).optional(),
  view: z.enum(["for-you", "latest", "trending", "resolved"]).optional(),
  limit: z.coerce.number().int().min(1).max(50).optional(),
  page: z.coerce.number().int().min(1).max(1000).optional()
});

export type StoryInput = z.infer<typeof storyInputSchema>;
