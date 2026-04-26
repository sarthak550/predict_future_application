import { addHours } from "date-fns";
import { Prisma } from "@prisma/client";

import { weatherCityOptions } from "@/lib/constants";
import { isHostedResolutionMode } from "@/lib/hosts/trust";
import {
  getTrustedHostChallengeWindowHours,
  isHostResolvedMode,
  normalizeResolutionMode
} from "@/lib/markets/policies";
import { settleMarket } from "@/lib/markets/payouts";
import { notifyMany } from "@/lib/notifications";
import { prisma } from "@/lib/prisma";
import { refreshUserStats } from "@/lib/stats";

type TxClient = Prisma.TransactionClient;

type AutomatedResolutionResult = {
  outcome: "YES" | "NO";
  sourceName: string;
  sourceUrl?: string;
  explanation: string;
  auditData?: Prisma.JsonObject;
};

function getValueAtPath(input: unknown, path: string) {
  if (!path) {
    return undefined;
  }

  return path.split(".").reduce<unknown>((current, segment) => {
    if (current && typeof current === "object" && segment in current) {
      return (current as Record<string, unknown>)[segment];
    }
    return undefined;
  }, input);
}

async function attemptWeatherResolution(
  structuredData: Prisma.JsonValue,
  sourceUrl?: string | null
): Promise<AutomatedResolutionResult | null> {
  if (!structuredData || typeof structuredData !== "object" || Array.isArray(structuredData)) {
    return null;
  }

  const cityKey = String(structuredData.cityKey ?? "");
  const thresholdMm = Number(structuredData.thresholdMm ?? 0);
  const date = String(structuredData.date ?? "");
  const city = weatherCityOptions.find((option) => option.key === cityKey);
  if (!city || !date || Number.isNaN(thresholdMm)) {
    return null;
  }

  const url =
    sourceUrl ??
    `https://archive-api.open-meteo.com/v1/archive?latitude=${city.latitude}&longitude=${city.longitude}&start_date=${date}&end_date=${date}&daily=precipitation_sum&timezone=${encodeURIComponent(
      city.timezone
    )}`;

  const response = await fetch(url, {
    headers: {
      Accept: "application/json"
    },
    next: { revalidate: 0 }
  });
  if (!response.ok) {
    return null;
  }

  const payload = (await response.json()) as {
    daily?: { precipitation_sum?: number[] };
  };
  const precipitation = payload.daily?.precipitation_sum?.[0];
  if (typeof precipitation !== "number") {
    return null;
  }

  return {
    outcome: precipitation >= thresholdMm ? "YES" : "NO",
    sourceName: "Open-Meteo precipitation feed",
    sourceUrl: url,
    explanation: `Daily precipitation for ${city.label} on ${date} was ${precipitation.toFixed(
      1
    )} mm against the ${thresholdMm.toFixed(1)} mm threshold.`,
    auditData: {
      precipitation,
      thresholdMm,
      city: city.label,
      date
    }
  };
}

async function attemptCustomJsonResolution(
  sourceUrl: string | null,
  structuredData: Prisma.JsonValue
): Promise<AutomatedResolutionResult | null> {
  if (!sourceUrl || !structuredData || typeof structuredData !== "object" || Array.isArray(structuredData)) {
    return null;
  }

  const jsonPath = String(structuredData.jsonPath ?? "");
  const operator = String(structuredData.operator ?? "");
  const targetValue = structuredData.targetValue;
  if (!jsonPath || !operator) {
    return null;
  }

  const response = await fetch(sourceUrl, {
    headers: {
      Accept: "application/json"
    },
    next: { revalidate: 0 }
  });
  if (!response.ok) {
    return null;
  }

  const payload = await response.json();
  const actualValue = getValueAtPath(payload, jsonPath);

  let outcome: "YES" | "NO" = "NO";
  if (operator === "eq") {
    outcome = actualValue === targetValue ? "YES" : "NO";
  } else if (operator === "gte") {
    outcome = Number(actualValue) >= Number(targetValue) ? "YES" : "NO";
  } else if (operator === "lte") {
    outcome = Number(actualValue) <= Number(targetValue) ? "YES" : "NO";
  } else {
    return null;
  }

  return {
    outcome,
    sourceName: "Custom JSON source",
    sourceUrl,
    explanation: `Automatic resolution compared ${jsonPath} (${String(actualValue)}) with target ${String(
      targetValue
    )} using operator "${operator}".`,
    auditData: {
      jsonPath,
      operator,
      targetValue: targetValue as Prisma.JsonValue,
      actualValue: actualValue as Prisma.JsonValue
    }
  };
}

