import { NextResponse } from "next/server";

import { getUserIdFromRequest } from "@/lib/auth";
import { backfillMissingImages } from "@/lib/news/rss-ingestion-service";
import { prisma } from "@/lib/prisma";

/**
 * POST /api/news/backfill-images
 *
 * Triggers og:image backfill for stories that are missing images.
 * Processes up to 50 stories per call.
 *
 * Requires ADMIN or MODERATOR role — server fetches sourceUrl values (SSRF risk).
 */
export async function POST(request: Request) {
  const userId = await getUserIdFromRequest(request);
  if (!userId) {
    return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  }
  const actor = await prisma.user.findUnique({
    where: { id: userId },
    select: { role: true, isSuspended: true },
  });
  if (!actor || actor.isSuspended || (actor.role !== "ADMIN" && actor.role !== "MODERATOR")) {
    return NextResponse.json({ error: "Admin access required." }, { status: 403 });
  }
  try {
    await backfillMissingImages();
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("[news:backfill-images] error:", error);
    return NextResponse.json(
      { error: "Backfill failed" },
      { status: 500 }
    );
  }
}
