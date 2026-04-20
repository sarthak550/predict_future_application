import { notFound } from "next/navigation";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { getCurrentUser } from "@/lib/auth";
import { marketCategoryLabels } from "@/lib/constants";
import { prisma } from "@/lib/prisma";
import { formatPercent, formatPoints } from "@/lib/utils";

export default async function ProfilePage({
  params
}: {
  params: { username: string };
}) {
  const [profile, viewer] = await Promise.all([
    prisma.user.findUnique({
      where: { username: params.username },
      include: {
        stats: true,
        wallet: true,
        badges: {
          include: {
            badge: true
          }
        },
        categoryStats: true,
        positions: {
          include: {
            market: true
          },
          orderBy: { createdAt: "desc" },
          take: 10
        },
        createdMarkets: {
          orderBy: { createdAt: "desc" },
          take: 6
        }
      }
    }),
    getCurrentUser()
  ]);

  if (!profile) {
    notFound();
  }

  const isSelf = viewer?.id === profile.id;

  return (
    <div className="space-y-6">
      <Card className="overflow-hidden border-0 bg-ink-900 text-white">
        <CardHeader>
          <div className="flex flex-wrap items-center gap-2">
            <Badge className="bg-white/10 text-white">Level {profile.level}</Badge>
            <Badge className="bg-white/10 text-white">{profile.reputationScore} reputation</Badge>
            <Badge className="bg-white/10 text-white">{profile.streak} streak</Badge>
            {profile.stats?.publicHostingEligibility && (
              <Badge className="bg-white/10 text-white">Trusted Host</Badge>
            )}
          </div>
          <CardTitle className="pt-4 text-3xl text-white">@{profile.username}</CardTitle>
          <CardDescription className="text-white/70">
            Forecasting accuracy, category depth, and creator trust are all visible here.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-4">
          <div className="rounded-[24px] bg-white/10 p-4">
            <p className="text-sm text-white/60">Accuracy</p>
            <p className="mt-2 text-2xl font-semibold">{formatPercent(profile.accuracyScore / 100)}</p>
          </div>
          <div className="rounded-[24px] bg-white/10 p-4">
            <p className="text-sm text-white/60">Predictions</p>
            <p className="mt-2 text-2xl font-semibold">{profile.stats?.totalPredictions ?? 0}</p>
          </div>
          <div className="rounded-[24px] bg-white/10 p-4">
            <p className="text-sm text-white/60">Net points</p>
            <p className="mt-2 text-2xl font-semibold">{formatPoints(profile.stats?.totalNetPoints ?? 0)}</p>
          </div>
          <div className="rounded-[24px] bg-white/10 p-4">
            <p className="text-sm text-white/60">Balance</p>
            <p className="mt-2 text-2xl font-semibold">
              {isSelf ? formatPoints(profile.wallet?.balance ?? 0) : "Private"}
            </p>
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-6 xl:grid-cols-[1fr_1fr]">
        <Card>
          <CardHeader>
            <CardTitle>Host stats</CardTitle>
            <CardDescription>Fair hosting improves market visibility and unlocks public trusted-host access.</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-3 sm:grid-cols-2">
            <div className="rounded-[24px] bg-ink-50 p-4">
              <p className="text-sm text-ink-500">Host trust score</p>
              <p className="mt-2 text-2xl font-semibold text-ink-900">{profile.stats?.hostTrustScore ?? 30}</p>
            </div>
            <div className="rounded-[24px] bg-ink-50 p-4">
              <p className="text-sm text-ink-500">Valid hosted markets</p>
              <p className="mt-2 text-2xl font-semibold text-ink-900">
                {profile.stats?.validFinalizedHostedMarketsCount ?? 0}
              </p>
            </div>
            <div className="rounded-[24px] bg-ink-50 p-4">
              <p className="text-sm text-ink-500">Timeouts / Overturns</p>
              <p className="mt-2 text-2xl font-semibold text-ink-900">
                {profile.stats?.hostTimeoutCount ?? 0} / {profile.stats?.overturnedHostedMarketsCount ?? 0}
              </p>
            </div>
            <div className="rounded-[24px] bg-ink-50 p-4">
              <p className="text-sm text-ink-500">Average host fee</p>
              <p className="mt-2 text-2xl font-semibold text-ink-900">
                {((profile.stats?.avgHostCommissionBps ?? 0) / 100).toFixed(2)}%
              </p>
            </div>
            <div className="rounded-[24px] bg-ink-50 p-4">
              <p className="text-sm text-ink-500">Repeat join rate</p>
              <p className="mt-2 text-2xl font-semibold text-ink-900">
                {formatPercent(profile.stats?.repeatJoinRate ?? 0)}
              </p>
            </div>
            <div className="rounded-[24px] bg-ink-50 p-4">
              <p className="text-sm text-ink-500">Clean streak</p>
              <p className="mt-2 text-2xl font-semibold text-ink-900">{profile.stats?.cleanStreakCount ?? 0}</p>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Badges</CardTitle>
            <CardDescription>Earned through forecasting performance and trust.</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-2">
            {profile.badges.map((userBadge) => (
              <Badge key={userBadge.id} variant="accent">
                {userBadge.badge.name}
              </Badge>
            ))}
            {profile.badges.length === 0 && <p className="text-sm text-ink-500">No badges yet.</p>}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Category expertise</CardTitle>
            <CardDescription>Where this forecaster performs best.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {profile.categoryStats.map((categoryStat) => (
              <div key={categoryStat.id} className="rounded-[24px] bg-ink-50 p-4">
                <div className="flex items-center justify-between">
                  <p className="font-medium text-ink-900">{marketCategoryLabels[categoryStat.category]}</p>
                  <p className="text-sm text-ink-500">
                    {formatPercent(categoryStat.accuracyScore / 100)} accuracy
                  </p>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-6 xl:grid-cols-[1fr_1fr]">
        <Card>
          <CardHeader>
            <CardTitle>Recent positions</CardTitle>
            <CardDescription>Latest forecasts placed by this user.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {profile.positions.map((position) => (
              <div key={position.id} className="rounded-[24px] border border-ink-100 p-4">
                <p className="font-medium text-ink-900">{position.market.title}</p>
                <p className="mt-1 text-sm text-ink-500">
                  {position.side} · {formatPoints(position.amount)} pts
                </p>
              </div>
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Created markets</CardTitle>
            <CardDescription>Questions authored by this user.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {profile.createdMarkets.map((market) => (
              <div key={market.id} className="rounded-[24px] border border-ink-100 p-4">
                <p className="font-medium text-ink-900">{market.title}</p>
                <p className="mt-1 text-sm text-ink-500">{market.status.toLowerCase()}</p>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
