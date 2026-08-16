import type { OpinionDirection } from "@prisma/client";

import { prisma } from "@/lib/prisma";
import { buildInstrumentWhereOr } from "@/lib/finance/instruments";

export type DominantLean = "BULLISH" | "BEARISH" | "NEUTRAL" | "MIXED";

export interface SentimentSplit {
  bullishCount: number;
  bearishCount: number;
  neutralCount: number;
  totalCount: number;
  bullishPercent: number;
  bearishPercent: number;
  neutralPercent: number;
  dominantLean: DominantLean;
  samplePeriod: "7d";
  scopedInstrument: string | null;
}

/**
 * Shared by every sentiment aggregator in the app — the homepage/instrument-
 * unfiltered 7-day split here AND /opinions' filtered, all-time split
 * (lib/finance/opinionsQuery.ts's fetchOpinionsSentimentSplit) — so the
 * percent-rounding and "what counts as a lean" rules can never drift apart
 * between the two.
 */
export function computeSentimentPercentages(
  bullishCount: number,
  bearishCount: number,
  neutralCount: number,
): { bullishPercent: number; bearishPercent: number; neutralPercent: number } {
  const totalCount = bullishCount + bearishCount + neutralCount;
  if (totalCount === 0) {
    return { bullishPercent: 0, bearishPercent: 0, neutralPercent: 0 };
  }
  return {
    bullishPercent: Math.round((bullishCount / totalCount) * 1000) / 10,
    bearishPercent: Math.round((bearishCount / totalCount) * 1000) / 10,
    neutralPercent: Math.round((neutralCount / totalCount) * 1000) / 10,
  };
}

export function computeDominantLean(
  bullishPercent: number,
  bearishPercent: number,
  neutralPercent: number,
): DominantLean {
  if (bullishPercent > 55) return "BULLISH";
  if (bearishPercent > 55) return "BEARISH";
  if (neutralPercent > 55) return "NEUTRAL";
  return "MIXED";
}

// ─── Cross-article duplicate-stance dedup (sentiment bias fix mechanism 3,
// 2026-08-16) ────────────────────────────────────────────────────────────
//
// Every sentiment AGGREGATE in the app previously counted raw `ExpertOpinion`
// ROWS. An analyst who restates the same bullish view on the same instrument
// across 3 articles in one week contributed 3 datapoints to every
// percentage/lean/score built from that window, not 1. This is NOT the same
// bug the extraction-time "ONE NET STANCE PER (EXPERT, INSTRUMENT)" prompt
// rule (and its code-side safety net, collapseGroup()) guards against — that
// rule only dedupes WITHIN a single article's extraction. A second article,
// next week, saying the same thing produces a second, entirely legitimate
// ExpertOpinion row — the row itself is correct and stays on record — it is
// the AGGREGATION layer reading N rows as N independent opinions that was
// wrong. Repeated stances remain legitimate opinion rows on record (the raw
// `/opinions` listing and every instrument page's opinion list are
// unaffected); only aggregates (percentages, dominant lean, weighted scores)
// change.

export interface DedupableOpinionRow {
  expertId: string;
  instrumentTicker: string | null;
  instrument: string | null;
  direction: OpinionDirection;
  publishedAt: Date;
}

/**
 * Instrument identity for the dedup key — mirrors the extraction-time dedup
 * key (`instrumentDedupKey()` in apps/api/lib/ai/extractExpertOpinions.ts)
 * for the same reason that one exists: `instrumentTicker` is the strong
 * identity when present (already canonicalized at write time by
 * `persistExpertOpinions`'s alias-resolution step — no need to re-normalize
 * on read, just uppercase for safety), but SECTOR-type opinions (e.g.
 * "Capital Goods") never get a ticker at all and must still dedupe correctly
 * by their `instrument` label.
 */