async function upsertMarketResolution(
  tx: TxClient,
  input: {
    marketId: string;
    outcome: "YES" | "NO" | "CANCELLED" | "UNRESOLVED";
    actualValue?: number;
    sourceName: string;
    sourceUrl?: string;
    explanation: string;
    resolvedById?: string;
    auditData?: Prisma.JsonObject;
  }
) {
  return tx.marketResolution.upsert({
    where: { marketId: input.marketId },
    update: {
      outcome: input.outcome,
      actualValue: input.actualValue,
      sourceName: input.sourceName,
      sourceUrl: input.sourceUrl,
      explanation: input.explanation,
      auditData: input.auditData,
      resolvedById: input.resolvedById,
      resolvedAt: new Date()
    },
    create: {
      marketId: input.marketId,
      outcome: input.outcome,
      actualValue: input.actualValue,
      sourceName: input.sourceName,
      sourceUrl: input.sourceUrl,
      explanation: input.explanation,
      auditData: input.auditData,
      resolvedById: input.resolvedById
    }
  });
}

async function reviewOpenChallenges(
  tx: TxClient,
  input: {
    marketId: string;
    reviewedById: string;
    status: "UPHELD" | "REJECTED" | "REVIEWED";
  }
) {
  await tx.challenge.updateMany({
    where: {
      marketId: input.marketId,
      status: "OPEN"
    },
    data: {
      status: input.status,
      reviewedAt: new Date(),
      reviewedById: input.reviewedById
    }
  });
}

export async function attemptAutomaticResolution(marketId: string) {
  const market = await prisma.market.findUnique({
    where: { id: marketId }
  });
  if (!market || market.status !== "RESOLVING" || market.marketType !== "BINARY") {
    return null;
  }

  if (normalizeResolutionMode(market.resolutionMode) !== "VERIFIED") {
    return null;
  }

  if (market.resolutionSourceType === "WEATHER_API") {
    return attemptWeatherResolution(market.structuredData, market.resolutionSourceUrl);
  }

  if (market.resolutionSourceType === "CUSTOM_JSON") {
    return attemptCustomJsonResolution(market.resolutionSourceUrl, market.structuredData);
  }

  return null;
}

