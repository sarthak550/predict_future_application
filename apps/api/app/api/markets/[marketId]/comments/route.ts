import { NextResponse } from "next/server";
import { z } from "zod";

import { getUserIdFromRequest } from "@/lib/auth";
import { canViewMarket } from "@/lib/markets/access";
import { createNotification } from "@/lib/notifications";
import { prisma } from "@/lib/prisma";
import { getDisplayName } from "@/lib/users/displayName";

const commentSchema = z.object({
  content: z.string().min(1, "Comment cannot be empty.").max(500, "Comment is too long.")
});

type CommenterPosition =
  | { kind: "binary"; side: "YES" | "NO"; amount: number }
  | { kind: "multi-choice"; optionId: string; optionLabel: string; amount: number }
  | { kind: "numeric"; value: number; amount: number };

export async function GET(
  request: Request,
  { params }: { params: { marketId: string } }
) {
  try {
    const viewerId = (await getUserIdFromRequest(request)) ?? undefined;
    const viewer = viewerId
      ? await prisma.user.findUnique({
          where: { id: viewerId },
          select: { id: true, role: true },
        })
      : null;

    const market = await prisma.market.findUnique({
      where: { id: params.marketId },
      select: {
        id: true,
        creatorId: true,
        status: true,
        marketType: true,
        visibility: true,
        groupId: true,
        group: viewer?.id
          ? {
              select: {
                ownerId: true,
                memberships: {
                  where: { userId: viewer.id },
                  select: { userId: true },
                },
              },
            }
          : { select: { ownerId: true } },
      },
    });

    if (!market) {
      return NextResponse.json({ error: "Market not found." }, { status: 404 });
    }

    if (!canViewMarket(market, viewer)) {
      return NextResponse.json({ error: "Market not found." }, { status: 404 });
    }

    const rawComments = await prisma.marketComment.findMany({
      where: { marketId: params.marketId },
      select: {
        id: true,
        body: true,
        userId: true,
        createdAt: true,
        tipsReceived: true,
        user: {
          select: { id: true, username: true, displayMode: true, isVerifiedAnalyst: true }
        }
      },
      orderBy: { createdAt: "desc" }
    });

    // Collect the unique set of commenter userIds — we'll batch-fetch positions
    // in a single query per position table to avoid N+1 queries.
    const commenterUserIds = [...new Set(rawComments.map((c) => c.userId))];

    // Map: userId → CommenterPosition (populated below based on market type)
    const positionByUserId = new Map<string, CommenterPosition>();

    if (commenterUserIds.length > 0) {
      if (market.marketType === "MULTIPLE_CHOICE") {
        // Batch-fetch all MultiChoicePosition rows for these users on this market.
        // Each user may have at most one position per option; we take the largest.
        const multiPositions = await prisma.multiChoicePosition.findMany({
          where: {
            marketId: params.marketId,
            userId: { in: commenterUserIds },
          },
          select: {
            userId: true,
            optionId: true,
            amount: true,
            option: { select: { label: true } },
          },
        });

        // Group by userId and pick the highest-amount stake to surface as the badge.
        for (const pos of multiPositions) {
          const existing = positionByUserId.get(pos.userId);
          const existingAmount =
            existing?.kind === "multi-choice" ? existing.amount : 0;
          if (pos.amount > existingAmount) {
            positionByUserId.set(pos.userId, {
              kind: "multi-choice",
              optionId: pos.optionId,
              optionLabel: pos.option.label,
              amount: pos.amount,
            });
          }
        }
      } else {
        // BINARY and NUMERIC both use MarketPosition.
        const positions = await prisma.marketPosition.findMany({
          where: {
            marketId: params.marketId,
            userId: { in: commenterUserIds },
          },
          select: {
            userId: true,
            side: true,
            numericValue: true,
            amount: true,
          },
        });

        for (const pos of positions) {
          if (market.marketType === "NUMERIC" && pos.numericValue !== null) {
            positionByUserId.set(pos.userId, {
              kind: "numeric",
              value: pos.numericValue,
              amount: pos.amount,
            });
          } else if (pos.side !== null) {
            // BINARY — PositionSide enum values are "YES" | "NO"
            positionByUserId.set(pos.userId, {
              kind: "binary",
              side: pos.side as "YES" | "NO",
              amount: pos.amount,
            });
          }
        }
      }
    }

    const comments = rawComments.map((c) => ({
      id: c.id,
      content: c.body,
      createdAt: c.createdAt.toISOString(),
      tipsReceived: c.tipsReceived,
      user: {
        id: c.user.id,
        username: getDisplayName(c.user),
        isVerifiedAnalyst: c.user.isVerifiedAnalyst
      },
      commenterPosition: positionByUserId.get(c.userId) ?? null,
    }));

    return NextResponse.json({ comments });
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: "Unable to load comments." }, { status: 500 });
  }
}

export async function POST(
  request: Request,
  { params }: { params: { marketId: string } }
) {
  try {
    const requestUserId = await getUserIdFromRequest(request);
    if (!requestUserId) {
      return NextResponse.json({ error: "Authentication required." }, { status: 401 });
    }

    const user = await prisma.user.findUnique({
      where: { id: requestUserId },
      select: {
        id: true,
        username: true,
        displayMode: true,
        isSuspended: true,
        role: true
      }
    });
    if (!user || user.isSuspended) {
      return NextResponse.json({ error: "Account cannot comment." }, { status: 403 });
    }

    const rawBody = await request.json() as unknown;
    const payload = commentSchema.parse(rawBody);

    const result = await prisma.$transaction(async (tx) => {
      const market = await tx.market.findUnique({
        where: { id: params.marketId },
        include: {
          group: {
            select: {
              ownerId: true,
              memberships: {
                where: {
                  userId: user.id
                },
                select: {
                  userId: true
                }
              }
            }
          }
        }
      });
      if (!market) {
        throw new Error("Market not found.");
      }
      if (!canViewMarket(market, user)) {
        throw new Error("You do not have access to this market.");
      }

      const comment = await tx.marketComment.create({
        data: {
          userId: user.id,
          marketId: market.id,
          body: payload.content
        },
        select: {
          id: true,
          body: true,
          tipsReceived: true,
          createdAt: true,
          user: {
            select: { id: true, username: true, displayMode: true, isVerifiedAnalyst: true }
          }
        }
      });

      if (market.creatorId !== user.id) {
        await createNotification(tx, {
          userId: market.creatorId,
          marketId: market.id,
          type: "COMMENT",
          title: "New comment on your market",
          body: `@${user.username} commented on ${market.title}.`,
          href: `/markets/${market.id}`
        });
      }

      return comment;
    });

    return NextResponse.json(
      {
        comment: {
          id: result.id,
          content: result.body,
          createdAt: result.createdAt.toISOString(),
          tipsReceived: result.tipsReceived,
          user: {
            id: result.user.id,
            username: getDisplayName(result.user),
            isVerifiedAnalyst: result.user.isVerifiedAnalyst
          }
        }
      },
      { status: 201 }
    );
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: "Unable to add comment." }, { status: 400 });
  }
}
