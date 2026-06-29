import { NextResponse } from "next/server";

import { summarizeNewsStory } from "@/lib/ai/summarizeNews";
import { fetchArticleBody } from "@/lib/news/articleBody";
import { getUserIdFromRequest } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

/**
 * POST /api/admin/news/backfill-summaries
 *
 * Finds existing stories whose summary is empty or identical to the headline
 * (i.e., RSS feeds provided no description), fetches the article body, generates
 * an AI summary via summarizeNewsStory (Groq → Gemini), and persists the result.
 *
 * Processes up to 25 stories per call to stay within serverless execution limits.
 * Safe to call repeatedly — already-summarized stories are not re-processed.
 *
 * Auth: admin/moderator session OR CRON_SECRET bearer token (same pattern as
 * /api/admin/news/backfill-images and /api/admin/news/backfill-predictions).
 *
 * Response: { summarized: number, attempted: number, skipped: number, errors: string[] }
 */
export async function POST(request: Request) {
  try {
    // ---- Auth: CRON_SECRET bearer or admin/moderator session ----
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

    // ---- AI key guard ----
    if (!process.env.GROQ_API_KEY && !process.env.GEMINI_API_KEY) {
      return NextResponse.json(
        { error: "No AI key configured. Set GROQ_API_KEY or GEMINI_API_KEY." },
        { status: 503 }
      );
    }

    // ---- Find stories needing summaries ----
    // Batch size kept at 25 per call: each story requires an HTTP body fetch
    // (up to 10s) + an AI call (~2-5s), so 25 stories is roughly 3-5 minutes
    // of wall time at full throughput — within Vercel's function timeout.
    const BATCH_SIZE = 25;

    const stories = await prisma.story.findMany({
      where: {
        status: { in: ["PUBLISHED", "APPROVED"] },
        sourceUrl: { not: "" },
      },
      select: {
        id: true,
        headline: true,
        summary: true,
        sourceUrl: true,
      },
      orderBy: { publishedAt: "desc" },
      take: BATCH_SIZE * 4, // over-fetch; filter inline to fill the batch
    });

    // Filter to stories where summary is blank or equals the headline
    const eligible = stories
      .filter((s) => {
        const normalizedSummary = s.summary.trim().toLowerCase();
        const normalizedHeadline = s.headline.trim().toLowerCase();
        return !normalizedSummary || normalizedSummary === normalizedHeadline;
      })
      .slice(0, BATCH_SIZE);

    if (eligible.length === 0) {
      return NextResponse.json({
        summarized: 0,
        attempted: 0,
        skipped: stories.length,
        errors: [],
        message: "All recent stories already have summaries.",
      });
    }

    console.info(`[backfill-summaries] processing ${eligible.length} stories`);

    let summarized = 0;
    let bodyFailed = 0;
    const errors: string[] = [];

    // Process sequentially to respect the per-domain throttle inside
    // fetchArticleBody (1500ms) and avoid hammering the same origin.
    for (const story of eligible) {
      try {
        const { text: bodyText, error: bodyError } = await fetchArticleBody(story.sourceUrl);
        if (!bodyText) {
          bodyFailed++;
          console.debug(
            `[backfill-summaries] body fetch failed for "${story.headline.slice(0, 60)}": ${bodyError ?? "unknown"}`
          );
          continue;
        }

        const summary = await summarizeNewsStory(story.headline, bodyText);
        if (!summary) {
          console.debug(`[backfill-summaries] AI returned null for "${story.headline.slice(0, 60)}"`);
          errors.push(`${story.headline.slice(0, 50)}: AI returned no summary`);
          continue;
        }

        await prisma.story.update({
          where: { id: story.id },
          data: { summary },
        });
        summarized++;
        console.info(`[backfill-summaries] updated: "${story.headline.slice(0, 60)}"`);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        errors.push(`${story.headline.slice(0, 50)}: ${msg.slice(0, 100)}`);
        console.warn(`[backfill-summaries] failed for "${story.headline.slice(0, 60)}": ${msg.slice(0, 200)}`);
      }
    }

    return NextResponse.json({
      summarized,
      attempted: eligible.length,
      skipped: bodyFailed,
      errors: errors.slice(0, 10),
    });
  } catch (error) {
    console.error("[backfill-summaries] unhandled error:", error);
    return NextResponse.json({ error: "Failed to backfill summaries." }, { status: 500 });
  }
}
