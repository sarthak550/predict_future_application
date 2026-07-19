import { INSTRUMENT_NORMALIZATION_MAP } from "@predict-future/business-rules";

/**
 * Portable re-implementation of apps/api/lib/news/queries.ts#getInstrumentVariants
 * (apps/web cannot import apps/api's server code — separate deployable). Given a
 * canonical instrument label, returns every raw label that normalizes to it, so a
 * Prisma `contains` filter against ExpertOpinion.instrument/instrumentTicker can
 * match any known spelling. Reuses the same INSTRUMENT_NORMALIZATION_MAP as
 * @predict-future/business-rules' canonicalizeInstrument, so the two stay in
 * agreement by construction — never fork this map.
 *
 * Examples:
 *   getInstrumentVariants("SBI")   → ["SBI", "State Bank of India"]
 *   getInstrumentVariants("Gold")  → ["Gold", "Gold Futures"]
 */
export function getInstrumentVariants(canonical: string): string[] {
  const variants: string[] = [canonical];
  for (const [raw, mapped] of Object.entries(INSTRUMENT_NORMALIZATION_MAP)) {
    if (mapped === canonical) {
      variants.push(raw);
    }
  }
  return variants;
}

/**
 * Prisma `OR` fragment matching any variant of `instrument` against either the
 * instrument label or ticker field, case-insensitive substring — mirrors the
 * exact semantics apps/api's buildOpinionWhere/expert-sentiment route use, so
 * the web app's instrument filter always agrees with the mobile app's.
 */
export function buildInstrumentWhereOr(instrument: string) {
  return getInstrumentVariants(instrument).flatMap((v) => [
    { instrument: { contains: v, mode: "insensitive" as const } },
    { instrumentTicker: { contains: v, mode: "insensitive" as const } },
  ]);
}
