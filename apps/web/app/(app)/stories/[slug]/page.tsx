import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowUpRight, Newspaper, Sparkles } from "lucide-react";

import { CommentsSection } from "@/components/markets/comments-section";
import { PositionForm } from "@/components/markets/position-form";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { getCurrentUser } from "@/lib/auth";
import { marketCategoryLabels } from "@/lib/constants";
import { calculateProbabilities } from "@/lib/markets/probability";
import { getStoryBySlug } from "@/lib/stories/queries";
import { formatDateTime, formatPercent, formatPoints, formatRelativeTime } from "@/lib/utils";
import { approvedStoryStatuses } from "@/lib/validations/news";

export default async function StoryDetailPage({
  params
}: {
  params: { slug: string };
}) {
  const user = await getCurrentUser();
  const story = await getStoryBySlug(params.slug, user?.id);

  if (!story || !approvedStoryStatuses.includes(story.status) || !story.market) {
    notFound();
  }

  const probability = calculateProbabilities(story.market.yesPool, story.market.noPool);

  return (
    <div className="grid gap-6 xl:grid-cols-[1.1fr_0.9fr]">
      <div className="space-y-6">
        <Card className="overflow-hidden border-0 bg-ink-900 text-white">
          <CardHeader>
            <div className="flex flex-wrap items-center gap-2">
              <Badge className="bg-white/10 text-white">{marketCategoryLabels[story.category]}</Badge>
              <Badge className="bg-white/10 text-white">{formatRelativeTime(story.publishedAt)}</Badge>
              {story.isFeatured && <Badge className="bg-white/10 text-white">Featured</Badge>}
            </div>
            <CardTitle className="pt-4 text-3xl text-white">{story.headline}</CardTitle>
            <CardDescription className="max-w-3xl text-white/70">{story.summary}</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-3">
            <div className="rounded-[24px] bg-white/10 p-4">
              <p className="text-sm text-white/60">Source</p>
              <p className="mt-2 text-lg font-semibold">{story.sourceName}</p>
            </div>
            <div className="rounded-[24px] bg-white/10 p-4">
              <p className="text-sm text-white/60">Published</p>
              <p className="mt-2 text-lg font-semibold">{formatDateTime(story.publishedAt)}</p>
            </div>
            <div className="rounded-[24px] bg-white/10 p-4">
              <p className="text-sm text-white/60">Read the source</p>
              <a href={story.sourceUrl} target="_blank" rel="noreferrer" className="mt-2 inline-flex items-center gap-2 text-lg font-semibold text-signal-teal">
                Open article
                <ArrowUpRight className="h-4 w-4" />
              </a>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Attached prediction</CardTitle>
            <CardDescription>Every story in the swipe feed carries one primary measurable forecast.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="rounded-[24px] bg-ink-50 p-5">
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-ink-400">Question</p>
              <h2 className="mt-2 text-2xl font-semibold text-ink-900">{story.market.title}</h2>
              <p className="mt-3 text-sm leading-7 text-ink-600">{story.market.description}</p>
            </div>
            <div className="grid gap-4 sm:grid-cols-3">
              <div className="rounded-[24px] border border-ink-100 p-4">
                <p className="text-sm text-ink-500">YES probability</p>
                <p className="mt-1 text-2xl font-semibold text-ink-900">{formatPercent(probability.yesProbability)}</p>
              </div>
              <div className="rounded-[24px] border border-ink-100 p-4">
                <p className="text-sm text-ink-500">YES pool</p>
                <p className="mt-1 text-2xl font-semibold text-ink-900">{formatPoints(story.market.yesPool)} pts</p>
              </div>
              <div className="rounded-[24px] border border-ink-100 p-4">
                <p className="text-sm text-ink-500">NO pool</p>
                <p className="mt-1 text-2xl font-semibold text-ink-900">{formatPoints(story.market.noPool)} pts</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <CommentsSection marketId={story.market.id} comments={story.market.comments} canComment={Boolean(user)} />
      </div>

      <div className="space-y-6">
        <PositionForm
          marketId={story.market.id}
          marketType={story.market.marketType}
          status={story.market.status}
          yesPool={story.market.yesPool}
          noPool={story.market.noPool}
          totalVolume={story.market.totalVolume}
          balance={user?.wallet?.balance}
          canTrade={Boolean(user && !user.isSuspended)}
        />

        <Card>
          <CardHeader>
            <CardTitle>Why this story is in the feed</CardTitle>
            <CardDescription>News-first design with a forecasting layer on top.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3 text-sm leading-7 text-ink-600">
            <div className="flex items-start gap-3">
              <Newspaper className="mt-1 h-4 w-4 text-signal-sky" />
              <p>Short summary first, source attribution always visible, full article linked out.</p>
            </div>
            <div className="flex items-start gap-3">
              <Sparkles className="mt-1 h-4 w-4 text-signal-amber" />
              <p>Prediction question is objective, time-bounded, and resolved using pre-written rules.</p>
            </div>
            <Link href={`/markets/${story.market.id}`} className="inline-flex items-center gap-2 font-medium text-signal-sky">
              Open full prediction detail
              <ArrowUpRight className="h-4 w-4" />
            </Link>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
