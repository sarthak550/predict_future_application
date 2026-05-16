import { NextResponse } from "next/server";
import { getUserIdFromRequest } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

/**
 * GET /api/finance/experts/followed
 * Authenticated. Returns { expertIds: string[] } of all experts the user follows.
 * Returns { expertIds: [] } when unauthenticated.
 */
export async function GET(request: Request) {
  const userId = await getUserIdFromRequest(request);

  if (!userId) {
    return NextResponse.json({ expertIds: [] });
  }

  const follows = await prisma.expertFollow.findMany({
    where: { userId },
    select: { expertId: true },
    orderBy: { createdAt: "desc" },
  });

  return NextResponse.json({ expertIds: follows.map((f) => f.expertId) });
}
