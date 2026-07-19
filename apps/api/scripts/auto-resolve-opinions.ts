/**
 * Auto-resolution script for expert opinions.
 *
 * Uses a two-pass AI approach (via evaluateOpinionResolution) instead of keyword-map
 * instrument extraction + mechanical threshold logic. Pass 1 identifies the instrument
 * and assesses resolvability; Pass 2 renders a HIT/MISS/NOT_GRADED verdict given real
 * price data. This prevents cross-opinion ticker contamination and correctly handles
 * non-price-call quotes (macro commentary, mutual fund flows, etc.).
 *
 * Eligibility is determined by resolutionEligibleAt (publishedAt + resolutionWindowDays),
 * not a fixed global window. Run preprocess-resolution-windows.ts first to populate
 * those fields for new opinions.
 *
 * Usage:
 *   npx tsx scripts/auto-resolve-opinions.ts
 *
 * Environment variables:
 *   DRY_RUN=true   — print decisions but do NOT write to DB (default: false)
 *   LIMIT=200      — max opinions to process per run (default: 200)
 *   DELAY_MS=600   — ms to sleep between opinions to respect Groq rate limits (default: 600)
 */

import { prisma } from "../lib/prisma";
import { evaluateOpinionResolution, wasLastCallRateLimited } from "../lib/ai/evaluateOpinionResolution";

// ─── Configuration ─────────────────────────────────────────────────────────────

const DRY_RUN = process.env.DRY_RUN === "true";
const LIMIT = parseInt(process.env.LIMIT ?? "200", 10);
const DELAY_MS = parseInt(process.env.DELAY_MS ?? "600", 10);

/** Max AI attempts before an opinion is permanently marked NOT_GRADED. Must match
 *  RESOLVE_MAX_ATTEMPTS in app/api/cron/auto-resolve-opinions/route.ts. */
const RESOLVE_MAX_ATTEMPTS = 5;

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

// ─── Resolution counters ────────────────────────────────────────────────────────

const summary = {
  hit: 0,
  miss: 0,
  notGraded: 0,
  skipped: 0,
  capped: 0,
  noWindow: 0,
  total: 0,
};

// ─── Main ───────────────────────────────────────────────────────────────────────

