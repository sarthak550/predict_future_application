import { ApproveStoryForm } from "@/components/admin/approve-story-form";
import { ApproveMarketForm } from "@/components/admin/approve-market-form";
import { BulkApproveManifoldForm } from "@/components/admin/bulk-approve-manifold-form";
import { BulkApproveStoriesForm } from "@/components/admin/bulk-approve-stories-form";
import { FeatureMarketForm } from "@/components/admin/feature-market-form";
import { RejectMarketForm } from "@/components/admin/reject-market-form";
import { RejectStoryForm } from "@/components/admin/reject-story-form";
import { ReportReviewForm } from "@/components/admin/report-review-form";
import { RunNewsIngestionForm } from "@/components/admin/run-news-ingestion-form";
import { StoryReviewEditor } from "@/components/admin/story-review-editor";
import { UserSuspensionForm } from "@/components/admin/user-suspension-form";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { marketCategoryLabels } from "@/lib/constants";
import { prisma } from "@/lib/prisma";
import { pendingStoryStatuses } from "@/lib/validations/news";

export default async function ModerationPage() {
  const [draftStories, recentNews, latestNewsIngestion, draftMarkets, reports, users, spotlightMarkets] = await Promise.all([
    prisma.story.findMany({
      where: {
        status: {
          in: pendingStoryStatuses
        }
      },
      include: {
        market: true,
        source: true
      },
      orderBy: [{ publishedAt: "desc" }, { createdAt: "desc" }],
      take: 12
    }),
    prisma.story.findMany({
      where: {
        status: {
          in: ["APPROVED", "PUBLISHED"]
        }
      },
      orderBy: [{ ingestedAt: "desc" }, { publishedAt: "desc" }],
      take: 8
    }),
    prisma.story.findFirst({
      where: {
        status: {
          in: ["APPROVED", "PUBLISHED"]
        }
      },
      orderBy: {
        ingestedAt: "desc"
      },
      select: {
        ingestedAt: true
      }
    }),
    prisma.market.findMany({
      where: {
        status: {
          in: ["DRAFT", "PENDING_REVIEW"]
        }
      },
      include: {
        creator: true
      },
      // S32-T6: Sort flagship-pending markets to top, then by createdAt asc
      orderBy: [{ flagshipEventAt: "asc" }, { createdAt: "asc" }]
    }),
    prisma.marketReport.findMany({
      where: {
        status: {
          in: ["OPEN", "REVIEWING"]
        }
      },
      include: {
        reporter: true,
        market: true
      },
      orderBy: { createdAt: "asc" }
    }),
    prisma.user.findMany({
      where: {
        OR: [{ isSuspended: true }, { reports: { some: {} } }]
      },
      orderBy: { createdAt: "desc" },
      take: 10
    }),
    prisma.market.findMany({
      where: {
        status: "OPEN"
      },
      include: {
        creator: true
      },
      orderBy: [{ isFeatured: "desc" }, { totalVolume: "desc" }],
      take: 6
    })
  ]);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-semibold text-ink-900">Moderation queue</h1>
          <p className="mt-2 text-sm text-ink-500">Review RSS-ingested stories, approve clean markets, and deal with abuse reports quickly.</p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <BulkApproveStoriesForm />
          <RunNewsIngestionForm />
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Ingested story review</CardTitle>
          <CardDescription>
            RSS is the primary ingestion source. Manual fetch writes new stories directly into the live news feed, with API fallback only when an RSS source fails.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {draftStories.map((story) => (
            <div key={story.id} className="rounded-[28px] border border-ink-100 p-5">
              <div className="grid gap-5 xl:grid-cols-[1.2fr_1fr]">
                <div className="space-y-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant="warning">{story.status.toLowerCase().replaceAll("_", " ")}</Badge>
                    <Badge>{marketCategoryLabels[story.category]}</Badge>
                    {story.source && <Badge variant="accent">{story.source.trustTier.toLowerCase()}</Badge>}
                    {story.market ? <Badge variant="accent">prediction attached</Badge> : <Badge>No market yet</Badge>}
                  </div>
                  <div>
                    <p className="font-medium text-ink-900">{story.headline}</p>
                    <p className="mt-1 text-sm text-ink-500">
                      Source: {story.sourceName} ·{" "}
                      <a href={story.sourceUrl} target="_blank" rel="noreferrer" className="text-signal-sky">
                        open source
                      </a>
                    </p>
                  </div>
                  <StoryReviewEditor
                    story={{
                      id: story.id,
                      headline: story.headline,
                      summary: story.summary,
                      category: story.category,
                      sourceName: story.sourceName,
                      sourceUrl: story.sourceUrl,
                      isFeatured: story.isFeatured,
                      isTrending: story.isTrending,
                      market: story.market
                        ? {
                            title: story.market.title,
                            description: story.market.description,
                            template: story.market.template,
                            closeAt: story.market.closeAt,
                            resolveAt: story.market.resolveAt,
                            resolutionSourceType: story.market.resolutionSourceType,
                            resolutionSourceName: story.market.resolutionSourceName,
                            resolutionSourceUrl: story.market.resolutionSourceUrl,
                            resolutionRuleText: story.market.resolutionRuleText ?? "",
                            fallbackRuleText: story.market.fallbackRuleText
                          }
                        : null
                    }}
                  />
                </div>
                <div className="space-y-4">
                  <div className="rounded-[24px] bg-ink-50 p-4 text-sm leading-7 text-ink-600">
                    <p className="font-medium text-ink-900">Approval checklist</p>
                    <p className="mt-2">1. Summary is concise and attributable.</p>
                    <p>2. Prediction is objective, measurable, and time-bounded.</p>
                    <p>3. Source and fallback rule are strong enough for later resolution.</p>
                  </div>
                  <ApproveStoryForm storyId={story.id} />
                  <RejectStoryForm storyId={story.id} />
                </div>
              </div>
            </div>
          ))}
          {draftStories.length === 0 && <p className="text-sm text-ink-500">No stories waiting for review.</p>}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Recent published news</CardTitle>
          <CardDescription>
            Latest ingestion time: {latestNewsIngestion?.ingestedAt.toLocaleString() ?? "No successful ingestion yet"}.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {recentNews.map((story) => (
            <div key={story.id} className="rounded-[24px] border border-ink-100 p-4">
              <div className="flex flex-wrap items-center gap-2">
                <Badge>{story.status.toLowerCase()}</Badge>
                <Badge variant="accent">{marketCategoryLabels[story.category]}</Badge>
                {story.ingestionFeedName && <Badge variant="warning">{story.ingestionFeedName}</Badge>}
              </div>
              <p className="mt-3 font-medium text-ink-900">{story.headline}</p>
              <p className="mt-1 text-sm text-ink-500">
                {story.sourceName} · published {story.publishedAt.toLocaleString()} · ingested {story.ingestedAt.toLocaleString()}
              </p>
            </div>
          ))}
          {recentNews.length === 0 && <p className="text-sm text-ink-500">No published news yet.</p>}
        </CardContent>
      </Card>

      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-semibold text-ink-900">Market and trust moderation</h2>
          <p className="mt-2 text-sm text-ink-500">Approve clean markets, feature strong questions, and deal with abuse reports quickly.</p>
        </div>
        <BulkApproveManifoldForm />
      </div>

      <div className="grid gap-6 xl:grid-cols-[1fr_1fr]">
        <Card>
          <CardHeader>
            <CardTitle>Pending market approvals</CardTitle>
            <CardDescription>Markets stay in draft until staff approves or rejects them.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {draftMarkets.map((market) => (
              <div
                key={market.id}
                className={`rounded-[24px] border p-4 ${market.flagshipEventAt ? "border-amber-300 bg-amber-50" : "border-ink-100"}`}
              >
                <div className="grid gap-4 lg:grid-cols-[1fr_0.8fr]">
                  <div className="space-y-3">
                    <p className="font-medium text-ink-900">{market.title}</p>
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge variant="warning">{market.status.toLowerCase().replaceAll("_", " ")}</Badge>
                      {market.flagshipEventAt && (
                        <Badge variant="accent">
                          {"🔥 Flagship"} · {market.flagshipEventType ?? ""} · {new Date(market.flagshipEventAt).toLocaleDateString()}
                        </Badge>
                      )}
                    </div>
                    <p className="mt-1 text-sm text-ink-500">by @{market.creator.username}</p>
                    <p className="mt-3 text-sm leading-7 text-ink-600">{market.resolutionRuleText}</p>
                  </div>
                  <div className="space-y-4">
                    <ApproveMarketForm marketId={market.id} />
                    <RejectMarketForm marketId={market.id} />
                  </div>
                </div>
              </div>
            ))}
            {draftMarkets.length === 0 && <p className="text-sm text-ink-500">No draft markets.</p>}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Open reports</CardTitle>
            <CardDescription>Ambiguity, duplicates, and disallowed content should land here.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {reports.map((report) => (
              <div key={report.id} className="rounded-[24px] border border-ink-100 p-4">
                <div className="flex items-center gap-2">
                  <Badge variant="warning">{report.status.toLowerCase()}</Badge>
                  <Badge>{report.reason}</Badge>
                </div>
                <p className="mt-3 font-medium text-ink-900">{report.market.title}</p>
                <p className="mt-1 text-sm text-ink-500">Reported by @{report.reporter.username}</p>
                {report.details && <p className="mt-3 text-sm leading-7 text-ink-600">{report.details}</p>}
                <div className="mt-4">
                  <ReportReviewForm reportId={report.id} />
                </div>
              </div>
            ))}
            {reports.length === 0 && <p className="text-sm text-ink-500">No reports pending.</p>}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Discovery spotlight controls</CardTitle>
          <CardDescription>Feature high-quality open markets in the discovery feed.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 lg:grid-cols-2">
          {spotlightMarkets.map((market) => (
            <div key={market.id} className="rounded-[24px] border border-ink-100 p-4">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="font-medium text-ink-900">{market.title}</p>
                  <p className="text-sm text-ink-500">@{market.creator.username}</p>
                </div>
                {market.isFeatured && <Badge variant="accent">featured</Badge>}
              </div>
              <div className="mt-4">
                <FeatureMarketForm marketId={market.id} isFeatured={market.isFeatured} />
              </div>
            </div>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>User moderation</CardTitle>
          <CardDescription>Suspend or restore accounts involved in repeated abuse.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 lg:grid-cols-2">
          {users.map((user) => (
            <div key={user.id} className="rounded-[24px] border border-ink-100 p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="font-medium text-ink-900">@{user.username}</p>
                  <p className="text-sm text-ink-500">{user.email}</p>
                </div>
                {user.isSuspended && <Badge variant="danger">suspended</Badge>}
              </div>
              <div className="mt-4">
                <UserSuspensionForm userId={user.id} isSuspended={user.isSuspended} />
              </div>
            </div>
          ))}
          {users.length === 0 && <p className="text-sm text-ink-500">No flagged users right now.</p>}
        </CardContent>
      </Card>
    </div>
  );
}
