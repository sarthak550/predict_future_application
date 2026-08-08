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
  fetchInstrumentOptions,
  fetchOpinionAnalystOptions,
  fetchOpinionFirmOptions,
  fetchOpinionsPage,
  hasActiveOpinionsQuery,
  parseOpinionsFilters,
} from "@/lib/finance/opinionsQuery";
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
  const filters = parseOpinionsFilters(searchParams);

  // Cascading dropdowns (founder ask, 2026-08-08): the analyst list narrows
  // to the selected firm; the firm list narrows to the selected analyst's
  // own firm — but only when a firm ISN'T already active, since the firm is
  // the more specific/dominant filter when both are set (see
  // fetchOpinionFirmOptions' and fetchOpinionsPage's own notes on this).
  const [{ items, hasMore, page }, instrumentOptions, analystOptions, firmOptions, sentiment] = await Promise.all([
    fetchOpinionsPage(filters),
    fetchInstrumentOptions(),
    fetchOpinionAnalystOptions(filters.firm),
    fetchOpinionFirmOptions(filters.firm ? undefined : filters.analyst),
    getSentimentSplit(filters.instrument),
  ]);

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-3xl font-semibold text-ink-900">Every analyst call</h1>
        <p className="mt-3 max-w-2xl text-sm leading-6 text-ink-500">
          Every public market call we&rsquo;ve tracked, newest first. Filter by instrument, direction,
          grading status, analyst, or firm — every combination is a shareable link.
        </p>
      </div>

      <SentimentGauge split={sentiment} />

      <OpinionsFilterBar
        instrumentOptions={instrumentOptions}
        analystOptions={analystOptions}
        firmOptions={firmOptions}
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
