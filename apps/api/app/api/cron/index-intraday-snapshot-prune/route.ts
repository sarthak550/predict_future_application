/**
 * POST /api/cron/index-intraday-snapshot-prune
 *
 * "Serious Charts" Program, Workstream B (2026-08-17) — deletes
 * `IndexIntradaySnapshot` rows past retention. Kept as its OWN cron file
 * rather than folded into the capture cron, per this codebase's established
 * one-mechanism-per-cron convention (see paper-trading-premium-capture vs.
 * paper-trading-premium-snapshot-prune, the exact pattern this route mirrors).
 *
 * 60-day retention, chunked delete (`findMany` id-batch + `deleteMany`,
 * capped batch count) rather than one unbounded `deleteMany` — same
 * discipline `paper-trading-premium-snapshot-prune` uses, proportionally
 * lighter here (this feature's real volume is under 900K rows/year at
 * steady state — see the CTO brief's row-volume recompute — over 10x
 * smaller than OptionPremiumSnapshot's ~7.88M rows/year). 60 days is
 * deliberately more generous than the bare ~1-month minimum a 1M-timeframe
 * chart needs, giving headroom for a possible future wider-range extension
 * without immediately needing to re-architect retention — but this is not
 * "keep forever," given the standing Neon-quota watch item this codebase
 * has hit before.
 *
 * Recommended cadence — once nightly, at a low-traffic hour:
 *   0 14 * * * curl -s -X POST https://<host>/api/cron/index-intraday-snapshot-prune \
 *       -H "Authorization: Bearer $CRON_SECRET"
 * (14:00 UTC = 19:30 IST, same slot as the OptionPremiumSnapshot prune.)
 *
 * Never throws: the delete is wrapped and any failure is reported in the
 * JSON response body instead of a 500, matching every other cron route's
 * contract.
 */

import { NextResponse } from "next/server";

import { prisma } from "@/lib/prisma";
import type { Prisma } from "@prisma/client";

const RETENTION_DAYS = 60;
/** Rows deleted per DELETE statement — each chunk is its own short-lived transaction rather than one unbounded delete. */
const PRUNE_CHUNK_SIZE = 25_000;
/** Safety bound on chunk-loop iterations, same rationale as paper-trading-premium-snapshot-prune's own PRUNE_MAX_CHUNKS. */
const PRUNE_MAX_CHUNKS = 400;

/**
 * Deletes rows matching `where` in `PRUNE_CHUNK_SIZE`-row batches (via
 * `findMany` id-select + `deleteMany({ id: { in } })`), the same
 * Prisma-portable pattern paper-trading-premium-snapshot-prune's own
 * `deleteInChunks` uses. Loops until a chunk comes back empty or
 * `PRUNE_MAX_CHUNKS` is hit. Returns the total rows deleted.
 */
async function deleteInChunks(where: Prisma.IndexIntradaySnapshotWhereInput): Promise<number> {
  let totalDeleted = 0;
  for (let i = 0; i < PRUNE_MAX_CHUNKS; i++) {
    const idsToDelete = await prisma.indexIntradaySnapshot.findMany({
      where,
      select: { id: true },
      take: PRUNE_CHUNK_SIZE,
    });
    if (idsToDelete.length === 0) break;

    const { count } = await prisma.indexIntradaySnapshot.deleteMany({
      where: { id: { in: idsToDelete.map((r) => r.id) } },
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
    const cutoff = daysAgo(RETENTION_DAYS);
    const deletedCount = await deleteInChunks({ capturedAt: { lt: cutoff } });

    return NextResponse.json({
      ok: true,
      deletedCount,
      cutoff: cutoff.toISOString(),
    });
  } catch (err) {
    console.error("[cron/index-intraday-snapshot-prune] unexpected failure:", err);
    return NextResponse.json({ ok: false, error: "Unexpected failure." }, { status: 200 });
  }
}

export const GET = run;
export const POST = run;
