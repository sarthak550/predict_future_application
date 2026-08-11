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
 * **All-expiry index capture project (2026-08-11)** — premiumCapture.ts's
 * fine-grained (<=60s) track jumped from ~315,000 rows/day
 * (nearest-weekly-only, single index expiry per underlying) to a
 * live-measured ~788,250 rows/day (every listed expiry of all 5 index
 * underlyings, tiered 15s/60s by proximity — see that file's own module doc
 * for the full measurement). The marginal NIGHTLY delete volume this prune
 * cron now needs to clear is therefore ~1 day's production sliding out of
 * the 10-day window, ~788K rows, not the old design's ~315K. Both
 * `deleteMany` calls below were previously UNBATCHED — one single
 * transaction covering however many rows had aged out. At the new volume
 * that's a meaningfully bigger single delete than this route was designed
 * against, so both are now chunked (`deleteInChunks`, `PRUNE_CHUNK_SIZE`
 * rows per `DELETE`, looped until nothing left) — each chunk is its own
 * short transaction rather than one that could hold locks / grow the WAL
 * for however long a ~788K-row delete takes on Neon. `PRUNE_CHUNK_SIZE`
 * (25,000) is arbitrary-but-reasonable: ~32 chunks to clear a full day's
 * fine-grained volume, each individually fast, well inside this route's own
 * request timeout.
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
import type { Prisma } from "@prisma/client";

/** Fine-grained (index-track, both the 15s near-tier and 60s far-tier — see premiumCapture.ts) rows. */
const FINE_GRAINED_RETENTION_DAYS = 10;
/** Everything else (5-minute stock track + legacy pre-column rows) — unchanged from the original design. */
const STANDARD_RETENTION_DAYS = 45;
/** The dividing line between "fine-grained" and "standard" retention — matches premiumCapture.ts's ALWAYS_ON_FAR_CAPTURE_INTERVAL_SEC exactly (a row captured at <=60s cadence is fine-grained). */
const FINE_GRAINED_MAX_INTERVAL_SEC = 60;
/** Rows deleted per DELETE statement (see module doc's 2026-08-11 section) — each chunk is its own short-lived transaction rather than one unbounded delete covering a full day's ~788K-row fine-grained volume. */
const PRUNE_CHUNK_SIZE = 25_000;
/** Safety bound on chunk-loop iterations — 400 chunks x PRUNE_CHUNK_SIZE = 10,000,000 rows, comfortably above any volume this table should ever accumulate past retention in one night (a healthy nightly run clears ~1 day's production, ~32 chunks at current volume). Exists purely so a pathological runaway (retention job broken for weeks) can't loop unbounded inside one request. */
const PRUNE_MAX_CHUNKS = 400;

/**
 * Deletes rows matching `where` in `PRUNE_CHUNK_SIZE`-row batches (via
 * `findMany` id-select + `deleteMany({ id: { in } })`, the same
 * Prisma-portable pattern used elsewhere in this codebase for bounded bulk
 * deletes — no raw SQL / ctid tricks needed). Loops until a chunk comes back
 * empty or `PRUNE_MAX_CHUNKS` is hit. Returns the total rows deleted.
 */
async function deleteInChunks(where: Prisma.OptionPremiumSnapshotWhereInput): Promise<number> {
  let totalDeleted = 0;
  for (let i = 0; i < PRUNE_MAX_CHUNKS; i++) {
    const idsToDelete = await prisma.optionPremiumSnapshot.findMany({
      where,
      select: { id: true },
      take: PRUNE_CHUNK_SIZE
    });
    if (idsToDelete.length === 0) break;

    const { count } = await prisma.optionPremiumSnapshot.deleteMany({
      where: { id: { in: idsToDelete.map((r) => r.id) } }
    });
    totalDeleted += count;

    if (idsToDelete.length < PRUNE_CHUNK_SIZE) break; // last (partial) chunk — no more rows past this point
  }
  return totalDeleted;
}

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
      deleteInChunks({ captureIntervalSec: { lte: FINE_GRAINED_MAX_INTERVAL_SEC }, capturedAt: { lt: fineGrainedCutoff } }),
      deleteInChunks({ captureIntervalSec: { gt: FINE_GRAINED_MAX_INTERVAL_SEC }, capturedAt: { lt: standardCutoff } })
    ]);

    return NextResponse.json({
      ok: true,
      deletedCount: fineGrainedDeleted + standardDeleted,
      fineGrainedDeleted,
      fineGrainedCutoff: fineGrainedCutoff.toISOString(),
      standardDeleted,
      standardCutoff: standardCutoff.toISOString()
    });
  } catch (err) {
    console.error("[cron/paper-trading-premium-snapshot-prune] unexpected failure:", err);
    return NextResponse.json({ ok: false, error: "Unexpected failure." }, { status: 200 });
  }
}

export const GET = run;
export const POST = run;
