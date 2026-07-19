import type { Metadata } from "next";
import { ArrowUpRight, ChevronDown, TrendingDown, TrendingUp } from "lucide-react";

import { AnalystDisclaimerFooter } from "@/components/finance/disclaimer-footer";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import {
  fetchLatestFilings,
  fetchLatestNews,
  fetchTopMovers,
  type FilingRow,
  type MoverRow,
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
  const [movers, news, filings] = await Promise.all([
    fetchTopMovers(),
    fetchLatestNews(),
    fetchLatestFilings(),
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

      <TopMoversSection movers={movers} />

      <StockNewsSection news={news} />

      <FilingsSection filings={filings} />

      <AnalystDisclaimerFooter />
    </div>
  );
}

function TopMoversSection({ movers }: { movers: Awaited<ReturnType<typeof fetchTopMovers>> }) {
  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-xl font-semibold text-ink-900">Top movers</h2>
        {movers.asOf && <p className="text-xs text-ink-400">As of {formatRelativeTime(movers.asOf)}</p>}
      </div>

      {movers.gainers.length === 0 && movers.losers.length === 0 ? (
        <Card>
          <CardContent className="p-6 text-sm text-ink-500">
            No mover data captured yet — this fills in once the market-hours tracker has run.
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          <MoverList title="Gainers" rows={movers.gainers} tone="up" />
          <MoverList title="Losers" rows={movers.losers} tone="down" />
        </div>
      )}
    </section>
  );
}

function MoverList({ title, rows, tone }: { title: string; rows: MoverRow[]; tone: "up" | "down" }) {
  const Icon = tone === "up" ? TrendingUp : TrendingDown;
  const toneClass = tone === "up" ? "text-emerald-600" : "text-rose-600";

  return (
    <Card>
      <CardContent className="p-5">
        <p className={`mb-3 flex items-center gap-1.5 text-sm font-semibold ${toneClass}`}>
          <Icon className="h-4 w-4" />
          {title}
        </p>
        {rows.length === 0 ? (
          <p className="text-sm text-ink-400">No {title.toLowerCase()} captured this session.</p>
        ) : (
          <ul className="divide-y divide-ink-100">
            {rows.map((row) => (
              <li key={row.tickerSymbol} className="flex items-center justify-between gap-3 py-2.5">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-ink-900">{row.companyName}</p>
                  <p className="text-xs text-ink-400">{row.tickerSymbol}</p>
                </div>
                <div className="text-right">
                  <p className={`text-sm font-semibold ${toneClass}`}>
                    {row.changePercent > 0 ? "+" : ""}
                    {row.changePercent.toFixed(2)}%
                  </p>
                  {row.isUnusualVolume && (
                    <p className="text-[10px] font-medium uppercase tracking-wide text-signal-amber">
                      Unusual volume
                    </p>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

function StockNewsSection({ news }: { news: Awaited<ReturnType<typeof fetchLatestNews>> }) {
  return (
    <section className="space-y-4">
      <h2 className="text-xl font-semibold text-ink-900">Stock news</h2>

      {news.length === 0 ? (
        <Card>
          <CardContent className="p-6 text-sm text-ink-500">No stock news captured yet.</CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="divide-y divide-ink-100 p-0">
            {news.map((item) => (
              <a
                key={item.id}
                href={item.sourceUrl}
                target="_blank"
                rel="noreferrer"
                className="flex items-start gap-3 px-5 py-4 transition hover:bg-ink-50/60"
              >
                <Badge className="mt-0.5 shrink-0">{item.tickerSymbol.replace(/^BSE:/i, "")}</Badge>
                <div className="min-w-0 flex-1">
                  <p className="text-sm leading-6 text-ink-900">{item.headline}</p>
                  <p className="mt-1 text-xs text-ink-400">
                    {item.publisher} · {formatRelativeTime(item.publishedAt)}
                  </p>
                </div>
                <ArrowUpRight className="mt-1 h-3.5 w-3.5 shrink-0 text-ink-300" />
              </a>
            ))}
          </CardContent>
        </Card>
      )}
    </section>
  );
}

function FilingsSection({ filings }: { filings: FilingRow[] }) {
  return (
    <details className="group rounded-[28px] border border-ink-100 bg-white/60">
      <summary className="flex cursor-pointer list-none items-center justify-between px-5 py-4">
        <span className="text-lg font-semibold text-ink-900">Filings &amp; announcements</span>
        <ChevronDown className="h-4 w-4 text-ink-400 transition group-open:rotate-180" />
      </summary>
      <div className="px-5 pb-5">
        {filings.length === 0 ? (
          <p className="text-sm text-ink-500">No exchange filings captured yet.</p>
        ) : (
          <ul className="divide-y divide-ink-100">
            {filings.map((filing) => (
              <li key={filing.id} className="py-3">
                <div className="flex flex-wrap items-center gap-2 text-xs text-ink-400">
                  <Badge>{filing.source}</Badge>
                  <Badge>{EVENT_TYPE_LABELS[filing.eventType] ?? filing.eventType}</Badge>
                  <span>{formatRelativeTime(filing.announcedAt)}</span>
                </div>
                <p className="mt-1.5 text-sm text-ink-800">
                  <span className="font-medium">{filing.companyName}</span> — {filing.headline}
                </p>
                {filing.detailUrl && (
                  <a
                    href={filing.detailUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="mt-1 inline-flex items-center gap-1 text-xs font-medium text-signal-sky hover:underline"
                  >
                    View filing
                    <ArrowUpRight className="h-3 w-3" />
                  </a>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </details>
  );
}
