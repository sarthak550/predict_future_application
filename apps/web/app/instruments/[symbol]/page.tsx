import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { TrendingDown, TrendingUp } from "lucide-react";

import { AnalystDisclaimerFooter } from "@/components/finance/disclaimer-footer";
import { ExpandableCallsTable } from "@/components/finance/expandable-calls-table";
import { InstrumentSentimentGauge } from "@/components/finance/instrument-sentiment-gauge";
import { PriceChart } from "@/components/finance/price-chart";
import { PulseTabs } from "@/components/finance/pulse-tabs";
import { Card, CardContent } from "@/components/ui/card";
import { fetchInstrumentDetail, type InstrumentDetail } from "@/lib/finance/instrument";
import { formatDateOnly, formatNumericValue, formatRelativeTime } from "@/lib/utils";

export const revalidate = 900;

const EVENT_TYPE_LABELS: Record<string, string> = {
  MERGER_ACQUISITION: "M&A",
  RESULTS: "Results",
  BOARD_MEETING: "Board Meeting",
  RATING_CHANGE: "Rating Change",
  OTHER_MATERIAL: "Material Update",
};

/** "₹1,830.50" — Indian digit grouping, at most 2 decimal places. */
function formatRupees(value: number): string {
  return `₹${value.toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;
}

/** "+₹52.00" / "-₹12.30" — signed rupee change. */
function formatSignedRupees(value: number): string {
  const sign = value > 0 ? "+" : value < 0 ? "-" : "";
  return `${sign}₹${Math.abs(value).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;
}

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
    ? `${instrument.companyName} (${instrument.symbol}) closed at ₹${instrument.quote.close.toLocaleString("en-IN", { maximumFractionDigits: 2 })} (${instrument.quote.changePercent >= 0 ? "+" : ""}${instrument.quote.changePercent.toFixed(2)}%) on ${formatDateOnly(instrument.quote.sessionDate)}. Analyst calls, live news and exchange filings, sourced back to the original article.`
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

      <QuoteHeader instrument={instrument} />

      <Card>
        <CardContent className="p-5">
          <p className="mb-3 text-xs font-semibold uppercase tracking-[0.2em] text-ink-400">
            Price history
          </p>
          <PriceChart
            series={instrument.spark.map((pt) => ({
              date: pt.sessionDate.toISOString().slice(0, 10),
              close: pt.close,
            }))}
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
            <CardContent>
              <ExpandableCallsTable
                calls={instrument.opinions.map((o) => ({
                  id: o.id,
                  quote: o.quote,
                  headline: o.headline,
                  instrument: o.instrument,
                  direction: o.direction,
                  sourceUrl: o.sourceUrl,
                  publishedAtLabel: formatDateOnly(o.publishedAt),
                  resolutionStatus: o.resolutionStatus,
                  resolutionNote: o.resolutionNote,
                  resolvedAtLabel: o.resolvedAt ? formatDateOnly(o.resolvedAt) : null,
                  analyst: { name: o.expert.name, slug: o.expert.slug },
                }))}
              />
            </CardContent>
          </Card>
        )}
      </section>

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

function QuoteHeader({ instrument }: { instrument: InstrumentDetail }) {
  const { quote } = instrument;
  const isUp = quote != null && quote.changePercent >= 0;
  const TrendIcon = isUp ? TrendingUp : TrendingDown;

  return (
    <Card className="overflow-hidden border-0 bg-ink-900 text-white">
      <CardContent className="p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-white/50">{instrument.symbol} · NSE</p>
            <h1 className="mt-1 text-2xl font-semibold">{instrument.companyName}</h1>
          </div>

          {quote ? (
            <div className="text-right">
              <p className="text-3xl font-semibold">{formatRupees(quote.close)}</p>
              <p className={`mt-1 flex items-center justify-end gap-1 text-sm font-semibold ${isUp ? "text-emerald-400" : "text-rose-400"}`}>
                <TrendIcon className="h-4 w-4" />
                {quote.changePercent >= 0 ? "+" : ""}
                {quote.changePercent.toFixed(2)}% ({formatSignedRupees(quote.close - quote.prevClose)})
              </p>
            </div>
          ) : (
            <div className="rounded-[16px] bg-white/10 px-4 py-2 text-sm text-white/70">Price data pending</div>
          )}
        </div>

        {quote && (
          <div className="mt-5 grid grid-cols-2 gap-4 border-t border-white/10 pt-4 text-sm sm:grid-cols-4">
            <div>
              <p className="text-xs text-white/50">Prev. close</p>
              <p className="mt-0.5 font-medium">{formatRupees(quote.prevClose)}</p>
            </div>
            <div>
              <p className="text-xs text-white/50">Volume</p>
              <p className="mt-0.5 font-medium">{formatNumericValue(quote.volume, { precision: 0 })}</p>
            </div>
            {quote.deliveryPct != null && (
              <div>
                <p className="text-xs text-white/50">Delivery %</p>
                <p className="mt-0.5 font-medium">{quote.deliveryPct.toFixed(1)}%</p>
              </div>
            )}
            <div>
              <p className="text-xs text-white/50">As of</p>
              <p className="mt-0.5 font-medium">{formatDateOnly(quote.sessionDate)}</p>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
