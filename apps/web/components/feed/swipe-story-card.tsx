import Link from "next/link";
import type { MarketCategory, MarketStatus, PositionSide } from "@prisma/client";
import { ArrowUpRight, MessageSquareMore, Timer, TrendingUp } from "lucide-react";

import { QuickPredictCard } from "@/components/feed/quick-predict-card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { marketCategoryLabels, marketStatusLabels } from "@/lib/constants";
import { calculateProbabilities } from "@/lib/markets/probability";
import { formatPercent, formatPoints, formatRelativeTime } from "@/lib/utils";

export type SwipeStory = {
  id: string;
  slug: string;
  headline: string;
  summary: string;
  category: MarketCategory;
  sourceName: string;
  sourceUrl: string;
  imageUrl?: string | null;
  publishedAt: string | Date;
  isFeatured: boolean;
  isTrending: boolean;
  market: {
    id: string;
    title: string;
    status: MarketStatus;
    yesPool: number;
    noPool: number;
    totalVolume: number;
    positions?: Array<{
      side: PositionSide;
      amount: number;
    }>;
  } | null;
};

export function SwipeStoryCard({
  story,
  balance,
  canTrade
}: {
  story: SwipeStory;
  balance?: number;
  canTrade: boolean;
}) {
  const market = story.market;
  const currentPosition = Array.isArray(market?.positions) ? market.positions[0] : undefined;
  const probability = calculateProbabilities(market?.yesPool ?? 0, market?.noPool ?? 0);

  return (
    <article className="h-full min-h-full snap-start">
      <div className="mx-auto h-full max-w-5xl overflow-hidden rounded-[36px] border border-white/60 bg-white/90 shadow-[0_24px_80px_rgba(15,23,42,0.10)] backdrop-blur">
        <div className="grid h-full lg:grid-cols-[1.1fr_0.9fr]">
          <div className="relative flex flex-col justify-between overflow-hidden bg-[linear-gradient(180deg,rgba(248,250,252,0.95),rgba(241,245,249,0.85))] p-6 sm:p-8">
            <div className="absolute inset-0 bg-grid bg-[size:32px_32px] opacity-20" />
            {story.imageUrl && (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={story.imageUrl}
                alt={story.headline}
                loading="lazy"
                className="absolute inset-x-0 top-0 h-56 w-full object-cover opacity-20"
              />
            )}
            <div className="relative space-y-5">
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant="accent">{marketCategoryLabels[story.category]}</Badge>
                {story.isTrending && <Badge variant="warning">Trending</Badge>}
                {story.isFeatured && <Badge variant="accent">Featured</Badge>}
                <Badge>{formatRelativeTime(story.publishedAt)}</Badge>
              </div>

              <div className="space-y-4">
                <h2 className="text-3xl font-semibold leading-tight text-ink-900 sm:text-4xl">
                  {story.headline}
                </h2>
                <p className="max-w-2xl text-base leading-8 text-ink-600">{story.summary}</p>
              </div>

              <div className="flex flex-wrap items-center gap-3 text-sm text-ink-500">
                <span className="font-medium text-ink-800">Source: {story.sourceName}</span>
                {market ? <span>{marketStatusLabels[market.status]}</span> : <span>Prediction attaching</span>}
                {market ? <span>{formatPoints(market.totalVolume)} pts in play</span> : <span>Live RSS story</span>}
              </div>
            </div>

            <div className="relative mt-8 space-y-4">
              <div className="rounded-[24px] border border-ink-100 bg-white/80 p-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-[0.2em] text-ink-400">
                      {market ? "Prediction attached" : "Story status"}
                    </p>
                    <h3 className="mt-2 text-xl font-semibold text-ink-900">
                      {market ? market.title : "Prediction market coming soon"}
                    </h3>
                  </div>
                  <TrendingUp className="mt-1 h-5 w-5 text-signal-sky" />
                </div>
                {market ? (
                  <div className="mt-4 space-y-3">
                    <div className="flex items-center justify-between text-sm">
                      <span className="font-medium text-emerald-700">YES {formatPercent(probability.yesProbability)}</span>
                      <span className="font-medium text-rose-700">NO {formatPercent(probability.noProbability)}</span>
                    </div>
                    <Progress value={probability.yesProbability * 100} />
                  </div>
                ) : (
                  <p className="mt-4 text-sm leading-7 text-ink-600">
                    The news item is already live in the feed. Forecast controls will appear here once a measurable prediction is attached.
                  </p>
                )}
              </div>

              <div className="flex flex-wrap gap-3 text-sm">
                <a
                  href={story.sourceUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-2 rounded-2xl border border-ink-200 bg-white px-4 py-2 font-medium text-ink-700 transition hover:border-signal-sky hover:text-signal-sky"
                >
                  Read more
                  <ArrowUpRight className="h-4 w-4" />
                </a>
                <Link
                  href={`/stories/${story.slug}#discussion`}
                  className="inline-flex items-center gap-2 rounded-2xl border border-ink-200 bg-white px-4 py-2 font-medium text-ink-700 transition hover:border-signal-sky hover:text-signal-sky"
                >
                  Discussion
                  <MessageSquareMore className="h-4 w-4" />
                </Link>
                <div className="inline-flex items-center gap-2 rounded-2xl border border-ink-200 bg-white px-4 py-2 text-ink-500">
                  <Timer className="h-4 w-4" />
                  {formatRelativeTime(story.publishedAt)}
                </div>
              </div>
            </div>
          </div>

          <div className="flex flex-col justify-between bg-[#f8fafc] p-6 sm:p-8">
            <div className="space-y-4">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.2em] text-ink-400">
                  {market ? "Fast forecast" : "Live news card"}
                </p>
                <p className="mt-2 text-sm leading-7 text-ink-600">
                  {market
                    ? "Use free virtual points to call the outcome. No deposits, no withdrawals, no cash redemption."
                    : "This story is already available from the RSS feed. Open the source now or come back once a prediction market is attached."}
                </p>
              </div>
              {market ? (
                <QuickPredictCard
                  marketId={market.id}
                  status={market.status}
                  yesPool={market.yesPool}
                  noPool={market.noPool}
                  balance={balance}
                  canTrade={canTrade}
                  currentSide={currentPosition?.side}
                  currentAmount={currentPosition?.amount}
                />
              ) : (
                <div className="rounded-[28px] border border-dashed border-ink-200 bg-white/80 p-5 text-sm leading-7 text-ink-600">
                  Prediction UI is intentionally hidden until a structured, objective market is attached to this story.
                </div>
              )}
            </div>

            <div className="mt-8 rounded-[28px] bg-ink-900 p-5 text-white">
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-white/50">
                News-first game loop
              </p>
              <ol className="mt-4 space-y-3 text-sm text-white/75">
                <li>1. Read the story in seconds.</li>
                <li>2. Predict the measurable outcome.</li>
                <li>3. Return for results, streaks, and rank.</li>
              </ol>
            </div>
          </div>
        </div>
      </div>
    </article>
  );
}
