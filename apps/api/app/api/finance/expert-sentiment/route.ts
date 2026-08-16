import { NextResponse } from "next/server";

import type { OpinionDirection } from "@prisma/client";

import { prisma } from "@/lib/prisma";
import { getInstrumentVariants } from "@/lib/news/queries";

export const dynamic = "force-dynamic";

// ─── Cross-article duplicate-stance dedup (sentiment bias fix mechanism 3,
// 2026-08-16) — KEEP IN LOCKSTEP with apps/web/lib/finance/sentiment.ts's
// `dedupeToLatestStancePerExpertInstrument` (same pattern this route already
// uses to stay in lockstep with that file's `getSentimentSplit` for the
// aggregation math itself — apps/web has no shared Prisma-aware package with
// apps/api, so this is duplicated, not imported; see that file's own doc
// comment for the full mechanism-3 rationale). ─────────────────────────────

interface DedupableOpinionRow {
  expertId: string;
  instrumentTicker: string | null;
  instrument: string | null;
  direction: OpinionDirection;
  publishedAt: Date;
}

function dedupKey(r: { instrumentTicker: string | null; instrument: string | null }): string | null {
  if (r.instrumentTicker) return `t:${r.instrumentTicker.toUpperCase()}`;
  if (r.instrument) return `l:${r.instrument.toLowerCase().replace(/[^a-z0-9]/g, "")}`;
  return null;
}

function dedupeToLatestStancePerExpertInstrument<T extends DedupableOpinionRow>(rows: T[]): T[] {
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
 * GET /api/finance/expert-sentiment
 *
 * Returns an aggregate of all ExpertOpinion rows whose analyst made the call
 * in the last 7 days. Includes PENDING and RESOLVED — a call made this week
 * is a this-week data point regardless of whether it later resolved.
 *
 * Optional `?instrument=<canonical label>` scopes the aggregate to that
 * instrument (and all its known variants — see getInstrumentVariants) via
 * a case-insensitive match against instrument/instrumentTicker. This reuses
 * the same matching logic as the news feed's instrument filter so the gauge
 * and the feed always agree on which opinions belong to an instrument.
 *
 * No auth required — this is a public aggregate.
 */
export async function GET(request: Request) {
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const instrument = new URL(request.url).searchParams.get("instrument")?.trim() || undefined;

  // findMany + in-app dedup, NOT groupBy — mechanism 3 (2026-08-16): a
  // groupBy({by:["direction"]}) counts raw rows, double-counting an analyst
  // who restated the same stance across multiple articles this week. Minimal
  // columns only — never Prisma's `distinct` option (client-side-emulated,
  // see the dedup helper's own doc above).
  const rows = await prisma.expertOpinion.findMany({
    where: {
      suppressedAt: null,
      publishedAt: { gte: sevenDaysAgo },
      // Reuses the news feed's instrument-matching semantics (buildOpinionWhere
      // in lib/news/queries.ts): match ANY known variant on EITHER field, so
      // this must be an OR array, not AND — AND would require every variant to
      // match both fields simultaneously and return ~zero results.
      ...(instrument
        ? {
            OR: getInstrumentVariants(instrument).flatMap((v) => [
              { instrument: { contains: v, mode: "insensitive" as const } },
              { instrumentTicker: { contains: v, mode: "insensitive" as const } },
            ]),
          }
        : {}),
    },
    select: { expertId: true, instrumentTicker: true, instrument: true, direction: true, publishedAt: true },
  });
  const deduped = dedupeToLatestStancePerExpertInstrument(rows);

  const bullishCount = deduped.filter((r) => r.direction === "BULLISH").length;
  const bearishCount = deduped.filter((r) => r.direction === "BEARISH").length;
  const neutralCount = deduped.filter((r) => r.direction === "NEUTRAL").length;

  const totalCount = bullishCount + bearishCount + neutralCount;

  let bullishPercent = 0;
  let bearishPercent = 0;
  let neutralPercent = 0;

  if (totalCount > 0) {
    bullishPercent = Math.round((bullishCount / totalCount) * 1000) / 10; // 1 decimal
    bearishPercent = Math.round((bearishCount / totalCount) * 1000) / 10;
    neutralPercent = Math.round((neutralCount / totalCount) * 1000) / 10;
  }

  let dominantLean: "BULLISH" | "BEARISH" | "NEUTRAL" | "MIXED" = "MIXED";
  if (bullishPercent > 55) {
    dominantLean = "BULLISH";
  } else if (bearishPercent > 55) {
    dominantLean = "BEARISH";
  } else if (neutralPercent > 55) {
    dominantLean = "NEUTRAL";
  }

  const response = NextResponse.json({
    bullishCount,
    bearishCount,
    neutralCount,
    totalCount,
    bullishPercent,
    bearishPercent,
    neutralPercent,
    dominantLean,
    samplePeriod: "7d" as const,
    scopedInstrument: instrument ?? null,
  });
  response.headers.set("Cache-Control", "public, max-age=120, s-maxage=120");
  return response;
}
