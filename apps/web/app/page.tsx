import type { Metadata } from "next";
import Link from "next/link";
import { ArrowUpRight, FileSearch, Gauge, ScrollText } from "lucide-react";

import { BigCallCard } from "@/components/finance/big-call-card";
import { DirectionChip, VerdictBadge } from "@/components/finance/analyst-badges";
import { AnalystDisclaimerFooter } from "@/components/finance/disclaimer-footer";
import { PublicHeader } from "@/components/finance/public-header";
import { SentimentGauge } from "@/components/finance/sentiment-gauge";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { fetchIndexableAnalysts, sortAnalysts } from "@/lib/finance/analysts";
import { getTodaysBigCall } from "@/lib/finance/bigCall";
import { getSentimentSplit } from "@/lib/finance/sentiment";
import { prisma } from "@/lib/prisma";
import { formatDateOnly, formatPercent } from "@/lib/utils";

export const revalidate = 900;

// Title/description are inherited from the root layout (app/layout.tsx) — that
// copy already IS the homepage's Analyst Scorecard positioning, so this only
// adds the canonical/OG url rather than duplicating the title string.
export const metadata: Metadata = {
  alternates: { canonical: "https://predictfuture.app" },
  openGraph: { url: "https://predictfuture.app" },
};

const LATEST_GRADED_LIMIT = 5;
const TOP_ANALYSTS_LIMIT = 5;

async function fetchLatestGradedCalls() {
  return prisma.expertOpinion.findMany({
    where: {
      suppressedAt: null,
      resolutionStatus: { in: ["RESOLVED_HIT", "RESOLVED_MISS"] },
    },
    orderBy: { resolvedAt: "desc" },
    take: LATEST_GRADED_LIMIT,
    select: {
      id: true,
      quote: true,
      instrument: true,
      direction: true,
      sourceUrl: true,
      resolutionStatus: true,
      resolvedAt: true,
      expert: { select: { name: true, slug: true, avatarUrl: true, organization: true } },
    },
  });
}

export default async function HomePage() {
  const [sentiment, bigCall, latestGraded, analysts] = await Promise.all([
    getSentimentSplit(),
    getTodaysBigCall(),
    fetchLatestGradedCalls(),
    fetchIndexableAnalysts(),
  ]);

  const topAnalysts = sortAnalysts(analysts, "accuracy").slice(0, TOP_ANALYSTS_LIMIT);

  return (
    <div className="min-h-screen bg-[#f5f7fb]">
      <PublicHeader />

      <main className="mx-auto max-w-5xl space-y-16 px-4 py-10 sm:px-6">
        <Hero sentiment={sentiment} bigCall={bigCall} />

        <LatestGradedCalls calls={latestGraded} />

        <TopAnalysts analysts={topAnalysts} />

        <HowItWorks />

        <AnalystDisclaimerFooter />
      </main>
    </div>
  );
}

function Hero({
  sentiment,
  bigCall,
}: {
  sentiment: Awaited<ReturnType<typeof getSentimentSplit>>;
  bigCall: Awaited<ReturnType<typeof getTodaysBigCall>>;
}) {
  return (
    <section className="space-y-6 pt-4">
      <div className="max-w-2xl space-y-4">
        <span className="inline-flex items-center gap-2 rounded-full border border-ink-200 bg-white px-3 py-1 text-xs font-medium text-ink-600">
          <Gauge className="h-3.5 w-3.5 text-signal-sky" />
          India&rsquo;s Analyst Scorecard
        </span>
        <h1 className="text-4xl font-semibold tracking-tight text-ink-900 sm:text-5xl">
          Track which market analysts are actually right.
        </h1>
        <p className="text-lg leading-8 text-ink-600">
          We track public calls from Indian market analysts — TV, print, and online — and grade every
          one HIT or MISS against what actually happened, sourced back to the original article. No
          spin, no cherry-picking, just the record.
        </p>
        <div className="flex flex-wrap gap-3 pt-1">
          <Link
            href="/analysts"
            className="inline-flex items-center gap-2 rounded-2xl bg-ink-900 px-5 py-3 text-sm font-semibold text-white transition hover:bg-ink-700"
          >
            See the Scorecard
            <ArrowUpRight className="h-4 w-4" />
          </Link>
          <Link
            href="/opinions"
            className="inline-flex items-center gap-2 rounded-2xl border border-ink-200 bg-white px-5 py-3 text-sm font-semibold text-ink-900 transition hover:border-signal-sky hover:text-signal-sky"
          >
            Browse every call
          </Link>
        </div>
      </div>

      <div className="grid gap-5 lg:grid-cols-[1.1fr_0.9fr] lg:items-start">
        <SentimentGauge split={sentiment} title="Market-wide sentiment" />
        <BigCallCard result={bigCall} />
      </div>
    </section>
  );
}

