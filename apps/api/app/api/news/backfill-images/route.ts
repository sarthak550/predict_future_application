import { NextResponse } from "next/server";

import { getSession } from "@/lib/auth";
import { backfillMissingImages } from "@/lib/news/rss-ingestion-service";

/**
 * POST /api/news/backfill-images
 *
 * Triggers og:image backfill for stories that are missing images.
 * Processes up to 50 stories per call.
 *
 * Requires ADMIN or MODERATOR role — server fetches sourceUrl values (SSRF risk).
 */
export async function POST() {
  const session = await getSession();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  }
  if (session.user.role !== "ADMIN" && session.user.role !== "MODERATOR") {
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
