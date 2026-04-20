import { NextResponse } from "next/server";

import { getSession } from "@/lib/auth";
import { canViewMarket } from "@/lib/markets/access";
import { prisma } from "@/lib/prisma";

export async function GET(
  _request: Request,
  { params }: { params: { marketId: string } }
) {
  const session = await getSession();
  const viewer = session?.user?.id
    ? await prisma.user.findUnique({
        where: { id: session.user.id },
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
      challenges: {
        include: {
          challenger: {
            select: {
              username: true
            }
          },
          reviewedBy: {
            select: {
              username: true
            }
          }
        },
        orderBy: {
          createdAt: "desc"
        }
      }
    }
  });

  if (!market || !canViewMarket(market, viewer)) {
    return NextResponse.json({ error: "Market not found." }, { status: 404 });
  }

  return NextResponse.json({ challenges: market.challenges });
}
