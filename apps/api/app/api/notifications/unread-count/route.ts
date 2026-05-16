/**
 * GET /api/notifications/unread-count
 *
 * Returns the authenticated user's current unread notification count.
 * Intentionally not cached so the count is always fresh.
 *
 * Response: { count: number }
 */

import { NextResponse } from "next/server";

import { getUserIdFromRequest } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function GET(request: Request) {
  const userId = await getUserIdFromRequest(request);
  if (!userId) {
    return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  }

  const count = await prisma.notification.count({
    where: { userId, isRead: false },
  });

  return NextResponse.json(
    { count },
    {
      headers: {
        "Cache-Control": "no-store",
      },
    }
  );
}
