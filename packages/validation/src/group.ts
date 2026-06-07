import { z } from "zod";

const GROUP_VISIBILITY_VALUES = ["INVITE_ONLY", "OPEN", "REQUEST_TO_JOIN"] as const;

const MARKET_CATEGORY_VALUES = [
  "GENERAL",
  "SPORTS",
  "BUSINESS",
  "TECH",
  "WEATHER",
  "ENTERTAINMENT",
  "PRODUCT",
  "COMPANY",
  "FINANCE"
] as const;

export const createGroupSchema = z.object({
  name: z.string().min(3, "Group name is too short.").max(80),
  description: z.string().max(280).optional().or(z.literal("")),
  /** S54: New groups default to OPEN so they appear in the discover feed. */
  visibility: z.enum(GROUP_VISIBILITY_VALUES).optional(),
  /** Optional category for filtering in the discover feed. */
  category: z.enum(MARKET_CATEGORY_VALUES).nullable().optional(),
  /** Cover image URL. Admin/seed-set only in S54; upload UI is S56. */
  coverImageUrl: z
    .string()
    .url("coverImageUrl must be a valid URL.")
    .nullable()
    .optional()
});

export const joinGroupSchema = z.object({
  inviteCode: z
    .string()
    .min(4, "Invite code is too short.")
    .max(32)
    .transform((value) => value.trim().toUpperCase())
});

/**
 * Groups are private — join is invite-code only.
 * S54 adds a separate POST /api/groups/:id/join for OPEN groups.
 */
export const joinGroupFlexSchema = z.object({
  inviteCode: z
    .string()
    .min(4, "Invite code is too short.")
    .max(32)
    .transform((value) => value.trim().toUpperCase())
});

/**
 * S57: Body schema for POST /api/groups/:id/transfer-ownership.
 * newOwnerId must be a valid CUID matching an active non-banned group member.
 */
export const transferOwnershipSchema = z.object({
  newOwnerId: z.string().cuid({ message: "newOwnerId must be a valid CUID." })
});
