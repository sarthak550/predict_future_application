/**
 * "Serious Charts" Program, Workstream B (2026-08-17) — self-owned 15-min
 * intraday capture for NSE indices, feeding `IndexIntradaySnapshot`.
 *
 * Separated from the cron route (mirrors lib/paperTrading/premiumCapture.ts's
 * own lib/route split) so the core logic is independently testable — a test
 * can inject `fetchIndices` to simulate a genuinely dead live feed without
 * touching NSE, and `force` to bypass the market-hours gate for a manual
 * backfill/dry-run, same convention as market-moves-movers' own `?force=1`.
 *
 * Reuses `getAllIndices()` verbatim (zero new NSE fetch code) — that module
 * already hits NSE's own live `GET /api/allIndices`, returns all 139 indices
 * in one call, with its own 60s in-module cache + stale-if-error fallback.
 * Writes EVERY index `getAllIndices()` returns, not just the ~104 long-tail
 * ones (CTO brief Decision 2) — trivially cheap, and gives the 35
 * Yahoo-backed indices a free self-owned cross-check. The instrument page
 * only WIRES the long-tail set to read from this table (see
 * lib/finance/instrument.ts's `hasSelfCapturedIntraday`) — the 35
 * Yahoo-backed indices keep using their proven pipe.
 *
 * Never throws, never writes partial/fabricated rows: a genuinely dead live
 * feed (`getAllIndices()` returns null — its own stale-if-error cache
 * already absorbs a transient NSE hiccup, so a true null means the live feed
 * itself is down) or an empty row set no-ops with `{ok:true, skipped:...}`,
 * matching this codebase's "not yet published" `200`, never `404`,
 * convention.
 *
 * Idempotent per (indexName, capturedAt): `capturedAt` is floored to the
 * current minute before the batch write, so re-triggering inside the same
 * minute (crontab double-fire, manual retry) collides on the real DB unique
 * constraint and `createMany({skipDuplicates:true})` silently no-ops the
 * repeat rather than duplicating rows.
 */

import { getAllIndices, type AllIndicesSnapshot } from "./allIndices";
import { isNseWeekdayMarketHours, getIstSessionDate } from "./marketHours";
import { prisma } from "@/lib/prisma";

export type IndexIntradayCaptureResult =
  | { ok: true; skipped: "outside_market_hours" }
  | { ok: true; skipped: "no_live_feed" }
  | { ok: true; capturedAt: string; sessionDate: string; attempted: number; written: number; asOf: string };

/** Floors to the current minute boundary — see module doc's idempotency note. */
function floorToMinute(d: Date): Date {
  const ms = d.getTime();
  return new Date(ms - (ms % 60_000));
}

export async function runIndexIntradayCapture(options?: {
  /** Bypasses the isNseWeekdayMarketHours() gate — manual backfill/testing only, never set by the crontab entry itself. */
  force?: boolean;
  /** Injectable for tests — defaults to the real getAllIndices(). */
  fetchIndices?: () => Promise<AllIndicesSnapshot | null>;
}): Promise<IndexIntradayCaptureResult> {
  const force = options?.force ?? false;
  const fetchIndices = options?.fetchIndices ?? getAllIndices;

  if (!force && !isNseWeekdayMarketHours()) {
    return { ok: true, skipped: "outside_market_hours" };
  }

  const snapshot = await fetchIndices();
  if (!snapshot || snapshot.rows.length === 0) {
    return { ok: true, skipped: "no_live_feed" };
  }

  const capturedAt = floorToMinute(new Date());
  const sessionDate = getIstSessionDate();

  // NSE occasionally omits `last` for a handful of non-equity-weighted rows
  // (see allIndices.ts's own NseAllIndicesRow doc) — a snapshot with no real
  // level is worthless to store; `last` is NOT NULL on the model by design.
  const rows = snapshot.rows
    .filter((r): r is typeof r & { last: number } => r.last != null)
    .map((r) => ({
      indexName: r.name,
      sessionDate,
      capturedAt,
      last: r.last,
      changeAbs: r.changeAbs,
      changePercent: r.changePercent,
      open: r.open,
      high: r.high,
      low: r.low,
      previousClose: r.previousClose,
    }));

  if (rows.length === 0) {
    return { ok: true, skipped: "no_live_feed" };
  }

  const result = await prisma.indexIntradaySnapshot.createMany({
    data: rows,
    skipDuplicates: true,
  });

  return {
    ok: true,
    capturedAt: capturedAt.toISOString(),
    sessionDate: sessionDate.toISOString(),
    attempted: rows.length,
    written: result.count,
    asOf: snapshot.asOf,
  };
}
