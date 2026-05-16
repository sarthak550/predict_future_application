import { MarketCategory } from "@prisma/client";
import { NextResponse } from "next/server";

import { randomUUID } from "crypto";

import { generatePollWithAI } from "@/lib/ai/gemini";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { slugify } from "@/lib/utils";

/**
 * POST /api/news/generate-prediction
 * Body: { storyId: string }
 *
 * Uses AI to generate an opinion poll from a news story and creates it.
 */
export async function POST(request: Request) {
  try {
    const session = await getSession();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Authentication required." }, { status: 401 });
    }

    const body = await request.json();
    const storyId = body?.storyId;

    if (!storyId || typeof storyId !== "string") {
      return NextResponse.json({ error: "storyId is required." }, { status: 400 });
    }

    const story = await prisma.story.findUnique({
      where: { id: storyId },
      select: {
        id: true,
        headline: true,
        summary: true,
        category: true,
        sourceName: true,
        sourceUrl: true,
        publishedAt: true,
        market: { select: { id: true } },
      },
    });

    if (!story) {
      return NextResponse.json({ error: "Story not found." }, { status: 404 });
    }

    const actor = await prisma.user.findUnique({
      where: { id: session.user.id },
    });

    if (!actor || actor.isSuspended) {
      return NextResponse.json({ error: "Account cannot create polls." }, { status: 403 });
    }

    const suggestion = await generatePollWithAI({
      headline: story.headline,
      summary: story.summary,
      category: story.category,
      sourceName: story.sourceName,
      sourceUrl: story.sourceUrl,
      publishedAt: story.publishedAt.toISOString(),
    });

    if (suggestion.skip && suggestion.enhancedSummary) {
      await prisma.story.update({
        where: { id: story.id },
        data: { summary: suggestion.enhancedSummary },
      });

      return NextResponse.json({
        skipped: true,
        enhancedSummary: suggestion.enhancedSummary,
      }, { status: 200 });
    }

    const now = new Date();
    const expiresAt = new Date(now.getTime() + suggestion.expiresInHours * 60 * 60 * 1000);

    const categoryMap: Record<string, MarketCategory> = {
      SPORTS: "SPORTS",
      BUSINESS: "BUSINESS",
      TECH: "TECH",
      ENTERTAINMENT: "ENTERTAINMENT",
      GENERAL: "GENERAL",
    };
    const category = categoryMap[suggestion.category] ?? story.category;

    const market = await prisma.market.create({
      data: {
        slug: `${slugify(suggestion.title).slice(0, 64)}-${randomUUID().slice(0, 8)}`,
        title: suggestion.title,
        description: suggestion.description,
        category,
        template: "CUSTOM",
        marketType: suggestion.marketType ?? "BINARY",
        visibility: "PUBLIC",
        marketScope: "GLOBAL",
        creatorId: actor.id,
        status: "OPEN",
        closeAt: expiresAt,
        resolveAt: new Date(expiresAt.getTime() + 24 * 60 * 60 * 1000),
        resolutionSourceType: "MANUAL",
        resolutionSourceName: "Opinion Poll",
        resolutionRuleText: "This is an opinion poll generated from the news story.",
        storyId: story.market ? undefined : story.id,
        approvedAt: new Date(),
        approvedById: actor.id,
        ...(suggestion.marketType === "NUMERIC" ? {
          unit: suggestion.unit || "units",
          minValue: suggestion.minValue ?? 0,
          maxValue: suggestion.maxValue ?? 1000,
          precision: suggestion.precision ?? 0,
        } : {}),
      },
    });

    return NextResponse.json({
      skipped: false,
      market: { id: market.id, title: suggestion.title },
    }, { status: 201 });
  } catch (error) {
    console.error("Generate poll error:", error);
    const message = error instanceof Error ? error.message : "Failed to generate poll.";
    const isRateLimit = message.toLowerCase().includes("rate limit");
    return NextResponse.json({ error: message }, { status: isRateLimit ? 429 : 500 });
  }
}
