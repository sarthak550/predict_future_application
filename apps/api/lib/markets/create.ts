import { randomUUID } from "crypto";

import {
  MarketType,
  MarketScope,
  MarketStatus,
  MarketTemplate,
  MarketVisibility,
  ResolutionMode,
  ResolutionSourceType
} from "@prisma/client";

import { findPotentialDuplicateMarket } from "@/lib/markets/deduplication";
import {
  calculateBondMetrics,
  evaluateTrustedHostEligibility,
  getDefaultTrustedHostBondCapAmount,
  normalizeChallengeWindowHours,
  normalizeGracePeriodHours,
  normalizeHostCommissionBps,
  normalizePoolRewardMode
} from "@/lib/markets/policies";
import { createNotification, notifyMany } from "@/lib/notifications";
import { prisma } from "@/lib/prisma";
import { slugify } from "@/lib/utils";
import type { CreateMarketInput } from "@/lib/validations/market";

function buildMarketSlug(title: string) {
  return `${slugify(title).slice(0, 64) || "market"}-${randomUUID().slice(0, 8)}`;
}

function deriveResolutionFields(payload: CreateMarketInput) {
  if (payload.resolutionMode === ResolutionMode.HOST || payload.resolutionMode === ResolutionMode.TRUSTED_HOST) {
    return {
      resolutionSourceType: ResolutionSourceType.MANUAL,
      resolutionSourceName: payload.resolutionSourceName?.trim() || "Trusted host resolution",
      resolutionSourceUrl: null,
      fallbackRuleText:
        payload.fallbackRuleText ||
        "If the host cannot resolve cleanly, staff can review the written rules and cancel if needed."
    };
  }

  if (payload.resolutionMode === ResolutionMode.GROUP_VOTE) {
    return {
      resolutionSourceType: ResolutionSourceType.MANUAL,
      resolutionSourceName: "Community consensus",
      resolutionSourceUrl: null,
      fallbackRuleText:
        payload.fallbackRuleText ||
        "If participants cannot reach a clear vote outcome, the market creator or staff should cancel and refund positions."
    };
  }

  return {
    resolutionSourceType: payload.resolutionSourceType ?? ResolutionSourceType.MANUAL,
    resolutionSourceName: payload.resolutionSourceName?.trim() || "Named source",
    resolutionSourceUrl: payload.resolutionSourceUrl || null,
    fallbackRuleText: payload.fallbackRuleText || null
  };
}

