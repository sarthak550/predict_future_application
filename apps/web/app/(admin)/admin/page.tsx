import Link from "next/link";
import { AlertTriangle, CheckCircle2, Clock3, ShieldCheck } from "lucide-react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { prisma } from "@/lib/prisma";
import { pendingStoryStatuses } from "@/lib/validations/news";

export default async function AdminDashboardPage() {
  const [draftMarkets, draftStories, flaggedReports, pendingResolutions, suspendedUsers] = await Promise.all([
    prisma.market.count({ where: { status: { in: ["DRAFT", "PENDING_REVIEW"] } } }),
    prisma.story.count({ where: { status: { in: pendingStoryStatuses } } }),
    prisma.marketReport.count({ where: { status: { in: ["OPEN", "REVIEWING"] } } }),
    prisma.market.count({ where: { status: { in: ["CLOSED", "RESOLVING"] } } }),
    prisma.user.count({ where: { isSuspended: true } })
  ]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-semibold text-ink-900">Admin dashboard</h1>
        <p className="mt-2 text-sm text-ink-500">Moderation, approvals, resolution, and trust tooling.</p>
      </div>

      <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-5">
        <Card>
          <CardHeader>
            <Clock3 className="h-5 w-5 text-signal-sky" />
            <CardTitle className="pt-4">Pending markets</CardTitle>
          </CardHeader>
          <CardContent className="text-3xl font-semibold text-ink-900">{draftMarkets}</CardContent>
        </Card>
        <Card>
          <CardHeader>
            <Clock3 className="h-5 w-5 text-indigo-500" />
            <CardTitle className="pt-4">Draft stories</CardTitle>
          </CardHeader>
          <CardContent className="text-3xl font-semibold text-ink-900">{draftStories}</CardContent>
        </Card>
        <Card>
          <CardHeader>
            <AlertTriangle className="h-5 w-5 text-signal-coral" />
            <CardTitle className="pt-4">Open reports</CardTitle>
          </CardHeader>
          <CardContent className="text-3xl font-semibold text-ink-900">{flaggedReports}</CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CheckCircle2 className="h-5 w-5 text-signal-teal" />
            <CardTitle className="pt-4">Pending resolutions</CardTitle>
          </CardHeader>
          <CardContent className="text-3xl font-semibold text-ink-900">{pendingResolutions}</CardContent>
        </Card>
        <Card>
          <CardHeader>
            <ShieldCheck className="h-5 w-5 text-amber-600" />
            <CardTitle className="pt-4">Suspended users</CardTitle>
          </CardHeader>
          <CardContent className="text-3xl font-semibold text-ink-900">{suspendedUsers}</CardContent>
        </Card>
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        <Link href="/admin/moderation" className="rounded-[28px] border border-white/70 bg-white/80 p-6">
          <h2 className="text-xl font-semibold text-ink-900">Moderation queue</h2>
          <p className="mt-2 text-sm leading-7 text-ink-600">
            Review ingested stories, approve markets, handle reports, and manage user trust controls.
          </p>
        </Link>
        <Link href="/admin/resolutions" className="rounded-[28px] border border-white/70 bg-white/80 p-6">
          <h2 className="text-xl font-semibold text-ink-900">Resolution queue</h2>
          <p className="mt-2 text-sm leading-7 text-ink-600">
            Resolve closed markets, review auto-resolution misses, and settle payouts.
          </p>
        </Link>
        <Link href="/admin/big-call" className="rounded-[28px] border border-white/70 bg-white/80 p-6">
          <h2 className="text-xl font-semibold text-ink-900">Big Call dashboard</h2>
          <p className="mt-2 text-sm leading-7 text-ink-600">
            Track notification opens and participation for every Big Call market, with aggregate stats.
          </p>
        </Link>
      </div>
    </div>
  );
}
