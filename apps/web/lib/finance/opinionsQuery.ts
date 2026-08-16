import type { OpinionDirection, OpinionResolutionStatus, Prisma } from "@prisma/client";
import { canonicalizeInstrument } from "@predict-future/business-rules";
import { canonicalizeOrgDisplay } from "@predict-future/business-rules/experts/firmAliases";
import { normalizeInstrumentRawName } from "@predict-future/business-rules/instruments/instrumentDedup";

import { prisma } from "@/lib/prisma";
import { formatDateOnly } from "@/lib/utils";
import { buildInstrumentWhereOr } from "@/lib/finance/instruments";
import { isMissingTableError } from "@/lib/finance/instrumentLink";
import {
  computeDominantLean,
  computeSentimentPercentages,
  dedupeToLatestStancePerExpertInstrument,
  type DominantLean,
} from "@/lib/finance/sentiment";
import { getNseIndustryMap } from "@/lib/finance/nseSectorMaster";
import { resolveSectorLabel } from "@/lib/finance/sectorTaxonomy";

export const OPINIONS_PAGE_SIZE = 25;

export type OpinionStatusFilter = "graded" | "pending";

export interface OpinionsFilters {
  instrument?: string;
  direction?: OpinionDirection;
  status?: OpinionStatusFilter;
  /**
   * True when `status` is the page's own GRADED default rather than a
   * user-chosen `?status=` param (founder 2026-08-16: the newest-first
   * default view was pending-heavy — page one of a "we grade every call"
   * product showed zero graded calls and therefore zero share affordances;
   * receipts lead now). The bare /opinions URL stays the canonical,
   * indexable, "no filters active" page — the two has*Filter helpers below
   * ignore a defaulted status, so noindex/canonical/sentiment-source
   * decisions are unchanged for the bare URL.
   */
  statusIsDefault?: boolean;
  /** Expert slug, not id — matches the public URL shape used everywhere else (/analysts/[slug]). */
  analyst?: string;
  /** Canonical org display string, e.g. "Motilal Oswal Financial Services" — the SAME ?firm= value shape /analysts uses (see lib/finance/firmLink.ts, buildFirmOptions). */
  firm?: string;
  /** One of CANONICAL_SECTOR_LABELS (sectorTaxonomy.ts), e.g. "Banking", "Automobile and Auto Components" — the ticker's underlying instrument's sector, NOT an expert/firm attribute. */
  sector?: string;
  /** ISO `YYYY-MM-DD`, inclusive lower bound on `publishedAt` — see DATE_ONLY_RE/parseDateOnly. Absent means no lower bound, i.e. byte-for-byte the pre-date-range behavior. */
  from?: string;
  /** ISO `YYYY-MM-DD`, inclusive upper bound on `publishedAt` (end-of-day — see buildWhere) — see DATE_ONLY_RE/parseDateOnly. Absent means no upper bound. */
  to?: string;
  page: number;
}

/** The four filter dimensions that cascade against one another — see buildOptionsWhere's doc comment. Order is significant: DROP_PRECEDENCE below relies on it. `direction` and `status` are deliberately excluded from this list (and from every option-builder query) — see fetchOpinionsSentimentSplit's doc comment for `direction`; `status` was never part of the founder's cascade ask and stays a plain independent AND. */
const CASCADE_DIMENSIONS = ["firm", "analyst", "sector", "instrument"] as const;
type CascadeDimension = (typeof CASCADE_DIMENSIONS)[number];

const VALID_DIRECTIONS: readonly OpinionDirection[] = ["BULLISH", "BEARISH", "NEUTRAL"];

/** Matches a bare `YYYY-MM-DD` — the shape both the native `<input type="date">` in OpinionsFilterBar and the preset-chip math in that same file produce. Anything else (malformed, a full ISO timestamp, garbage) is dropped by parseDateOnly rather than passed through to Prisma. */
const DATE_ONLY_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Parses a `?from=`/`?to=` value into a validated `YYYY-MM-DD` string, or undefined if it's missing/malformed/not a real calendar date (e.g. "2026-02-30"). The round-trip comparison (parse, then re-format and compare to the input) is load-bearing: JS's Date constructor silently rolls day-of-month overflow forward ("2026-02-30" → 2026-03-02) instead of producing NaN, so an isNaN check alone quietly filters by a date the user never typed — caught by QA 2026-08-09. Kept as a string (not a Date) here — buildWhere is the single place that turns it into the actual gte/lte Date bounds, and callers that need to render the range back (scopeLabel, the empty-state message) want the plain date string, not a Date they'd have to re-format. */
function parseDateOnly(value: string | undefined): string | undefined {
  if (!value || !DATE_ONLY_RE.test(value)) return undefined;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime())) return undefined;
  return parsed.toISOString().slice(0, 10) === value ? value : undefined;
}

