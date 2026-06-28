/**
 * POST /api/admin/rbi/mpc-pack
 *
 * Admin-only endpoint to create an RBI MPC "poll-pack":
 * one MarketEventCluster + two MULTIPLE_CHOICE flagship markets (Repo Rate + Stance).
 *
 * All three records are created atomically in a single Prisma transaction.
 * Votes are free (amount = 0) — matching the existing flagship-poll pattern.
 * The static EMI-impact line is stored in `Market.structuredData`.
 *
 * Request body:
 * {
 *   eventTitle:      string,          // e.g. "RBI MPC June 2026"
 *   announcementAt:  string,          // ISO date — used as flagshipEventAt, closeAt, resolveAt
 *   emiImpactLine:   string,          // static admin-typed text shown below the poll
 *   repoOptions?:    string[],        // defaults to the 5 standard rate options
 *   stanceOptions?:  string[],        // defaults to the 3 standard stance options
 * }
 *
 * Response 201:
 * {
 *   ok: true,
 *   pack: {
 *     cluster: { id, slug, name, startsAt, endsAt },
 *     markets: [
 *       { id, title, flagshipEventType, structuredData, options: [...] },  // Repo Rate
 *       { id, title, flagshipEventType, structuredData, options: [...] },  // Stance
 *     ]
 *   }
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

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

const DEFAULT_REPO_OPTIONS = [
  "Hold",
  "Cut 25bps",
  "Cut 50bps",
  "Hike 25bps",
  "Hike 50bps",
];

const DEFAULT_STANCE_OPTIONS = [
  "Accommodative",
  "Neutral",
  "Withdrawal of accommodation",
];

// ---------------------------------------------------------------------------
// Auth helper (same pattern as event-clusters route)
// ---------------------------------------------------------------------------

async function requireAdmin(request: Request) {
  const userId = await getUserIdFromRequest(request);
  if (!userId) {
    return {
      actor: null,
      error: NextResponse.json(
        { error: "Authentication required." },
        { status: 401 }
      ),
    };
  }

  const actor = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, role: true, isSuspended: true },
  });

  if (!actor || actor.isSuspended) {
    return {
      actor: null,
      error: NextResponse.json(
        { error: "Account cannot perform this action." },
        { status: 403 }
      ),
    };
  }

  if (actor.role !== "ADMIN" && actor.role !== "MODERATOR") {
    return {
      actor: null,
      error: NextResponse.json(
        { error: "Admin access required." },
        { status: 403 }
      ),
    };
  }

  return { actor, error: null };
}

// ---------------------------------------------------------------------------
// Slug helper (mirrors flagship-events/route.ts pattern)
// ---------------------------------------------------------------------------

function buildSlug(title: string): string {
  return (
    title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 80) +
    "-" +
    Math.random().toString(36).slice(2, 8)
  );
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

interface CreatePackBody {
  eventTitle?: unknown;
  announcementAt?: unknown;
  emiImpactLine?: unknown;
  repoOptions?: unknown;
  stanceOptions?: unknown;
}

export async function POST(request: Request) {
  const { actor, error } = await requireAdmin(request);
  if (error) return error;

  let body: CreatePackBody;
  try {
    body = (await request.json()) as CreatePackBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  // ---- Validate required fields ------------------------------------------

  const eventTitle =
    typeof body.eventTitle === "string" ? body.eventTitle.trim() : "";
  if (eventTitle.length < 5 || eventTitle.length > 200) {
    return NextResponse.json(
      { error: "eventTitle must be 5–200 characters." },
      { status: 400 }
    );
  }

  if (typeof body.announcementAt !== "string") {
    return NextResponse.json(
      { error: "announcementAt is required (ISO date string)." },
      { status: 400 }
    );
  }
  const announcementDate = new Date(body.announcementAt);
  if (
    isNaN(announcementDate.getTime()) ||
    announcementDate.getTime() <= Date.now() + 60 * 60 * 1000
  ) {
    return NextResponse.json(
      { error: "announcementAt must be a valid date at least 1 hour in the future." },
      { status: 400 }
    );
  }

  const emiImpactLine =
    typeof body.emiImpactLine === "string" ? body.emiImpactLine.trim() : "";
  if (!emiImpactLine) {
    return NextResponse.json(
      { error: "emiImpactLine is required." },
      { status: 400 }
    );
  }

  const repoOptions: string[] = Array.isArray(body.repoOptions)
    ? (body.repoOptions as unknown[])
        .map((s) => String(s).trim())
        .filter(Boolean)
    : DEFAULT_REPO_OPTIONS;

  const stanceOptions: string[] = Array.isArray(body.stanceOptions)
    ? (body.stanceOptions as unknown[])
        .map((s) => String(s).trim())
        .filter(Boolean)
    : DEFAULT_STANCE_OPTIONS;

  if (repoOptions.length < 2 || repoOptions.length > 10) {
    return NextResponse.json(
      { error: "repoOptions must have 2–10 items." },
      { status: 400 }
    );
  }
  if (stanceOptions.length < 2 || stanceOptions.length > 10) {
    return NextResponse.json(
      { error: "stanceOptions must have 2–10 items." },
      { status: 400 }
    );
  }

  // ---- Build shared market fields ----------------------------------------

  const structuredData = { emiImpactLine };
  const clusterSlug = buildSlug(eventTitle);

  // ---- Atomic transaction -------------------------------------------------

  try {
    const pack = await prisma.$transaction(async (tx) => {
      // 1. Create the MarketEventCluster for this MPC meeting.
      const cluster = await tx.marketEventCluster.create({
        data: {
          slug: clusterSlug,
          name: eventTitle,
          description: `RBI Monetary Policy Committee meeting — ${eventTitle}`,
          bannerEmoji: "🏦",
          startsAt: announcementDate,
          // endsAt = same day + 23h 59m so the cluster window covers the full meeting day.
          endsAt: new Date(announcementDate.getTime() + 23 * 60 * 60 * 1000 + 59 * 60 * 1000),
          category: MarketCategory.FINANCE,
        },
        select: { id: true, slug: true, name: true, startsAt: true, endsAt: true },
      });

      // 2. Create the Repo Rate market.
      const repoMarket = await tx.market.create({
        data: {
          slug: buildSlug(`${eventTitle} Repo Rate`),
          title: `${eventTitle}: What will the RBI do with the Repo Rate?`,
          description:
            `Vote on the RBI's repo rate decision at the ${eventTitle} MPC meeting.`,
          category: MarketCategory.FINANCE,
          template: MarketTemplate.CUSTOM,
          marketType: MarketType.MULTIPLE_CHOICE,
          status: MarketStatus.OPEN,
          visibility: MarketVisibility.PUBLIC,
          resolutionMode: ResolutionMode.SOURCE_BASED,
          resolutionSourceType: ResolutionSourceType.PRESS_RELEASE,
          resolutionSourceName: "RBI Official Press Release",
          resolutionRuleText:
            "Resolves based on the official RBI MPC announcement.",
          poolRewardMode: PoolRewardMode.COMMISSION_BASED,
          flagshipEventAt: announcementDate,
          flagshipEventType: "RBI",
          closeAt: announcementDate,
          resolveAt: announcementDate,
          approvedAt: new Date(),
          approvedById: actor!.id,
          creatorId: actor!.id,
          structuredData,
          eventClusterId: cluster.id,
          options: {
            create: repoOptions.map((label, idx) => ({ label, sortOrder: idx })),
          },
        },
        select: {
          id: true,
          title: true,
          flagshipEventType: true,
          structuredData: true,
          options: {
            select: { id: true, label: true, sortOrder: true },
            orderBy: { sortOrder: "asc" },
          },
        },
      });

      // 3. Create the Stance market.
      const stanceMarket = await tx.market.create({
        data: {
          slug: buildSlug(`${eventTitle} Stance`),
          title: `${eventTitle}: What Stance will the RBI adopt?`,
          description:
            `Vote on the RBI's monetary policy stance at the ${eventTitle} MPC meeting.`,
          category: MarketCategory.FINANCE,
          template: MarketTemplate.CUSTOM,
          marketType: MarketType.MULTIPLE_CHOICE,
          status: MarketStatus.OPEN,
          visibility: MarketVisibility.PUBLIC,
          resolutionMode: ResolutionMode.SOURCE_BASED,
          resolutionSourceType: ResolutionSourceType.PRESS_RELEASE,
          resolutionSourceName: "RBI Official Press Release",
          resolutionRuleText:
            "Resolves based on the official RBI MPC announcement.",
          poolRewardMode: PoolRewardMode.COMMISSION_BASED,
          flagshipEventAt: announcementDate,
          flagshipEventType: "RBI",
          closeAt: announcementDate,
          resolveAt: announcementDate,
          approvedAt: new Date(),
          approvedById: actor!.id,
          creatorId: actor!.id,
          structuredData,
          eventClusterId: cluster.id,
          options: {
            create: stanceOptions.map((label, idx) => ({ label, sortOrder: idx })),
          },
        },
        select: {
          id: true,
          title: true,
          flagshipEventType: true,
          structuredData: true,
          options: {
            select: { id: true, label: true, sortOrder: true },
            orderBy: { sortOrder: "asc" },
          },
        },
      });

      return { cluster, markets: [repoMarket, stanceMarket] };
    });

    return NextResponse.json({ ok: true, pack }, { status: 201 });
  } catch (err) {
    console.error("[admin/rbi/mpc-pack POST]", err);
    return NextResponse.json(
      { error: "Failed to create RBI MPC poll-pack." },
      { status: 500 }
    );
  }
}
