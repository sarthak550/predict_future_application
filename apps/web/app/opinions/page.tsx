import type { Metadata } from "next";
import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";

import { AnalystDisclaimerFooter } from "@/components/finance/disclaimer-footer";
import { ExpandableCallsTable } from "@/components/finance/expandable-calls-table";
import { OpinionsFilterBar } from "@/components/finance/opinions-filter-bar";
import { SentimentGauge } from "@/components/finance/sentiment-gauge";
import { Card, CardContent } from "@/components/ui/card";
import { getSentimentSplit } from "@/lib/finance/sentiment";
import {
  fetchOpinionAnalystOptions,
  fetchOpinionFirmOptions,
  fetchOpinionInstrumentOptions,
  fetchOpinionSectorOptions,
  fetchOpinionsPage,
  fetchOpinionsSentimentSplit,
  hasActiveOpinionsQuery,
  hasNonDirectionOpinionsFilter,
  parseOpinionsFilters,
  resolveEffectiveFilters,
  type OpinionsFilters,
} from "@/lib/finance/opinionsQuery";
import { resolveInstrumentPageSymbols } from "@/lib/finance/instrumentLink";
import { formatDateOnly } from "@/lib/utils";

export const revalidate = 900;

type SearchParams = Record<string, string | string[] | undefined>;

export function generateMetadata({ searchParams }: { searchParams: SearchParams }): Metadata {
  const filters = parseOpinionsFilters(searchParams);
  const isFiltered = hasActiveOpinionsQuery(filters);

  return {
    title: "Every Analyst Call — Predict Future",
    description:
      "Every public market call from Indian analysts, filterable by instrument, direction, and grading status — each one sourced back to the original article.",
    alternates: { canonical: "https://predictfuture.app/opinions" },
    // Only the unfiltered first page is indexable — filtered/paginated combinations
    // are near-duplicate content from a search engine's perspective.
    robots: { index: !isFiltered, follow: true },
    openGraph: {
      title: "Every Analyst Call — Predict Future",
      description: "Browse every graded and pending analyst call, filterable by instrument and direction.",
      type: "website",
      url: "https://predictfuture.app/opinions",
    },
  };
}

/**
 * Range-aware sentiment-bar empty-state copy (2026-08-09 date-range
 * feature) — SentimentGauge's own hardcoded "last 7 days" fallback would be
 * actively wrong once a user has picked their own from/to, so this composes
 * the actual bound(s) into the message instead. Only reached when a
 * non-direction filter is active (this is only ever passed on the filtered
 * `"scopeLabel" in sentiment` branch below) — filters other than the date
 * range are covered by the generic "clear one" copy, unchanged from before
 * this feature.
 */
function buildSentimentEmptyMessage(filters: OpinionsFilters): string {
  if (filters.from && filters.to) {
    return `No calls between ${formatDateOnly(filters.from)} and ${formatDateOnly(filters.to)} match these filters.`;
  }
  if (filters.from) {
    return `No calls since ${formatDateOnly(filters.from)} match these filters.`;
  }
  if (filters.to) {
    return `No calls on or before ${formatDateOnly(filters.to)} match these filters.`;
  }
  return "No calls match these filters yet — clear one to see a sentiment split.";
}

function buildPageHref(searchParams: SearchParams, page: number): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(searchParams)) {
    if (key === "page" || value === undefined) continue;
    const v = Array.isArray(value) ? value[0] : value;
    if (v) params.set(key, v);
  }
  if (page > 1) params.set("page", String(page));
  const query = params.toString();
  return query ? `/opinions?${query}` : "/opinions";
}

