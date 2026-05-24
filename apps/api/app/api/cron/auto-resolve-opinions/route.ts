/**
 * POST /api/cron/auto-resolve-opinions
 *
 * Next.js API route wrapper for the two-phase expert opinion auto-resolution pipeline.
 * Protected by CRON_SECRET header (same pattern as other cron routes in this app).
 *
 * Phase 0 — Notification sweep: find opinions resolved but not yet notified (e.g. because
 *            a prior run was killed by Vercel after the DB commit but before the push fired).
 * Phase 1 — Preprocess: Populate resolutionWindowDays / resolutionEligibleAt for any
 *            PENDING opinions that haven't been preprocessed yet.
 * Phase 2 — Resolve:    Resolve any PENDING opinions whose resolutionEligibleAt <= now.
 *
 * Env vars:
 *   CRON_PREPROCESS_LIMIT   — max opinions to preprocess per run (default: 30)
 *   CRON_RESOLVE_LIMIT      — max opinions to resolve per run (default: 25)
 *   PREPROCESS_DELAY_MS     — ms between preprocess AI calls (default: 400)
 *   RESOLVE_DELAY_MS        — ms between resolve AI calls (default: 600)
 *
 * Budget: 30 × 400ms + 25 × 600ms = 27s — well under Vercel Hobby 60s limit.
 *
 * Schedule recommendation: daily at 03:00 UTC via Vercel Cron or external scheduler.
 */

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { parseOpinionTimeframe, evaluateOpinionResolution, wasLastCallRateLimited } from "@/lib/ai/evaluateOpinionResolution";
import { notifyOpinionResolution } from "@/lib/notifyOpinionResolution";

// Vercel function timeout hint (Next.js convention)
export const maxDuration = 60;

// Lowered defaults so 30×400ms + 25×600ms = 27s — fits comfortably in 60s Vercel budget.
const PREPROCESS_LIMIT = parseInt(process.env.CRON_PREPROCESS_LIMIT ?? "30", 10);
const RESOLVE_LIMIT = parseInt(process.env.CRON_RESOLVE_LIMIT ?? "25", 10);
const PREPROCESS_DELAY_MS = parseInt(process.env.PREPROCESS_DELAY_MS ?? "400", 10);
const RESOLVE_DELAY_MS = parseInt(process.env.RESOLVE_DELAY_MS ?? "600", 10);

/** Max AI attempts before an opinion is permanently marked NOT_GRADED. */
const PREPROCESS_MAX_ATTEMPTS = 5;
const RESOLVE_MAX_ATTEMPTS = 5;

/** How far back we look for stuck-notification opinions in the sweep (7 days). */
const SWEEP_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
/** Max stuck opinions notified per cron run — bounds notify burst + DB load. */
const SWEEP_LIMIT = parseInt(process.env.CRON_SWEEP_LIMIT ?? "50", 10);

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

function hasCronAccess(request: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;

  const authHeader = request.headers.get("authorization");
  const cronHeader = request.headers.get("x-cron-secret");
  return authHeader === `Bearer ${secret}` || cronHeader === secret;
}

// ─── Phase 0: Notification sweep ─────────────────────────────────────────────
//
// Catches opinions that were resolved (resolvedAt != null, status HIT/MISS) but
// whose notification was dropped because the Vercel process died after the DB
// commit but before notifyOpinionResolution returned. We stamp notifiedAt on
// success so each opinion is notified at most once.

async function runNotificationSweep(): Promise<{ swept: number }> {
  const cutoff = new Date(Date.now() - SWEEP_WINDOW_MS);

  const stuckOpinions = await prisma.expertOpinion.findMany({
    where: {
      resolutionStatus: { in: ["RESOLVED_HIT", "RESOLVED_MISS"] },
      resolvedAt: { not: null, gte: cutoff },
      notifiedAt: null,
    },
    select: { id: true },
    orderBy: { resolvedAt: "asc" },
    take: SWEEP_LIMIT,
  });

  let swept = 0;
  for (const { id } of stuckOpinions) {
    try {
      await notifyOpinionResolution(id);
      await prisma.expertOpinion.update({
        where: { id },
        data: { notifiedAt: new Date() },
      });
      swept++;
    } catch (err) {
      console.error(`[cron/auto-resolve-opinions] sweep notify failed for ${id}:`, err);
    }
  }

  return { swept };
}

