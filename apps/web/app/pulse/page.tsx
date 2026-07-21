import type { Metadata } from "next";


import { AnalystDisclaimerFooter } from "@/components/finance/disclaimer-footer";
import { Card, CardContent } from "@/components/ui/card";
import { TopMoversCard } from "@/components/finance/top-movers-card";
import { PulseTabs } from "@/components/finance/pulse-tabs";
import {
  fetchLatestFilings,
  fetchLatestNews,
  fetchTopMovers,
  type TopMovers,
} from "@/lib/finance/marketPulse";
import { formatRelativeTime } from "@/lib/utils";

export const revalidate = 300;

export const metadata: Metadata = {
  title: "Market Pulse — Live NSE/BSE Movers, News & Filings | Predict Future",
  description:
    "Live-tracked NSE/BSE top gainers and losers, material stock news, and exchange filings — refreshed every few minutes during market hours.",
  alternates: { canonical: "https://predictfuture.app/pulse" },
  openGraph: {
    title: "Market Pulse — Predict Future",
    description: "Live NSE/BSE top movers, material stock news, and exchange filings.",
    type: "website",
    url: "https://predictfuture.app/pulse",
  },
};

const EVENT_TYPE_LABELS: Record<string, string> = {
  MERGER_ACQUISITION: "M&A",
  RESULTS: "Results",
  BOARD_MEETING: "Board Meeting",
  RATING_CHANGE: "Rating Change",
  OTHER_MATERIAL: "Material Update",
};

export default async function MarketPulsePage() {
  const [popularMovers, allMovers, news, filings] = await Promise.all([
    fetchTopMovers("popular"),
    fetchTopMovers("all"),
    fetchLatestNews(100),
    fetchLatestFilings(60),
  ]);

  return (
    <div className="space-y-10">
      <div>
        <h1 className="text-3xl font-semibold text-ink-900">Market Pulse</h1>
        <p className="mt-3 max-w-2xl text-sm leading-6 text-ink-500">
          Live NSE/BSE movers, material stock news, and exchange filings — refreshed every few minutes
          during market hours.
        </p>
      </div>

      <TopMoversSection popular={popularMovers} all={allMovers} />

      <PulseTabs
        news={news.map((item) => ({
          id: item.id,
          tickerSymbol: item.tickerSymbol,
          headline: item.headline,
          publisher: item.publisher,
          sourceUrl: item.sourceUrl,
          timeLabel: formatRelativeTime(item.publishedAt),
        }))}
        filings={filings.map((filing) => ({
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

function TopMoversSection({ popular, all }: { popular: TopMovers; all: TopMovers }) {
  const asOf = popular.asOf ?? all.asOf;
  const isEmpty =
    popular.gainers.length === 0 &&
    popular.losers.length === 0 &&
    all.gainers.length === 0 &&
    all.losers.length === 0;

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-xl font-semibold text-ink-900">Top movers</h2>
        {asOf && <p className="text-xs text-ink-400">As of {formatRelativeTime(asOf)}</p>}
      </div>

      {isEmpty ? (
        <Card>
          <CardContent className="p-6 text-sm text-ink-500">
            No mover data captured yet — this fills in once the market-hours tracker has run.
          </CardContent>
        </Card>
      ) : (
        <TopMoversCard popular={popular} all={all} />
      )}
    </section>
  );
}
