/**
 * BSE Expansion Phase 1 (2026-08-12) — read-side for BseIndexEodQuote
 * (apps/api/lib/marketMoves/bseIndexEod.ts's module doc has the live-verified
 * ingestion source). Deliberately standalone: this does NOT extend
 * apps/web/lib/finance/instrument.ts's NSE index resolution chain
 * (hasLiveIndexPipe / indexLongTail / INDEX_UNIVERSE) or mint any
 * `/instruments/[symbol]` page. That resolver is large, actively evolving,
 * and load-bearing for every NSE index/equity page in prod — Phase 1's own
 * acceptance bar is "an ingested daily close, verifiable," not a full
 * instrument page (that promotion is explicitly Phase 2's job, gated on a
 * live Yahoo price-match check BSE indices haven't cleared yet). This file
 * backs a single minimal browse page (/bse-indices) instead.
 */

import { prisma } from "@/lib/prisma";

export interface BseIndexRow {
  indexName: string;
  sessionDate: Date;
  close: number;
  changeAbs: number;
  changePercent: number;
  previousClose: number | null;
  open: number | null;
  high: number | null;
  low: number | null;
  peRatio: number | null;
  pbRatio: number | null;
  dividendYield: number | null;
}

/**
 * Every BSE index's latest ingested session, sorted alphabetically by name.
 * Two-query shape (find the latest sessionDate, then fetch that day's full
 * set) rather than a groupBy — the same pattern indexLongTail.ts and
 * instrument.ts's own `metricsSnapshotRow` fetches use elsewhere in this
 * codebase, bounded to the live-verified ~130-160 row universe (never an
 * unbounded findMany). Returns an empty array (never throws) before the
 * cron/backfill have ever run.
 */
export async function fetchLatestBseIndices(): Promise<BseIndexRow[]> {
  const latest = await prisma.bseIndexEodQuote.findFirst({
    orderBy: { sessionDate: "desc" },
    select: { sessionDate: true },
  });
  if (!latest) return [];

  const rows = await prisma.bseIndexEodQuote.findMany({
    where: { sessionDate: latest.sessionDate },
    orderBy: { indexName: "asc" },
    select: {
      indexName: true,
      sessionDate: true,
      close: true,
      changeAbs: true,
      changePercent: true,
      previousClose: true,
      open: true,
      high: true,
      low: true,
      peRatio: true,
      pbRatio: true,
      dividendYield: true,
    },
  });
  return rows;
}
