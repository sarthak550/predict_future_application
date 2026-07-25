import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { AnalystDisclaimerFooter } from "@/components/finance/disclaimer-footer";
import { ExpandableCallsTable } from "@/components/finance/expandable-calls-table";
import { FundamentalsPanel } from "@/components/finance/fundamentals-panel";
import { InstrumentSentimentGauge } from "@/components/finance/instrument-sentiment-gauge";
import { PerformanceStrip } from "@/components/finance/performance-strip";
import { PriceChart } from "@/components/finance/price-chart";
import { PulseTabs } from "@/components/finance/pulse-tabs";
import { QuoteHeader } from "@/components/finance/quote-header";
import { Card, CardContent } from "@/components/ui/card";
import { isIndexOptionUnderlying } from "@predict-future/business-rules/papertrading/optionContract";

import { fetchInstrumentDetail } from "@/lib/finance/instrument";
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
    // to submit to search.
    robots: { index: instrument.quote != null, follow: true },
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
  const isIndex = isIndexOptionUnderlying(instrument.symbol);
  const indexIntradayUrl = `/api/instruments/index/${encodeURIComponent(instrument.symbol)}/intraday`;

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
        intradayEndpoint={isIndex ? indexIntradayUrl : undefined}
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
            intradaySource={isIndex ? { url: indexIntradayUrl } : undefined}
            defaultTimeframe={isIndex ? "1D" : undefined}
          />
        </CardContent>
      </Card>

      <InstrumentSentimentGauge sentiment={instrument.sentiment} />

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
                  analyst: { name: o.expert.name, slug: o.expert.slug },
                }))}
              />
            </CardContent>
          </Card>
        )}
      </section>

      {/* Instrument Page v2 — commodity context ("is this analyst's thesis
          backed by real earnings growth?"), deliberately placed AFTER
          Analyst opinions (the moat) and BEFORE PulseTabs — non-negotiable
          ordering per the CTO assignment brief's thesis-alignment section. */}
      <PerformanceStrip performance={instrument.performance} />
      <FundamentalsPanel
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
      />

      <PulseTabs
        news={instrument.news.map((item) => ({
          id: item.id,
          tickerSymbol: item.tickerSymbol,
          headline: item.headline,
          publisher: item.publisher,
          sourceUrl: item.sourceUrl,
          timeLabel: formatRelativeTime(item.publishedAt),
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

