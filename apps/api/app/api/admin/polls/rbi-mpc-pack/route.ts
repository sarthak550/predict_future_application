/**
 * POST /api/admin/polls/rbi-mpc-pack
 *
 * Admin/Moderator endpoint to create an RBI MPC "poll-pack":
 * THREE Polls (Repo Rate / CRR / SLR) sharing a generated packId, each with
 * their PollOptions and a plain-English educational description, created
 * atomically in a single transaction.
 *
 * This is the Poll-model replacement for the old Market-based
 * POST /api/admin/rbi/mpc-pack — no wallet, no stake, no MarketEventCluster.
 *
 * Request body:
 * {
 *   eventTitle:     string,       // e.g. "RBI MPC June 2026" (5–200 chars)
 *   announcementAt: string,       // ISO date string — used as closeAt + eventAt
 *   emiImpactLine:  string,       // static admin-typed text stored in structuredData on Repo poll
 *   repoOptions?:   string[],     // defaults: Hold/Cut 25bps/Cut 50bps/Hike 25bps/Hike 50bps
 *   crrOptions?:    string[],     // defaults: same 5-option list
 *   slrOptions?:    string[],     // defaults: same 5-option list
 * }
 *
 * Response 201:
 * {
 *   ok: true,
 *   pack: {
 *     packId: string,
 *     polls: [
 *       { id, question, description, structuredData, options: [{id, label, sortOrder}] },  // Repo Rate
 *       { id, question, description, structuredData, options: [{id, label, sortOrder}] },  // CRR
 *       { id, question, description, structuredData, options: [{id, label, sortOrder}] },  // SLR
 *     ]
 *   }
 * }
 */

import { randomUUID } from "crypto";

import { MarketCategory, PollStatus } from "@prisma/client";
import { NextResponse } from "next/server";

import { getUserIdFromRequest } from "@/lib/auth";
import { fetchRbiPolicyRates } from "@/lib/finance/rbiRates";
import { prisma } from "@/lib/prisma";

// ---------------------------------------------------------------------------
// Option defaults
// ---------------------------------------------------------------------------

const DEFAULT_RATE_OPTIONS = [
  "Hold",
  "Cut 25bps",
  "Cut 50bps",
  "Hike 25bps",
  "Hike 50bps",
];

// Plain-English educational descriptions shown below each question title.
const REPO_DESCRIPTION =
  "The rate RBI charges banks for short-term funds — it sets the floor for your loan EMIs.";
const CRR_DESCRIPTION =
  "The share of deposits banks must park with RBI (earning nothing). Cutting it frees up cash to lend.";
const SLR_DESCRIPTION =
  "The share of deposits banks must hold in government securities/gold — a liquidity + govt-borrowing lever.";

// ---------------------------------------------------------------------------
// Auth helper
// ---------------------------------------------------------------------------

