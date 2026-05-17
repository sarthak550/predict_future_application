import {
  MarketCategory,
  MarketType,
  MarketTemplate,
  MarketVisibility,
  NumericTieBreakerRule,
  PoolRewardMode,
  PositionSide,
  ResolutionMode,
  ResolutionSourceType
} from "@prisma/client";
import { z } from "zod";

import {
  getFixedTrustedHostCommissionBps,
  getMaxGracePeriodHours,
  getMinimumHostBondCapAmount,
  normalizePoolRewardMode,
  getPrivateHostChallengeWindowOptions,
  getPrivateHostCommissionPresets,
  getTrustedHostChallengeWindowHours,
  isAllowedPrivateHostCommissionBps
} from "@predict-future/business-rules/markets/policies";

const isoDateString = z
  .string()
  .refine((value) => !Number.isNaN(new Date(value).getTime()), "Enter a valid date and time.");

const optionalUrl = z.string().url().optional().or(z.literal(""));
const optionalCuid = z.string().cuid().optional().or(z.literal(""));

const disallowedTopicPatterns = [
  /\b(kill|killed|murder|suicide|dead|death|injur(?:y|ies)|assault|rape|terror)\b/i,
  /\bprivate life|dating life|pregnan(?:cy|t)|divorce|breakup|affair\b/i,
  /\bcrime|criminal act|arrested|kidnap|kidnapping\b/i,
  /\bdisaster|earthquake|flood death|plane crash|mass shooting\b/i
];

function containsDisallowedMarketTopic(input: string) {
  return disallowedTopicPatterns.some((pattern) => pattern.test(input));
}

const baseMarketSchema = z.object({
  visibility: z.nativeEnum(MarketVisibility).default(MarketVisibility.PUBLIC),
  groupId: optionalCuid,
  marketType: z.nativeEnum(MarketType).default(MarketType.BINARY),
  title: z.string().min(12, "Question is too short.").max(160),
  description: z.string().min(24, "Description is too short.").max(2000),
  category: z.nativeEnum(MarketCategory),
  template: z.nativeEnum(MarketTemplate).default(MarketTemplate.CUSTOM),
  closeAt: isoDateString,
  resolveAt: isoDateString,
  resolutionMode: z.nativeEnum(ResolutionMode).default(ResolutionMode.HOST),
  resolutionSourceType: z.nativeEnum(ResolutionSourceType).optional(),
  resolutionSourceName: z.string().max(120).optional().or(z.literal("")),
  resolutionSourceUrl: optionalUrl,
  resolutionRuleText: z.string().max(1000).optional().or(z.literal("")),
  fallbackRuleText: z.string().max(1000).optional().or(z.literal("")),
  unit: z.string().max(24).optional().or(z.literal("")),
  minValue: z.coerce.number().min(0).optional(),
  maxValue: z.coerce.number().min(0).optional(),
  precision: z.coerce.number().int().min(0).max(6).optional(),
  winnersCount: z.coerce.number().int().min(1).max(10).optional(),
  payoutDistribution: z.array(z.coerce.number().min(0).max(100)).optional(),
  tieBreakerRule: z.nativeEnum(NumericTieBreakerRule).optional(),
  structuredData: z.record(z.any()).optional(),
  poolRewardMode: z.nativeEnum(PoolRewardMode).optional(),
  hostCommissionBps: z.coerce.number().int().min(0).max(1000).optional(),
  bondCap: z.coerce.number().int().min(0).max(100000).optional(),
  dynamicPoolEnabled: z.coerce.boolean().optional(),
  challengeWindowHours: z.coerce.number().int().min(1).max(72).optional(),
  gracePeriodHours: z.coerce.number().int().min(1).max(getMaxGracePeriodHours()).optional(),
  // MULTIPLE_CHOICE only — 2-10 option labels
  options: z
    .array(z.object({ label: z.string().min(1).max(100) }))
    .min(2, "Multiple choice markets require at least 2 options.")
    .max(10, "Multiple choice markets allow at most 10 options.")
    .optional()
});