/**
 * Parses ?instrument=&direction=&status=&analyst=&from=&to=&page= from a
 * page's raw searchParams into a typed, validated filter set. Unknown/invalid
 * values are dropped rather than erroring — a malformed query string degrades
 * to "no filter" instead of a 500.
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
  const statusExplicit = statusRaw === "graded" || statusRaw === "pending";
  // Absent (or junk) → GRADED default; explicit "all" opts out entirely —
  // see `statusIsDefault`'s doc comment on the interface above.
  const status: OpinionStatusFilter | undefined = statusExplicit
    ? (statusRaw as OpinionStatusFilter)
    : statusRaw === "all"
      ? undefined
      : "graded";
  const statusIsDefault = !statusExplicit && statusRaw !== "all";

  const instrument = get("instrument")?.trim() || undefined;
  const analyst = get("analyst")?.trim() || undefined;
  const firm = get("firm")?.trim() || undefined;
  const sector = get("sector")?.trim() || undefined;
  const from = parseDateOnly(get("from")?.trim());
  const to = parseDateOnly(get("to")?.trim());

  const pageRaw = Number.parseInt(get("page") ?? "1", 10);
  const page = Number.isFinite(pageRaw) && pageRaw > 0 ? pageRaw : 1;

  return { instrument, direction, status, statusIsDefault, analyst, firm, sector, from, to, page };
}

/** True if any filter/pagination param beyond the bare unfiltered first page is active. */
export function hasActiveOpinionsQuery(filters: OpinionsFilters): boolean {
  const explicitStatus = filters.statusIsDefault ? undefined : filters.status;
  return (
    Boolean(
      filters.instrument || filters.direction || explicitStatus || filters.analyst || filters.firm || filters.sector ||
        filters.from || filters.to,
    ) || filters.page > 1
  );
}

/**
 * True if a filter OTHER than direction (or page, which doesn't change the
 * matched set) is active. Deliberately excludes `direction` — see
 * fetchOpinionsSentimentSplit's doc comment: the sentiment bar drops
 * direction from its own aggregate, so a direction-ONLY filter shouldn't
 * switch it out of the default market-wide/7-day view either. Used by
 * opinions/page.tsx to decide which sentiment data source to render.
 *
 * `from`/`to` count as non-direction filters (2026-08-09 date-range feature)
 * — a date range with no other filter active must route through the
 * filtered, all-time fetchOpinionsSentimentSplit (with the date clause
 * applied) rather than silently falling back to the unfiltered default
 * 7-day getSentimentSplit(), which would ignore the user's chosen range.
 */
export function hasNonDirectionOpinionsFilter(filters: OpinionsFilters): boolean {
  const explicitStatus = filters.statusIsDefault ? undefined : filters.status;
  return Boolean(filters.instrument || explicitStatus || filters.analyst || filters.firm || filters.sector || filters.from || filters.to);
}

const GRADED_STATUSES: OpinionResolutionStatus[] = ["RESOLVED_HIT", "RESOLVED_MISS"];

/**
 * Distinct raw `organization` strings used by opinion-having HUMAN experts,
 * grouped by their canonical display form (canonicalizeOrgDisplay). This is
 * a NAME-RESOLUTION lookup (canonical firm -> its raw org spelling variants),
 * unfiltered by design — the same reason fetchOpinionOrgGroups was already
 * unfiltered before the N-way cascade generalization: it answers "what raw
 * strings does this canonical firm name expand to," not "how many opinions
 * currently match." The FILTERED, cascade-aware firm dropdown counts now
 * live in fetchOpinionFirmOptions below, built on top of this lookup.
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

/**
 * Ticker <-> sector index. Unfiltered NAME-RESOLUTION lookup (canonical
 * sector -> its ticker set), same role as fetchOpinionOrgGroups above.
 * Exported (not just used internally) so lib/finance/screenerQuery.ts
 * (Growth Loop Sprint G4) can resolve the SAME ticker->sector labels
 * /opinions?sector= already uses, rather than re-deriving a second mapping
 * that could silently drift from this one.
 */
