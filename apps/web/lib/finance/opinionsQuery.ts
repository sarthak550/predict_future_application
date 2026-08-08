import type { OpinionDirection, OpinionResolutionStatus, Prisma } from "@prisma/client";
import { canonicalizeInstrument } from "@predict-future/business-rules";
import { canonicalizeOrgDisplay } from "@predict-future/business-rules/experts/firmAliases";

import { prisma } from "@/lib/prisma";
import { buildInstrumentWhereOr } from "@/lib/finance/instruments";
import { computeDominantLean, computeSentimentPercentages, type DominantLean } from "@/lib/finance/sentiment";

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

/**
 * True if a filter OTHER than direction (or page, which doesn't change the
 * matched set) is active. Deliberately excludes `direction` — see
 * fetchOpinionsSentimentSplit's doc comment: the sentiment bar drops
 * direction from its own aggregate, so a direction-ONLY filter shouldn't
 * switch it out of the default market-wide/7-day view either. Used by
 * opinions/page.tsx to decide which sentiment data source to render.
 */
export function hasNonDirectionOpinionsFilter(filters: OpinionsFilters): boolean {
  return Boolean(filters.instrument || filters.status || filters.analyst || filters.firm);
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
 *
 * Cascading (founder ask, 2026-08-08: "once user selects the firm name, can
 * we make sure the analyst names should be accordingly shown there" — and
 * symmetrically, an analyst pick narrows the firm dropdown too): pass
 * `narrowToAnalystSlug` when an analyst is selected and no firm is active yet
 * to collapse the list to that analyst's own (single) firm, with the count
 * being that analyst's own opinion count rather than the whole firm's. This
 * is intentionally NOT called with an analyst when a firm is already active
 * — the firm is the more specific/dominant filter in that case (see
 * fetchOpinionsPage's mismatched-pair handling below), so its own dropdown
 * always shows the full firm list rather than collapsing to one option a
 * user might then feel stuck with.
 */
export async function fetchOpinionFirmOptions(narrowToAnalystSlug?: string): Promise<OpinionFirmOption[]> {
  if (narrowToAnalystSlug) {
    const expert = await prisma.expert.findFirst({
      where: { slug: narrowToAnalystSlug, entityKind: "HUMAN" },
      select: { organization: true, _count: { select: { opinions: { where: { suppressedAt: null } } } } },
    });
    if (!expert || expert._count.opinions === 0) return [];
    return [{ firm: canonicalizeOrgDisplay(expert.organization), count: expert._count.opinions }];
  }

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

/**
 * Mismatched-pair guard: the filter bar's cascading dropdowns are supposed to
 * make an incompatible firm+analyst combination unreachable by clicking
 * (picking a firm clears an analyst outside it, and picking an analyst
 * narrows the firm list to theirs), but a hand-built or stale-bookmarked URL
 * can still land here with both set and disagreeing. That pair would
 * otherwise silently resolve to zero rows (analyst.slug = X AND organization
 * IN <firm's orgs>, which never both hold). Rather than serving a confusing
 * "no calls match" page — or erroring — we drop the analyst and treat it as
 * firm-only: the firm is the more specific/dominant signal when the two
 * disagree, same precedence fetchOpinionFirmOptions' narrowToAnalystSlug skip
 * already encodes.
 *
 * Shared by fetchOpinionsPage (the table) AND fetchOpinionsSentimentSplit
 * (the sentiment bar above it) — both MUST resolve to the identical
 * effective analyst, or the bar's "n" could disagree with the table's total
 * on exactly this edge case.
 */
async function resolveEffectiveAnalyst(filters: OpinionsFilters): Promise<string | undefined> {
  if (!filters.firm || !filters.analyst) return filters.analyst;
  const analystExpert = await prisma.expert.findFirst({
    where: { slug: filters.analyst },
    select: { organization: true },
  });
  const analystFirm = analystExpert ? canonicalizeOrgDisplay(analystExpert.organization) : undefined;
  return analystFirm === filters.firm ? filters.analyst : undefined;
}

export async function fetchOpinionsPage(filters: OpinionsFilters) {
  // Resolved once, only when a firm filter is active — an unfiltered browse
  // (the common case) pays no extra query. An unrecognized/stale ?firm=
  // value resolves to an empty array, which Prisma's `organization: { in: [] }`
  // correctly turns into zero rows rather than an error.
  const firmOrganizations = filters.firm ? (await fetchOpinionOrgGroups()).get(filters.firm)?.rawOrganizations : undefined;
  const effectiveAnalyst = await resolveEffectiveAnalyst(filters);

  const where = buildWhere({ ...filters, analyst: effectiveAnalyst }, firmOrganizations);
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

const STATUS_SCOPE_LABELS: Record<OpinionStatusFilter, string> = {
  graded: "graded calls",
  pending: "pending calls",
};

export interface OpinionsSentimentSplit {
  bullishCount: number;
  bearishCount: number;
  neutralCount: number;
  totalCount: number;
  bullishPercent: number;
  bearishPercent: number;
  neutralPercent: number;
  dominantLean: DominantLean;
  /** Short, truncation-safe scope description, e.g. "Sentiment · Rahul Shah". Always non-empty — callers only invoke this when at least one non-direction filter is active. */
  scopeLabel: string;
  /** totalCount is small enough (<5) that the bar should disclose its basis rather than read as authoritative. */
  isSmallSample: boolean;
}

/**
 * Sentiment split for /opinions, recomputed against the SAME filters as the
 * table rendered below it (instrument, firm, analyst, grading status) — with
 * one deliberate exception: `direction`. Filtering the bar's own aggregate by
 * direction would be a tautology (picking "Bullish" would always render a
 * 100% bullish bar), so direction is dropped before building the WHERE
 * clause here — the bar always shows the FULL bullish/bearish/neutral split
 * within whatever OTHER filters are active. It's the caller's job
 * (opinions/page.tsx) to only invoke this function when a non-direction
 * filter is active in the first place; when direction is the only active
 * filter (or nothing is), the caller falls back to the unfiltered
 * getSentimentSplit (lib/finance/sentiment.ts)'s 7-day market-wide split
 * instead, unchanged from before this filter-aware bar existed.
 *
 * Deliberately ALL-TIME (no 7-day window), unlike getSentimentSplit — the
 * whole point of this function is for `totalCount` to equal the table's own
 * total-matching-rows count (every row has exactly one direction, so
 * bullish+bearish+neutral IS that total) so the bar's basis stays legible:
 * "this bar is built from exactly the N calls in the table below," not a
 * silently different, time-boxed subset of them.
 *
 * Reuses buildWhere (the same private where-builder fetchOpinionsPage uses)
 * and resolveEffectiveAnalyst (the same mismatched firm+analyst-pair guard)
 * so the two can never disagree on what counts as "the filtered set." One
 * groupBy for the counts, run in parallel with the (only-when-needed) label
 * lookup — no per-opinion queries.
 */
export async function fetchOpinionsSentimentSplit(filters: OpinionsFilters): Promise<OpinionsSentimentSplit> {
  const firmOrganizations = filters.firm ? (await fetchOpinionOrgGroups()).get(filters.firm)?.rawOrganizations : undefined;
  const effectiveAnalyst = await resolveEffectiveAnalyst(filters);

  const where = buildWhere({ ...filters, analyst: effectiveAnalyst, direction: undefined }, firmOrganizations);

  const [directionCounts, analystExpert] = await Promise.all([
    prisma.expertOpinion.groupBy({ by: ["direction"], where, _count: { _all: true } }),
    effectiveAnalyst ? prisma.expert.findFirst({ where: { slug: effectiveAnalyst }, select: { name: true } }) : null,
  ]);

  const bullishCount = directionCounts.find((c) => c.direction === "BULLISH")?._count._all ?? 0;
  const bearishCount = directionCounts.find((c) => c.direction === "BEARISH")?._count._all ?? 0;
  const neutralCount = directionCounts.find((c) => c.direction === "NEUTRAL")?._count._all ?? 0;
  const totalCount = bullishCount + bearishCount + neutralCount;

  const { bullishPercent, bearishPercent, neutralPercent } = computeSentimentPercentages(
    bullishCount,
    bearishCount,
    neutralCount,
  );
  const dominantLean = computeDominantLean(bullishPercent, bearishPercent, neutralPercent);

  // Scope label parts, most-specific first. An analyst filter implies a firm
  // (they only ever belong to one), so when both resolve to the same person
  // we show ONLY the analyst's name rather than stacking "Firm · Analyst" —
  // shorter, and the firm is one click away on their profile anyway. If the
  // mismatched-pair guard above dropped the analyst, `effectiveAnalyst` is
  // undefined and we correctly fall back to the firm alone, matching what
  // the WHERE clause actually filtered on.
  const scopeParts: string[] = [];
  if (effectiveAnalyst) {
    scopeParts.push(analystExpert?.name ?? filters.analyst ?? "");
  } else if (filters.firm) {
    scopeParts.push(filters.firm);
  }
  if (filters.instrument) scopeParts.push(filters.instrument);
  if (filters.status) scopeParts.push(STATUS_SCOPE_LABELS[filters.status]);

  const scopeLabel = scopeParts.length > 0 ? `Sentiment · ${scopeParts.filter(Boolean).join(" · ")}` : "Market-wide sentiment";

  return {
    bullishCount,
    bearishCount,
    neutralCount,
    totalCount,
    bullishPercent,
    bearishPercent,
    neutralPercent,
    dominantLean,
    scopeLabel,
    isSmallSample: totalCount > 0 && totalCount < 5,
  };
}

export type OpinionAnalystOption = { slug: string; name: string; count?: number };

/**
 * Analyst filter dropdown options for /opinions.
 *
 * Cascading (founder ask, 2026-08-08): when `firm` is set, narrows to
 * opinion-having HUMAN experts belonging to that canonical firm — same
 * HUMAN + canonical-org resolution fetchOpinionOrgGroups already uses to
 * build the firm dropdown itself, so every narrowed option is guaranteed
 * selectable — each with its OWN opinion count (cheap: scoped to one firm's
 * raw org variants). When no firm is set, this preserves the page's
 * original unscoped behavior (every expert — HUMAN or FIRM entityKind —
 * with >=1 public opinion, no per-analyst counts) so the common unfiltered
 * browse is unchanged.
 */
export async function fetchOpinionAnalystOptions(firm?: string): Promise<OpinionAnalystOption[]> {
  if (!firm) {
    const experts = await prisma.expert.findMany({
      where: { slug: { not: null }, opinions: { some: { suppressedAt: null } } },
      select: { slug: true, name: true },
      orderBy: { name: "asc" },
    });
    return experts
      .filter((e): e is { slug: string; name: string } => Boolean(e.slug))
      .map((e) => ({ slug: e.slug, name: e.name }));
  }

  const rawOrganizations = (await fetchOpinionOrgGroups()).get(firm)?.rawOrganizations ?? [];
  if (rawOrganizations.length === 0) return [];

  const experts = await prisma.expert.findMany({
    where: {
      slug: { not: null },
      entityKind: "HUMAN",
      organization: { in: rawOrganizations },
      opinions: { some: { suppressedAt: null } },
    },
    select: {
      slug: true,
      name: true,
      _count: { select: { opinions: { where: { suppressedAt: null } } } },
    },
    orderBy: { name: "asc" },
  });

  return experts
    .filter((e): e is typeof e & { slug: string } => Boolean(e.slug))
    .map((e) => ({ slug: e.slug, name: e.name, count: e._count.opinions }));
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
