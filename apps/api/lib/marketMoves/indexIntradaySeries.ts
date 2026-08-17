/**
 * "Serious Charts" Program, Workstream B (2026-08-17) — reads self-captured
 * `IndexIntradaySnapshot` rows back out as a line series, for a long-tail
 * NSE index's instrument-page 1W/1M chart (see
 * apps/web/lib/finance/instrument.ts's `hasSelfCapturedIntraday`).
 *
 * Line-series only, by construction: each row is a single `last` value at a
 * point in time, never a real OHLC bar (see IndexIntradaySnapshot's own
 * schema doc) — this function has no open/high/low fields to return, full
 * stop, so no caller downstream can accidentally synthesize a candlestick
 * from it.
 */

import { istCalendarDateOfInstant } from "@predict-future/business-rules/portfolios/shadow";
import { sliceToLastIstSessions, groupBarsByIstSession } from "@predict-future/business-rules/marketPulse/intradaySessions";

import { prisma } from "@/lib/prisma";

export type SelfCapturedPoint = { t: number; value: number };

export type SelfCapturedIndexSeries = {
  points: SelfCapturedPoint[];
  /** IST calendar date (YYYY-MM-DD) of the earliest point actually returned in `points` — null when `points` is empty. Feeds the instrument page's "captured live since {date}" footer copy. */
  from: string | null;
  /** Every distinct IST session currently in retention for this index — NOT just the sessions returned in `points` (which may be fewer than `sessions` requested). Lets a caller render an honest "N of M sessions" partial state rather than guessing from `points` alone. */
  sessionsAvailable: number;
};

/** Matches IndexIntradaySnapshot's own 60-day prune retention (index-intraday-snapshot-prune) — never queries further back than what could possibly still exist. */
const RETENTION_LOOKBACK_DAYS = 60;

function istDateString(timestampMs: number): string {
  const { year, month, day } = istCalendarDateOfInstant(new Date(timestampMs));
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/**
 * Reads `indexName`'s self-captured 15-min snapshots for its last `sessions`
 * IST trading sessions. `sessions <= 0` or a genuinely uncaptured index both
 * degrade to an honest empty result — never fabricated, never backfilled,
 * matching the founder's own "nothing retroactive, never fake history"
 * instruction (CTO brief Decision 5).
 */
export async function getSelfCapturedIndexSeries(indexName: string, sessions: number): Promise<SelfCapturedIndexSeries> {
  if (sessions <= 0) {
    return { points: [], from: null, sessionsAvailable: 0 };
  }

  const cutoff = new Date(Date.now() - RETENTION_LOOKBACK_DAYS * 24 * 60 * 60 * 1000);
  const rows = await prisma.indexIntradaySnapshot.findMany({
    where: { indexName, capturedAt: { gte: cutoff } },
    orderBy: { capturedAt: "asc" },
    select: { capturedAt: true, last: true },
  });

  if (rows.length === 0) {
    return { points: [], from: null, sessionsAvailable: 0 };
  }

  const bars = rows.map((r) => ({ timestamp: r.capturedAt.getTime(), value: r.last }));
  // Total distinct sessions across the FULL retention window, before slicing
  // to the requested `sessions` count — see `sessionsAvailable`'s own doc.
  const sessionsAvailable = groupBarsByIstSession(bars).length;
  const sliced = sliceToLastIstSessions(bars, sessions);

  return {
    points: sliced.map((b) => ({ t: b.timestamp, value: b.value })),
    from: sliced.length > 0 ? istDateString(sliced[0].timestamp) : null,
    sessionsAvailable,
  };
}
