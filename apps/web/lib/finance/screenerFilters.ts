/**
 * Growth Loop Sprint G4 — /screener's filter constants, types, and URL-param
 * parsing. Split out from screenerQuery.ts DELIBERATELY: screenerQuery.ts
 * imports `@/lib/prisma` (server-only — pulls in `fs`/`path` to read
 * credentials), and ScreenerFilterBar ("use client") needs these constants
 * to render its <select> options. Importing screenerQuery.ts directly from
 * a client component drags the Prisma client into the browser bundle and
 * breaks the build ("Module not found: Can't resolve 'fs'") — caught live
 * while smoke-testing this ticket. This file has zero server-only
 * dependencies and is safe to import from either side of the boundary.
 */

export const SCREENER_WINDOW_OPTIONS = [
  { key: "7d", label: "7d", days: 7 },
  { key: "30d", label: "30d", days: 30 },
  { key: "90d", label: "90d", days: 90 },
] as const;
export type ScreenerWindowKey = (typeof SCREENER_WINDOW_OPTIONS)[number]["key"];
const DEFAULT_WINDOW: ScreenerWindowKey = "30d";

export const MIN_GRADED_OPTIONS = [
  { value: 0, label: "Any" },
  { value: 3, label: "3+" },
  { value: 5, label: "5+" },
  { value: 10, label: "10+" },
] as const;
const VALID_MIN_GRADED = new Set(MIN_GRADED_OPTIONS.map((o) => o.value));

export const SENTIMENT_LEAN_OPTIONS = [
  { value: "BULLISH", label: "Bullish-leaning" },
  { value: "BEARISH", label: "Bearish-leaning" },
  { value: "MIXED", label: "Mixed" },
] as const;
export type SentimentLeanFilter = (typeof SENTIMENT_LEAN_OPTIONS)[number]["value"];
const VALID_LEANS = new Set(SENTIMENT_LEAN_OPTIONS.map((o) => o.value));

export interface ScreenerFilters {
  window: ScreenerWindowKey;
  /** 0 means "any" (no filter). */
  minGraded: number;
  lean?: SentimentLeanFilter;
  /** One of CANONICAL_SECTOR_LABELS. */
  sector?: string;
}

export function parseScreenerFilters(searchParams: Record<string, string | string[] | undefined>): ScreenerFilters {
  const get = (key: string): string | undefined => {
    const raw = searchParams[key];
    return Array.isArray(raw) ? raw[0] : raw;
  };

  const windowRaw = get("window");
  const window: ScreenerWindowKey = SCREENER_WINDOW_OPTIONS.some((o) => o.key === windowRaw)
    ? (windowRaw as ScreenerWindowKey)
    : DEFAULT_WINDOW;

  const minGradedRaw = Number.parseInt(get("minGraded") ?? "", 10);
  const minGraded = VALID_MIN_GRADED.has(minGradedRaw as 0 | 3 | 5 | 10) ? minGradedRaw : 0;

  const leanRaw = get("lean")?.toUpperCase();
  const lean = VALID_LEANS.has(leanRaw as SentimentLeanFilter) ? (leanRaw as SentimentLeanFilter) : undefined;

  const sector = get("sector")?.trim() || undefined;

  return { window, minGraded, lean, sector };
}

export function windowDays(window: ScreenerWindowKey): number {
  return SCREENER_WINDOW_OPTIONS.find((o) => o.key === window)?.days ?? SCREENER_WINDOW_OPTIONS[1].days;
}
