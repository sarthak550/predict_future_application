import type { OpinionDirection, OpinionResolutionStatus, Prisma } from "@prisma/client";
import { canonicalizeInstrument } from "@predict-future/business-rules";
import { canonicalizeOrgDisplay } from "@predict-future/business-rules/experts/firmAliases";

import { prisma } from "@/lib/prisma";
import { buildInstrumentWhereOr } from "@/lib/finance/instruments";

export const OPINIONS_PAGE_SIZE = 25;

export type OpinionStatusFilter = "graded" | "pending";

export interface OpinionsFilters {
  instrument?: string;
  direction?: OpinionDirection;
  status?: OpinionStatusFilter;
  /** Expert slug, not id — matches the public URL shape used everywhere else (/analysts/[slug]). */
  analyst?: string;
  page: number;
}

const VALID_DIRECTIONS: readonly OpinionDirection[] = ["BULLISH", "BEARISH", "NEUTRAL"];

/**
 * Parses ?instrument=&direction=&status=&analyst=&page= from a page's raw
 * searchParams into a typed, validated filter set. Unknown/invalid values are
 * dropped rather than erroring — a malformed query string degrades to "no
 * filter" instead of a 500.
 */
export function parseOpinionsFilters(searchParams: Record<string, string | string[] | undefined>): OpinionsFilters {
  const get = (key: string): string | undefined => {
    const raw = searchParams[key];
    return Array.isArray(raw) ? raw[0] : raw;
  };

  const directionRaw = get("direction")?.toUpperCase();
  const direction = VALID_DIRECTIONS.includes(directionRaw as OpinionDirection)
    ? (directionRaw as OpinionDirection)
    : undefined;

  const statusRaw = get("status");
  const status: OpinionStatusFilter | undefined =
    statusRaw === "graded" || statusRaw === "pending" ? statusRaw : undefined;

  const instrument = get("instrument")?.trim() || undefined;
  const analyst = get("analyst")?.trim() || undefined;

  const pageRaw = Number.parseInt(get("page") ?? "1", 10);
  const page = Number.isFinite(pageRaw) && pageRaw > 0 ? pageRaw : 1;

  return { instrument, direction, status, analyst, page };
}

/** True if any filter/pagination param beyond the bare unfiltered first page is active. */
export function hasActiveOpinionsQuery(filters: OpinionsFilters): boolean {
  return Boolean(filters.instrument || filters.direction || filters.status || filters.analyst) || filters.page > 1;
}

const GRADED_STATUSES: OpinionResolutionStatus[] = ["RESOLVED_HIT", "RESOLVED_MISS"];

function buildWhere(filters: OpinionsFilters): Prisma.ExpertOpinionWhereInput {
  return {
    suppressedAt: null,
    ...(filters.instrument ? { OR: buildInstrumentWhereOr(filters.instrument) } : {}),
    ...(filters.direction ? { direction: filters.direction } : {}),
    ...(filters.status === "graded" ? { resolutionStatus: { in: GRADED_STATUSES } } : {}),
    ...(filters.status === "pending" ? { resolutionStatus: "PENDING" as const } : {}),
    ...(filters.analyst ? { expert: { slug: filters.analyst } } : {}),
  };
}

export async function fetchOpinionsPage(filters: OpinionsFilters) {
  const where = buildWhere(filters);
  const skip = (filters.page - 1) * OPINIONS_PAGE_SIZE;

  const rows = await prisma.expertOpinion.findMany({
    where,
    orderBy: { publishedAt: "desc" },
    skip,
    take: OPINIONS_PAGE_SIZE + 1,
    select: {
      id: true,
      quote: true,
      headline: true,
      instrument: true,
      instrumentTicker: true,
      direction: true,
      sourceUrl: true,
      publishedAt: true,
      resolutionStatus: true,
      resolutionNote: true,
      resolvedAt: true,
      expert: { select: { name: true, slug: true, organization: true } },
    },
  });

  const hasMore = rows.length > OPINIONS_PAGE_SIZE;
  const items = (hasMore ? rows.slice(0, OPINIONS_PAGE_SIZE) : rows).map((row) => ({
    ...row,
    expert: { ...row.expert, organization: canonicalizeOrgDisplay(row.expert.organization) },
  }));

  return { items, hasMore, page: filters.page };
}

/** For the analyst filter select — every indexable-or-not expert with at least one public opinion. */
export async function fetchAnalystOptions() {
  return prisma.expert.findMany({
    where: { slug: { not: null }, opinions: { some: { suppressedAt: null } } },
    select: { slug: true, name: true },
    orderBy: { name: "asc" },
  });
}

/**
 * For the instrument filter select — the set of raw `instrument` labels is
 * effectively free text (AI-extracted per call), so we canonicalize +
 * dedupe rather than exposing every raw variant as its own option. Bounded
 * by the number of distinct instruments ever called (small in practice).
 */
export async function fetchInstrumentOptions(): Promise<string[]> {
  const rows = await prisma.expertOpinion.findMany({
    where: { instrument: { not: null }, suppressedAt: null },
    distinct: ["instrument"],
    select: { instrument: true },
  });

  const canonical = new Set<string>();
  for (const row of rows) {
    if (row.instrument) {
      canonical.add(canonicalizeInstrument(row.instrument.trim()));
    }
  }
  return [...canonical].sort((a, b) => a.localeCompare(b));
}
