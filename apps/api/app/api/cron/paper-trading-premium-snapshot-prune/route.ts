/**
 * POST /api/cron/paper-trading-premium-snapshot-prune
 *
 * Trading Terminal UI Overhaul (Sprint A, T3) — deletes OptionPremiumSnapshot
 * rows past retention. Kept as its OWN cron file rather than folded into the
 * capture cron, per this codebase's established one-mechanism-per-cron
 * convention (see the Phase 3 brief's cron-timing section, and every other
 * settle/prune pair in this domain — e.g. paper-trading-squareoff vs.
 * paper-trading-options-expiry are separate files despite both being
 * "closing leg" crons).
 *
 * **Interval-parity cadence project (2026-08-07)** — TWO-TIER retention,
 * widened from one flat 45-day cutoff. The 1-minute fast (index) track
 * writes ~5x the rows/candidate/run the old 5-minute cadence did; keeping
 * that volume for a full 45 days would multiply the table's steady-state
 * size well beyond what the original retention design budgeted for. Fine-
 * grained rows (`captureIntervalSec <= 60`) are pruned much sooner — 10
 * calendar days (this domain has no NSE trading-holiday calendar, see
 * marketHours.ts's own documented Phase 1 caveat, so calendar days rather
 * than trading days is deliberate, not an oversight) — a window still
 * comfortably wide enough to plot a full 1-minute-granularity intraday
 * session or two for review, well past what any "why isn't 1m working"
 * support question would need. Coarser rows (`captureIntervalSec > 60` —
 * the 5-minute stock track, AND every legacy row written before this column
 * existed, which defaults to 300) keep the ORIGINAL 45-day retention,
 * unchanged. Pure deletion, not downsample-then-delete: this is a pseudo-
 * candle convenience feature over unofficial NSE data, not settlement-grade
 * history, so preserving a synthetic coarser rollup past the fine-grained
 * cutoff was judged not worth the added write-path complexity — deferred,
 * flagged here for whoever revisits retention next.
 *
 * Recommended cadence — once nightly, at a low-traffic hour:
 *   0 14 * * * curl -s -X POST https://<host>/api/cron/paper-trading-premium-snapshot-prune \
 *       -H "Authorization: Bearer $CRON_SECRET"
 * (14:00 UTC = 19:30 IST) — UNCHANGED, still once a night.
 *
 * Never throws: the delete is wrapped and any failure is reported in the JSON
 * response body instead of a 500, matching every other cron route's contract.
 */

import { NextResponse } from "next/server";

import { prisma } from "@/lib/prisma";

/** Fine-grained (1-minute, index-track) rows — see module doc. */
const FINE_GRAINED_RETENTION_DAYS = 10;
/** Everything else (5-minute stock track + legacy pre-column rows) — unchanged from the original design. */
const STANDARD_RETENTION_DAYS = 45;
/** The dividing line between "fine-grained" and "standard" retention — matches premiumCapture.ts's FAST_TRACK_CAPTURE_INTERVAL_SEC exactly (a row captured at <=60s cadence is fine-grained). */
const FINE_GRAINED_MAX_INTERVAL_SEC = 60;

function hasCronAccess(request: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const authHeader = request.headers.get("authorization");
  const cronHeader = request.headers.get("x-cron-secret");
  return authHeader === `Bearer ${secret}` || cronHeader === secret;
}

function daysAgo(days: number): Date {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000);
}

async function run(request: Request) {
  if (!hasCronAccess(request)) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  try {
    const fineGrainedCutoff = daysAgo(FINE_GRAINED_RETENTION_DAYS);
    const standardCutoff = daysAgo(STANDARD_RETENTION_DAYS);

    const [fineGrainedDeleted, standardDeleted] = await Promise.all([
      prisma.optionPremiumSnapshot.deleteMany({
        where: { captureIntervalSec: { lte: FINE_GRAINED_MAX_INTERVAL_SEC }, capturedAt: { lt: fineGrainedCutoff } }
      }),
      prisma.optionPremiumSnapshot.deleteMany({
        where: { captureIntervalSec: { gt: FINE_GRAINED_MAX_INTERVAL_SEC }, capturedAt: { lt: standardCutoff } }
      })
    ]);

    return NextResponse.json({
      ok: true,
      deletedCount: fineGrainedDeleted.count + standardDeleted.count,
      fineGrainedDeleted: fineGrainedDeleted.count,
      fineGrainedCutoff: fineGrainedCutoff.toISOString(),
      standardDeleted: standardDeleted.count,
      standardCutoff: standardCutoff.toISOString()
    });
  } catch (err) {
    console.error("[cron/paper-trading-premium-snapshot-prune] unexpected failure:", err);
    return NextResponse.json({ ok: false, error: "Unexpected failure." }, { status: 200 });
  }
}

export const GET = run;
export const POST = run;