export async function buildSectorIndex(): Promise<{
  tickerToSector: Map<string, string>;
  sectorToTickers: Map<string, string[]>;
}> {
  const rows = await prisma.expertOpinion.findMany({
    where: { suppressedAt: null, instrumentTicker: { not: null } },
    distinct: ["instrumentTicker"],
    select: { instrumentTicker: true },
  });
  const tickers = rows.map((r) => r.instrumentTicker).filter((t): t is string => Boolean(t));

  const bareSymbol = (ticker: string): string | null => {
    const m = /^([A-Z0-9&-]+)\.NS$/i.exec(ticker);
    return m ? m[1].toUpperCase() : null;
  };

  const symbolByTicker = new Map<string, string>();
  for (const ticker of tickers) {
    const symbol = bareSymbol(ticker);
    if (symbol) symbolByTicker.set(ticker, symbol);
  }
  const bareSymbols = [...new Set(symbolByTicker.values())];

  const [nseIndustryMap, enrichmentRows] = await Promise.all([
    getNseIndustryMap(),
    bareSymbols.length > 0
      ? prisma.instrumentEnrichment.findMany({
          where: { symbol: { in: bareSymbols } },
          select: { symbol: true, keyStats: true },
        })
      : Promise.resolve([]),
  ]);
  const keyStatsBySymbol = new Map(
    enrichmentRows.map((r) => [r.symbol, r.keyStats as { sector?: string; industry?: string } | null]),
  );

  const tickerToSector = new Map<string, string>();
  const sectorToTickers = new Map<string, string[]>();
  for (const [ticker, symbol] of symbolByTicker) {
    const ks = keyStatsBySymbol.get(symbol);
    const label = resolveSectorLabel({
      nseIndustry: nseIndustryMap.get(symbol),
      yahooSector: ks?.sector,
      yahooIndustry: ks?.industry,
    });
    if (!label) continue;
    tickerToSector.set(ticker, label);
    const bucket = sectorToTickers.get(label);
    if (bucket) bucket.push(ticker);
    else sectorToTickers.set(label, [ticker]);
  }

  return { tickerToSector, sectorToTickers };
}

/** Resolves a ?sector= value to the instrumentTicker set buildWhere filters on. An unrecognized/stale value resolves to [], which Prisma's `in: []` correctly turns into zero rows. */
async function resolveSectorTickers(sector: string): Promise<string[]> {
  const { sectorToTickers } = await buildSectorIndex();
  return sectorToTickers.get(sector) ?? [];
}

/**
 * Resolves a ?instrument= value to the InstrumentAlias.rawName set (always
 * tickers — see instrumentLink.ts's doc comment: a `resolved: true` row only
 * ever exists for a ticker-keyed rawName) sharing that canonical display
 * name. Returns undefined when the value ISN'T a resolved canonical name
 * (either a legacy free-text value, or InstrumentAlias doesn't exist yet) —
 * callers fall back to the legacy fuzzy-text OR match in that case. See
 * buildWhere's own comment for how the two modes compose with `sector`'s
 * ticker constraint.
 */
async function resolveInstrumentFilterTickers(instrument: string): Promise<string[] | undefined> {
  try {
    const rows = await prisma.instrumentAlias.findMany({
      where: { canonicalName: instrument, resolved: true },
      select: { rawName: true },
    });
    return rows.length > 0 ? rows.map((r) => r.rawName) : undefined;
  } catch (err) {
    if (isMissingTableError(err)) return undefined;
    throw err;
  }
}

/** Resolution context threaded alongside `filters` into buildWhere/buildWhereExcluding — the values that back each active filter's WHERE-clause meaning. Populated once per request by resolveEffectiveFilters. */
interface FilterResolutionContext {
  firmOrganizations?: string[];
  sectorTickers?: string[];
  /** Set only when filters.instrument resolved against InstrumentAlias (ticker-equality mode). Absent => filters.instrument (if set) falls back to legacy fuzzy-text matching. */
  instrumentTickers?: string[];
}

/**
 * The shared WHERE-builder EVERY consumer of these filters goes through —
 * the table (fetchOpinionsPage), the sentiment bar (fetchOpinionsSentimentSplit),
 * and all four dropdown option-builders below (via buildWhereExcluding).
 * Single source of truth: nothing computes "what matches these filters"
 * except this function, so the dropdowns' cascade and the table's own result
 * set can never drift apart.
 */
