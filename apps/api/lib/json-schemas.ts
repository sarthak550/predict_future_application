/**
 * Zod schemas for Json? columns that drive critical business logic.
 *
 * Each schema is co-located with a parse guard so callers get typed values
 * and never silently receive broken data.
 */
import { z } from "zod";

// ─── Market.payoutDistributionJson ────────────────────────────────────────────
// Array of percentage numbers (must sum to ~100, enforced by admin at creation).
// Read by parseNumericPayoutDistribution in packages/business-rules/src/markets/numeric.ts.
export const payoutDistributionSchema = z.array(z.number().finite());

// ─── Market.structuredData ────────────────────────────────────────────────────
// Loosely typed — the shape varies per resolutionSourceType. All sites already
// treat missing keys gracefully, so we validate the outer container only.
// z.record accepts any string key with unknown values; no passthrough needed.
export const marketStructuredDataSchema = z.record(z.string(), z.unknown());

// ─── MarketEventCluster.dataPoints ───────────────────────────────────────────
// Array of stat-chip objects displayed in the Finance cluster detail view.
// Schema mirrors the Prisma comment: { label, value, subtext?, date? }.
export const eventClusterDataPointSchema = z.object({
  label: z.string().min(1).max(100),
  value: z.string().min(1).max(100),
  subtext: z.string().max(200).optional(),
  date: z.string().max(50).optional(),
});

export const eventClusterDataPointsSchema = z.array(eventClusterDataPointSchema);

export type EventClusterDataPoint = z.infer<typeof eventClusterDataPointSchema>;

// ─── Notification.metadata ────────────────────────────────────────────────────
// The only field actively queried is `key` (STREAK_MILESTONE idempotency guard
// in notifyOpinionResolution.ts). Additional keys may be written by future
// notification types — passthrough keeps the schema open for extension.
export const notificationMetadataSchema = z
  .object({
    key: z.string().optional(),
  })
  .passthrough();

export type NotificationMetadata = z.infer<typeof notificationMetadataSchema>;
