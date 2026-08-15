/**
 * GET /api/notifications/unread-count
 *
 * Mirrors apps/api's identically-named route (see that file's own doc
 * comment) — apps/web needs its own copy for the same same-origin-fetch
 * reason as the follow route (see app/api/finance/experts/[id]/follow).
 * Returns { count: number }. Intentionally not cached.
 */

import { NextResponse } from "next/server";

import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function GET() {
  const session = await getSession();
  const userId = session?.user?.id;
  if (!userId) {
    return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  }

  const count = await prisma.notification.count({
    where: { userId, isRead: false },
  });

  return NextResponse.json(
    { count },
    { headers: { "Cache-Control": "no-store" } },
  );
}