function dedupKey(r: { instrumentTicker: string | null; instrument: string | null }): string | null {
  if (r.instrumentTicker) return `t:${r.instrumentTicker.toUpperCase()}`;
  if (r.instrument) return `l:${r.instrument.toLowerCase().replace(/[^a-z0-9]/g, "")}`;
  return null; // no instrument identity at all — pass through unmerged, same convention
               // as instrumentDedupKey()'s own null-passthrough
}

/**
 * Collapses each analyst's repeated stances on the same instrument, within
 * whatever window/filter the caller already applied, to their single LATEST
 * row — so a restated view across N articles counts once, not N times, in
 * every sentiment percentage / dominant-lean / weighted-score computation.
 * Rows with no resolvable instrument identity pass through unmerged (should
 * be rare — validateRawOpinions rejects instrumentType=NONE at extraction
 * time, so `instrument` is populated for nearly every row).
 *
 * Deliberately NOT implemented via Prisma's `distinct` option — see
 * [[reference_prisma_distinct_emulation]]: `findMany({ distinct: [...] })` is
 * client-side-emulated (fetches and pages ALL matching rows before
 * deduping, no SQL-level DISTINCT ON/LIMIT), which caused a real 75s prod
 * regression once already. Every caller of this function fetches
 * minimal-column rows bounded by the same window/filter `where` clause it
 * already used before this fix, then dedupes in a single in-app pass —
 * cheap at the corpus's current size (~3,300 total ExpertOpinion rows
 * lifetime, so even a generously-windowed fetch is a small result set).
 */
export function dedupeToLatestStancePerExpertInstrument<T extends DedupableOpinionRow>(rows: T[]): T[] {
  const latestByKey = new Map<string, T>();
  const passthrough: T[] = [];
  for (const row of rows) {
    const instKey = dedupKey(row);
    if (!instKey) { passthrough.push(row); continue; }
    const key = `${row.expertId}::${instKey}`;
    const existing = latestByKey.get(key);
    if (!existing || row.publishedAt > existing.publishedAt) latestByKey.set(key, row);
  }
  return [...latestByKey.values(), ...passthrough];
}

/**
 * Portable port of apps/api/app/api/finance/expert-sentiment/route.ts — apps/web
 * renders this server-side (SSR/ISR) rather than fetching the API route over
 * HTTP, so the math is reimplemented here against the same Prisma models. KEEP
 * THE AGGREGATION LOGIC IN LOCKSTEP with that route; both must agree on what
 * counts as "this week's sentiment" (PENDING and RESOLVED both count — a call
 * made this week is a data point regardless of whether it later resolved).
 */
export async function getSentimentSplit(instrument?: string): Promise<SentimentSplit> {
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

  // findMany + in-app dedup, NOT groupBy — mechanism 3 (2026-08-16): a
  // groupBy({by:["direction"]}) counts raw rows, double-counting an analyst
  // who restated the same stance across multiple articles this week.
  const rows = await prisma.expertOpinion.findMany({
    where: {
      suppressedAt: null,
      publishedAt: { gte: sevenDaysAgo },
      ...(instrument ? { OR: buildInstrumentWhereOr(instrument) } : {}),
    },
    select: { expertId: true, instrumentTicker: true, instrument: true, direction: true, publishedAt: true },
  });
  const deduped = dedupeToLatestStancePerExpertInstrument(rows);

  const bullishCount = deduped.filter((r) => r.direction === "BULLISH").length;
  const bearishCount = deduped.filter((r) => r.direction === "BEARISH").length;
  const neutralCount = deduped.filter((r) => r.direction === "NEUTRAL").length;

  const totalCount = bullishCount + bearishCount + neutralCount;
  const { bullishPercent, bearishPercent, neutralPercent } = computeSentimentPercentages(
    bullishCount,
    bearishCount,
    neutralCount,
  );
  const dominantLean = computeDominantLean(bullishPercent, bearishPercent, neutralPercent);

  return {
    bullishCount,
    bearishCount,
    neutralCount,
    totalCount,
    bullishPercent,
    bearishPercent,
    neutralPercent,
    dominantLean,
    samplePeriod: "7d",
    scopedInstrument: instrument ?? null,
  };
}