async function requireAdminActor(request: Request) {
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
// Request body shape
// ---------------------------------------------------------------------------

interface CreatePackBody {
  eventTitle?: unknown;
  announcementAt?: unknown;
  emiImpactLine?: unknown;
  repoOptions?: unknown;
  crrOptions?: unknown;
  slrOptions?: unknown;
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

export async function POST(request: Request) {
  const { actor, error } = await requireAdminActor(request);
  if (error) return error;

  let body: CreatePackBody;
  try {
    body = (await request.json()) as CreatePackBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  // ---- Validate eventTitle -------------------------------------------------

  const eventTitle =
    typeof body.eventTitle === "string" ? body.eventTitle.trim() : "";
  if (eventTitle.length < 5 || eventTitle.length > 200) {
    return NextResponse.json(
      { error: "eventTitle must be 5–200 characters." },
      { status: 400 }
    );
  }

  // ---- Validate announcementAt --------------------------------------------

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
      {
        error:
          "announcementAt must be a valid date at least 1 hour in the future.",
      },
      { status: 400 }
    );
  }

  // ---- Validate emiImpactLine ---------------------------------------------

  const emiImpactLine =
    typeof body.emiImpactLine === "string" ? body.emiImpactLine.trim() : "";
  if (!emiImpactLine) {
    return NextResponse.json(
      { error: "emiImpactLine is required." },
      { status: 400 }
    );
  }

  // ---- Coerce option arrays -----------------------------------------------

  const coerceOptions = (raw: unknown, fallback: string[]): string[] =>
    Array.isArray(raw)
      ? (raw as unknown[]).map((s) => String(s).trim()).filter(Boolean)
      : fallback;

  const repoOptions = coerceOptions(body.repoOptions, DEFAULT_RATE_OPTIONS);
  const crrOptions  = coerceOptions(body.crrOptions,  DEFAULT_RATE_OPTIONS);
  const slrOptions  = coerceOptions(body.slrOptions,  DEFAULT_RATE_OPTIONS);

  for (const [name, opts] of [
    ["repoOptions", repoOptions],
    ["crrOptions",  crrOptions],
    ["slrOptions",  slrOptions],
  ] as [string, string[]][]) {
    if (opts.length < 2 || opts.length > 10) {
      return NextResponse.json(
        { error: `${name} must have 2–10 items.` },
        { status: 400 }
      );
    }
  }

  // ---- Build shared data --------------------------------------------------

  const packId = randomUUID();
  // Auto-fetch the current RBI policy rates (public, from rbi.org.in) as the prediction
  // baseline — no admin typing. Never blocks creation: null on failure, and the daily
  // /api/cron/rbi-rates job backfills/refreshes open packs.
  const currentRates = await fetchRbiPolicyRates().catch(() => null);
  const structuredData = {
    emiImpactLine,
    currentRates,
    ratesAsOf: currentRates?.fetchedAt ?? null,
  };

  // ---- Atomic transaction -------------------------------------------------

  // Helper to produce a consistent select shape for all three polls.
  const POLL_SELECT = {
    id: true,
    question: true,
    description: true,
    status: true,
    closeAt: true,
    eventAt: true,
    packId: true,
    structuredData: true,
    options: {
      select: { id: true, label: true, sortOrder: true },
      orderBy: { sortOrder: "asc" as const },
    },
  } as const;

  try {
    const pack = await prisma.$transaction(async (tx) => {
      // 1. Repo Rate poll — carries emiImpactLine + currentRates in structuredData
      //    (rates feed the "RBI Rates" strip in Today's Pulse; emiImpactLine shows
      //    on the detail screen).
      const repoPoll = await tx.poll.create({
        data: {
          question: `${eventTitle}: What will the RBI do with the Repo Rate?`,
          description: REPO_DESCRIPTION,
          category: MarketCategory.FINANCE,
          status: PollStatus.OPEN,
          closeAt: announcementDate,
          eventAt: announcementDate,
          packId,
          structuredData,
          createdById: actor!.id,
          options: {
            create: repoOptions.map((label, idx) => ({ label, sortOrder: idx })),
          },
        },
        select: POLL_SELECT,
      });

      // 2. CRR poll.
      const crrPoll = await tx.poll.create({
        data: {
          question: `${eventTitle}: What will the RBI do with the CRR?`,
          description: CRR_DESCRIPTION,
          category: MarketCategory.FINANCE,
          status: PollStatus.OPEN,
          closeAt: announcementDate,
          eventAt: announcementDate,
          packId,
          structuredData,
          createdById: actor!.id,
          options: {
            create: crrOptions.map((label, idx) => ({ label, sortOrder: idx })),
          },
        },
        select: POLL_SELECT,
      });

      // 3. SLR poll.
      const slrPoll = await tx.poll.create({
        data: {
          question: `${eventTitle}: What will the RBI do with the SLR?`,
          description: SLR_DESCRIPTION,
          category: MarketCategory.FINANCE,
          status: PollStatus.OPEN,
          closeAt: announcementDate,
          eventAt: announcementDate,
          packId,
          structuredData,
          createdById: actor!.id,
          options: {
            create: slrOptions.map((label, idx) => ({ label, sortOrder: idx })),
          },
        },
        select: POLL_SELECT,
      });

      return { packId, polls: [repoPoll, crrPoll, slrPoll] };
    });

    return NextResponse.json({ ok: true, pack }, { status: 201 });
  } catch (err) {
    console.error("[admin/polls/rbi-mpc-pack POST]", err);
    return NextResponse.json(
      { error: "Failed to create RBI MPC poll-pack." },
      { status: 500 }
    );
  }
}