export async function finalizeMarketResolution(input: {
  marketId: string;
  outcome: "YES" | "NO" | "CANCELLED" | "UNRESOLVED";
  actualValue?: number;
  sourceName: string;
  sourceUrl?: string;
  explanation: string;
  resolvedById?: string;
  auditData?: Prisma.JsonObject;
  automated?: boolean;
  resolutionStatus?: "FINALIZED" | "OVERTURNED" | "CANCELLED" | "HOST_TIMEOUT";
  marketStatus?: "RESOLVED" | "CANCELLED" | "HOST_TIMEOUT";
  payHostReward?: boolean;
  releaseHostBond?: boolean;
  forfeitHostBond?: boolean;
  markChallengesAs?: "UPHELD" | "REJECTED" | "REVIEWED";
  finalizationActorId?: string;
  hostResolutionNote?: string | null;
  hostResolutionEvidenceJson?: Prisma.JsonValue;
  overturnedReason?: string | null;
}) {
  return prisma.$transaction(async (tx) => {
    const market = await tx.market.findUnique({
      where: { id: input.marketId },
      include: {
        positions: {
          select: {
            userId: true
          }
        },
        challenges: {
          select: {
            challengerUserId: true
          }
        }
      }
    });

    if (!market) {
      throw new Error("Market not found.");
    }

    const finalResolutionStatus =
      input.resolutionStatus ??
      (input.outcome === "CANCELLED" ? "CANCELLED" : "FINALIZED");
    const nextMarketStatus =
      input.marketStatus ??
      (finalResolutionStatus === "HOST_TIMEOUT"
        ? "HOST_TIMEOUT"
        : input.outcome === "CANCELLED"
          ? "CANCELLED"
          : "RESOLVED");

    const marketUpdateData: Prisma.MarketUpdateInput = {
      status: nextMarketStatus,
      outcome: market.marketType === "NUMERIC" && input.outcome !== "CANCELLED" ? "UNRESOLVED" : input.outcome,
      resolutionStatus: finalResolutionStatus,
      finalizationAt: new Date(),
      finalResolutionDeadline: null,
      challengeWindowEndsAt: null,
      hostResolutionNote: input.hostResolutionNote ?? market.hostResolutionNote,
      overturnedReason: input.overturnedReason ?? null,
      actualValue:
        market.marketType === "NUMERIC" ? input.actualValue ?? market.actualValue ?? null : null
    };

    const finalizationActorId = input.finalizationActorId ?? input.resolvedById;
    marketUpdateData.resolutionFinalizedBy = finalizationActorId
      ? {
          connect: {
            id: finalizationActorId
          }
        }
      : {
          disconnect: true
        };

    const hostEvidenceJson =
      input.hostResolutionEvidenceJson !== undefined
        ? input.hostResolutionEvidenceJson
        : market.hostResolutionEvidenceJson;

    if (hostEvidenceJson === null) {
      marketUpdateData.hostResolutionEvidenceJson = Prisma.DbNull;
    } else if (hostEvidenceJson !== undefined) {
      marketUpdateData.hostResolutionEvidenceJson = hostEvidenceJson as Prisma.InputJsonValue;
    }

    await tx.market.update({
      where: { id: input.marketId },
      data: marketUpdateData
    });

    await upsertMarketResolution(tx, {
      marketId: input.marketId,
      outcome: market.marketType === "NUMERIC" && input.outcome !== "CANCELLED" ? "UNRESOLVED" : input.outcome,
      actualValue: input.actualValue,
      sourceName: input.sourceName,
      sourceUrl: input.sourceUrl,
      explanation: input.explanation,
      auditData: input.auditData,
      resolvedById: input.resolvedById
    });

    if (input.markChallengesAs && input.finalizationActorId) {
      await reviewOpenChallenges(tx, {
        marketId: input.marketId,
        reviewedById: input.finalizationActorId,
        status: input.markChallengesAs
      });
    }

    if (input.resolvedById) {
      await tx.adminAction.create({
        data: {
          actorId: input.resolvedById,
          marketId: input.marketId,
          type: "RESOLVE_MARKET",
          notes: input.explanation,
          metadata: {
            outcome: input.outcome,
            actualValue: input.actualValue ?? null,
            automated: Boolean(input.automated),
            resolutionStatus: finalResolutionStatus
          }
        }
      });
    }

    await settleMarket(tx, input.marketId, {
      payHostReward: Boolean(input.payHostReward),
      releaseHostBond: Boolean(input.releaseHostBond),
      forfeitHostBond: Boolean(input.forfeitHostBond)
    });

    const participantIds = Array.from(
      new Set([
        market.creatorId,
        ...market.positions.map((position) => position.userId),
        ...market.challenges.map((challenge) => challenge.challengerUserId)
      ])
    );

    await notifyMany(tx, participantIds, {
      marketId: market.id,
      type: "MARKET_RESOLVED",
      title:
        finalResolutionStatus === "OVERTURNED"
          ? "Resolution overturned"
          : finalResolutionStatus === "HOST_TIMEOUT"
            ? "Host resolution timed out"
            : finalResolutionStatus === "CANCELLED"
              ? "Market cancelled"
              : "Market finalized",
      body:
        finalResolutionStatus === "OVERTURNED"
          ? `${market.title} was overturned after review and the final result is now locked.`
          : finalResolutionStatus === "HOST_TIMEOUT"
            ? `${market.title} was not resolved before the deadline, so it timed out and refunded participants.`
            : finalResolutionStatus === "CANCELLED"
              ? `${market.title} was cancelled and all positions were refunded.`
              : `${market.title} is finalized and payouts are complete.`,
      href: `/markets/${market.id}`
    });

    for (const userId of participantIds) {
      await refreshUserStats(tx, userId);
    }

    return market;
  });
}

