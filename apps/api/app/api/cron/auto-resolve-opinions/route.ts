/**
 * POST /api/cron/auto-resolve-opinions
 *
 * Next.js API route wrapper for the two-phase expert opinion auto-resolution pipeline.
 * Protected by CRON_SECRET header (same pattern as other cron routes in this app).
 *
 * Phase 1 — Preprocess: Populate resolutionWindowDays / resolutionEligibleAt for any
 *            PENDING opinions that haven't been preprocessed yet.
 * Phase 2 — Resolve:    Resolve any PENDING opinions whose resolutionEligibleAt <= now.
 *
 * Env vars:
 *   CRON_PREPROCESS_LIMIT   — max opinions to preprocess per run (default: 100)
 *   CRON_RESOLVE_LIMIT      — max opinions to resolve per run (default: 50)
 *   PREPROCESS_DELAY_MS     — ms between preprocess AI calls (default: 400)
 *   RESOLVE_DELAY_MS        — ms between resolve AI calls (default: 600)
 *
 * Schedule recommendation: daily at 03:00 UTC via Vercel Cron or external scheduler.
 */

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { parseOpinionTimeframe, evaluateOpinionResolution } from "@/lib/ai/evaluateOpinionResolution";

const PREPROCESS_LIMIT = parseInt(process.env.CRON_PREPROCESS_LIMIT ?? "100", 10);
const RESOLVE_LIMIT = parseInt(process.env.CRON_RESOLVE_LIMIT ?? "50", 10);
const PREPROCESS_DELAY_MS = parseInt(process.env.PREPROCESS_DELAY_MS ?? "400", 10);
const RESOLVE_DELAY_MS = parseInt(process.env.RESOLVE_DELAY_MS ?? "600", 10);

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

function hasCronAccess(request: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return true;

  const authHeader = request.headers.get("authorization");
  const cronHeader = request.headers.get("x-cron-secret");
  return authHeader === `Bearer ${secret}` || cronHeader === secret;
}

// ─── Phase 1: Preprocess ──────────────────────────────────────────────────────

async function runPreprocess(): Promise<{ preprocessed: number; failed: number }> {
  const opinions = await prisma.expertOpinion.findMany({
    where: {
      resolutionStatus: "PENDING",
      resolutionWindowDays: null,
      suppressedAt: null,
    },
    orderBy: { publishedAt: "desc" },
    take: PREPROCESS_LIMIT,
    include: {
      story: { select: { headline: true } },
    },
  });

  let preprocessed = 0;
  let failed = 0;

  for (const opinion of opinions) {
    const headline = opinion.story?.headline ?? "";

    const result = await parseOpinionTimeframe({
      id: opinion.id,
      quote: opinion.quote,
      direction: opinion.direction,
      publishedAt: opinion.publishedAt,
      headline,
    });

    if (result === null) {
      failed++;
      await sleep(PREPROCESS_DELAY_MS);
      continue;
    }

    const windowDays = result.impliedWindowDays;
    const eligibleAt = new Date(opinion.publishedAt.getTime() + windowDays * 24 * 60 * 60 * 1000);

    await prisma.expertOpinion.update({
      where: { id: opinion.id },
      data: {
        resolutionWindowDays: windowDays,
        resolutionEligibleAt: eligibleAt,
        ...(result.instrument && !opinion.instrument ? { instrument: result.instrument } : {}),
        ...(result.ticker && !opinion.instrumentTicker ? { instrumentTicker: result.ticker } : {}),
      },
    });

    preprocessed++;
    await sleep(PREPROCESS_DELAY_MS);
  }

  return { preprocessed, failed };
}

// ─── Phase 2: Resolve ─────────────────────────────────────────────────────────

async function runResolution(): Promise<{
  processed: number;
  hit: number;
  miss: number;
  notGraded: number;
  skipped: number;
}> {
  const now = new Date();

  const opinions = await prisma.expertOpinion.findMany({
    where: {
      resolutionStatus: "PENDING",
      resolutionEligibleAt: { lte: now },
      resolutionWindowDays: { not: null },
      suppressedAt: null,
    },
    orderBy: { resolutionEligibleAt: "asc" },
    take: RESOLVE_LIMIT,
    include: {
      story: { select: { headline: true } },
    },
  });

  let hit = 0, miss = 0, notGraded = 0, skipped = 0;

  for (const opinion of opinions) {
    const headline = opinion.story?.headline ?? "";

    const result = await evaluateOpinionResolution({
      id: opinion.id,
      quote: opinion.quote,
      direction: opinion.direction,
      publishedAt: opinion.publishedAt,
      headline,
      resolutionWindowDays: opinion.resolutionWindowDays,
    });

    if (result === null) {
      skipped++;
      await sleep(RESOLVE_DELAY_MS);
      continue;
    }

    if (result.status === "RESOLVED_HIT") hit++;
    else if (result.status === "RESOLVED_MISS") miss++;
    else notGraded++;

    await prisma.expertOpinion.update({
      where: { id: opinion.id },
      data: {
        resolutionStatus: result.status,
        resolvedAt: new Date(),
        resolutionNote: result.resolutionNote,
        ...(result.instrument ? { instrument: result.instrument } : {}),
        ...(result.ticker ? { instrumentTicker: result.ticker } : {}),
        ...(result.resolutionWindowDays !== null && result.resolutionWindowDays !== opinion.resolutionWindowDays
          ? { resolutionWindowDays: result.resolutionWindowDays }
          : {}),
      },
    });

    await sleep(RESOLVE_DELAY_MS);
  }

  return { processed: opinions.length, hit, miss, notGraded, skipped };
}

// ─── Handler ──────────────────────────────────────────────────────────────────

export async function POST(request: Request) {
  if (!hasCronAccess(request)) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  try {
    console.log("[cron/auto-resolve-opinions] Starting Phase 1: preprocess windows");
    const preprocessResult = await runPreprocess();
    console.log(
      `[cron/auto-resolve-opinions] Phase 1 complete: ${preprocessResult.preprocessed} preprocessed, ${preprocessResult.failed} failed`
    );

    console.log("[cron/auto-resolve-opinions] Starting Phase 2: resolve eligible opinions");
    const resolveResult = await runResolution();
    console.log(
      `[cron/auto-resolve-opinions] Phase 2 complete: ${resolveResult.processed} processed, ` +
      `${resolveResult.hit} HIT, ${resolveResult.miss} MISS, ${resolveResult.notGraded} NOT_GRADED, ${resolveResult.skipped} skipped`
    );

    return NextResponse.json({
      preprocess: preprocessResult,
      resolution: resolveResult,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[cron/auto-resolve-opinions] Error:", msg);
    return NextResponse.json({ error: "Resolution job failed.", details: msg }, { status: 500 });
  }
}

export async function GET(request: Request) {
  return POST(request);
}