function buildWhere(filters: OpinionsFilters, ctx: FilterResolutionContext): Prisma.ExpertOpinionWhereInput {
  // Both `analyst` and `firm` constrain `expert`, so they're merged into a
  // single expert sub-object rather than two separate spreads — two object-
  // literal spreads under the same `expert` key would silently let the
  // second clobber the first, dropping whichever filter lost.
  const expertWhere: Prisma.ExpertWhereInput = {};
  if (filters.analyst) expertWhere.slug = filters.analyst;
  if (filters.firm) expertWhere.organization = { in: ctx.firmOrganizations ?? [] };

  // `sector` and a RESOLVED `instrument` both constrain instrumentTicker —
  // merge via intersection rather than two top-level `instrumentTicker` keys
  // (the second object-spread would silently clobber the first, same class
  // of bug the expertWhere merge above guards against). A resolved
  // instrument is always the more specific of the two in practice (one
  // ticker vs a sector's whole ticker set), so the intersection naturally
  // reduces to "that instrument, if it's actually in the selected sector" —
  // correctly empty when it isn't, which the mismatch-degrade retry in
  // resolveEffectiveFilters handles.
  const tickerSets: string[][] = [];
  if (filters.sector) tickerSets.push(ctx.sectorTickers ?? []);
  if (filters.instrument && ctx.instrumentTickers) tickerSets.push(ctx.instrumentTickers);
  let instrumentTickerWhere: Prisma.ExpertOpinionWhereInput = {};
  if (tickerSets.length === 1) {
    instrumentTickerWhere = { instrumentTicker: { in: tickerSets[0] } };
  } else if (tickerSets.length > 1) {
    const intersection = tickerSets.reduce((a, b) => a.filter((t) => b.includes(t)));
    instrumentTickerWhere = { instrumentTicker: { in: intersection } };
  }

  // Date range (2026-08-09 feature) — inclusive on both ends. `to` is bumped
  // to the END of that calendar day (23:59:59.999) rather than midnight, so
  // ?to=2026-07-15 includes every opinion published ON the 15th, not just up
  // to its first instant. Absent when neither `from` nor `to` is set, so
  // every existing link/bookmark with no date params gets byte-for-byte the
  // same WHERE clause as before this feature — see parseOpinionsFilters'
  // own doc comment for why this stays a plain YYYY-MM-DD string until here.
  const publishedAtWhere: Prisma.DateTimeFilter = {};
  if (filters.from) publishedAtWhere.gte = new Date(`${filters.from}T00:00:00.000Z`);
  if (filters.to) publishedAtWhere.lte = new Date(`${filters.to}T23:59:59.999Z`);

  return {
    suppressedAt: null,
    // Legacy fuzzy-text OR match — only when `instrument` is set AND it did
    // NOT resolve against InstrumentAlias (see resolveInstrumentFilterTickers).
    ...(filters.instrument && !ctx.instrumentTickers ? { OR: buildInstrumentWhereOr(filters.instrument) } : {}),
    ...(filters.direction ? { direction: filters.direction } : {}),
    ...(filters.status === "graded" ? { resolutionStatus: { in: GRADED_STATUSES } } : {}),
    ...(filters.status === "pending" ? { resolutionStatus: "PENDING" as const } : {}),
    ...(Object.keys(publishedAtWhere).length > 0 ? { publishedAt: publishedAtWhere } : {}),
    ...(Object.keys(expertWhere).length > 0 ? { expert: expertWhere } : {}),
    ...instrumentTickerWhere,
  };
}

/**
 * The natural shared abstraction the founder's "generalize, don't
 * special-case" ask calls for: EVERY dropdown's options reflect "what values
 * would produce non-empty results given every OTHER currently-active filter
 * dimension" — i.e. buildWhere with that ONE dimension's own param stripped,
 * everything else (now including sector, and a resolved instrument) applied.
 * Replaces the old bespoke narrowToAnalystSlug/firm-only params on
 * fetchOpinionFirmOptions/fetchOpinionAnalystOptions — those two, plus
 * sector and instrument, now all go through this single call.
 *
 * BEHAVIOR CHANGE from the prior firm<->analyst cascade: previously, firm's
 * own dropdown deliberately stayed UNNARROWED even when an analyst was
 * active ("so its own dropdown always shows the full firm list rather than
 * collapsing to one option a user might feel stuck with"). Under a true
 * symmetric N-way cascade this asymmetry doesn't generalize cleanly to 4
 * dimensions, and — since an analyst deterministically belongs to exactly
 * one firm — collapsing the firm dropdown to that one firm when an analyst
 * is active is actually the CORRECT answer, not a UX trap: the user can
 * still broaden by clearing the analyst filter first (one click), and every
 * other cascading facet UI (e-commerce category/brand filters, etc.) behaves
 * this same way. Flagged here explicitly since it's a deliberate, considered
 * reversal of prior documented behavior, not an oversight.
 *
 * `direction` is ALWAYS stripped here too, regardless of `exclude` — same
 * law as fetchOpinionsSentimentSplit's own direction exclusion (existing,
 * pre-dates this generalization): filtering a dropdown's OPTIONS by
 * direction would mean picking "Bearish" silently hides every firm/analyst/
 * sector/instrument that happens to have zero bearish calls, which is not
 * what "narrow by Banking" means and was never true of the original
 * firm<->analyst cascade (whose bespoke queries never referenced direction
 * at all). `status` is NOT stripped — it was never part of the cascade ask
 * and stays a plain filter on the option-building query, same as before.
 */
