import { NextResponse } from "next/server";

import { getSession, getUserIdFromRequest } from "@/lib/auth";
import { canManageMarket, canViewMarket } from "@/lib/markets/access";
import { finalizeMarketResolution } from "@/lib/markets/resolution";
import { prisma } from "@/lib/prisma";
import { updateMarketSchema } from "@/lib/validations/market";

export async function GET(
  request: Request,
  { params }: { params: { marketId: string } }
) {
  const viewerId = (await getUserIdFromRequest(request)) ?? undefined;
  const viewer = viewerId
    ? await prisma.user.findUnique({
        where: { id: viewerId },
        select: {
          id: true,
          role: true
        }
      })
    : null;

  const market = await prisma.market.findUnique({
    where: { id: params.marketId },
    include: {
      group: viewer?.id
        ? {
            select: {
              ownerId: true,
              memberships: {
                where: {
                  userId: viewer.id
                },
                select: {
                  userId: true
                }
              }
            }
          }
        : {
            select: {
              ownerId: true
            }
          },
      creator: {
        select: {
          username: true,
          reputationScore: true
        }
      },
      comments: {
        include: {
          user: {
            select: {
              username: true
            }
          }
        }
      },
      resolution: {
        select: {
          explanation: true,
          resolvedAt: true,
          createdAt: true,
          resolvedBy: {
            select: {
              username: true,
            },
          },
        },
      }
    }
  });

  if (!market) {
    return NextResponse.json({ error: "Market not found." }, { status: 404 });
  }

  if (!canViewMarket(market, viewer)) {
    return NextResponse.json({ error: "Market not found." }, { status: 404 });
  }

  const userPositions = viewerId
    ? await prisma.marketPosition.findMany({
        where: { marketId: market.id, userId: viewerId },
        select: {
          id: true,
          side: true,
          amount: true,
          numericValue: true,
          probabilityAtEntry: true,
          estimatedReturnAtEntry: true,
          createdAt: true,
        },
        orderBy: { createdAt: "desc" },
      })
    : [];

  // For poll markets (storyId != null), also fetch the user's free vote
  const userVote =
    viewerId && market.storyId
      ? await prisma.vote.findFirst({
          where: { marketId: market.id, userId: viewerId },
          select: { side: true, numericValue: true },
        })
      : null;

  // Shape the resolution field: rename explanation → rationale, add wasOverturned
  const shapedResolution = market.resolution
    ? {
        rationale: market.resolution.explanation,
        resolvedBy: market.resolution.resolvedBy ?? null,
        createdAt: market.resolution.createdAt,
        wasOverturned: Boolean(market.overturnedReason),
      }
    : null;

  const responseMarket = {
    ...market,
    resolution: shapedResolution,
  };

  return NextResponse.json({ market: responseMarket, userPositions, userVote });
}

export async function PATCH(
  request: Request,
  { params }: { params: { marketId: string } }
) {
  try {
    const session = await getSession();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Authentication required." }, { status: 401 });
    }

    const market = await prisma.market.findUnique({
      where: { id: params.marketId }
    });
    if (!market) {
      return NextResponse.json({ error: "Market not found." }, { status: 404 });
    }

    const actor = await prisma.user.findUnique({
      where: { id: session.user.id }
    });
    if (!actor) {
      return NextResponse.json({ error: "User not found." }, { status: 404 });
    }

    if (!canManageMarket(market, actor)) {
      return NextResponse.json({ error: "You cannot edit this market." }, { status: 403 });
    }

    if (market.status !== "DRAFT") {
      return NextResponse.json({ error: "Only draft markets can be edited." }, { status: 409 });
    }

    const payload = updateMarketSchema.parse(await request.json());

    const updated = await prisma.market.update({
      where: { id: market.id },
      data: {
        ...(payload.title ? { title: payload.title } : {}),
        ...(payload.description ? { description: payload.description } : {}),
        ...(payload.category ? { category: payload.category } : {}),
        ...(payload.template ? { template: payload.template } : {}),
        ...(payload.visibility ? { visibility: payload.visibility } : {}),
        ...(payload.groupId !== undefined ? { groupId: payload.groupId || null } : {}),
        ...(payload.closeAt ? { closeAt: new Date(payload.closeAt) } : {}),
        ...(payload.resolveAt ? { resolveAt: new Date(payload.resolveAt) } : {}),
        ...(payload.resolutionMode ? { resolutionMode: payload.resolutionMode } : {}),
        ...(payload.resolutionSourceType ? { resolutionSourceType: payload.resolutionSourceType } : {}),
        ...(payload.resolutionSourceName ? { resolutionSourceName: payload.resolutionSourceName } : {}),
        ...(payload.resolutionSourceUrl !== undefined
          ? { resolutionSourceUrl: payload.resolutionSourceUrl || null }
          : {}),
        ...(payload.resolutionRuleText ? { resolutionRuleText: payload.resolutionRuleText } : {}),
        ...(payload.fallbackRuleText !== undefined
          ? { fallbackRuleText: payload.fallbackRuleText || null }
          : {}),
        ...(payload.structuredData ? { structuredData: payload.structuredData } : {})
      }
    });

    return NextResponse.json({ market: updated });
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: "Unable to update market." }, { status: 400 });
  }
}

export async function DELETE(
  _request: Request,
  { params }: { params: { marketId: string } }
) {
  const session = await getSession();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  }

  const market = await prisma.market.findUnique({
    where: { id: params.marketId },
    include: {
      positions: {
        select: {
          id: true
        }
      }
    }
  });
  if (!market) {
    return NextResponse.json({ error: "Market not found." }, { status: 404 });
  }

  const actor = await prisma.user.findUnique({
    where: { id: session.user.id }
  });
  if (!actor) {
    return NextResponse.json({ error: "User not found." }, { status: 404 });
  }

  const canManage = canManageMarket(market, actor);
  if (!canManage) {
    return NextResponse.json({ error: "You cannot delete this market." }, { status: 403 });
  }

  if (market.positions.length === 0 && market.status === "DRAFT") {
    await prisma.market.delete({
      where: { id: market.id }
    });
    return NextResponse.json({ ok: true });
  }

  if (actor.role !== "ADMIN" && actor.role !== "MODERATOR") {
    return NextResponse.json(
      { error: "Only admins can cancel live or traded markets." },
      { status: 403 }
    );
  }

  await finalizeMarketResolution({
    marketId: market.id,
    outcome: "CANCELLED",
    sourceName: "Admin cancellation",
    explanation: "Market cancelled by staff and all positions refunded.",
    resolvedById: actor.id
  });

  return NextResponse.json({ ok: true });
}
