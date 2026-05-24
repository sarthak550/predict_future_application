import { NextResponse } from "next/server";

import { getUserIdFromRequest } from "@/lib/auth";
import { fetchOgImage, isGoogleNewsUrl } from "@/lib/news/og-image";
import { prisma } from "@/lib/prisma";

/**
 * POST /api/admin/news/backfill-images
 *
 * Finds published stories without an image and attempts to fetch og:image
 * from their source URL. Skips Google News redirect URLs.
 *
 * Accepts either admin session/Bearer auth OR a CRON_SECRET bearer token.
 */
export async function POST(request: Request) {
  try {
    const cronSecret = process.env.CRON_SECRET;
    const authHeader = request.headers.get("authorization");
    const isCron = cronSecret && authHeader === `Bearer ${cronSecret}`;

    if (!isCron) {
      const userId = await getUserIdFromRequest(request);
      if (!userId) {
        return NextResponse.json({ error: "Authentication required." }, { status: 401 });
      }
      const actor = await prisma.user.findUnique({
        where: { id: userId },
        select: { role: true, isSuspended: true },
      });
      if (!actor || actor.isSuspended) {
        return NextResponse.json({ error: "Account cannot perform this action." }, { status: 403 });
      }
      if (actor.role !== "ADMIN" && actor.role !== "MODERATOR") {
        return NextResponse.json({ error: "Admin access required." }, { status: 403 });
      }
    }

    const stories = await prisma.story.findMany({
      where: {
        OR: [{ imageUrl: null }, { imageUrl: "" }],
        sourceUrl: { not: "" },
        status: { in: ["PUBLISHED", "APPROVED"] },
      },
      select: { id: true, sourceUrl: true, headline: true },
      orderBy: { createdAt: "desc" },
      take: 100,
    });

    const resolvable = stories.filter((s) => !isGoogleNewsUrl(s.sourceUrl));
    const skippedGoogle = stories.length - resolvable.length;

    let filled = 0;
    const errors: string[] = [];

    // Process 5 at a time
    const CONCURRENCY = 5;
    for (let i = 0; i < resolvable.length; i += CONCURRENCY) {
      const batch = resolvable.slice(i, i + CONCURRENCY);
      const results = await Promise.allSettled(
        batch.map(async (story) => {
          const ogImage = await fetchOgImage(story.sourceUrl);
          if (ogImage) {
            await prisma.story.update({
              where: { id: story.id },
              data: { imageUrl: ogImage },
            });
            return true;
          }
          return false;
        })
      );

      for (let j = 0; j < results.length; j++) {
        const result = results[j];
        if (result.status === "fulfilled" && result.value) {
          filled++;
        } else if (result.status === "rejected") {
          errors.push(`${batch[j].headline.slice(0, 40)}: ${result.reason}`);
        }
      }
    }

    return NextResponse.json({
      filled,
      attempted: resolvable.length,
      skippedGoogle,
      total: stories.length,
      errors: errors.slice(0, 10),
    });
  } catch (error) {
    console.error("Image backfill error:", error);
    return NextResponse.json({ error: "Failed to backfill images." }, { status: 500 });
  }
}
