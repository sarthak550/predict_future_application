/**
 * Growth Loop Sprint G4 — Scorecard-powered screener v1 (Decision 4).
 *
 * Filter-parsing follows the SAME URL-param-driven, stateless convention as
 * lib/finance/opinionsQuery.ts (parseOpinionsFilters), but this is its own
 * file rather than an extension of that one: /screener's filter dimensions
 * (window preset, min-graded-count dropdown, sentiment lean, sector) are a
 * fixed, static option set — no dynamically-computed cascading dropdown
 * counts the way /opinions' four filters narrow each other. Filters here
 * compose as independent AND clauses applied to the final aggregated
 * per-instrument rows, not a cascading N-way system — documented per the
 * brief's explicit "CTO's call, document which" ask.
 *
 * Query strategy — 5 groupBy/aggregate round trips, ALL independent of how
 * many distinct instruments exist in the corpus (never N+1 per instrument,
 * per the brief's explicit warning about this exact class of bug — see
 * [[reference_prisma_distinct_emulation]]):
 *   1. allCounts       — window calls (any status) by (ticker, direction) —
 *                        feeds the sentiment-lean filter/column.
 *   2. gradedCounts     — window calls (HIT/MISS only) by (ticker, direction)
 *                        — feeds column 3 (bull/bear/neutral graded counts)
 *                        and the min-graded-count filter.
 *   3. analystPairs     — window calls (any status) by (ticker, expertId) —
 *                        feeds the distinct-analyst-coverage column.
 *   4. scoreRows        — window GRADED, DIRECTIONAL (BULLISH/BEARISH) calls
 *                        by (ticker, direction, expertId) — feeds the
 *                        accuracy-weighted sentiment score.
 *   5. expertAllTime    — ALL-TIME (unwindowed) per-expert hit/resolved
 *                        counts by (expertId, resolutionStatus) — the Wilson
 *                        weight input for #4. ~500 experts at current corpus
 *                        size per the brief's own estimate — one cheap
 *                        groupBy, not a per-call lookup.
 * Plus 3 batch lookups (also O(1), not O(instruments)): instrument identity
 * (resolveInstrumentIdentities), sector labels (buildSectorIndex, shared
 * with /opinions), and InstrumentEnrichment.keyStats for the read-only
 * market-cap/P-E reference columns.
 *
 * Instrument identity: EVERY query groups by instrumentTicker (the resolved
 * canonical symbol), never the raw free-text `instrument` label — see this
 * file's own tests/spot-checks and the brief's explicit HAL/HINDALCO
 * cautionary note. A ticker with no resolved InstrumentAlias still gets a
 * best-effort bare symbol (same `.NS` regex opinionsQuery.ts's
 * buildSectorIndex already uses) so it can still link to /instruments/
 * [symbol] and pick up a sector; it just isn't fabricated a display name.
 */

import type { OpinionDirection } from "@prisma/client";
import { computeWilsonInterval, PROVISIONAL_MIN_RESOLVED_CALLS } from "@predict-future/business-rules";

import { prisma } from "@/lib/prisma";
import { buildSectorIndex } from "@/lib/finance/opinionsQuery";
import { resolveInstrumentIdentities } from "@/lib/finance/instrumentLink";
import { computeDominantLean, computeSentimentPercentages, type DominantLean } from "@/lib/finance/sentiment";
import {
  parseScreenerFilters,
  windowDays,
  SCREENER_WINDOW_OPTIONS,
  MIN_GRADED_OPTIONS,
  SENTIMENT_LEAN_OPTIONS,
  type ScreenerFilters,
  type ScreenerWindowKey,
  type SentimentLeanFilter,
} from "@/lib/finance/screenerFilters";

// Filters/option-constants live in screenerFilters.ts (client-safe — no
// Prisma import) — re-exported here so server-only callers (this file,
// app/screener/page.tsx) can import everything screener-related from one
// place without needing to know about the split. ScreenerFilterBar (a
// client component) imports screenerFilters.ts DIRECTLY instead, never this
// file — see that file's own doc comment for why.
export { parseScreenerFilters, windowDays, SCREENER_WINDOW_OPTIONS, MIN_GRADED_OPTIONS, SENTIMENT_LEAN_OPTIONS };
export type { ScreenerFilters, ScreenerWindowKey, SentimentLeanFilter };

// ─── Row shape ───────────────────────────────────────────────────────────────

