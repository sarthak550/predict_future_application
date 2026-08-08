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
  /** Canonical org display string, e.g. "Motilal Oswal Financial Services" — the SAME ?firm= value shape /analysts uses (see lib/finance/firmLink.ts, buildFirmOptions). */
  firm?: string;
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
  const firm = get("firm")?.trim() || undefined;

  const pageRaw = Number.parseInt(get("page") ?? "1", 10);
  const page = Number.isFinite(pageRaw) && pageRaw > 0 ? pageRaw : 1;

  return { instrument, direction, status, analyst, firm, page };
}

/** True if any filter/pagination param beyond the bare unfiltered first page is active. */
export function hasActiveOpinionsQuery(filters: OpinionsFilters): boolean {
  return (
    Boolean(filters.instrument || filters.direction || filters.status || filters.analyst || filters.firm) ||
    filters.page > 1
  );
}

const GRADED_STATUSES: OpinionResolutionStatus[] = ["RESOLVED_HIT", "RESOLVED_MISS"];

/**
 * Distinct raw `organization` strings used by opinion-having HUMAN experts,
 * grouped by their canonical display form (canonicalizeOrgDisplay — the SAME
 * canonicalization /analysts applies via lib/finance/analysts.ts). Backs
 * BOTH the /opinions firm filter's dropdown counts (fetchOpinionFirmOptions)
 * and its server-side WHERE resolution (a canonical firm like "Motilal Oswal
 * Financial Services" isn't a column value — it's a display-time merge of
 * one or more raw org strings, e.g. "MOFSL" — so filtering by it means
 * resolving back to every raw variant first). One query shared by both so
 * the dropdown's counts and the actual filterable set can never drift apart.
 *
 * Scoped to entityKind=HUMAN with a public (non-suppressed) opinion, mirroring
 * fetchIndexableAnalysts' HUMAN-only convention (entityKind=FIRM rows are
 * publication/desk identities displayed as "Market Analysis from X", not a
 * person with a firm — see analysts.ts's own note on this) and this page's
 * own suppressedAt exclusion.
 */
async function fetchOpinionOrgGroups(): Promise<Map<string, { count: number; rawOrganizations: string[] }>> {
  const rows = await prisma.expertOpinion.findMany({
    where: { suppressedAt: null, expert: { entityKind: "HUMAN" } },
    select: { expert: { select: { organization: true } } },
  });

  const groups = new Map<string, { count: number; rawOrganizations: string[] }>();
  for (const row of rows) {
    const canonical = canonicalizeOrgDisplay(row.expert.organization);
    const entry = groups.get(canonical);
    if (entry) {
      entry.count += 1;
      if (!entry.rawOrganizations.includes(row.expert.organization)) {
        entry.rawOrganizations.push(row.expert.organization);
      }
    } else {
      groups.set(canonical, { count: 1, rawOrganizations: [row.expert.organization] });
    }
  }
  return groups;
}

export type OpinionFirmOption = { firm: string; count: number };

/**
 * Firm filter dropdown options for /opinions — canonical firms present among
 * opinion-having HUMAN experts, counted by OPINIONS (not analysts, unlike
 * /analysts' buildFirmOptions), sorted by count desc then name. Same
 * `?firm=` value shape as /analysts' options so a link built from either
 * page's dropdown is interoperable with the other.
 */
export async function fetchOpinionFirmOptions(): Promise<OpinionFirmOption[]> {
  const groups = await fetchOpinionOrgGroups();
  return [...groups.entries()]
    .map(([firm, { count }]) => ({ firm, count }))
    .sort((a, b) => b.count - a.count || a.firm.localeCompare(b.firm));
}

function buildWhere(filters: OpinionsFilters, firmOrganizations: string[] | undefined): Prisma.ExpertOpinionWhereInput {
  // Both `analyst` and `firm` constrain `expert`, so they're merged into a
  // single expert sub-object rather than two separate spreads — two object-
  // literal spreads under the same `expert` key would silently let the
  // second clobber the first, dropping whichever filter lost.
  const expertWhere: Prisma.ExpertWhereInput = {};
  if (filters.analyst) expertWhere.slug = filters.analyst;
  if (filters.firm) expertWhere.organization = { in: firmOrganizations ?? [] };

  return {
    suppressedAt: null,
    ...(filters.instrument ? { OR: buildInstrumentWhereOr(filters.instrument) } : {}),
    ...(filters.direction ? { direction: filters.direction } : {}),
    ...(filters.status === "graded" ? { resolutionStatus: { in: GRADED_STATUSES } } : {}),
    ...(filters.status === "pending" ? { resolutionStatus: "PENDING" as const } : {}),
    ...(Object.keys(expertWhere).length > 0 ? { expert: expertWhere } : {}),
  };
}

export async function fetchOpinionsPage(filters: OpinionsFilters) {
  // Resolved once, only when a firm filter is active — an unfiltered browse
  // (the common case) pays no extra query. An unrecognized/stale ?firm=
  // value resolves to an empty array, which Prisma's `organization: { in: [] }`
  // correctly turns into zero rows rather than an error.
  const firmOrganizations = filters.firm ? (await fetchOpinionOrgGroups()).get(filters.firm)?.rawOrganizations : undefined;
  const where = buildWhere(filters, firmOrganizations);
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