function buildWhereExcluding(
  filters: OpinionsFilters,
  ctx: FilterResolutionContext,
  exclude: CascadeDimension,
): Prisma.ExpertOpinionWhereInput {
  return buildWhere({ ...filters, [exclude]: undefined, direction: undefined }, ctx);
}

/**
 * Mismatched-pair guard: the filter bar's cascading dropdowns are supposed to
 * make an incompatible firm+analyst combination unreachable by clicking
 * (picking a firm clears an analyst outside it, and picking an analyst
 * narrows the firm list to theirs), but a hand-built or stale-bookmarked URL
 * can still land here with both set and disagreeing. That pair would
 * otherwise silently resolve to zero rows (analyst.slug = X AND organization
 * IN <firm's orgs>, which never both hold — a STRUCTURAL impossibility, not
 * sparse data: an analyst's organization is fixed, so no opinion can ever
 * satisfy both). Rather than serving a confusing "no calls match" page — or
 * erroring — we drop the analyst and treat it as firm-only: the firm is the
 * more specific/dominant signal when the two disagree, the base case
 * DROP_PRECEDENCE (below) generalizes to sector/instrument.
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

/**
 * Precedence for DROPPING a filter when the full active combination would
 * otherwise produce a false-empty result (see resolveEffectiveFilters) —
 * earlier entries are KEPT longer; the LAST entry still active is dropped
 * first. One consistent rule generalizes the founder's example (sector +
 * a pharma-only firm) and the pre-existing firm/analyst precedent:
 *   - expert-axis (who said it: firm/analyst) outranks subject-axis (what
 *     it's about: sector/instrument) — this preserves the existing,
 *     already-shipped firm-over-analyst precedent as the base case.
 *   - within each axis, the BROADER dimension outranks the narrower one it
 *     contains (a firm has many analysts; a sector has many instruments) —
 *     so firm > analyst and, symmetrically, sector > instrument.
 */
const DROP_PRECEDENCE: readonly CascadeDimension[] = ["firm", "analyst", "sector", "instrument"];

export interface ResolvedOpinionsFilters {
  /** The EFFECTIVE filters after any structural/false-empty degradation — use this (never the raw parsed filters) for every downstream query and for the sentiment bar's scope label. */
  filters: OpinionsFilters;
  ctx: FilterResolutionContext;
  /** Which cascade dimensions were dropped and why the combination reached this page needing it — empty in the overwhelming common case (0-1 filters, or a combination that's simply, legitimately narrow). Surfaced for the (currently silent) case a future UI wants to disclose "X was cleared because it couldn't be combined with Y." */
  droppedFilters: CascadeDimension[];
}

/**
 * Resolves parsed URL filters into the EFFECTIVE filters + WHERE-clause
 * context every other function in this file consumes — computed ONCE per
 * request (opinions/page.tsx calls this, then passes the result to
 * fetchOpinionsPage/fetchOpinionsSentimentSplit/the four option-fetchers) so
 * the table, the sentiment bar, and every dropdown can never disagree on
 * what "the current filters" actually mean.
 *
 * Two layers of degradation, applied in order:
 *   1. STRUCTURAL: firm/analyst — a deterministic identity check, no query
 *      needed beyond one small lookup (resolveEffectiveAnalyst).
 *   2. FALSE-EMPTY RETRY: only entered when 2+ cascade dimensions are active
 *      (0-1 filters can never conflict with anything). One indexed,
 *      LIMIT-1 existence check (`findFirst`) on the fully-combined WHERE
 *      clause; if it comes back empty, drop the lowest-precedence active
 *      filter (DROP_PRECEDENCE) and recheck — bounded to at most
 *      (active dimension count) extra existence checks, and ONLY reached by
 *      a hand-built/stale URL (the cascading dropdowns make this
 *      combination unreachable by clicking through the UI). The common
 *      path — 0, 1, or a legitimately-narrow-but-nonzero combination of
 *      filters — pays exactly one extra `findFirst` (only when 2+ filters
 *      are active), or zero when 0-1 are.
 */
