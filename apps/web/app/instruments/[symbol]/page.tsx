import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { AnalystDisclaimerFooter } from "@/components/finance/disclaimer-footer";
import { EtfDetailsPanel } from "@/components/finance/etf-details-panel";
import { EtfTrackingList } from "@/components/finance/etf-tracking-list";
import { ExpandableCallsTable } from "@/components/finance/expandable-calls-table";
import { FundamentalsPanel } from "@/components/finance/fundamentals-panel";
import { IndexCompositionPanel } from "@/components/finance/index-composition-panel";
import { IndexMembershipStrip } from "@/components/finance/index-membership-strip";
import { IndexMetricsPanel } from "@/components/finance/index-metrics-panel";
import { InstrumentSentimentGauge } from "@/components/finance/instrument-sentiment-gauge";
import { PriceChart } from "@/components/finance/price-chart";
import { PulseTabs } from "@/components/finance/pulse-tabs";
import { QuoteHeader } from "@/components/finance/quote-header";
import { Card, CardContent } from "@/components/ui/card";

import { fetchInstrumentDetail } from "@/lib/finance/instrument";
import { resolveCanonicalNameForSymbol } from "@/lib/finance/instrumentLink";
import { isOptionsTradingEnabled } from "@/lib/paperTrading/featureFlags";
import { formatIstSessionDate, formatRelativeTime } from "@/lib/utils";

export const revalidate = 900;

const EVENT_TYPE_LABELS: Record<string, string> = {
  MERGER_ACQUISITION: "M&A",
  RESULTS: "Results",
  BOARD_MEETING: "Board Meeting",
  RATING_CHANGE: "Rating Change",
  OTHER_MATERIAL: "Material Update",
};

export async function generateMetadata({
  params,
}: {
  params: { symbol: string };
}): Promise<Metadata> {
  const instrument = await fetchInstrumentDetail(params.symbol);
  const symbol = params.symbol.trim().toUpperCase();

  if (!instrument) {
    return { title: `${symbol} — Predict Future`, robots: { index: false, follow: true } };
  }

  const title = `${instrument.companyName} (${instrument.symbol}) share price, analyst opinions & news — Predict Future`;
  const description = instrument.quote
    ? `${instrument.companyName} (${instrument.symbol}) closed at ₹${instrument.quote.close.toLocaleString("en-IN", { maximumFractionDigits: 2 })} (${instrument.quote.changePercent >= 0 ? "+" : ""}${instrument.quote.changePercent.toFixed(2)}%) on ${formatIstSessionDate(instrument.quote.sessionDate)}. Analyst calls, live news and exchange filings, sourced back to the original article.`
    : `${instrument.companyName} (${instrument.symbol}) — analyst calls, live news and exchange filings, sourced back to the original article. Not investment advice.`;

  const url = `https://predictfuture.app/instruments/${instrument.symbol}`;

  return {
    title,
    description,
    alternates: { canonical: url },
    // Indexable once we have a real price quote — a symbol we only know
    // through news/filings/opinions (no bhavcopy row yet) is too thin a page
    // to submit to search. BSE Expansion Phase 3A (2026-08-12), reworked
    // 2026-08-14 to a turnover floor — a below-floor BSE-only equity
    // (lib/finance/bseEquity.ts's MIN_BSE_EQUITY_TURNOVER_RS) is EXPLICITLY
    // noindexed even though it has a real quote — the brief's own "stored
    // but noindex" rule for the thinnest tail of this universe.
    robots: { index: instrument.quote != null && !instrument.belowBseEquityFloor, follow: true },
    openGraph: { title, description, type: "website", url },
    twitter: { card: "summary_large_image", title, description },
  };
}

