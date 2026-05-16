import { NextResponse } from "next/server";

import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

/**
 * GET /api/profile/me/markets — returns the authenticated user's created polls
 * and polls they have voted on.
 */
export async function GET() {
  const session = await getSession();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  }

  const [createdPolls, votes] = await Promise.all([
    prisma.market.findMany({
      where: { creatorId: session.user.id },
      select: {
        id: true,
        title: true,
        status: true,
        category: true,
        visibility: true,
        yesCount: true,
        noCount: true,
        totalVotes: true,
        closeAt: true,
        createdAt: true,
      },
      orderBy: { createdAt: "desc" },
      take: 50,
    }),
    prisma.vote.findMany({
      where: { userId: session.user.id },
      select: {
        id: true,
        side: true,
        numericValue: true,
        createdAt: true,
        market: {
          select: {
            id: true,
            title: true,
            status: true,
            category: true,
            yesCount: true,
            noCount: true,
          },
        },
      },
      orderBy: { createdAt: "desc" },
      take: 50,
    }),
  ]);

  return NextResponse.json({ createdPolls, votes });
}