export async function submitHostMarketResolution(input: {
  marketId: string;
  hostUserId: string;
  outcome?: "YES" | "NO" | "CANCELLED";
  actualValue?: number;
  resolutionNote: string;
  evidenceText?: string;
  evidenceUrl?: string;
}) {
  return prisma.$transaction(async (tx) => {
    const market = await tx.market.findUnique({
      where: { id: input.marketId },
      include: {
        positions: {
          select: {
            userId: true
          }
        },
        creator: {
          select: {
            username: true
          }
        }
      }
    });

    if (!market) {
      throw new Error("Market not found.");
    }

    const normalizedMode = normalizeResolutionMode(market.resolutionMode);
    if (!["TRUSTED_HOST", "HOST", "GROUP_VOTE"].includes(normalizedMode)) {
      throw new Error("This market does not use host-style resolution.");
    }

    if (market.creatorId !== input.hostUserId) {
      throw new Error("Only the market host can submit this resolution.");
    }

    if (
      (market.marketType === "BINARY" && market.outcome !== "UNRESOLVED") ||
      (market.marketType === "NUMERIC" && market.actualValue !== null)
    ) {
      throw new Error("This market already has a submitted resolution.");
    }

    if (!["CLOSED", "AWAITING_RESOLUTION", "RESOLVING", "OPEN"].includes(market.status)) {
      throw new Error("This market is not ready for host resolution.");
    }

    if (market.marketType === "BINARY" && !input.outcome) {
      throw new Error("Binary markets require a YES, NO, or CANCELLED outcome.");
    }

    if (market.marketType === "NUMERIC" && input.outcome !== "CANCELLED" && input.actualValue === undefined) {
      throw new Error("Numeric markets require the actual resolved value.");
    }

    const isCancellation = input.outcome === "CANCELLED";
    if (market.closeAt > new Date()) {
      throw new Error("Wait until the market closes before submitting a host resolution.");
    }

    if (!isCancellation && market.resolveAt > new Date()) {
      throw new Error("Wait until the resolve time before submitting the final host result.");
    }

    const evidencePayload: Prisma.JsonObject = {
      text: input.evidenceText || null,
      url: input.evidenceUrl || null
    };
    const resolvedOutcome =
      market.marketType === "NUMERIC"
        ? isCancellation
          ? "CANCELLED"
          : "UNRESOLVED"
        : (input.outcome ?? "UNRESOLVED");
    const actualValue = market.marketType === "NUMERIC" ? input.actualValue : undefined;

    if ((normalizedMode === "TRUSTED_HOST" || normalizedMode === "HOST") && !isCancellation) {
      const challengeWindowEndsAt = addHours(
        new Date(),
        market.challengeWindowHours || getTrustedHostChallengeWindowHours()
      );

      await tx.market.update({
        where: { id: market.id },
        data: {
          status: "RESOLVED",
          outcome: resolvedOutcome,
          actualValue: actualValue ?? null,
          resolutionStatus: "RESOLVED_PENDING_CHALLENGE",
          challengeWindowEndsAt,
          finalResolutionDeadline: null,
          hostResolutionNote: input.resolutionNote,
          hostResolutionEvidenceJson: evidencePayload
        }
      });

      await upsertMarketResolution(tx, {
        marketId: market.id,
        outcome: resolvedOutcome,
        actualValue,
        sourceName:
          normalizedMode === "TRUSTED_HOST"
            ? `${market.creator.username} (trusted host)`
            : `${market.creator.username} (host)`,
        sourceUrl: input.evidenceUrl || undefined,
        explanation: input.resolutionNote,
        resolvedById: input.hostUserId,
        auditData: {
          evidenceText: input.evidenceText || null,
          evidenceUrl: input.evidenceUrl || null
        }
      });

      await tx.adminAction.create({
        data: {
          actorId: input.hostUserId,
          marketId: market.id,
          type: "HOST_RESOLVE_MARKET",
          notes: input.resolutionNote,
          metadata: {
            outcome: resolvedOutcome,
            actualValue: actualValue ?? null,
            challengeWindowEndsAt: challengeWindowEndsAt.toISOString()
          }
        }
      });

      await notifyMany(
        tx,
        Array.from(new Set(market.positions.map((position) => position.userId))),
        {
          marketId: market.id,
          type: "SYSTEM",
          title: "Resolution pending finalization",
          body: `${market.title} has a host-submitted result and is now in its challenge window.`,
          href: `/markets/${market.id}`
        }
      );

      return market;
    }

    const sourceName =
      normalizedMode === "GROUP_VOTE"
        ? "Community consensus"
        : `${market.creator.username} (host)`;

    if (isCancellation) {
      await finalizeMarketResolution({
        marketId: market.id,
        outcome: "CANCELLED",
        sourceName,
        sourceUrl: input.evidenceUrl,
        explanation: input.resolutionNote,
        resolvedById: input.hostUserId,
        resolutionStatus: "CANCELLED",
        finalizationActorId: input.hostUserId,
        releaseHostBond: true,
        hostResolutionNote: input.resolutionNote,
        hostResolutionEvidenceJson: evidencePayload
      });
    } else {
      await finalizeMarketResolution({
        marketId: market.id,
        outcome: resolvedOutcome,
        actualValue,
        sourceName,
        sourceUrl: input.evidenceUrl,
        explanation: input.resolutionNote,
        resolvedById: input.hostUserId,
        resolutionStatus: "FINALIZED",
        payHostReward: normalizedMode === "HOST",
        releaseHostBond: true,
        finalizationActorId: input.hostUserId,
        hostResolutionNote: input.resolutionNote,
        hostResolutionEvidenceJson: evidencePayload
      });
    }

    return market;
  });
}