export default async function InstrumentDetailPage({
  params,
}: {
  params: { symbol: string };
}) {
  const instrument = await fetchInstrumentDetail(params.symbol);

  if (!instrument) {
    notFound();
  }

  // Index pages have no bhavcopy series — the chart runs on the live 1D index
  // pipe instead, and the header's live overlay must hit the index endpoint
  // (the default equity path would request a nonexistent "NIFTY.NS").
  //
  // Index Universe Expansion (Sprint A, 2026-08-09) — `isIndex` covers both
  // the 5 tradable underlyings AND the view-only INDEX_UNIVERSE indices.
  // `viewOnlyIndex` drives the "Index — view only" indicator below.
  //
  // Index History Stage 2 (2026-08-11) — both flags now ALSO cover the long
  // tail (every other NSE-published index with self-owned IndexEodQuote
  // history), computed centrally in fetchInstrumentDetail (which already
  // does the DB lookup needed to tell a long-tail index apart from a plain
  // equity) rather than re-derived here. `hasLiveIndexPipe` is the narrower,
  // UNCHANGED-behavior flag: true only for the 35 symbols with a verified
  // Yahoo feed — a long-tail index has no Yahoo ticker, so it must NOT get
  // the live 1D intraday pipe (there is nothing for that endpoint to
  // resolve) or default to the "1D" timeframe (which would show an empty/
  // error state before the user ever picks a timeframe that has real data).
  // The 5 existing tradable + 30 view-only index pages are byte-for-byte
  // unchanged: hasLiveIndexPipe is computed identically to the old `isIndex`.
  const isIndex = instrument.isIndex;
  const viewOnlyIndex = instrument.viewOnlyIndex;
  const hasLiveIndexPipe = instrument.hasLiveIndexPipe;
  const indexIntradayUrl = `/api/instruments/index/${encodeURIComponent(instrument.symbol)}/intraday`;

  // Sentiment date-range link-out (2026-08-09 feature) — scoped to this
  // instrument's own /opinions filter value when InstrumentAlias has
  // resolved one, otherwise the plain unscoped /opinions link (never a dead
  // link). See resolveCanonicalNameForSymbol's own doc comment for why this
  // is NOT `instrument.companyName`.
  const opinionsCanonicalName = await resolveCanonicalNameForSymbol(instrument.symbol);
  const opinionsExploreHref = opinionsCanonicalName
    ? `/opinions?instrument=${encodeURIComponent(opinionsCanonicalName)}`
    : "/opinions";

  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "Organization",
    name: instrument.companyName,
    url: `https://predictfuture.app/instruments/${instrument.symbol}`,
  };

  return (
    <div className="space-y-8">
      {/* eslint-disable-next-line react/no-danger */}
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />

      <QuoteHeader
        symbol={instrument.symbol}
        companyName={instrument.companyName}
        intradayEndpoint={hasLiveIndexPipe ? indexIntradayUrl : undefined}
        viewOnlyIndex={viewOnlyIndex}
        isEtf={instrument.isEtf || instrument.isBseFund}
        exchange={instrument.isBseIndex || instrument.isBseEquity ? "BSE" : "NSE"}
        quote={
          instrument.quote
            ? {
                close: instrument.quote.close,
                prevClose: instrument.quote.prevClose,
                changePercent: instrument.quote.changePercent,
                volume: instrument.quote.volume,
                deliveryPct: instrument.quote.deliveryPct,
                sessionDateIso: instrument.quote.sessionDate.toISOString(),
                sessionDateLabel: formatIstSessionDate(instrument.quote.sessionDate),
              }
            : null
        }
      />

      <Card>
        <CardContent className="p-5">
          <p className="mb-3 text-xs font-semibold uppercase tracking-[0.2em] text-ink-400">
            Price history
          </p>
          <PriceChart
            symbol={instrument.symbol}
            series={instrument.spark.map((pt) => ({
              date: formatIstSessionDate(pt.sessionDate),
              close: pt.close,
            }))}
            intradaySource={hasLiveIndexPipe ? { url: indexIntradayUrl } : undefined}
            defaultTimeframe={hasLiveIndexPipe ? "1D" : undefined}
            // Intraday Chart Ranges (2026-08-16) — server-computed eligibility
            // (lib/finance/instrument.ts's own doc has the full per-class
            // table) so PriceChart never has to guess/re-derive which
            // instrument classes get a real 1W/1M candles fetch attempt.
            supportsIntradayRanges={instrument.supportsIntradayRanges}
            // "Serious Charts" Program, Workstream B (2026-08-17) — the
            // self-captured-series sibling of `intradaySource` above, for a
            // long-tail NSE index with at least one accrued
            // IndexIntradaySnapshot session (mutually exclusive with
            // `supportsIntradayRanges` being true — see instrument.ts's
            // `hasSelfCapturedIntraday` doc). `indexName` is already
            // resolved server-side by fetchInstrumentDetail; this proxy URL
            // just carries it through as a query param, no client-side
            // resolution needed.
            selfCapturedSource={
              instrument.hasSelfCapturedIntraday && instrument.selfCapturedIndexName
                ? {
                    url: `/api/instruments/index/${encodeURIComponent(instrument.symbol)}/captured-intraday?indexName=${encodeURIComponent(instrument.selfCapturedIndexName)}`,
                  }
                : undefined
            }
            // Index History Stage 2 (2026-08-11) — a long-tail index isn't a
            // real NSE equity ticker, so the chart's default bare-equity
            // quote poll (`/api/instruments/[symbol]/quote`) must be
            // explicitly disabled for it — exactly the background-hammering
            // footgun the /bonds page regression (see this prop's own doc
            // comment in price-chart.tsx) already taught this codebase:
            // `intradaySource` being set is NOT a reliable proxy for "don't
            // poll" on its own, every non-equity caller must say so. A
            // hasLiveIndexPipe index already avoided this (intradaySource
            // being set alone suppresses the default) — passing `false`
            // here is a no-op for it, explicit and harmless either way.
            //
            // BSE Expansion Phase 3A (2026-08-12) — a BSE-only equity is the
            // SAME EOD-only tier (no live intraday pipe, `intradaySource`
            // unset) — the default equity poll would hit
            // `/api/instruments/NSDL.BO/quote` forever for nothing (that
            // route resolves NSE symbols only), so it must be explicitly
            // disabled here too, same footgun this comment already warns
            // about for indices.
            quoteSource={isIndex || instrument.isBseEquity ? false : undefined}
            // "Serious Charts" Program, Workstream C (2026-08-17) — omitted
            // entirely (not `false`/a disabled state) when
            // supportsWorkbenchTrading is false, per Decision 3 of the CTO
            // brief: an unexplained missing button here is fine, this is a
            // convenience shortcut the page never promised, unlike a
            // trading ticket's Buy button.
            workbenchSymbol={instrument.supportsWorkbenchTrading ? instrument.symbol : undefined}
          />
        </CardContent>
      </Card>

      {/* Founder correction 2026-08-09: the 2026-08-09 layout-width pass had
          moved sentiment into a sticky sidebar next to Analyst opinions
          (side-by-side). Reverted per explicit feedback ("why Analyst
          opinion and analyst sentiment are side by side on instrument,
          previous one was good") — back to stacked full-width blocks,
          sentiment first, opinions below. Do not re-introduce the sidebar
          layout here without an explicit founder ask. */}
      <InstrumentSentimentGauge sentiment={instrument.sentiment} exploreHref={opinionsExploreHref} />

      <section className="space-y-4">
        <h2 className="text-xl font-semibold text-ink-900">Analyst opinions</h2>
        {instrument.opinions.length === 0 ? (
          <Card>
            <CardContent className="p-6 text-sm text-ink-500">
              No analyst calls on {instrument.companyName} in the last {instrument.sentiment.lookbackDays} days.
            </CardContent>
          </Card>
        ) : (
          <Card>
            {/* Founder 2026-07-26: every call visible — the card scrolls instead of truncating at 10. */}
            <CardContent className="max-h-[560px] overflow-y-auto">
              <ExpandableCallsTable
                calls={instrument.opinions.map((o) => ({
                  id: o.id,
                  quote: o.quote,
                  headline: o.headline,
                  instrument: o.instrument,
                  instrumentTicker: o.instrumentTicker,
                  direction: o.direction,
                  sourceUrl: o.sourceUrl,
                  publishedAtLabel: formatIstSessionDate(o.publishedAt),
                  resolutionStatus: o.resolutionStatus,
                  resolutionNote: o.resolutionNote,
                  resolvedAtLabel: o.resolvedAt ? formatIstSessionDate(o.resolvedAt) : null,
                  analyst: { name: o.expert.name, slug: o.expert.slug, organization: o.expert.organization },
                }))}
              />
            </CardContent>
          </Card>
        )}
      </section>

      {/* Instrument Page v2 — commodity context ("is this analyst's thesis
          backed by real earnings growth?"), deliberately placed AFTER
          Analyst opinions (the moat) and BEFORE PulseTabs — non-negotiable
          ordering per the CTO assignment brief's thesis-alignment section.
          (PerformanceStrip removed 2026-08-02 per founder — price-return
          chips read as noise next to the fundamentals charts; the price
          chart's timeframes already tell the returns story. Component kept
          at components/finance/performance-strip.tsx for possible reuse.)

          Indices Consolidation (2026-08-12) — an index has no financial
          statements (FundamentalsPanel always rendered nothing here before
          this change, see that component's own `return null` gate), so this
          SAME slot becomes index-shaped instead: metrics (P/E, P/B, div
          yield, day/52w range, advance/decline — also the retired slim
          `/indices/[slug]` page's entire stat surface) + composition
          (member stocks, ranked by today's move) for an equity this is not.
          Never both — `isIndex` is mutually exclusive with FundamentalsPanel
          having anything to show (enrichment is always empty for an index). */}
      {instrument.isIndex ? (
        <>
          {instrument.indexMetrics && (
            <IndexMetricsPanel
              symbol={instrument.symbol}
              metrics={instrument.indexMetrics}
              // Founder 2026-08-12: while F&O is gated "coming soon", the
              // "Tradable in the F&O options terminal" CTA must not show —
              // it would advertise a surface the gate blocks. Flag-driven,
              // so launching options restores it with zero code changes.
              isTradable={!instrument.viewOnlyIndex && isOptionsTradingEnabled()}
            />
          )}
          {instrument.indexComposition && (
            <IndexCompositionPanel
              constituents={instrument.indexComposition}
              advances={instrument.indexMetrics?.advances}
              declines={instrument.indexMetrics?.declines}
            />
          )}
          {/* ETF Layer (2026-08-12) Ask 3 — cross-link glue: registry-confirmed ETFs verified to track this index. */}
          <EtfTrackingList etfs={instrument.etfsTrackingIndex} />
          <p className="text-center text-xs text-ink-400">Index levels are informational only, not investment advice.</p>
        </>
      ) : instrument.isEtf && instrument.etfDetails ? (
        // ETF Layer (2026-08-12) — an ETF has no income statement/CEO/
        // employees to show (Yahoo's assetProfile returns null for every
        // NSE ETF tested — see EtfDetailsPanel's own doc), so this branch
        // swaps FundamentalsPanel entirely rather than rendering it
        // alongside a mostly-empty ETF panel. "Never both", same rule the
        // isIndex branch above already follows.
        <EtfDetailsPanel
          symbol={instrument.symbol}
          fundName={instrument.companyName}
          etf={instrument.etfDetails}
          trailingPE={instrument.enrichment.keyStats?.trailingPE}
        />
      ) : instrument.isBseFund && instrument.bseFundDetails ? (
        // BSE Expansion Phase 3B (2026-08-14) — the BSE-only-fund sibling of
        // the branch above, same "never both" rule. See bseFundRegistry.ts's
        // own doc for why the "Tracks" resolution is a weaker, honestly
        // labeled guarantee than the NSE branch's exact-Underlying-column
        // match.
        <EtfDetailsPanel
          symbol={instrument.symbol}
          fundName={instrument.companyName}
          etf={instrument.bseFundDetails}
          trailingPE={instrument.enrichment.keyStats?.trailingPE}
          exchange="BSE"
          bseScripCode={instrument.bseFundDetails.scripCode}
        />
      ) : (
        <>
          <FundamentalsPanel
            symbol={instrument.symbol}
            companyName={instrument.companyName}
            annualRevenue={instrument.enrichment.annualRevenue}
            annualNetIncome={instrument.enrichment.annualNetIncome}
            annualDilutedEps={instrument.enrichment.annualDilutedEps}
            quarterlyRevenue={instrument.enrichment.quarterlyRevenue}
            quarterlyNetIncome={instrument.enrichment.quarterlyNetIncome}
            quarterlyDilutedEps={instrument.enrichment.quarterlyDilutedEps}
            dividends={instrument.enrichment.dividends}
            keyStats={instrument.enrichment.keyStats}
            debtCoverage={instrument.enrichment.debtCoverage}
            fetchedAt={instrument.enrichment.fundamentalsFetchedAt}
            isBseOnlyEquity={instrument.isBseEquity}
            bseScripCode={instrument.bseScripCode}
          />
          {/* Index Membership (2026-08-12) — plain-equity-only, symmetric with
              EtfTrackingList on the index side (see that component's own
              doc). Never rendered for an ETF (isEtf is the branch above, not
              this one) — an ETF page already shows its own "Tracks: <index>"
              line via EtfDetailsPanel, and a second membership section would
              be redundant for the one index an ETF actually cares about.
              Self-hides when the reverse map has nothing for this symbol
              (indexMembership.ts's honest-until-warm/zero-membership gate). */}
          <IndexMembershipStrip memberships={instrument.indexMembership} />
        </>
      )}

      <PulseTabs
        newsSymbol={instrument.symbol}
        news={instrument.news.map((item) => ({
          id: item.id,
          tickerSymbol: item.tickerSymbol,
          headline: item.headline,
          publisher: item.publisher,
          sourceUrl: item.sourceUrl,
          publishedAt: item.publishedAt.toISOString(),
          timeLabel: formatRelativeTime(item.publishedAt),
          summary: item.summary,
        }))}
        filings={instrument.filings.map((filing) => ({
          id: filing.id,
          source: filing.source,
          companyName: filing.companyName,
          eventTypeLabel: EVENT_TYPE_LABELS[filing.eventType] ?? filing.eventType,
          headline: filing.headline,
          detailUrl: filing.detailUrl,
          timeLabel: formatRelativeTime(filing.announcedAt),
        }))}
      />

      <AnalystDisclaimerFooter />
    </div>
  );
}

