import { NextResponse } from "next/server";
import { z } from "zod";

import { getUserIdFromRequest } from "@/lib/auth";
import { canViewMarket } from "@/lib/markets/access";
import { createNotification } from "@/lib/notifications";
import { prisma } from "@/lib/prisma";

const commentSchema = z.object({
  content: z.string().min(1, "Comment cannot be empty.").max(500, "Comment is too long.")
});

export async function GET(
  _request: Request,
  { params }: { params: { marketId: string } }
) {
  try {
    const market = await prisma.market.findUnique({
      where: { id: params.marketId },
      select: { id: true, visibility: true, groupId: true, group: { select: { ownerId: true } } }
    });

    if (!market) {
      return NextResponse.json({ error: "Market not found." }, { status: 404 });
    }

    const rawComments = await prisma.marketComment.findMany({
      where: { marketId: params.marketId },
      include: {
        user: {
          select: { username: true }
        }
      },
      orderBy: { createdAt: "desc" }
    });

    const comments = rawComments.map((c) => ({
      id: c.id,
      content: c.body,
      createdAt: c.createdAt.toISOString(),
      user: { username: c.user.username }
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
        include: {
          user: {
            select: { username: true }
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
          user: { username: result.user.username }
        }
      },
      { status: 201 }
    );
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: "Unable to add comment." }, { status: 400 });
  }
}