export const createMarketSchema = baseMarketSchema.superRefine((value, ctx) => {
  const closeAt = new Date(value.closeAt);
  const resolveAt = new Date(value.resolveAt);
  const fixedTrustedHostCommissionBps = getFixedTrustedHostCommissionBps();
  const privateCommissionPresets = getPrivateHostCommissionPresets();
  const privateChallengeWindows = getPrivateHostChallengeWindowOptions();
  const minimumBondCap = getMinimumHostBondCapAmount();
  const poolRewardMode = normalizePoolRewardMode(value.poolRewardMode);

  if (closeAt >= resolveAt) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Close time must be before resolution time.",
      path: ["closeAt"]
    });
  }

  if (closeAt <= new Date()) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Close time must be in the future.",
      path: ["closeAt"]
    });
  }

  if (value.visibility === MarketVisibility.PUBLIC && !["TRUSTED_HOST", "HOST"].includes(value.resolutionMode)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Public markets must use host or trusted-host resolution.",
      path: ["resolutionMode"]
    });
  }

  if (value.visibility === MarketVisibility.PRIVATE && value.resolutionMode !== "HOST") {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Private markets must use host resolution.",
      path: ["resolutionMode"]
    });
  }

  if (value.visibility === MarketVisibility.PRIVATE && !value.groupId) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Select a group for a private market.",
      path: ["groupId"]
    });
  }

  if (value.visibility === MarketVisibility.PUBLIC && value.groupId) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Public markets cannot target a private group.",
      path: ["groupId"]
    });
  }

  if (value.marketType === MarketType.NUMERIC) {
    if (!["HOST", "TRUSTED_HOST"].includes(value.resolutionMode)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Numeric markets require host or trusted-host resolution.",
        path: ["resolutionMode"]
      });
    }

    if (!value.winnersCount) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Numeric markets require a winners count.",
        path: ["winnersCount"]
      });
    }

    if (!value.payoutDistribution?.length) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Numeric markets require a payout distribution.",
        path: ["payoutDistribution"]
      });
    }

    if (!value.tieBreakerRule) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Numeric markets require a tie-breaker rule.",
        path: ["tieBreakerRule"]
      });
    }

    if (value.minValue !== undefined && value.maxValue !== undefined && value.minValue > value.maxValue) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Minimum value must be less than or equal to maximum value.",
        path: ["minValue"]
      });
    }

    if (value.payoutDistribution && value.winnersCount) {
      if (value.payoutDistribution.length !== value.winnersCount) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Payout distribution length must match winners count.",
          path: ["payoutDistribution"]
        });
      }

      const sum = value.payoutDistribution.reduce((total, percentage) => total + percentage, 0);
      if (Math.abs(sum - 100) > 0.001) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Payout distribution must sum to 100%.",
          path: ["payoutDistribution"]
        });
      }
    }
  }

  if (value.resolutionMode === ResolutionMode.TRUSTED_HOST) {
    if (value.visibility !== MarketVisibility.PUBLIC) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Trusted-host markets are only available for public/global markets.",
        path: ["resolutionMode"]
      });
    }

    if (
      poolRewardMode === "COMMISSION_BASED" &&
      value.hostCommissionBps !== undefined &&
      Math.floor(value.hostCommissionBps) !== fixedTrustedHostCommissionBps
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Trusted-host public commission is fixed at ${(fixedTrustedHostCommissionBps / 100).toFixed(2)}%.`,
        path: ["hostCommissionBps"]
      });
    }

    if (
      poolRewardMode === "BOND_BASED" &&
      value.hostCommissionBps !== undefined &&
      Math.floor(value.hostCommissionBps) !== 0
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Bond-based markets do not use host commission percentages.",
        path: ["hostCommissionBps"]
      });
    }

    if (
      value.challengeWindowHours !== undefined &&
      value.challengeWindowHours !== getTrustedHostChallengeWindowHours()
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Trusted-host public markets use the platform-set challenge window.",
        path: ["challengeWindowHours"]
      });
    }
  }

  if (value.resolutionMode === ResolutionMode.HOST) {
    const commission = Math.floor(value.hostCommissionBps ?? 0);

    if (poolRewardMode === "COMMISSION_BASED" && !isAllowedPrivateHostCommissionBps(commission)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Private host commission must use a preset tier: ${privateCommissionPresets
          .map((bps) => `${bps / 100}%`)
          .join(", ")}.`,
        path: ["hostCommissionBps"]
      });
    }

    if (poolRewardMode === "BOND_BASED" && commission !== 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Bond-based host markets do not use commission percentages.",
        path: ["hostCommissionBps"]
      });
    }

    if (value.bondCap === undefined || value.bondCap < minimumBondCap) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Host-resolved private markets require a funded bond cap.",
        path: ["bondCap"]
      });
    }

    if (
      value.challengeWindowHours !== undefined &&
      !privateChallengeWindows.includes(Math.floor(value.challengeWindowHours))
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Private host markets must use a preset challenge window: ${privateChallengeWindows.join(", ")} hours.`,
        path: ["challengeWindowHours"]
      });
    }
  }

  if (value.resolutionMode === ResolutionMode.TRUSTED_HOST) {
    if (value.bondCap !== undefined && value.bondCap < minimumBondCap) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Trusted-host markets require a valid bond cap.",
        path: ["bondCap"]
      });
    }
  }

  if (value.marketType === MarketType.BINARY && value.payoutDistribution?.length) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Binary markets do not use numeric payout distribution rules.",
      path: ["payoutDistribution"]
    });
  }

  if (value.marketType === MarketType.MULTIPLE_CHOICE) {
    if (!value.options || value.options.length < 2) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Multiple choice markets require at least 2 options.",
        path: ["options"]
      });
    } else {
      const labels = value.options.map((o) => o.label.trim().toLowerCase());
      const uniqueLabels = new Set(labels);
      if (uniqueLabels.size !== labels.length) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "All option labels must be unique.",
          path: ["options"]
        });
      }
    }
  }

  if (
    value.poolRewardMode &&
    !["HOST", "TRUSTED_HOST"].includes(value.resolutionMode)
  ) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Pool reward mode only applies to host-resolved markets.",
      path: ["poolRewardMode"]
    });
  }

  const combinedText = `${value.title}\n${value.description}\n${value.resolutionRuleText ?? ""}`;
  if (containsDisallowedMarketTopic(combinedText)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "This market topic is not allowed on the platform.",
      path: ["title"]
    });
  }
});

export const updateMarketSchema = baseMarketSchema.partial();

export const marketPositionSchema = z.object({
  side: z.nativeEnum(PositionSide).optional(),
  numericValue: z.coerce.number().min(0).optional(),
  // amount=0 is allowed for flagship-poll votes (validated server-side that market.flagshipEventAt is set).
  amount: z.coerce.number().int().min(0, "Amount cannot be negative.").max(100000),
  reasoning: z
    .string()
    .transform((v) => v.trim())
    .refine((v) => v.length === 0 || v.length <= 500, {
      message: "Reasoning must be at most 500 characters.",
    })
    .transform((v) => (v.length === 0 ? null : v))
    .nullish()
});

export const marketCommentSchema = z.object({
  body: z.string().min(2, "Comment is too short.").max(500)
});

export const marketReportSchema = z.object({
  reason: z.string().min(3).max(120),
  details: z.string().max(600).optional().or(z.literal(""))
});

export const marketChallengeSchema = z.object({
  reasonText: z.string().max(500).optional().or(z.literal("")),
  evidenceText: z.string().max(1000).optional().or(z.literal("")),
  evidenceUrl: z.string().url().optional().or(z.literal(""))
});

export const hostResolutionSchema = z.object({
  outcome: z.enum(["YES", "NO", "CANCELLED"]).optional(),
  actualValue: z.coerce.number().min(0).optional(),
  resolutionNote: z.string().min(12).max(1000),
  evidenceText: z.string().max(1000).optional().or(z.literal("")),
  evidenceUrl: z.string().url().optional().or(z.literal(""))
});

export const adminResolutionSchema = z.object({
  outcome: z.enum(["YES", "NO", "CANCELLED"]),
  explanation: z.string().min(12).max(1000),
  sourceName: z.string().min(2).max(120),
  sourceUrl: z.string().url().optional().or(z.literal(""))
});

export const adminUpholdResolutionSchema = z.object({
  explanation: z.string().min(12).max(1000)
});

export const adminOverturnResolutionSchema = z.object({
  outcome: z.enum(["YES", "NO"]).optional(),
  actualValue: z.coerce.number().min(0).optional(),
  explanation: z.string().min(12).max(1000),
  sourceName: z.string().min(2).max(120),
  sourceUrl: z.string().url().optional().or(z.literal("")),
  overturnedReason: z.string().min(8).max(500)
});

export const multiChoicePositionSchema = z.object({
  optionId: z.string().cuid(),
  // amount=0 allowed for flagship polls (validated server-side that market is flagship).
  amount: z.coerce.number().int().min(0, "Amount cannot be negative.").max(100000),
  reasoning: z
    .string()
    .transform((v) => v.trim())
    .pipe(z.string().max(500, "Reasoning must be 500 characters or less."))
    .transform((v) => (v.length === 0 ? null : v))
    .nullable()
    .optional()
});

export const resolveMultiChoiceSchema = z.object({
  winningOptionId: z.string().cuid()
});

export const adminCancelMarketSchema = z.object({
  explanation: z.string().min(8).max(1000)
});

export const voteSchema = z.object({
  side: z.nativeEnum(PositionSide).optional(),
  numericValue: z.coerce.number().optional()
});

export type CreateMarketInput = z.infer<typeof createMarketSchema>;