export async function submitMarketChallenge(input: {
  marketId: string;
  challengerUserId: string;
  reasonText?: string;
  evidenceText?: string;
  evidenceUrl?: string;
}) {
  return prisma.$transaction(async (tx) => {
    const market = await tx.market.findUnique({
      where: { id: input.marketId },
      include: {
        positions: {
          where: {
            userId: input.challengerUserId
          },
          select: {
            id: true
          }
        }
      }
    });

    if (!market) {
      throw new Error("Market not found.");
    }

    if (!isHostResolvedMode(market.resolutionMode)) {
      throw new Error("Challenges are only available for host-resolved markets.");
    }

    if (market.resolutionStatus !== "RESOLVED_PENDING_CHALLENGE") {
      throw new Error("This market is not currently challengeable.");
    }

    if (!market.challengeWindowEndsAt || market.challengeWindowEndsAt <= new Date()) {
      throw new Error("The challenge window has already closed.");
    }

    if (market.positions.length === 0) {
      throw new Error("Only participants can challenge a host resolution.");
    }

    const existingChallenge = await tx.challenge.findFirst({
      where: {
        marketId: market.id,
        challengerUserId: input.challengerUserId,
        status: "OPEN"
      }
    });

    if (existingChallenge) {
      throw new Error("You already have an open challenge for this market.");
    }

    const challenge = await tx.challenge.create({
      data: {
        marketId: market.id,
        challengerUserId: input.challengerUserId,
        reasonText: input.reasonText || null,
        evidenceText: input.evidenceText || null,
        evidenceUrl: input.evidenceUrl || null
      }
    });

    await tx.market.update({
      where: { id: market.id },
      data: {
        resolutionStatus: "DISPUTED",
        disputeCount: {
          increment: 1
        }
      }
    });

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
      [market.creatorId, ...admins.map((admin) => admin.id)],
      {
        marketId: market.id,
        type: "SYSTEM",
        title: "Host-resolved market challenged",
        body: `${market.title} now needs review before finalization.`,
        href: "/admin/resolutions"
      }
    );

    await refreshUserStats(tx, market.creatorId);
    await refreshUserStats(tx, input.challengerUserId);

    return challenge;
  });
}

