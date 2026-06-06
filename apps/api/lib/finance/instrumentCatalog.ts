/**
 * Instrument catalog: normalization map + catalog builder.
 *
 * Used by GET /api/finance/instruments to return a sorted, de-duped list of
 * all instruments that have non-suppressed ExpertOpinion rows, with opinion
 * counts and popularity flags.
 *
 * NORMALIZATION_MAP collapses known label variants produced by the AI extraction
 * pipeline into a single canonical display name. Future AI extraction improvements
 * may produce new variants — add them here so the catalog stays clean without
 * needing a data migration.
 *
 * Key: raw instrument label as stored in the DB (case-sensitive match).
 * Value: canonical display label shown to users.
 */
export const NORMALIZATION_MAP: Record<string, string> = {
  // Nifty index variants
  "Nifty 50 Index": "Nifty 50",
  "Nifty IT Index": "Nifty IT",
  "Bank Nifty Index": "Bank Nifty",
  // Indian blue-chip equities — AI sometimes uses full legal names
  "State Bank of India": "SBI",
  "Larsen & Toubro": "L&T",
  // Commodity futures — AI sometimes appends "Futures"
  "Gold Futures": "Gold",
  "Crude Oil Futures": "Crude Oil",
};

/**
 * Returns the canonical label for a raw instrument string.
 * Falls through to the raw label unchanged when no mapping exists.
 */
export function canonicalize(label: string): string {
  return NORMALIZATION_MAP[label] ?? label;
}

import type { PrismaClient } from "@prisma/client";
import type { ApiInstrumentCatalogItem } from "@predict-future/types";

/**
 * Builds the instrument catalog from live DB data.
 *
 * Steps:
 * 1. groupBy ExpertOpinion WHERE suppressedAt IS NULL, grouped by
 *    (instrument, instrumentTicker) — null rows excluded at query level.
 * 2. For each group, normalize the label through NORMALIZATION_MAP.
 * 3. Aggregate counts under the canonical label, keeping the first ticker seen
 *    for each canonical label (tickers for the same instrument are identical in
 *    practice; first-seen is stable enough for catalog display).
 * 4. Sort descending by count.
 * 5. Mark the top 10 as isPopular: true.
 */
export async function buildInstrumentCatalog(
  prisma: PrismaClient
): Promise<ApiInstrumentCatalogItem[]> {
  const groups = await prisma.expertOpinion.groupBy({
    by: ["instrument", "instrumentTicker"],
    where: {
      suppressedAt: null,
      // Exclude rows where the instrument label is null/empty — they carry no
      // useful catalog signal and would produce a blank entry in the picker.
      instrument: { not: null },
    },
    _count: { _all: true },
  });

  // Aggregate counts under canonical labels.
  const catalogMap = new Map<string, { ticker: string; count: number }>();

  for (const group of groups) {
    // Already filtered above, but guard defensively so TS is satisfied.
    if (!group.instrument) continue;

    const canonical = canonicalize(group.instrument);
    const existing = catalogMap.get(canonical);

    if (existing) {
      existing.count += group._count._all;
    } else {
      catalogMap.set(canonical, {
        // Use the ticker from the first group that maps to this canonical label.
        // If instrumentTicker is null (legacy rows), fall back to empty string
        // so the row is still included — the label is still useful for filtering.
        ticker: group.instrumentTicker ?? "",
        count: group._count._all,
      });
    }
  }

  // Sort descending by count.
  const sorted = [...catalogMap.entries()].sort(
    ([, a], [, b]) => b.count - a.count
  );

  return sorted.map(([label, { ticker, count }], index) => ({
    label,
    ticker,
    count,
    isPopular: index < 10,
  }));
}
