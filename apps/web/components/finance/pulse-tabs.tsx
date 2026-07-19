"use client";

/**
 * Tabbed Stock News / Filings & Announcements section for /pulse.
 *
 * Replaces the old layout (news list + filings buried in a collapsed <details>
 * at the bottom — a straight port of mobile's space-saving pattern). On web the
 * two feeds are peers: one tab bar at the top of the section, each tab showing
 * a longer server-fetched list with incremental "Show more" (filings run to
 * thousands per week, so the server caps what ships and the footer says so).
 *
 * Time labels arrive preformatted from the server (ISR page, 5-min revalidate)
 * so this stays purely presentational.
 */

import { useState } from "react";
import { ArrowUpRight } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";

export type PulseNewsItem = {
  id: string;
  tickerSymbol: string;
  headline: string;
  publisher: string;
  sourceUrl: string;
  timeLabel: string;
};

export type PulseFilingItem = {
  id: string;
  source: string;
  companyName: string;
  eventTypeLabel: string;
  headline: string;
  detailUrl: string | null;
  timeLabel: string;
};

const NEWS_PAGE = 20;
const FILINGS_PAGE = 15;

export function PulseTabs({ news, filings }: { news: PulseNewsItem[]; filings: PulseFilingItem[] }) {
  const [tab, setTab] = useState<"news" | "filings">("news");
  const [newsCount, setNewsCount] = useState(NEWS_PAGE);
  const [filingsCount, setFilingsCount] = useState(FILINGS_PAGE);

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <TabButton active={tab === "news"} onClick={() => setTab("news")}>
          Stock news
        </TabButton>
        <TabButton active={tab === "filings"} onClick={() => setTab("filings")}>
          Filings &amp; announcements
        </TabButton>
      </div>

      {tab === "news" ? (
        news.length === 0 ? (
          <EmptyCard label="No stock news captured yet." />
        ) : (
          <Card>
            <CardContent className="divide-y divide-ink-100 p-0">
              {news.slice(0, newsCount).map((item) => (
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
                      {item.publisher} · {item.timeLabel}
                    </p>
                  </div>
                  <ArrowUpRight className="mt-1 h-3.5 w-3.5 shrink-0 text-ink-300" />
                </a>
              ))}
              <ShowMoreFooter
                shown={Math.min(newsCount, news.length)}
                total={news.length}
                onMore={() => setNewsCount((c) => c + NEWS_PAGE)}
              />
            </CardContent>
          </Card>
        )
      ) : filings.length === 0 ? (
        <EmptyCard label="No exchange filings captured yet." />
      ) : (
        <Card>
          <CardContent className="p-5">
            <ul className="divide-y divide-ink-100">
              {filings.slice(0, filingsCount).map((filing) => (
                <li key={filing.id} className="py-3">
                  <div className="flex flex-wrap items-center gap-2 text-xs text-ink-400">
                    <Badge>{filing.source}</Badge>
                    <Badge>{filing.eventTypeLabel}</Badge>
                    <span>{filing.timeLabel}</span>
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
            <ShowMoreFooter
              shown={Math.min(filingsCount, filings.length)}
              total={filings.length}
              onMore={() => setFilingsCount((c) => c + FILINGS_PAGE)}
            />
          </CardContent>
        </Card>
      )}
    </section>
  );
}

function EmptyCard({ label }: { label: string }) {
  return (
    <Card>
      <CardContent className="p-6 text-sm text-ink-500">{label}</CardContent>
    </Card>
  );
}

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-full px-4 py-1.5 text-sm font-medium transition-colors ${
        active
          ? "bg-ink-900 text-white"
          : "border border-ink-200 bg-white text-ink-600 hover:bg-ink-50"
      }`}
    >
      {children}
    </button>
  );
}

function ShowMoreFooter({
  shown,
  total,
  onMore,
}: {
  shown: number;
  total: number;
  onMore: () => void;
}) {
  if (shown >= total) {
    return (
      <p className="px-5 py-3 text-center text-xs text-ink-400">
        Showing the latest {total} — older items roll off as new ones arrive.
      </p>
    );
  }
  return (
    <button
      type="button"
      onClick={onMore}
      className="w-full border-t border-ink-100 py-3 text-center text-xs font-medium text-ink-500 transition-colors hover:bg-ink-50 hover:text-ink-700"
    >
      Show more ({shown} of {total})
    </button>
  );
}