export interface ScreenerRow {
  ticker: string;
  /** Bare NSE symbol for /instruments/[symbol] — null when unresolvable (commodities/FX/unrecognized tickers). */
  symbol: string | null;
  displayName: string;
  sector: string | null;
  bullishCount: number;
  bearishCount: number;
  neutralCount: number;
  distinctAnalystCount: number;
  /** null when fewer than 3 graded directional (BULLISH/BEARISH) calls in-window — render "insufficient track record". */
  score: number | null;
  dominantLean: DominantLean;
  marketCap?: number;
  trailingPE?: number;
}

/**
 * Main aggregate query. Returns EVERY instrument with >=1 call in the
 * window, already filtered/sorted per `filters` — sector, minGraded, and
 * lean all apply as independent AND clauses over the aggregated rows (not a
 * cascading dropdown-narrowing system, per this file's own doc comment).
 * Default sort: accuracy-weighted score descending, with "insufficient
 * track record" (score: null) rows sorted last, then by distinct-analyst
 * count descending, then ticker ascending — a stable, deterministic order.
 */
export async function fetchScreenerRows(filters: ScreenerFilters): Promise<ScreenerRow[]> {
  const windowStart = new Date(Date.now() - windowDays(filters.window) * 24 * 60 * 60 * 1000);
  const windowWhere = { suppressedAt: null, publishedAt: { gte: windowStart }, instrumentTicker: { not: null } } as const;

  const [allCounts, gradedCounts, analystPairs, scoreRows, expertAllTime] = await Promise.all([
    prisma.expertOpinion.groupBy({
      by: ["instrumentTicker", "direction"],
      where: windowWhere,
      _count: { _all: true },
    }),
    prisma.expertOpinion.groupBy({
      by: ["instrumentTicker", "direction"],
      where: { ...windowWhere, resolutionStatus: { in: ["RESOLVED_HIT", "RESOLVED_MISS"] } },
      _count: { _all: true },
    }),
    prisma.expertOpinion.groupBy({
      by: ["instrumentTicker", "expertId"],
      where: windowWhere,
    }),
    prisma.expertOpinion.groupBy({
      by: ["instrumentTicker", "direction", "expertId"],
      where: {
        ...windowWhere,
        resolutionStatus: { in: ["RESOLVED_HIT", "RESOLVED_MISS"] },
        direction: { in: ["BULLISH", "BEARISH"] },
      },
      _count: { _all: true },
    }),
    prisma.expertOpinion.groupBy({
      by: ["expertId", "resolutionStatus"],
      where: { resolutionStatus: { in: ["RESOLVED_HIT", "RESOLVED_MISS"] } },
      _count: { _all: true },
    }),
  ]);

  // Per-expert ALL-TIME Wilson-lower-bound weight (Decision 4's exact
  // formula) — computed once, reused for every call that expert made.
  const expertTotals = new Map<string, { hit: number; resolved: number }>();
  for (const row of expertAllTime) {
    const entry = expertTotals.get(row.expertId) ?? { hit: 0, resolved: 0 };
    entry.resolved += row._count._all;
    if (row.resolutionStatus === "RESOLVED_HIT") entry.hit += row._count._all;
    expertTotals.set(row.expertId, entry);
  }
  function expertWeight(expertId: string): number {
    const totals = expertTotals.get(expertId);
    if (!totals || totals.resolved < PROVISIONAL_MIN_RESOLVED_CALLS) return 0.5;
    return computeWilsonInterval(totals.hit, totals.resolved)?.lower ?? 0.5;
  }

  interface Accumulator {
    bullAll: number;
    bearAll: number;
    neutAll: number;
    bullGraded: number;
    bearGraded: number;
    neutGraded: number;
    analysts: Set<string>;
    scoreNumerator: number;
    scoreDenominator: number;
  }
  const byTicker = new Map<string, Accumulator>();
  function acc(ticker: string): Accumulator {
    let entry = byTicker.get(ticker);
    if (!entry) {
      entry = {
        bullAll: 0,
        bearAll: 0,
        neutAll: 0,
        bullGraded: 0,
        bearGraded: 0,
        neutGraded: 0,
        analysts: new Set(),
        scoreNumerator: 0,
        scoreDenominator: 0,
      };
      byTicker.set(ticker, entry);
    }
    return entry;
  }
  function addByDirection(entry: Accumulator, field: "All" | "Graded", direction: OpinionDirection, count: number) {
    if (field === "All") {
      if (direction === "BULLISH") entry.bullAll += count;
      else if (direction === "BEARISH") entry.bearAll += count;
      else entry.neutAll += count;
    } else {
      if (direction === "BULLISH") entry.bullGraded += count;
      else if (direction === "BEARISH") entry.bearGraded += count;
      else entry.neutGraded += count;
    }
  }

  for (const row of allCounts) {
    if (!row.instrumentTicker) continue;
    addByDirection(acc(row.instrumentTicker), "All", row.direction, row._count._all);
  }
  for (const row of gradedCounts) {
    if (!row.instrumentTicker) continue;
    addByDirection(acc(row.instrumentTicker), "Graded", row.direction, row._count._all);
  }
  for (const row of analystPairs) {
    if (!row.instrumentTicker) continue;
    acc(row.instrumentTicker).analysts.add(row.expertId);
  }
  for (const row of scoreRows) {
    if (!row.instrumentTicker) continue;
    const weight = expertWeight(row.expertId);
    const sign = row.direction === "BULLISH" ? 1 : -1;
    const entry = acc(row.instrumentTicker);
    entry.scoreNumerator += sign * weight * row._count._all;
    entry.scoreDenominator += weight * row._count._all;
  }

  const tickers = [...byTicker.keys()];
  if (tickers.length === 0) return [];

  const [identities, { tickerToSector }] = await Promise.all([
    resolveInstrumentIdentities(tickers.map((t) => ({ instrumentTicker: t, instrument: null }))),
    buildSectorIndex(),
  ]);

  const bareSymbolFallback = (ticker: string): string | null => {
    const m = /^([A-Z0-9&-]+)\.NS$/i.exec(ticker);
    return m ? m[1].toUpperCase() : null;
  };

  const bareSymbols = new Set<string>();
  for (const ticker of tickers) {
    const symbol = identities.get(ticker)?.symbol ?? bareSymbolFallback(ticker);
    if (symbol) bareSymbols.add(symbol);
  }
  const enrichmentRows =
    bareSymbols.size > 0
      ? await prisma.instrumentEnrichment.findMany({
          where: { symbol: { in: [...bareSymbols] } },
          select: { symbol: true, keyStats: true },
        })
      : [];
  const keyStatsBySymbol = new Map(
    enrichmentRows.map((r) => [r.symbol, r.keyStats as { marketCap?: number; trailingPE?: number } | null]),
  );

  const rows: ScreenerRow[] = tickers.map((ticker) => {
    const entry = byTicker.get(ticker)!;
    const identity = identities.get(ticker);
    const symbol = identity?.symbol ?? bareSymbolFallback(ticker);
    const displayName = identity?.canonicalName ?? symbol ?? ticker;
    const sector = tickerToSector.get(ticker) ?? null;

    const { bullishPercent, bearishPercent, neutralPercent } = computeSentimentPercentages(
      entry.bullAll,
      entry.bearAll,
      entry.neutAll,
    );
    const dominantLean = computeDominantLean(bullishPercent, bearishPercent, neutralPercent);

    const gradedDirectionalCount = entry.bullGraded + entry.bearGraded;
    const score = gradedDirectionalCount >= PROVISIONAL_MIN_RESOLVED_CALLS && entry.scoreDenominator > 0
      ? entry.scoreNumerator / entry.scoreDenominator
      : null;

    const keyStats = symbol ? keyStatsBySymbol.get(symbol) : undefined;

    return {
      ticker,
      symbol,
      displayName,
      sector,
      bullishCount: entry.bullGraded,
      bearishCount: entry.bearGraded,
      neutralCount: entry.neutGraded,
      distinctAnalystCount: entry.analysts.size,
      score,
      dominantLean,
      marketCap: keyStats?.marketCap,
      trailingPE: keyStats?.trailingPE,
    };
  });

  const totalGradedByTicker = (r: ScreenerRow) => r.bullishCount + r.bearishCount + r.neutralCount;

  const filtered = rows.filter((r) => {
    if (filters.sector && r.sector !== filters.sector) return false;
    if (filters.lean && r.dominantLean !== filters.lean) return false;
    if (filters.minGraded > 0 && totalGradedByTicker(r) < filters.minGraded) return false;
    return true;
  });

  filtered.sort((a, b) => {
    if (a.score === null && b.score === null) {
      return b.distinctAnalystCount - a.distinctAnalystCount || a.ticker.localeCompare(b.ticker);
    }
    if (a.score === null) return 1;
    if (b.score === null) return -1;
    return b.score - a.score || b.distinctAnalystCount - a.distinctAnalystCount || a.ticker.localeCompare(b.ticker);
  });

  return filtered;
}