function LatestGradedCalls({ calls }: { calls: Awaited<ReturnType<typeof fetchLatestGradedCalls>> }) {
  if (calls.length === 0) {
    return null;
  }

  return (
    <section className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-signal-sky">Latest verdicts</p>
          <h2 className="mt-1 text-2xl font-semibold text-ink-900">Recently graded calls</h2>
        </div>
        <Link href="/opinions?status=graded" className="text-sm font-medium text-ink-500 hover:text-ink-900">
          See all
        </Link>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        {calls.map((call) => (
          <Card key={call.id} className="h-full">
            <CardContent className="space-y-3 p-5">
              <div className="flex items-center justify-between gap-2">
                <div className="flex min-w-0 items-center gap-2">
                  <Avatar name={call.expert.name} src={call.expert.avatarUrl} className="h-8 w-8 text-xs" />
                  {call.expert.slug ? (
                    <Link
                      href={`/analysts/${call.expert.slug}`}
                      className="truncate text-sm font-semibold text-ink-900 hover:underline"
                    >
                      {call.expert.name}
                    </Link>
                  ) : (
                    <p className="truncate text-sm font-semibold text-ink-900">{call.expert.name}</p>
                  )}
                </div>
                <VerdictBadge status={call.resolutionStatus} />
              </div>
              <p className="line-clamp-2 text-sm leading-6 text-ink-600">&ldquo;{call.quote}&rdquo;</p>
              <div className="flex flex-wrap items-center gap-2 text-xs text-ink-400">
                {call.instrument && <Badge>{call.instrument}</Badge>}
                <DirectionChip direction={call.direction} />
                {call.resolvedAt && <span>Graded {formatDateOnly(call.resolvedAt)}</span>}
              </div>
              <a
                href={call.sourceUrl}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 text-xs font-medium text-signal-sky hover:underline"
              >
                Source
                <ArrowUpRight className="h-3 w-3" />
              </a>
            </CardContent>
          </Card>
        ))}
      </div>
    </section>
  );
}

function TopAnalysts({ analysts }: { analysts: Awaited<ReturnType<typeof fetchIndexableAnalysts>> }) {
  if (analysts.length === 0) {
    return null;
  }

  return (
    <section className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-signal-sky">Leaderboard</p>
          <h2 className="mt-1 text-2xl font-semibold text-ink-900">Top analysts by hit rate</h2>
        </div>
        <Link href="/analysts" className="text-sm font-medium text-ink-500 hover:text-ink-900">
          Full scorecard
        </Link>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        {analysts.map((analyst) => (
          <Link key={analyst.id} href={`/analysts/${analyst.slug}`}>
            <Card className="h-full transition hover:border-signal-sky/40">
              <CardContent className="flex items-center gap-4 p-5">
                <Avatar name={analyst.name} src={analyst.avatarUrl} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <p className="truncate text-base font-semibold text-ink-900">{analyst.name}</p>
                    {analyst.verified && <Badge variant="accent">Verified</Badge>}
                  </div>
                  <p className="truncate text-sm text-ink-500">{analyst.organization}</p>
                </div>
                <div className="text-right">
                  <p className="text-xl font-semibold text-ink-900">{formatPercent(analyst.stats.hitRate ?? 0)}</p>
                  <p className="text-xs text-ink-400">{analyst.stats.resolvedCount} graded calls</p>
                </div>
              </CardContent>
            </Card>
          </Link>
        ))}
      </div>
    </section>
  );
}

function HowItWorks() {
  const steps = [
    {
      icon: FileSearch,
      title: "We track the calls",
      body: "Every public prediction an Indian market analyst makes on TV, in print, or online — captured with a link back to the original source.",
    },
    {
      icon: Gauge,
      title: "We grade them",
      body: "Once a call's timeframe passes, we check it against real market data and mark it HIT or MISS. No editorializing, no judgment calls.",
    },
    {
      icon: ScrollText,
      title: "You see the record",
      body: "Every analyst's track record is public — hits and misses both — so you can judge who's actually worth listening to.",
    },
  ];

  return (
    <section>
      <div className="mb-8 max-w-2xl">
        <p className="text-xs font-semibold uppercase tracking-[0.24em] text-signal-sky">How it works</p>
        <h2 className="mt-3 text-3xl font-semibold tracking-tight text-ink-900">
          Accountability for market punditry.
        </h2>
      </div>
      <ol className="grid gap-5 lg:grid-cols-3">
        {steps.map((step, i) => (
          <li key={step.title} className="rounded-3xl border border-white/70 bg-white/80 p-6 backdrop-blur">
            <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-ink-900 text-sm font-semibold text-white">
              {i + 1}
            </div>
            <h3 className="mt-5 flex items-center gap-2 text-lg font-semibold text-ink-900">
              <step.icon className="h-4 w-4 text-signal-sky" />
              {step.title}
            </h3>
            <p className="mt-2 text-sm leading-7 text-ink-600">{step.body}</p>
          </li>
        ))}
      </ol>
    </section>
  );
}
