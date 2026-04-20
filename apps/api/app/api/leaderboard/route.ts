import { MarketCategory } from "@prisma/client";
import { NextResponse } from "next/server";

import { prisma } from "@/lib/prisma";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const category = searchParams.get("category");

  if (category && Object.values(MarketCategory).includes(category as MarketCategory)) {
    const entries = await prisma.userCategoryStat.findMany({
      where: {
        category: category as MarketCategory
      },
      include: {
        user: {
          select: {
            username: true,
            reputationScore: true
          }
        }
      },
      orderBy: [{ accuracyScore: "desc" }, { totalNetPoints: "desc" }],
      take: 25
    });
    return NextResponse.json({ entries });
  }

  const entries = await prisma.user.findMany({
    include: {
      stats: true
    },
    orderBy: [{ reputationScore: "desc" }, { accuracyScore: "desc" }],
    take: 25
  });
  return NextResponse.json({ entries });
}
