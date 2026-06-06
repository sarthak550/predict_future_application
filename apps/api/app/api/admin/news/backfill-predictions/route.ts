import { randomUUID } from "crypto";
import { NextResponse } from "next/server";

import { generatePollWithAI } from "@/lib/ai/gemini";
import { getUserIdFromRequest } from "@/lib/auth";
import { EXCLUDE_AUTO_POLL_CATEGORIES, MAX_STORY_AGE_FOR_POLL_MS } from "@/lib/news/rss-ingestion-service";
import { prisma } from "@/lib/prisma";
import { slugify } from "@/lib/utils";
import type { MarketCategory } from "@prisma/client";

/**
 * POST /api/admin/news/backfill-predictions
 *
 * Finds published stories without a poll and generates AI polls for them.
 * Accepts either admin session/Bearer auth OR a CRON_SECRET bearer token.
 */
export async function POST(request: Request) {
  try {
    const cronSecret = process.env.CRON_SECRET;
    const authHeader = request.headers.get("authorization");
    const isCron = cronSecret && authHeader === `Bearer ${cronSecret}`;

    let actorId: string | undefined;

    if (isCron) {
      // Prefer deterministic lookup via SYSTEM_ADMIN_EMAIL env var to avoid
      // non-deterministic findFirst when multiple ADMIN rows exist.
      const systemEmail = process.env.SYSTEM_ADMIN_EMAIL;
      if (systemEmail) {
        actorId = (await prisma.user.findUnique({ where: { email: systemEmail }, select: { id: true } }))?.id;
      }
      // Fallback: first ADMIN row (non-deterministic if >1 admin exists, but acceptable
      // when SYSTEM_ADMIN_EMAIL is not configured).
      if (!actorId) {
        actorId = (await prisma.user.findFirst({ where: { role: "ADMIN" }, select: { id: true } }))?.id;
      }
    } else {
      const userId = await getUserIdFromRequest(request);
      if (!userId) {
        return NextResponse.json({ error: "Authentication required." }, { status: 401 });
      }
      const actor = await prisma.user.findUnique({
        where: { id: userId },
        select: { id: true, role: true, isSuspended: true },
      });
      if (!actor || actor.isSuspended) {
        return NextResponse.json({ error: "Account cannot perform this action." }, { status: 403 });
      }
      if (actor.role !== "ADMIN" && actor.role !== "MODERATOR") {
        return NextResponse.json({ error: "Admin access required." }, { status: 403 });
      }
      actorId = actor.id;
    }

    if (!actorId) {
      return NextResponse.json({ error: "Authentication required." }, { status: 401 });
    }

    // ?includeAll=true bypasses the category exclusion and freshness filter.
    // Use this for deliberate admin backfills where the operator has verified
    // the stories are appropriate. Without this flag, the same filters applied
    // in generatePollsInBackground (rss-ingestion-service.ts) are enforced.
    const includeAll = new URL(request.url).searchParams.get("includeAll") === "true";
    const cutoff = new Date(Date.now() - MAX_STORY_AGE_FOR_POLL_MS);
    const additionalFilters = includeAll
      ? {}
      : {
          category: { notIn: Array.from(EXCLUDE_AUTO_POLL_CATEGORIES) as MarketCategory[] },
          publishedAt: { gte: cutoff },
        };

    const stories = await prisma.story.findMany({
      where: {
        status: { in: ["PUBLISHED", "APPROVED"] },
        market: null,
        ...additionalFilters,
      },
      select: {
        id: true,
        headline: true,
        summary: true,
        category: true,
        sourceName: true,
        sourceUrl: true,
        publishedAt: true,
      },
      orderBy: { publishedAt: "desc" },
      take: 20,
    });

    console.info(
      `[backfill] includeAll=${includeAll} — excluded categories=${includeAll ? "none" : [...EXCLUDE_AUTO_POLL_CATEGORIES].join(",")}, cutoff=${includeAll ? "none" : cutoff.toISOString()}`
    );

    if (stories.length === 0) {
      return NextResponse.json({ filled: 0, message: "All stories have polls." });
    }

    let filled = 0;
    const errors: string[] = [];

    for (const story of stories) {
      try {
        if (filled > 0) {
          await new Promise((r) => setTimeout(r, 2500));
        }

        const aiResult = await generatePollWithAI({
          headline: story.headline,
          summary: story.summary,
          category: story.category,
          sourceName: story.sourceName,
          sourceUrl: story.sourceUrl,
          publishedAt: story.publishedAt.toISOString(),
        });

        if (aiResult.skip && aiResult.enhancedSummary) {
          await prisma.story.update({
            where: { id: story.id },
            data: { summary: aiResult.enhancedSummary },
          });
          console.info(`[backfill] skipped poll, enhanced summary for "${story.headline.slice(0, 60)}..."`);
          continue;
        }

        const now = new Date();
        await prisma.market.create({
          data: {
            slug: `${slugify(aiResult.title).slice(0, 64)}-${randomUUID().slice(0, 8)}`,
            title: aiResult.title,
            description: aiResult.description,
            category: story.category,
            template: "CUSTOM",
            marketType: aiResult.marketType ?? "BINARY",
            visibility: "PUBLIC",
            marketScope: "GLOBAL",
            creatorId: actorId,
            status: "OPEN",
            closeAt: new Date(now.getTime() + aiResult.expiresInHours * 60 * 60 * 1000),
            resolveAt: new Date(now.getTime() + (aiResult.expiresInHours + 24) * 60 * 60 * 1000),
            resolutionSourceType: "MANUAL",
            resolutionSourceName: "Opinion Poll",
            resolutionRuleText: "This is an opinion poll generated from the news story.",
            storyId: story.id,
            approvedAt: new Date(),
            approvedById: actorId,
            ...(aiResult.marketType === "NUMERIC" ? {
              unit: aiResult.unit || "units",
              minValue: aiResult.minValue ?? 0,
              maxValue: aiResult.maxValue ?? 1000,
              precision: aiResult.precision ?? 0,
            } : {}),
          },
        });

        filled++;
        console.info(`[backfill] created poll for "${story.headline.slice(0, 60)}..."`);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        errors.push(`${story.headline.slice(0, 40)}: ${msg}`);
        if (msg.toLowerCase().includes("rate limit")) {
          console.warn("[backfill] rate limited, stopping");
          break;
        }
      }
    }

    return NextResponse.json({ filled, total: stories.length, errors });
  } catch (error) {
    console.error("Backfill error:", error);
    return NextResponse.json({ error: "Failed to backfill." }, { status: 500 });
  }
}