export async function upholdTrustedHostResolution(input: {
  marketId: string;
  actorId: string;
  explanation: string;
}) {
  const market = await prisma.market.findUnique({
    where: { id: input.marketId },
    include: {
      resolution: true
    }
  });

  if (!market) {
    throw new Error("Market not found.");
  }

  if (!isHostResolvedMode(market.resolutionMode)) {
    throw new Error("Only host-resolved markets can be upheld.");
  }

  if (!["RESOLVED_PENDING_CHALLENGE", "DISPUTED"].includes(market.resolutionStatus)) {
    throw new Error("This market is not waiting for challenge review.");
  }

  if (market.marketType === "BINARY" && market.outcome === "UNRESOLVED") {
    throw new Error("No host resolution has been submitted yet.");
  }

  await finalizeMarketResolution({
    marketId: market.id,
    outcome: market.outcome,
    actualValue: market.actualValue ?? undefined,
    sourceName: market.resolution?.sourceName ?? market.resolutionSourceName,
    sourceUrl: market.resolution?.sourceUrl ?? market.resolutionSourceUrl ?? undefined,
    explanation: input.explanation,
    resolvedById: market.resolution?.resolvedById ?? market.creatorId,
    resolutionStatus: "FINALIZED",
    payHostReward: true,
    releaseHostBond: true,
    markChallengesAs: "REJECTED",
    finalizationActorId: input.actorId,
    hostResolutionNote: market.hostResolutionNote,
    hostResolutionEvidenceJson: market.hostResolutionEvidenceJson
  });

  await prisma.adminAction.create({
    data: {
      actorId: input.actorId,
      marketId: market.id,
      type: "UPHOLD_MARKET_RESOLUTION",
      notes: input.explanation
    }
  });
}

export async function overturnTrustedHostResolution(input: {
  marketId: string;
  actorId: string;
  outcome?: "YES" | "NO";
  actualValue?: number;
  explanation: string;
  sourceName: string;
  sourceUrl?: string;
  overturnedReason: string;
}) {
  const market = await prisma.market.findUnique({
    where: { id: input.marketId },
    include: {
      resolution: true
    }
  });

  if (!market) {
    throw new Error("Market not found.");
  }

  if (!isHostResolvedMode(market.resolutionMode)) {
    throw new Error("Only host-resolved markets can be overturned.");
  }

  if (!["RESOLVED_PENDING_CHALLENGE", "DISPUTED"].includes(market.resolutionStatus)) {
    throw new Error("This market is not waiting for challenge review.");
  }

  if (market.marketType === "BINARY" && !input.outcome) {
    throw new Error("Binary host markets require a corrected YES or NO outcome.");
  }

  if (market.marketType === "NUMERIC" && input.actualValue === undefined) {
    throw new Error("Numeric host markets require a corrected actual value.");
  }

  await finalizeMarketResolution({
    marketId: market.id,
    outcome: market.marketType === "NUMERIC" ? "UNRESOLVED" : input.outcome ?? "UNRESOLVED",
    actualValue: input.actualValue,
    sourceName: input.sourceName,
    sourceUrl: input.sourceUrl,
    explanation: input.explanation,
    resolvedById: input.actorId,
    resolutionStatus: "OVERTURNED",
    forfeitHostBond: true,
    markChallengesAs: "UPHELD",
    finalizationActorId: input.actorId,
    hostResolutionNote: market.hostResolutionNote,
    hostResolutionEvidenceJson: market.hostResolutionEvidenceJson,
    overturnedReason: input.overturnedReason,
    auditData: {
      priorOutcome: market.outcome,
      priorActualValue: market.actualValue,
      overturnedReason: input.overturnedReason
    }
  });

  await prisma.adminAction.create({
    data: {
      actorId: input.actorId,
      marketId: market.id,
      type: "OVERTURN_MARKET_RESOLUTION",
      notes: input.explanation,
      metadata: {
        overturnedReason: input.overturnedReason,
        correctedOutcome: input.outcome ?? null,
        correctedActualValue: input.actualValue ?? null
      }
    }
  });
}

