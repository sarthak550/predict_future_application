import { NextRequest, NextResponse } from "next/server";

import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

/**
 * GET /api/notifications?limit=N
 *
 * `limit` is optional (used by NotificationBell's dropdown, ?limit=10) —
 * absent means "everything," which is what the full /notifications page
 * wants. Guards NaN/non-positive the same way apps/api's route does (Number
 * ("abc") is NaN → Prisma would throw an uncaught 500 on a bad take value).
 * Response now also carries `unreadCount`, matching apps/api's shape, so the
 * bell can render its badge from the same request that populates the
 * dropdown list.
 */
export async function GET(request: NextRequest) {
  const session = await getSession();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  }
  const userId = session.user.id;

  const limitParam = request.nextUrl.searchParams.get("limit");
  const parsedLimit = limitParam ? Number(limitParam) : NaN;
  const take = Number.isInteger(parsedLimit) && parsedLimit > 0 ? Math.min(parsedLimit, 100) : undefined;

  const [notifications, unreadCount] = await Promise.all([
    prisma.notification.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
      ...(take ? { take } : {}),
    }),
    prisma.notification.count({ where: { userId, isRead: false } }),
  ]);

  return NextResponse.json({ notifications, unreadCount });
}

export async function PATCH() {
  const session = await getSession();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  }

  await prisma.notification.updateMany({
    where: {
      userId: session.user.id,
      isRead: false
    },
    data: {
      isRead: true
    }
  });

  return NextResponse.json({ ok: true });
}
