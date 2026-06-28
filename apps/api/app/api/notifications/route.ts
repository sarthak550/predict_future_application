import { NextRequest, NextResponse } from "next/server";

import { getUserIdFromRequest } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function GET(request: NextRequest) {
  const userId = await getUserIdFromRequest(request);
  if (!userId) {
    return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const limitParam = searchParams.get("limit");
  // Guard against NaN / non-positive: Number("abc") is NaN → take:NaN → Prisma throws (uncaught 500).
  const parsedLimit = limitParam ? Number(limitParam) : NaN;
  const take = Number.isInteger(parsedLimit) && parsedLimit > 0 ? Math.min(parsedLimit, 100) : 20;

  const [notifications, unreadCount] = await Promise.all([
    prisma.notification.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
      take,
    }),
    prisma.notification.count({
      where: { userId, isRead: false },
    }),
  ]);

  return NextResponse.json({ notifications, unreadCount });
}

export async function PATCH(request: Request) {
  const userId = await getUserIdFromRequest(request);
  if (!userId) {
    return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  }

  await prisma.notification.updateMany({
    where: {
      userId,
      isRead: false,
    },
    data: {
      isRead: true,
    },
  });

  return NextResponse.json({ ok: true });
}
