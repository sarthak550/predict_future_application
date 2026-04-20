import { prisma } from "@/lib/prisma";
import {
  attemptAutomaticResolution,
  finalizeExpiredHostResolutionMarkets,
  finalizeMarketResolution
} from "@/lib/markets/resolution";
import { notifyMany } from "@/lib/notifications";
import { isHostResolvedMode, normalizeResolutionMode } from "@/lib/markets/policies";
import { processHostResolutionTimeouts } from "@/lib/markets/resolution";

export async function runMarketLifecycleJobs() {
  const now = new Date();
  const marketsToClose = await prisma.market.findMany({
    where: {
      status: "OPEN",
      closeAt: {
        lte: now
      }
    },
    include: {
      positions: {
        select: {
          userId: true
        }
      }
    }
  });

  for (const market of marketsToClose) {
    await prisma.market.update({
      where: { id: market.id },
      data: {
        status: "CLOSED",
        resolutionStatus: "CLOSED"
      }
    });

    await prisma.$transaction(async (tx) => {
      await notifyMany(
        tx,
        [
          market.creatorId,
          ...market.positions.map((position) => position.userId)
        ],
        {
          marketId: market.id,
          type: "MARKET_CLOSED",
          title: "Market closed",
          body: `${market.title} is now closed for new positions.`,
          href: `/markets/${market.id}`
        }
      );
    });
  }

  const marketsToResolve = await prisma.market.findMany({
    where: {
      status: {
        in: ["OPEN", "CLOSED"]
      },
      resolveAt: {
        lte: now
      },
      outcome: "UNRESOLVED"
    }
  });

  let movedToAwaitingResolution = 0;
  let movedToResolving = 0;
  for (const market of marketsToResolve) {
    if (isHostResolvedMode(market.resolutionMode)) {
      await prisma.market.update({
        where: { id: market.id },
        data: {
          status: "AWAITING_RESOLUTION",
          resolutionStatus: "AWAITING_RESOLUTION",
          finalResolutionDeadline: new Date(
            market.resolveAt.getTime() + (market.gracePeriodHours || 48) * 60 * 60 * 1000
          )
        }
      });

      await prisma.$transaction(async (tx) => {
        await notifyMany(tx, [market.creatorId], {
          marketId: market.id,
          type: "SYSTEM",
          title: "Resolution needed",
          body: `${market.title} is now awaiting host resolution.`,
          href: `/markets/${market.id}`
        });
      });
      movedToAwaitingResolution += 1;
      continue;
    }

    if (normalizeResolutionMode(market.resolutionMode) === "VERIFIED") {
      await prisma.market.update({
        where: { id: market.id },
        data: {
          status: "RESOLVING"
        }
      });
      movedToResolving += 1;
    }
  }

  const resolvingMarkets = await prisma.market.findMany({
    where: {
      status: "RESOLVING",
      outcome: "UNRESOLVED"
    }
  });

  let automatedResolutions = 0;
  for (const market of resolvingMarkets) {
    const automatedResult = await attemptAutomaticResolution(market.id);
    if (!automatedResult) {
      continue;
    }

    await finalizeMarketResolution({
      marketId: market.id,
      outcome: automatedResult.outcome,
      sourceName: automatedResult.sourceName,
      sourceUrl: automatedResult.sourceUrl,
      explanation: automatedResult.explanation,
      auditData: automatedResult.auditData,
      automated: true
    });
    automatedResolutions += 1;
  }

  const finalizedHostMarkets = await finalizeExpiredHostResolutionMarkets();
  const hostTimeouts = await processHostResolutionTimeouts();

  return {
    closed: marketsToClose.length,
    movedToResolving,
    movedToAwaitingResolution,
    automatedResolutions,
    finalizedHostMarkets,
    hostTimeouts
  };
}