export async function resolveEffectiveFilters(filters: OpinionsFilters): Promise<ResolvedOpinionsFilters> {
  const firmOrganizations = filters.firm
    ? (await fetchOpinionOrgGroups()).get(filters.firm)?.rawOrganizations
    : undefined;

  const droppedFilters: CascadeDimension[] = [];
  const effectiveAnalyst = await resolveEffectiveAnalyst(filters);
  if (filters.analyst && effectiveAnalyst === undefined) droppedFilters.push("analyst");

  let current: OpinionsFilters = { ...filters, analyst: effectiveAnalyst };
  const sectorTickers = current.sector ? await resolveSectorTickers(current.sector) : undefined;
  const instrumentTickers = current.instrument ? await resolveInstrumentFilterTickers(current.instrument) : undefined;

  let ctx: FilterResolutionContext = { firmOrganizations, sectorTickers, instrumentTickers };

  const activeCascadeDims = CASCADE_DIMENSIONS.filter((d) => Boolean(current[d]));
  if (activeCascadeDims.length >= 2) {
    for (let i = 0; i < activeCascadeDims.length; i++) {
      const exists = await prisma.expertOpinion.findFirst({ where: buildWhere(current, ctx), select: { id: true } });
      if (exists) break;

      const stillActive = DROP_PRECEDENCE.filter((d) => Boolean(current[d]));
      const drop = stillActive[stillActive.length - 1];
      if (!drop) break;

      droppedFilters.push(drop);
      current = { ...current, [drop]: undefined };
      if (drop === "firm") ctx = { ...ctx, firmOrganizations: undefined };
      if (drop === "sector") ctx = { ...ctx, sectorTickers: undefined };
      if (drop === "instrument") ctx = { ...ctx, instrumentTickers: undefined };
    }
  }

  return { filters: current, ctx, droppedFilters };
}

