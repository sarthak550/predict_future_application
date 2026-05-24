import { NextResponse } from "next/server";

import { getUserIdFromRequest } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getNewsDebugSnapshot } from "@/lib/news/queries";
import { getRssSources } from "@/lib/news/rssSources";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  // Require authentication.
  const userId = await getUserIdFromRequest(request);
  if (!userId) {
    return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  }

  // Require ADMIN or MODERATOR role.
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { role: true },
  });
  if (!user || (user.role !== "ADMIN" && user.role !== "MODERATOR")) {
    return NextResponse.json({ error: "Admin access required." }, { status: 403 });
  }

  const snapshot = await getNewsDebugSnapshot();
  const configuredFeeds = getRssSources().map((feed) => ({
    id: feed.id,
    name: feed.name,
    url: feed.url,
    category: feed.categoryHint,
    isActive: feed.isActive !== false
  }));

  return NextResponse.json({
    ...snapshot,
    configuredFeeds
  });
}