export default async function OpinionsPage({ searchParams }: { searchParams: SearchParams }) {
  const rawFilters = parseOpinionsFilters(searchParams);

  // N-way cascade (founder ask, 2026-08-08 for firm<->analyst, generalized
  // 2026-08-09 to include sector + instrument: "if I click on Banking then
  // only firms or analysts or instruments which are relevant should be
  // shown in dropdown"). resolveEffectiveFilters is the SINGLE per-request
  // resolution pass — it also degrades a hand-built/stale URL's incompatible
  // filter combination (see its own doc comment) — so every query below,
  // and every dropdown, agrees on exactly what "the current filters" mean.
  const { filters, ctx } = await resolveEffectiveFilters(rawFilters);

  // Sentiment bar (founder ask, 2026-08-08: "I want the Market-wide
  // Sentiment bar to be adjusted based on the filters we apply below"): once
  // any filter OTHER than direction is active, swap the default 7-day
  // market-wide split for one recomputed against exactly the table's own
  // filtered, all-time set. `direction` itself is deliberately excluded —
  // see hasNonDirectionOpinionsFilter and fetchOpinionsSentimentSplit's own
  // doc comments — so a direction-only filter leaves the bar on the default
  // path below, unchanged.
  const isSentimentFiltered = hasNonDirectionOpinionsFilter(filters);

  const [{ items, hasMore, page }, instrumentOptions, analystOptions, firmOptions, sectorOptions, sentiment] =
    await Promise.all([
      fetchOpinionsPage(filters, ctx),
      fetchOpinionInstrumentOptions(filters, ctx),
      fetchOpinionAnalystOptions(filters, ctx),
      fetchOpinionFirmOptions(filters, ctx),
      fetchOpinionSectorOptions(filters, ctx),
      isSentimentFiltered ? fetchOpinionsSentimentSplit(filters, ctx) : getSentimentSplit(),
    ]);

  // Instrument cell -> /instruments/[symbol] (founder ask, 2026-08-09): one
  // batched lookup for exactly this page's rows, run after `items` resolves
  // (its own instrumentTicker list isn't known ahead of fetchOpinionsPage).
  const instrumentPageSymbols = await resolveInstrumentPageSymbols(items.map((call) => call.instrumentTicker));

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-3xl font-semibold text-ink-900">Every analyst call</h1>
        <p className="mt-3 max-w-2xl text-sm leading-6 text-ink-500">
          Every public market call we&rsquo;ve tracked, newest first. Filter by instrument, direction,
          grading status, analyst, firm, or sector — every combination is a shareable link.
        </p>
      </div>

      {"scopeLabel" in sentiment ? (
        <SentimentGauge
          split={sentiment}
          title={sentiment.scopeLabel}
          metaLabel={
            sentiment.isSmallSample
              ? `Based on ${sentiment.totalCount} analyst stance${sentiment.totalCount === 1 ? "" : "s"} · one per analyst`
              : `${sentiment.totalCount} analyst stance${sentiment.totalCount === 1 ? "" : "s"} matching these filters · one per analyst`
          }
          // Range-aware (2026-08-09 date-range feature): a custom from/to
          // that yields zero calls should name the actual range rather than
          // the generic "clear one" copy, which reads as if no date filter
          // were involved at all.
          emptyMessage={buildSentimentEmptyMessage(filters)}
        />
      ) : (
        <SentimentGauge split={sentiment} />
      )}

      <OpinionsFilterBar
        instrumentOptions={instrumentOptions}
        analystOptions={analystOptions}
        firmOptions={firmOptions}
        sectorOptions={sectorOptions}
      />

      {items.length === 0 ? (
        <Card>
          <CardContent className="p-8 text-center text-sm text-ink-500">
            No calls match these filters yet. Try clearing one of them.
          </CardContent>
        </Card>
      ) : (
        <ExpandableCallsTable
          firmLinkBasePath="/opinions"
          calls={items.map((call) => ({
            id: call.id,
            quote: call.quote,
            headline: call.headline,
            instrument: call.instrument,
            instrumentTicker: call.instrumentTicker,
            instrumentPageSymbol: call.instrumentTicker ? instrumentPageSymbols.get(call.instrumentTicker) : null,
            direction: call.direction,
            sourceUrl: call.sourceUrl,
            publishedAtLabel: formatDateOnly(call.publishedAt),
            resolutionStatus: call.resolutionStatus,
            resolutionNote: call.resolutionNote,
            resolvedAtLabel: call.resolvedAt ? formatDateOnly(call.resolvedAt) : null,
            analyst: { name: call.expert.name, slug: call.expert.slug, organization: call.expert.organization },
          }))}
        />
      )}

      {(page > 1 || hasMore) && (
        <div className="flex items-center justify-between border-t border-ink-100 pt-6 text-sm">
          {page > 1 ? (
            <Link
              href={buildPageHref(searchParams, page - 1)}
              className="inline-flex items-center gap-1 font-medium text-ink-700 hover:text-signal-sky"
            >
              <ChevronLeft className="h-4 w-4" />
              Previous
            </Link>
          ) : (
            <span />
          )}
          <span className="text-ink-400">Page {page}</span>
          {hasMore ? (
            <Link
              href={buildPageHref(searchParams, page + 1)}
              className="inline-flex items-center gap-1 font-medium text-ink-700 hover:text-signal-sky"
            >
              Next
              <ChevronRight className="h-4 w-4" />
            </Link>
          ) : (
            <span />
          )}
        </div>
      )}

      <AnalystDisclaimerFooter />
    </div>
  );
}
