import { NextResponse } from "next/server";

import { getSession } from "@/lib/auth";
import { canViewMarket } from "@/lib/markets/access";
import { createNotification } from "@/lib/notifications";
import { prisma } from "@/lib/prisma";
import { marketReportSchema } from "@/lib/validations/market";

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
      return NextResponse.json({ error: "Account cannot submit reports." }, { status: 403 });
    }

    const payload = marketReportSchema.parse(await request.json());

    const duplicate = await prisma.marketReport.findFirst({
      where: {
        marketId: params.marketId,
        reporterId: user.id,
        status: {
          in: ["OPEN", "REVIEWING"]
        }
      }
    });
    if (duplicate) {
      return NextResponse.json({ error: "You already have an open report for this market." }, { status: 409 });
    }

    await prisma.$transaction(async (tx) => {
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

      await tx.marketReport.create({
        data: {
          marketId: market.id,
          reporterId: user.id,
          reason: payload.reason,
          details: payload.details || null
        }
      });

      await tx.market.update({
        where: { id: market.id },
        data: {
          isFlagged: true
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

      for (const admin of admins) {
        await createNotification(tx, {
          userId: admin.id,
          marketId: market.id,
          type: "REPORT_UPDATE",
          title: "New market report",
          body: `${market.title} has been flagged for review.`,
          href: "/admin/moderation"
        });
      }
    });

    return NextResponse.json({ ok: true }, { status: 201 });
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: "Unable to submit report." }, { status: 400 });
  }
}
