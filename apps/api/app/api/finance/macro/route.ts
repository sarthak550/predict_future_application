/**
 * GET /api/finance/macro
 *
 * Returns the latest India Macro snapshot from the `MacroSnapshot` warm store.
 * Does NOT hit IMF or RBI live — serves the row written by the daily cron.
 *
 * Response shape:
 * ```json
 * {
 *   "rbi": {
 *     "repoRate": 6.5,
 *     "crr": 4.0,
 *     "slr": 18.0
 *   },
 *   "imf": {
 *     "gdpGrowth": 6.5,
 *     "gdpGrowthYear": 2026,
 *     "cpiInflation": 4.2,
 *     "cpiInflationYear": 2026
 *   },
 *   "asOf": "2026-07-04T06:00:00.000Z"
 * }
 * ```
 * Any of the individual values may be `null` if the cron has not yet successfully
 * fetched that figure (or if the singleton row doesn't exist yet — returns 404).
 *
 * `asOf` is the most recent of rbiFetchedAt and imfFetchedAt — the timestamp the
 * mobile card uses for "Updated d Mon".
 *
 * Public endpoint — no auth required. Client caches with AsyncStorage.
 */

import { NextResponse } from "next/server";

import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export async function GET() {
  const snapshot = await prisma.macroSnapshot.findUnique({
    where: { key: "singleton" },
  });

  if (!snapshot) {
    return NextResponse.json(
      { error: "No macro snapshot available yet. Run the cron to seed data." },
      { status: 404 }
    );
  }

  // asOf: pick the most recent of the two fetch timestamps.
  const timestamps: Date[] = [];
  if (snapshot.rbiFetchedAt) timestamps.push(snapshot.rbiFetchedAt);
  if (snapshot.imfFetchedAt) timestamps.push(snapshot.imfFetchedAt);
  const asOf =
    timestamps.length > 0
      ? new Date(Math.max(...timestamps.map((t) => t.getTime()))).toISOString()
      : null;

  return NextResponse.json({
    rbi: {
      repoRate: snapshot.repoRate,
      crr: snapshot.crr,
      slr: snapshot.slr,
    },
    imf: {
      gdpGrowth: snapshot.gdpGrowth,
      gdpGrowthYear: snapshot.gdpGrowthYear,
      cpiInflation: snapshot.cpiInflation,
      cpiInflationYear: snapshot.cpiInflationYear,
    },
    asOf,
  });
}