export async function createPredictionMarket(input: {
  actorId: string;
  actorRole: "USER" | "ADMIN" | "MODERATOR";
  actorUsername: string;
  actorReputationScore: number;
  payload: CreateMarketInput;
}) {
  const actor = await prisma.user.findUnique({
    where: { id: input.actorId },
    include: {
      wallet: true,
      stats: true
    }
  });

  if (!actor || actor.isSuspended) {
    throw new Error("Account is not allowed to create markets.");
  }

  const visibility = input.payload.visibility ?? MarketVisibility.PUBLIC;
  const groupId = input.payload.groupId || null;

  if (visibility === MarketVisibility.PRIVATE && !groupId) {
    throw new Error("Private markets must belong to a group.");
  }

  let allowedGroupMemberIds: string[] = [];

  if (visibility === MarketVisibility.PRIVATE && groupId) {
    const membership = await prisma.groupMembership.findUnique({
      where: {
        groupId_userId: {
          groupId,
          userId: actor.id
        }
      },
      include: {
        group: {
          include: {
            memberships: {
              select: {
                userId: true
              }
            }
          }
        }
      }
    });

    if (!membership || membership.group.isArchived) {
      throw new Error("You must be a member of the selected group.");
    }

    allowedGroupMemberIds = membership.group.memberships.map((item) => item.userId);
  }

  if (visibility === MarketVisibility.PUBLIC && input.payload.resolutionMode === ResolutionMode.TRUSTED_HOST) {
    const eligibility = evaluateTrustedHostEligibility({
      user: actor,
      stats: actor.stats
    });

    if (!eligibility.eligible) {
      throw new Error(eligibility.reasons[0] ?? "You are not eligible for public trusted-host markets.");
    }
  }

  const duplicate = await findPotentialDuplicateMarket({
    title: input.payload.title,
    category: input.payload.category,
    template: input.payload.template ?? MarketTemplate.CUSTOM,
    resolveAt: new Date(input.payload.resolveAt),
    visibility,
    groupId
  });

  if (duplicate) {
    throw new Error(
      `${duplicate.reason} Review the existing market "${duplicate.market.title}" before creating another one.`
    );
  }

  const autoApproved =
    actor.role === "ADMIN" ||
    actor.role === "MODERATOR" ||
    visibility === MarketVisibility.PRIVATE;
  const status = autoApproved ? MarketStatus.OPEN : MarketStatus.DRAFT;
  const resolutionFields = deriveResolutionFields(input.payload);
  const marketScope =
    visibility === MarketVisibility.PUBLIC ? MarketScope.GLOBAL : groupId ? MarketScope.GROUP : MarketScope.INVITE_ONLY;
  const isHostResolvedMarket =
    input.payload.resolutionMode === ResolutionMode.HOST ||
    input.payload.resolutionMode === ResolutionMode.TRUSTED_HOST;
  const poolRewardMode = isHostResolvedMarket
    ? normalizePoolRewardMode(input.payload.poolRewardMode)
    : normalizePoolRewardMode();
  const hostCommissionBps = normalizeHostCommissionBps({
    visibility,
    resolutionMode: input.payload.resolutionMode,
    poolRewardMode,
    requestedCommissionBps: input.payload.hostCommissionBps
  });
  const bondCap = isHostResolvedMarket
    ? Math.max(
        0,
        Math.floor(
          input.payload.bondCap ??
            (input.payload.resolutionMode === ResolutionMode.TRUSTED_HOST
              ? getDefaultTrustedHostBondCapAmount()
              : 0)
        )
      )
    : 0;
  const bondMetrics = calculateBondMetrics({
    poolRewardMode,
    commissionBps: hostCommissionBps,
    bondCap,
    totalPool: 0
  });
  const challengeWindowHours = normalizeChallengeWindowHours({
    visibility,
    resolutionMode: input.payload.resolutionMode,
    requestedChallengeWindowHours: input.payload.challengeWindowHours
  });
  const gracePeriodHours = normalizeGracePeriodHours(input.payload.gracePeriodHours);

  if (bondCap > 0 && !actor.wallet) {
    throw new Error("Wallet not found.");
  }

  if (bondCap > 0 && (actor.wallet?.balance ?? 0) < bondCap) {
    throw new Error("Insufficient virtual points to lock the host bond cap.");
  }

  const market = await prisma.$transaction(async (tx) => {
    const createdMarket = await tx.market.create({
      data: {
        slug: buildMarketSlug(input.payload.title),
        title: input.payload.title,
        description: input.payload.description,
        category: input.payload.category,
        template: input.payload.template ?? MarketTemplate.CUSTOM,
        marketType: input.payload.marketType ?? MarketType.BINARY,
        creatorId: actor.id,
        visibility,
        marketScope,
        groupId,
        status,
        closeAt: new Date(input.payload.closeAt),
        resolveAt: new Date(input.payload.resolveAt),
        resolutionMode: input.payload.resolutionMode,
        resolutionStatus: "OPEN",
        resolutionSourceType: resolutionFields.resolutionSourceType,
        resolutionSourceName: resolutionFields.resolutionSourceName,
        resolutionSourceUrl: resolutionFields.resolutionSourceUrl,
        resolutionRuleText: input.payload.resolutionRuleText ?? "Resolved by market host.",
        fallbackRuleText: resolutionFields.fallbackRuleText ?? null,
        unit: input.payload.unit || null,
        minValue: input.payload.minValue ?? null,
        maxValue: input.payload.maxValue ?? null,
        precision: input.payload.precision ?? null,
        winnersCount: input.payload.winnersCount ?? 1,
        payoutDistributionJson: input.payload.payoutDistribution ?? undefined,
        tieBreakerRule: input.payload.tieBreakerRule ?? null,
        rulesLockedAt: autoApproved ? new Date() : null,
        structuredData: input.payload.structuredData,
        creatorReputationSnapshot: actor.reputationScore,
        poolRewardMode,
        hostCommissionBps,
        bondCap,
        lockedBondAmount: bondCap,
        currentRequiredBond: bondMetrics.currentRequiredBond,
        dynamicPoolEnabled: false,
        maxPoolAllowed: bondMetrics.maxPoolAllowed,
        challengeWindowHours,
        gracePeriodHours,
        approvedAt: autoApproved ? new Date() : null,
        approvedById: autoApproved ? actor.id : null
      }
    });

    if (bondCap > 0 && actor.wallet) {
      await tx.wallet.update({
        where: { id: actor.wallet.id },
        data: {
          balance: {
            decrement: bondCap
          }
        }
      });

      await tx.walletTransaction.create({
        data: {
          walletId: actor.wallet.id,
          type: "HOST_BOND_LOCK",
          amount: -bondCap,
          description: `Host bond cap locked for "${createdMarket.title}"`,
          marketId: createdMarket.id
        }
      });
    }

    if (!autoApproved) {
      const admins = await tx.user.findMany({
        where: {
          role: {
            in: ["ADMIN", "MODERATOR"]
          }
        },
        select: {
          id: true
        }
      });

      await notifyMany(
        tx,
        admins.map((admin) => admin.id),
        {
          marketId: createdMarket.id,
          type: "SYSTEM",
          title:
            input.payload.resolutionMode === ResolutionMode.TRUSTED_HOST
              ? "Trusted-host public market awaiting review"
              : "New public market awaiting review",
          body: `${createdMarket.title} needs moderation review before it can open.`,
          href: "/admin/moderation"
        }
      );
    } else if (visibility === MarketVisibility.PRIVATE) {
      await notifyMany(
        tx,
        allowedGroupMemberIds.filter((userId) => userId !== actor.id),
        {
          marketId: createdMarket.id,
          type: "SYSTEM",
          title: "New private group prediction",
          body: `@${input.actorUsername} opened ${createdMarket.title} for your group.`,
          href: `/markets/${createdMarket.id}`
        }
      );
    }

    await createNotification(tx, {
      userId: actor.id,
      marketId: createdMarket.id,
      type: "SYSTEM",
      title:
        visibility === MarketVisibility.PUBLIC
          ? autoApproved
            ? "Public prediction created"
            : "Prediction submitted"
          : "Private prediction created",
      body:
        visibility === MarketVisibility.PUBLIC
          ? autoApproved
            ? "Your public prediction is live."
            : "Your public prediction is in moderation review."
          : "Your private group prediction is live.",
      href: `/markets/${createdMarket.id}`,
      metadata:
        input.payload.resolutionMode === ResolutionMode.TRUSTED_HOST
          ? {
              hostCommissionBps,
              poolRewardMode,
              bondCap,
              maxPoolAllowed: bondMetrics.maxPoolAllowed
            }
          : undefined
    });

    return createdMarket;
  });

  return market;
}
