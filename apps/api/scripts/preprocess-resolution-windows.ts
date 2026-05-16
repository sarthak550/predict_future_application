/**
 * Preprocess resolution windows for expert opinions.
 *
 * Runs Pass 1 only (instrument + timeframe extraction) on all PENDING opinions that
 * do not yet have resolutionWindowDays set. Populates resolutionWindowDays and
 * resolutionEligibleAt without attempting resolution. The daily cron then uses
 * resolutionEligibleAt to know which calls have matured and can be resolved.
 *
 * Usage:
 *   npx tsx scripts/preprocess-resolution-windows.ts
 *
 * Environment variables:
 *   LIMIT=200     — max opinions to process per run (default: 200)
 *   DELAY_MS=400  — ms to sleep between AI calls (default: 400)
 *   DRY_RUN=true  — print decisions but do NOT write to DB (default: false)
 */

import { prisma } from "../lib/prisma";
import { parseOpinionTimeframe } from "../lib/ai/evaluateOpinionResolution";

// ─── Configuration ─────────────────────────────────────────────────────────────

const LIMIT = parseInt(process.env.LIMIT ?? "200", 10);
const DELAY_MS = parseInt(process.env.DELAY_MS ?? "400", 10);
const DRY_RUN = process.env.DRY_RUN === "true";

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

// ─── Window distribution buckets ────────────────────────────────────────────────

/** Buckets for the distribution table. Each entry is [label, maxDays]. */
const BUCKETS: Array<{ label: string; maxDays: number }> = [
  { label: "7d  (this week)", maxDays: 7 },
  { label: "21d (short-term)", maxDays: 21 },
  { label: "30d (1 month)", maxDays: 30 },
  { label: "60d (target call)", maxDays: 60 },
  { label: "90d (1 quarter)", maxDays: 90 },
  { label: "180d (6 months)", maxDays: 180 },
  { label: "365d (1 year)", maxDays: 365 },
  { label: "730d+ (long-term)", maxDays: Infinity },
];

function bucketLabel(days: number): string {
  for (const bucket of BUCKETS) {
    if (days <= bucket.maxDays) return bucket.label;
  }
  return "730d+ (long-term)";
}

// ─── Main ───────────────────────────────────────────────────────────────────────

async function main() {
  console.log("=".repeat(60));
  console.log("Expert Opinion Preprocess — Resolution Window Population");
  console.log("=".repeat(60));
  console.log(`Mode:          ${DRY_RUN ? "DRY RUN (no DB writes)" : "LIVE"}`);
  console.log(`Limit:         ${LIMIT}`);
  console.log(`Delay between: ${DELAY_MS}ms`);
  console.log("=".repeat(60));
  console.log();

  // Fetch PENDING opinions that have no resolutionWindowDays yet
  const opinions = await prisma.expertOpinion.findMany({
    where: {
      resolutionStatus: "PENDING",
      resolutionWindowDays: null,
      suppressedAt: null,
    },
    orderBy: { publishedAt: "desc" },
    take: LIMIT,
    include: {
      story: { select: { headline: true } },
    },
  });

  console.log(`Found ${opinions.length} PENDING opinion(s) without a resolution window.\n`);

  if (opinions.length === 0) {
    console.log("Nothing to preprocess — all PENDING opinions already have windows.");
    await prisma.$disconnect();
    return;
  }

  let processed = 0;
  let failed = 0;

  // Distribution counters: bucket label → count
  const distribution = new Map<string, number>();
  for (const b of BUCKETS) distribution.set(b.label, 0);

  for (let i = 0; i < opinions.length; i++) {
    const opinion = opinions[i];
    const idx = `[${i + 1}/${opinions.length}]`;
    const publishedDate = opinion.publishedAt.toISOString().slice(0, 10);
    const headline = opinion.story?.headline ?? "(no story)";
    const shortHeadline = headline.slice(0, 55);

    console.log(`${idx} ${publishedDate} | ${opinion.direction} | ${shortHeadline}`);

    const result = await parseOpinionTimeframe({
      id: opinion.id,
      quote: opinion.quote,
      direction: opinion.direction,
      publishedAt: opinion.publishedAt,
      headline,
    });

    if (result === null) {
      console.log(`  Failed (AI error) — skipping\n`);
      failed++;
      await sleep(DELAY_MS);
      continue;
    }

    const windowDays = result.impliedWindowDays;
    // Compute eligible date: publishedAt + windowDays
    const eligibleAt = new Date(opinion.publishedAt.getTime() + windowDays * 24 * 60 * 60 * 1000);

    const label = bucketLabel(windowDays);
    distribution.set(label, (distribution.get(label) ?? 0) + 1);

    const alreadyEligible = eligibleAt <= new Date();
    console.log(`  Instrument:  ${result.instrument ?? "n/a"} | Resolvable: ${result.isResolvable}`);
    console.log(`  Window:      ${windowDays}d → eligible ${eligibleAt.toISOString().slice(0, 10)}${alreadyEligible ? " (ALREADY ELIGIBLE)" : ""}`);
    if (!result.isResolvable && result.notResolvableReason) {
      console.log(`  Note:        ${result.notResolvableReason}`);
    }
    console.log();

    if (!DRY_RUN) {
      await prisma.expertOpinion.update({
        where: { id: opinion.id },
        data: {
          resolutionWindowDays: windowDays,
          resolutionEligibleAt: eligibleAt,
          // Also persist instrument fields if we got them and they weren't set
          ...(result.instrument && !opinion.instrument ? { instrument: result.instrument } : {}),
          ...(result.ticker && !opinion.instrumentTicker ? { instrumentTicker: result.ticker } : {}),
        },
      });
    }

    processed++;
    await sleep(DELAY_MS);
  }

  // ── Summary ──────────────────────────────────────────────────────────────────

  console.log("=".repeat(60));
  console.log("PREPROCESS SUMMARY");
  console.log("=".repeat(60));
  console.log(`Total found:       ${opinions.length}`);
  console.log(`Windows set:       ${processed}`);
  console.log(`Failed (AI error): ${failed}`);
  if (DRY_RUN) console.log(`(DRY RUN — no changes written to database)`);
  console.log();

  console.log("WINDOW DISTRIBUTION");
  console.log("-".repeat(40));

  let totalWindowed = 0;
  for (const b of BUCKETS) {
    const count = distribution.get(b.label) ?? 0;
    totalWindowed += count;
    if (count > 0) {
      const bar = "#".repeat(Math.min(count, 40));
      console.log(`  ${b.label.padEnd(22)} ${String(count).padStart(4)}  ${bar}`);
    }
  }
  console.log("-".repeat(40));
  console.log(`  ${"Total".padEnd(22)} ${String(totalWindowed).padStart(4)}`);
  console.log();

  // ── Check if any are already eligible ───────────────────────────────────────

  if (!DRY_RUN) {
    const now = new Date();
    const alreadyEligible = await prisma.expertOpinion.count({
      where: {
        resolutionStatus: "PENDING",
        resolutionEligibleAt: { lte: now },
        resolutionWindowDays: { not: null },
        suppressedAt: null,
      },
    });

    if (alreadyEligible > 0) {
      console.log(`NOTICE: ${alreadyEligible} opinion(s) are already past their eligible date.`);
      console.log(`Run auto-resolve-opinions.ts to resolve them now.`);
    } else {
      console.log("No opinions are currently past their eligible date.");
    }
  }

  await prisma.$disconnect();
}

main().catch((err) => {
  console.error("Fatal error:", err instanceof Error ? err.message : err);
  process.exit(1);
});
