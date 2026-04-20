import { NextResponse } from "next/server";

import { getSession } from "@/lib/auth";
import { canViewMarket } from "@/lib/markets/access";
import { createNotification } from "@/lib/notifications";
import { prisma } from "@/lib/prisma";
import { marketCommentSchema } from "@/lib/validations/market";

export async function POST(
  request: Request,
  { params }: { params: { marketId: string } }
) {
  try {
    const session = await getSession();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Authentication required." }, { status: 401 });
    }

    const user = await prisma.user.findUnique({
      where: { id: session.user.id },
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

    const payload = marketCommentSchema.parse(await request.json());

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
          body: payload.body
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

    return NextResponse.json({ comment: result }, { status: 201 });
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: "Unable to add comment." }, { status: 400 });
  }
}