export async function cancelMarketAfterReview(input: {
  marketId: string;
  actorId: string;
  explanation: string;
}) {
  const market = await prisma.market.findUnique({
    where: { id: input.marketId },
    include: {
      resolution: true
    }
  });

  if (!market) {
    throw new Error("Market not found.");
  }

  const shouldForfeitBond = isHostResolvedMode(market.resolutionMode) && Boolean(market.hostResolutionNote);

  await finalizeMarketResolution({
    marketId: market.id,
    outcome: "CANCELLED",
    sourceName: market.resolution?.sourceName ?? "Admin cancellation",
    sourceUrl: market.resolution?.sourceUrl ?? undefined,
    explanation: input.explanation,
    resolvedById: input.actorId,
    resolutionStatus: "CANCELLED",
    releaseHostBond: !shouldForfeitBond,
    forfeitHostBond: shouldForfeitBond,
    markChallengesAs: shouldForfeitBond ? "UPHELD" : "REVIEWED",
    finalizationActorId: input.actorId,
    hostResolutionNote: market.hostResolutionNote,
    hostResolutionEvidenceJson: market.hostResolutionEvidenceJson
  });

  await prisma.adminAction.create({
    data: {
      actorId: input.actorId,
      marketId: market.id,
      type: "CANCEL_MARKET",
      notes: input.explanation
    }
  });
}

export async function finalizeExpiredHostResolutionMarkets() {
  const now = new Date();
  const markets = await prisma.market.findMany({
    where: {
      resolutionStatus: "RESOLVED_PENDING_CHALLENGE",
      challengeWindowEndsAt: {
        lte: now
      }
    },
    include: {
      challenges: {
        where: {
          status: "OPEN"
        },
        select: {
          id: true
        }
      },
      resolution: true
    }
  });

  let finalized = 0;
  for (const market of markets) {
    if (!isHostedResolutionMode(market.resolutionMode)) {
      continue;
    }

    if (market.challenges.length > 0) {
      continue;
    }

    if (market.marketType === "BINARY" && market.outcome === "UNRESOLVED") {
      continue;
    }

    await finalizeMarketResolution({
      marketId: market.id,
      outcome: market.outcome,
      actualValue: market.actualValue ?? undefined,
      sourceName: market.resolution?.sourceName ?? market.resolutionSourceName,
      sourceUrl: market.resolution?.sourceUrl ?? market.resolutionSourceUrl ?? undefined,
      explanation:
        market.resolution?.explanation ??
        market.hostResolutionNote ??
        "Host-submitted resolution finalized after the challenge window closed.",
      resolvedById: market.resolution?.resolvedById ?? undefined,
      resolutionStatus: "FINALIZED",
      payHostReward: true,
      releaseHostBond: true,
      hostResolutionNote: market.hostResolutionNote,
      hostResolutionEvidenceJson: market.hostResolutionEvidenceJson
    });
    finalized += 1;
  }

  return finalized;
}

export async function processHostResolutionTimeouts() {
  const now = new Date();
  const markets = await prisma.market.findMany({
    where: {
      status: "AWAITING_RESOLUTION",
      finalResolutionDeadline: {
        lte: now
      }
    }
  });

  let timedOut = 0;
  for (const market of markets) {
    if (!isHostedResolutionMode(market.resolutionMode)) {
      continue;
    }

    await finalizeMarketResolution({
      marketId: market.id,
      outcome: "CANCELLED",
      sourceName: market.resolutionSourceName,
      sourceUrl: market.resolutionSourceUrl ?? undefined,
      explanation:
        "The host did not submit a resolution before the deadline. The market timed out and all participants were refunded.",
      resolutionStatus: "HOST_TIMEOUT",
      marketStatus: "HOST_TIMEOUT",
      forfeitHostBond: market.lockedBondAmount > 0,
      finalizationActorId: market.creatorId,
      auditData: {
        timeout: true,
        finalResolutionDeadline: market.finalResolutionDeadline?.toISOString() ?? null
      }
    });
    timedOut += 1;
  }

  return timedOut;
}
