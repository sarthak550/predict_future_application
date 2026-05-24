/**
 * POST /api/admin/flagship-events
 *
 * Admin-only endpoint to create a flagship poll directly (skips PENDING_REVIEW).
 * Used by the dedicated /admin/flagship-events/new web form.
 *
 * Body: {
 *   title: string,
 *   description?: string,
 *   marketType: "BINARY" | "MULTIPLE_CHOICE",
 *   options?: string[],          // required if MULTIPLE_CHOICE (2-10 items)
 *   flagshipEventAt: string,     // ISO date in the future
 *   flagshipEventType: string,   // RBI | BUDGET | GST | GLOBAL | FED | OTHER
 *   resolutionSourceName: string,
 *   resolutionRuleText: string,
 * }
 */

import {
  MarketCategory,
  MarketStatus,
  MarketTemplate,
  MarketType,
  MarketVisibility,
  PoolRewardMode,
  ResolutionMode,
  ResolutionSourceType,
} from "@prisma/client";
import { NextResponse } from "next/server";

import { getUserIdFromRequest } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function POST(request: Request) {
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

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const title = String(body.title ?? "").trim();
  const description = String(body.description ?? "").trim() || title;
  const marketType = body.marketType === "MULTIPLE_CHOICE" ? MarketType.MULTIPLE_CHOICE : MarketType.BINARY;
  const options = Array.isArray(body.options) ? (body.options as unknown[]).map((s) => String(s).trim()).filter(Boolean) : [];
  const flagshipEventAtRaw = body.flagshipEventAt;
  const flagshipEventType = String(body.flagshipEventType ?? "OTHER").trim() || "OTHER";
  const resolutionSourceName = String(body.resolutionSourceName ?? "Official source").trim() || "Official source";
  const resolutionRuleText = String(body.resolutionRuleText ?? "").trim() || `Resolves based on official ${flagshipEventType} announcement.`;

  if (title.length < 10 || title.length > 200) {
    return NextResponse.json({ error: "Title must be 10–200 chars." }, { status: 400 });
  }
  if (typeof flagshipEventAtRaw !== "string") {
    return NextResponse.json({ error: "flagshipEventAt is required (ISO date)." }, { status: 400 });
  }
  const flagshipDate = new Date(flagshipEventAtRaw);
  if (isNaN(flagshipDate.getTime()) || flagshipDate.getTime() <= Date.now() + 60 * 60 * 1000) {
    return NextResponse.json({ error: "flagshipEventAt must be at least 1 hour in the future." }, { status: 400 });
  }
  if (marketType === MarketType.MULTIPLE_CHOICE && (options.length < 2 || options.length > 10)) {
    return NextResponse.json({ error: "Multi-choice requires 2–10 options." }, { status: 400 });
  }

  const slug =
    title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 80) + "-" + Math.random().toString(36).slice(2, 8);

  const market = await prisma.market.create({
    data: {
      slug,
      title,
      description,
      category: MarketCategory.FINANCE,
      template: MarketTemplate.CUSTOM,
      marketType,
      status: MarketStatus.OPEN,
      visibility: MarketVisibility.PUBLIC,
      resolutionMode: ResolutionMode.SOURCE_BASED,
      resolutionSourceType: ResolutionSourceType.PRESS_RELEASE,
      resolutionSourceName,
      resolutionRuleText,
      poolRewardMode: PoolRewardMode.COMMISSION_BASED,
      flagshipEventAt: flagshipDate,
      flagshipEventType,
      closeAt: flagshipDate,
      resolveAt: flagshipDate,
      approvedAt: new Date(),
      approvedById: actor.id,
      creatorId: actor.id,
      ...(marketType === MarketType.MULTIPLE_CHOICE
        ? {
            options: {
              create: options.map((label, idx) => ({ label, sortOrder: idx })),
            },
          }
        : {}),
    },
    select: { id: true, title: true },
  });

  return NextResponse.json({ ok: true, market }, { status: 201 });
}
