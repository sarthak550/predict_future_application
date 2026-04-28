import { NextResponse } from "next/server";

import { backfillMissingImages } from "@/lib/news/rss-ingestion-service";

/**
 * POST /api/news/backfill-images
 *
 * Triggers og:image backfill for stories that are missing images.
 * Processes up to 50 stories per call.
 */
export async function POST() {
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