// ─── Phase 1: Preprocess ──────────────────────────────────────────────────────

async function runPreprocess(): Promise<{ preprocessed: number; failed: number; capped: number }> {
  const opinions = await prisma.expertOpinion.findMany({
    where: {
      resolutionStatus: "PENDING",
      resolutionWindowDays: null,
      suppressedAt: null,
      // Exclude opinions that have already hit the attempt cap.
      preprocessAttempts: { lt: PREPROCESS_MAX_ATTEMPTS },
    },
    orderBy: { publishedAt: "desc" },
    take: PREPROCESS_LIMIT,
    include: {
      story: { select: { headline: true } },
    },
  });

  let preprocessed = 0;
  let failed = 0;
  let capped = 0;

  for (const opinion of opinions) {
    const headline = opinion.story?.headline ?? "";

    const result = await parseOpinionTimeframe({
      id: opinion.id,
      quote: opinion.quote,
      direction: opinion.direction,
      publishedAt: opinion.publishedAt,
      analystCallAt: opinion.analystCallAt,
      headline,
    });

    if (result === null) {
      // If the AI was rate-limited (429), do NOT count this as a failed attempt.
      // The quota is transient — trying again next run is the right behaviour.
      if (wasLastCallRateLimited()) {
        console.warn(
          `[cron/auto-resolve-opinions] Phase 1 quota exceeded for ${opinion.id} — skipping this run, attempt counter unchanged`
        );
        await sleep(PREPROCESS_DELAY_MS);
        continue;
      }

      // Genuine AI failure — increment attempt counter.
      const attemptNumber = opinion.preprocessAttempts + 1;
      await prisma.expertOpinion.update({
        where: { id: opinion.id },
        data: {
          preprocessAttempts: { increment: 1 },
          lastPreprocessAttemptAt: new Date(),
        },
      });

      // On the final allowed attempt, permanently mark NOT_GRADED to stop future retries.
      if (attemptNumber >= PREPROCESS_MAX_ATTEMPTS) {
        await prisma.expertOpinion.update({
          where: { id: opinion.id },
          data: {
            resolutionStatus: "NOT_GRADED",
            resolutionNote: "AI failed to parse timeframe after 5 attempts",
            resolvedAt: new Date(),
          },
        });
        capped++;
        console.warn(
          `[cron/auto-resolve-opinions] Phase 1 capped opinion ${opinion.id} after ${attemptNumber} failed attempts`
        );
      } else {
        failed++;
      }
      await sleep(PREPROCESS_DELAY_MS);
      continue;
    }

    const windowDays = result.impliedWindowDays;
    const callDate = opinion.analystCallAt ?? opinion.publishedAt;
    const eligibleAt = new Date(callDate.getTime() + windowDays * 24 * 60 * 60 * 1000);

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

  return { preprocessed, failed, capped };
}

// ─── Phase 2: Resolve ─────────────────────────────────────────────────────────

async function runResolution(): Promise<{
  processed: number;
  hit: number;
  miss: number;
  notGraded: number;
  skipped: number;
  capped: number;
  notifiedVoters: number;
  pushQueued: number;
}> {
  const now = new Date();

  const opinions = await prisma.expertOpinion.findMany({
    where: {
      resolutionStatus: "PENDING",
      resolutionEligibleAt: { lte: now },
      resolutionWindowDays: { not: null },
      suppressedAt: null,
      // Exclude opinions that have already hit the attempt cap.
      resolutionAttempts: { lt: RESOLVE_MAX_ATTEMPTS },
    },
    orderBy: { resolutionEligibleAt: "asc" },
    take: RESOLVE_LIMIT,
    include: {
      story: { select: { headline: true } },
    },
  });

  let hit = 0, miss = 0, notGraded = 0, skipped = 0, capped = 0;
  let notifiedVoters = 0;
  let pushQueued = 0;

  for (const opinion of opinions) {
    const headline = opinion.story?.headline ?? "";

    // Optimisation: if the parse result (instrument, ticker, window) is already cached
    // on the row, pass skipPass1=true to avoid re-running the parse AI call.
    const hasFullParseCache =
      opinion.resolutionWindowDays !== null &&
      opinion.instrument !== null &&
      opinion.instrumentTicker !== null;

    const result = await evaluateOpinionResolution({
      id: opinion.id,
      quote: opinion.quote,
      direction: opinion.direction,
      publishedAt: opinion.publishedAt,
      analystCallAt: opinion.analystCallAt,
      headline,
      resolutionWindowDays: opinion.resolutionWindowDays,
      instrument: hasFullParseCache ? opinion.instrument : undefined,
      instrumentTicker: hasFullParseCache ? opinion.instrumentTicker : undefined,
    });

    if (result === null) {
      // Don't burn an attempt on a transient AI rate-limit — the quota is per-minute and
      // we'll get a fresh budget on the next cron run. Phase 1 does the same thing.
      if (wasLastCallRateLimited()) {
        console.warn(
          `[cron/auto-resolve-opinions] Phase 2 quota exceeded for ${opinion.id} — skipping this run, attempt counter unchanged`
        );
        skipped++;
        await sleep(RESOLVE_DELAY_MS);
        continue;
      }

      // Genuine AI failure — increment the counter now.
      const attemptNumber = opinion.resolutionAttempts + 1;
      await prisma.expertOpinion.update({
        where: { id: opinion.id },
        data: {
          resolutionAttempts: { increment: 1 },
          lastResolutionAttemptAt: new Date(),
        },
      });

      // On the final allowed attempt, permanently mark NOT_GRADED.
      if (attemptNumber >= RESOLVE_MAX_ATTEMPTS) {
        await prisma.expertOpinion.update({
          where: { id: opinion.id },
          data: {
            resolutionStatus: "NOT_GRADED",
            resolutionNote: "AI resolution failed after 5 attempts",
            resolvedAt: new Date(),
          },
        });
        capped++;
        console.warn(
          `[cron/auto-resolve-opinions] Phase 2 capped opinion ${opinion.id} after ${attemptNumber} failed attempts`
        );
      } else {
        skipped++;
      }
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

    // Fire notification and stamp notifiedAt. If the process dies here,
    // Phase 0 (sweep) on the next run picks this opinion up and retries.
    if (result.status === "RESOLVED_HIT" || result.status === "RESOLVED_MISS") {
      try {
        const notify = await notifyOpinionResolution(opinion.id);
        notifiedVoters += notify.notified;
        pushQueued += notify.pushQueued;
        await prisma.expertOpinion.update({
          where: { id: opinion.id },
          data: { notifiedAt: new Date() },
        });
      } catch (err) {
        console.error(`[cron/auto-resolve-opinions] notify failed for ${opinion.id}:`, err);
        // notifiedAt stays null — sweep will retry on next run
      }
    }

    await sleep(RESOLVE_DELAY_MS);
  }

  return { processed: opinions.length, hit, miss, notGraded, skipped, capped, notifiedVoters, pushQueued };
}

// ─── Handler ──────────────────────────────────────────────────────────────────

export async function POST(request: Request) {
  if (!hasCronAccess(request)) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  try {
    console.log("[cron/auto-resolve-opinions] Starting Phase 0: notification sweep");
    const sweepResult = await runNotificationSweep();
    console.log(`[cron/auto-resolve-opinions] Phase 0 complete: ${sweepResult.swept} swept`);

    console.log("[cron/auto-resolve-opinions] Starting Phase 1: preprocess windows");
    const preprocessResult = await runPreprocess();
    console.log(
      `[cron/auto-resolve-opinions] Phase 1 complete: ${preprocessResult.preprocessed} preprocessed, ` +
      `${preprocessResult.failed} failed, ${preprocessResult.capped} capped`
    );

    console.log("[cron/auto-resolve-opinions] Starting Phase 2: resolve eligible opinions");
    const resolveResult = await runResolution();
    console.log(
      `[cron/auto-resolve-opinions] Phase 2 complete: ${resolveResult.processed} processed, ` +
      `${resolveResult.hit} HIT, ${resolveResult.miss} MISS, ${resolveResult.notGraded} NOT_GRADED, ` +
      `${resolveResult.skipped} skipped, ${resolveResult.capped} capped, ` +
      `${resolveResult.notifiedVoters} voters notified, ${resolveResult.pushQueued} push queued`
    );

    return NextResponse.json({
      sweep: sweepResult,
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