async function main() {
  console.log("=".repeat(60));
  console.log("Expert Opinion Auto-Resolution (AI-powered, per-call windows)");
  console.log("=".repeat(60));
  console.log(`Mode:          ${DRY_RUN ? "DRY RUN (no DB writes)" : "LIVE"}`);
  console.log(`Limit:         ${LIMIT}`);
  console.log(`Delay between: ${DELAY_MS}ms`);
  console.log("=".repeat(60));
  console.log();

  const now = new Date();

  // Only evaluate opinions whose per-call window has elapsed.
  // resolutionWindowDays must be non-null (preprocess ran for these opinions).
  const opinions = await prisma.expertOpinion.findMany({
    where: {
      resolutionStatus: "PENDING",
      resolutionEligibleAt: { lte: now },
      resolutionWindowDays: { not: null },
      suppressedAt: null,
      // Exclude opinions that have already hit the attempt cap (mirrors the cron route).
      resolutionAttempts: { lt: RESOLVE_MAX_ATTEMPTS },
    },
    orderBy: { resolutionEligibleAt: "asc" },
    take: LIMIT,
    include: {
      story: { select: { headline: true } },
    },
  });

  // Also check how many PENDING opinions have no window yet (shouldn't happen if preprocess ran first)
  const noWindowCount = await prisma.expertOpinion.count({
    where: {
      resolutionStatus: "PENDING",
      resolutionWindowDays: null,
      suppressedAt: null,
    },
  });

  if (noWindowCount > 0) {
    console.log(`WARNING: ${noWindowCount} PENDING opinion(s) have no resolutionWindowDays set.`);
    console.log(`Run preprocess-resolution-windows.ts first to populate windows.\n`);
  }

  console.log(`Found ${opinions.length} PENDING opinion(s) eligible for resolution (window elapsed).\n`);

  for (let i = 0; i < opinions.length; i++) {
    const opinion = opinions[i];
    summary.total++;

    const idx = `[${i + 1}/${opinions.length}]`;
    const headline = opinion.story?.headline ?? "(no story)";
    const shortHeadline = headline.slice(0, 55);
    const publishedDate = opinion.publishedAt.toISOString().slice(0, 10);
    const eligibleDate = opinion.resolutionEligibleAt?.toISOString().slice(0, 10) ?? "?";

    console.log(`${idx} published ${publishedDate} | eligible ${eligibleDate} | ${opinion.direction} | ${shortHeadline}`);

    // Guard: skip opinions without a stored window (shouldn't happen after preprocess)
    if (opinion.resolutionWindowDays === null) {
      console.log(`  Skipped (no resolutionWindowDays — run preprocess first)\n`);
      summary.noWindow++;
      continue;
    }

    // Delegate all resolution logic to the AI evaluator.
    // Pass resolutionWindowDays and analystCallAt from DB so evaluateOpinionResolution uses
    // the stored window and the analyst's actual call date (not just publishedAt).
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

    // null means an unrecoverable AI error — track the attempt (unless it was a transient
    // rate-limit) and skip this opinion to avoid corrupting the DB. Mirrors the cron route's
    // attempt-cap logic so a chronically-failing opinion eventually stops being retried.
    if (result === null) {
      if (wasLastCallRateLimited()) {
        console.log(`  Rate-limited — skipping this run, attempt counter unchanged\n`);
        summary.skipped++;
        await sleep(DELAY_MS);
        continue;
      }

      console.log(`  Skipped (AI error)\n`);
      summary.skipped++;

      if (!DRY_RUN) {
        const attemptNumber = opinion.resolutionAttempts + 1;
        await prisma.expertOpinion.update({
          where: { id: opinion.id },
          data: { resolutionAttempts: { increment: 1 }, lastResolutionAttemptAt: new Date() },
        });
        if (attemptNumber >= RESOLVE_MAX_ATTEMPTS) {
          await prisma.expertOpinion.update({
            where: { id: opinion.id },
            data: {
              resolutionStatus: "NOT_GRADED",
              resolutionNote: "AI resolution failed after 5 attempts",
              resolvedAt: new Date(),
            },
          });
          summary.capped++;
          console.log(`  Capped after ${attemptNumber} failed attempts — marked NOT_GRADED\n`);
        }
      }

      await sleep(DELAY_MS);
      continue;
    }

    console.log(`  Instrument: ${result.instrument ?? "n/a"} (${result.ticker ?? "n/a"})`);
    console.log(`  Window:     ${result.resolutionWindowDays ?? opinion.resolutionWindowDays}d`);
    console.log(`  Result:     ${result.status}`);
    console.log(`  Note:       ${result.resolutionNote}\n`);

    if (result.status === "RESOLVED_HIT") summary.hit++;
    else if (result.status === "RESOLVED_MISS") summary.miss++;
    else summary.notGraded++;

    if (!DRY_RUN) {
      await prisma.expertOpinion.update({
        where: { id: opinion.id },
        data: {
          resolutionStatus: result.status,
          resolvedAt: new Date(),
          resolutionNote: result.resolutionNote,
          // Persist instrument fields if the AI identified them
          ...(result.instrument ? { instrument: result.instrument } : {}),
          ...(result.ticker ? { instrumentTicker: result.ticker } : {}),
          // Write back resolutionWindowDays if it changed (defensive)
          ...(result.resolutionWindowDays !== null && result.resolutionWindowDays !== opinion.resolutionWindowDays
            ? { resolutionWindowDays: result.resolutionWindowDays }
            : {}),
        },
      });
    }

    await sleep(DELAY_MS);
  }

  // ── Summary table ───────────────────────────────────────────────────────────

  console.log("=".repeat(60));
  console.log("RESOLUTION SUMMARY");
  console.log("=".repeat(60));
  console.log(`Total processed:   ${summary.total}`);
  console.log(`RESOLVED_HIT:      ${summary.hit}`);
  console.log(`RESOLVED_MISS:     ${summary.miss}`);
  console.log(`NOT_GRADED:        ${summary.notGraded}`);
  console.log(`Skipped (error):   ${summary.skipped}`);
  console.log(`Capped (5 fails):  ${summary.capped}`);
  if (summary.noWindow > 0) {
    console.log(`Skipped (no win):  ${summary.noWindow}`);
  }

  if (DRY_RUN) {
    console.log();
    console.log("(DRY RUN — no changes written to database)");
  }

  await prisma.$disconnect();
}

main().catch((err) => {
  console.error("Fatal error:", err instanceof Error ? err.message : err);
  process.exit(1);
});