export async function fetchOpinionsPage(filters: OpinionsFilters, ctx: FilterResolutionContext) {
  const where = buildWhere(filters, ctx);
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

/**
 * Human-readable label for an active `from`/`to` range, e.g. "12 Jan – 20 Jan
 * 2026" (both bounds), "Since 12 Jan 2026" (open-ended end), or "Through 20
 * Jan 2026" (open-ended start). Shared by fetchOpinionsSentimentSplit's
 * scopeLabel and opinions/page.tsx's range-aware empty-state message so the
 * two never describe the same range differently.
 */
export function formatDateRangeLabel(from: string | undefined, to: string | undefined): string {
  if (from && to) return `${formatDateOnly(from)} – ${formatDateOnly(to)}`;
  if (from) return `Since ${formatDateOnly(from)}`;
  if (to) return `Through ${formatDateOnly(to)}`;
  return "";
}

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
 * Sentiment split for /opinions, recomputed against the SAME EFFECTIVE
 * filters as the table rendered below it — with one deliberate exception:
 * `direction`. Filtering the bar's own aggregate by direction would be a
 * tautology (picking "Bullish" would always render a 100% bullish bar), so
 * direction is dropped before building the WHERE clause here — the bar
 * always shows the FULL bullish/bearish/neutral split within whatever OTHER
 * filters are active. It's the caller's job (opinions/page.tsx) to only
 * invoke this function when a non-direction filter is active in the first
 * place; when direction is the only active filter (or nothing is), the
 * caller falls back to the unfiltered getSentimentSplit (lib/finance/
 * sentiment.ts)'s 7-day market-wide split instead, unchanged from before
 * this filter-aware bar existed.
 *
 * Deliberately ALL-TIME (no 7-day window), unlike getSentimentSplit — the
 * point of the all-time scope is that the bar is built from the SAME
 * filtered set as the table below it, not a silently different, time-boxed
 * subset of it.
 *
 * INVARIANT (revised 2026-08-16 — sentiment bias fix mechanism 3; the old
 * invariant here, "`totalCount` equals the table's own total-matching-rows
 * count," is DELIBERATELY GONE, not a bug): `totalCount` is
 * `dedupeToLatestStancePerExpertInstrument(rows).length` — every ROW in the
 * filtered set still appears in the table below (that part is unchanged),
 * but `totalCount`/bullish/bearish/neutral now count each analyst's LATEST
 * stance per instrument once, so an analyst who restated the same call
 * across multiple articles within this filter set contributes one to this
 * total, not one per row. `totalCount` is therefore <= the table's row
 * count, not equal to it, whenever any duplicate-stance group exists in the
 * filtered set. Any caller-facing copy built from this value (see
 * opinions/page.tsx's `metaLabel`) MUST say "stances"/"one per analyst" or
 * equivalent, never imply it's a row count — see the QA finding on
 * 2026-08-16 that caught exactly this mismatch (caption said "N calls",
 * table below it legitimately showed more rows than N).
 *
 * Takes the SAME already-resolved `filters`/`ctx` as fetchOpinionsPage
 * (both computed once by resolveEffectiveFilters) so the two can never
 * disagree on what counts as "the filtered set."
 */
export async function fetchOpinionsSentimentSplit(
  filters: OpinionsFilters,
  ctx: FilterResolutionContext,
): Promise<OpinionsSentimentSplit> {
  const where = buildWhere({ ...filters, direction: undefined }, ctx);

  // findMany + in-app dedup, NOT groupBy — mechanism 3 (2026-08-16): a
  // groupBy({by:["direction"]}) counts raw rows, double-counting an analyst
  // who restated the same stance on the same instrument across multiple
  // articles within `where`'s active filters. Minimal columns only — never
  // Prisma's `distinct` option (client-side-emulated, see
  // dedupeToLatestStancePerExpertInstrument's own doc).
  const [rows, analystExpert] = await Promise.all([
    prisma.expertOpinion.findMany({
      where,
      select: { expertId: true, instrumentTicker: true, instrument: true, direction: true, publishedAt: true },
    }),
    filters.analyst ? prisma.expert.findFirst({ where: { slug: filters.analyst }, select: { name: true } }) : null,
  ]);
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

  // Scope label parts, most-specific first. An analyst filter implies a firm
  // (they only ever belong to one), so when both resolve to the same person
  // we show ONLY the analyst's name rather than stacking "Firm · Analyst" —
  // shorter, and the firm is one click away on their profile anyway.
  const scopeParts: string[] = [];
  if (filters.analyst) {
    scopeParts.push(analystExpert?.name ?? filters.analyst);
  } else if (filters.firm) {
    scopeParts.push(filters.firm);
  }
  if (filters.instrument) scopeParts.push(filters.instrument);
  if (filters.sector) scopeParts.push(filters.sector);
  if (filters.status) scopeParts.push(STATUS_SCOPE_LABELS[filters.status]);
  if (filters.from || filters.to) scopeParts.push(formatDateRangeLabel(filters.from, filters.to));

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

export type OpinionFirmOption = { firm: string; count: number };

/**
 * Firm filter dropdown options for /opinions — canonical firms present among
 * opinion-having HUMAN experts, counted by OPINIONS (not analysts, unlike
 * /analysts' buildFirmOptions) within the current cascade scope (every OTHER
 * active dimension applied via buildWhereExcluding — see that function's own
 * doc comment for the behavior-change note on firm<->analyst), sorted by
 * count desc then name.
 */
export async function fetchOpinionFirmOptions(
  filters: OpinionsFilters,
  ctx: FilterResolutionContext,
): Promise<OpinionFirmOption[]> {
  const where = buildWhereExcluding(filters, ctx, "firm");
  const rows = await prisma.expertOpinion.findMany({
    where: { ...where, expert: { ...(where.expert as Prisma.ExpertWhereInput | undefined), entityKind: "HUMAN" } },
    select: { expert: { select: { organization: true } } },
  });

  const counts = new Map<string, number>();
  for (const row of rows) {
    const canonical = canonicalizeOrgDisplay(row.expert.organization);
    counts.set(canonical, (counts.get(canonical) ?? 0) + 1);
  }

  return [...counts.entries()]
    .map(([firm, count]) => ({ firm, count }))
    .sort((a, b) => b.count - a.count || a.firm.localeCompare(b.firm));
}

export type OpinionSectorOption = { sector: string; count: number };

/**
 * Sector filter dropdown options for /opinions — every sector with >=1
 * public opinion within the current cascade scope (firm/analyst/instrument
 * applied via buildWhereExcluding — sector NO LONGER stands independent of
 * firm/analyst, per the founder's 2026-08-09 "Banking should narrow firms
 * too" ask, which supersedes the prior "sector doesn't cascade" decision
 * recorded in buildSectorIndex's history), counted by OPINIONS, sorted by
 * count desc then name.
 */
export async function fetchOpinionSectorOptions(
  filters: OpinionsFilters,
  ctx: FilterResolutionContext,
): Promise<OpinionSectorOption[]> {
  const { tickerToSector } = await buildSectorIndex();
  if (tickerToSector.size === 0) return [];

  const where = buildWhereExcluding(filters, ctx, "sector");
  const counts = await prisma.expertOpinion.groupBy({
    by: ["instrumentTicker"],
    where: { ...where, instrumentTicker: { in: [...tickerToSector.keys()] } },
    _count: { _all: true },
  });

  const bySector = new Map<string, number>();
  for (const row of counts) {
    const sector = row.instrumentTicker ? tickerToSector.get(row.instrumentTicker) : undefined;
    if (!sector) continue;
    bySector.set(sector, (bySector.get(sector) ?? 0) + row._count._all);
  }

  return [...bySector.entries()]
    .map(([sector, count]) => ({ sector, count }))
    .sort((a, b) => b.count - a.count || a.sector.localeCompare(b.sector));
}

export type OpinionAnalystOption = { slug: string; name: string; count?: number };

/**
 * Analyst filter dropdown options for /opinions, within the current cascade
 * scope (firm/sector/instrument applied via buildWhereExcluding). Scoped to
 * entityKind=HUMAN only when `firm` is active — a canonical firm is a
 * HUMAN-only concept here (fetchOpinionOrgGroups' own HUMAN scoping), so a
 * FIRM-kind "desk" expert can never legitimately belong to one; with no firm
 * active, every expert kind is eligible, matching the page's original
 * unscoped behavior. Counts are now ALWAYS included (previously only when
 * firm-narrowed) — free to compute once the query is already scoped, and
 * strictly better dropdown UX.
 */
export async function fetchOpinionAnalystOptions(
  filters: OpinionsFilters,
  ctx: FilterResolutionContext,
): Promise<OpinionAnalystOption[]> {
  const where = buildWhereExcluding(filters, ctx, "analyst");
  const experts = await prisma.expert.findMany({
    where: {
      slug: { not: null },
      ...(filters.firm ? { entityKind: "HUMAN" as const } : {}),
      opinions: { some: where },
    },
    select: {
      slug: true,
      name: true,
      _count: { select: { opinions: { where } } },
    },
    orderBy: { name: "asc" },
  });

  return experts
    .filter((e): e is typeof e & { slug: string } => Boolean(e.slug))
    .map((e) => ({ slug: e.slug, name: e.name, count: e._count.opinions }));
}

export type OpinionInstrumentOption = {
  /** The exact string used as ?instrument= and shown in the dropdown. */
  value: string;
  count: number;
  /** True when `value` resolved against InstrumentAlias (authoritative-source-backed, ticker-equality matched, and clickable elsewhere on the page); false for the legacy free-text fallback (fuzzy substring matched, never linked, deduped only by canonicalizeInstrument's small static map). */
  resolved: boolean;
};

/**
 * Instrument filter dropdown options for /opinions, within the current
 * cascade scope (firm/analyst/sector applied via buildWhereExcluding).
 *
 * Two-tier grouping, per the founder's 2026-08-09 identity-resolution ask:
 *   - RESOLVED: grouped by InstrumentAlias.canonicalName (authoritative —
 *     StockEodQuote / NSE's equity master, never a guess) whenever the raw
 *     (instrument, instrumentTicker) pair has a resolved alias. This is what
 *     collapses "Adani Ports and Special Economic Zone Limited (APSEZ)" and
 *     "Adani Ports" into ONE dropdown entry (both extract to instrumentTicker
 *     "ADANIPORTS.NS", which InstrumentAlias resolves to a single canonical
 *     company name) instead of the old raw-text canonicalizeInstrument dedup
 *     colliding two DIFFERENT strings by coincidence.
 *   - UNRESOLVED (legacy fallback): the pre-existing canonicalizeInstrument
 *     text dedup, for whatever InstrumentAlias hasn't resolved yet
 *     (commodities/FX/sectoral indices out of resolution scope by design, or
 *     a raw name the backfill/extraction pipeline hasn't reached).
 */
export async function fetchOpinionInstrumentOptions(
  filters: OpinionsFilters,
  ctx: FilterResolutionContext,
): Promise<OpinionInstrumentOption[]> {
  const where = buildWhereExcluding(filters, ctx, "instrument");
  const rows = await prisma.expertOpinion.findMany({
    where: { ...where, OR: [{ instrument: { not: null } }, { instrumentTicker: { not: null } }] },
    select: { instrument: true, instrumentTicker: true },
  });

  const rawNames = [
    ...new Set(
      rows
        .map((r) => normalizeInstrumentRawName(r.instrumentTicker, r.instrument))
        .filter((r): r is string => Boolean(r)),
    ),
  ];

  let canonicalByRawName = new Map<string, string>();
  if (rawNames.length > 0) {
    try {
      const aliases = await prisma.instrumentAlias.findMany({
        where: { rawName: { in: rawNames }, resolved: true },
        select: { rawName: true, canonicalName: true },
      });
      canonicalByRawName = new Map(
        aliases.filter((a): a is typeof a & { canonicalName: string } => Boolean(a.canonicalName)).map((a) => [a.rawName, a.canonicalName]),
      );
    } catch (err) {
      if (!isMissingTableError(err)) throw err;
    }
  }

  const counts = new Map<string, { count: number; resolved: boolean }>();
  for (const row of rows) {
    const rawName = normalizeInstrumentRawName(row.instrumentTicker, row.instrument);
    const canonicalName = rawName ? canonicalByRawName.get(rawName) : undefined;
    const value = canonicalName ?? (row.instrument ? canonicalizeInstrument(row.instrument.trim()) : undefined);
    if (!value) continue;
    const entry = counts.get(value);
    if (entry) entry.count += 1;
    else counts.set(value, { count: 1, resolved: Boolean(canonicalName) });
  }

  return [...counts.entries()]
    .map(([value, { count, resolved }]) => ({ value, count, resolved }))
    .sort((a, b) => b.count - a.count || a.value.localeCompare(b.value));
}
