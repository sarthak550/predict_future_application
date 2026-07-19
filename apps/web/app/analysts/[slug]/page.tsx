import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowUpRight } from "lucide-react";

import { AnalystDisclaimerFooter } from "@/components/finance/disclaimer-footer";
import { DirectionChip, VerdictBadge } from "@/components/finance/analyst-badges";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeaderCell, TableRow } from "@/components/ui/table";
import { getPublicProfileStats } from "@/lib/finance/publicProfile";
import { prisma } from "@/lib/prisma";
import { formatDateOnly, formatPercent } from "@/lib/utils";

export const revalidate = 3600;

const RECENT_CALLS_LIMIT = 25;

async function fetchExpertBySlug(slug: string) {
  const expert = await prisma.expert.findUnique({
    where: { slug },
    select: {
      id: true,
      name: true,
      organization: true,
      verified: true,
      bio: true,
      avatarUrl: true,
      tipranksUrl: true,
      linkedinUrl: true,
      opinions: {
        where: { suppressedAt: null },
        orderBy: { publishedAt: "desc" },
        select: {
          id: true,
          quote: true,
          instrument: true,
          instrumentTicker: true,
          direction: true,
          sourceUrl: true,
          publishedAt: true,
          resolutionStatus: true,
        },
      },
    },
  });

  if (!expert) {
    return null;
  }

  return {
    ...expert,
    stats: getPublicProfileStats(expert.opinions),
    recentCalls: expert.opinions.slice(0, RECENT_CALLS_LIMIT),
  };
}

export async function generateMetadata({
  params,
}: {
  params: { slug: string };
}): Promise<Metadata> {
  const expert = await fetchExpertBySlug(params.slug);

  if (!expert) {
    return { title: "Analyst not found — Predict Future" };
  }

  const title = `${expert.name} — Track Record & Analyst Scorecard | Predict Future`;
  const description =
    expert.stats.resolvedCount >= 3
      ? `${expert.name} (${expert.organization}) has a ${formatPercent(expert.stats.hitRate ?? 0)} hit rate across ${expert.stats.resolvedCount} graded market calls. See every call, sourced back to the original article.`
      : `Track record for ${expert.name} (${expert.organization}) — public market calls, sourced back to the original article. Not investment advice.`;

  return {
    title,
    description,
    alternates: { canonical: `https://predictfuture.app/analysts/${params.slug}` },
    robots: {
      index: expert.stats.indexable,
      follow: true,
    },
    openGraph: {
      title,
      description,
      type: "profile",
      url: `https://predictfuture.app/analysts/${params.slug}`,
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
    },
  };
}

export default async function AnalystProfilePage({
  params,
}: {
  params: { slug: string };
}) {
  const expert = await fetchExpertBySlug(params.slug);

  if (!expert) {
    notFound();
  }

  const { stats, recentCalls } = expert;
  const hasProvisionalTrackRecord = stats.resolvedCount < 3;

  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "Person",
    name: expert.name,
    affiliation: {
      "@type": "Organization",
      name: expert.organization,
    },
    url: `https://predictfuture.app/analysts/${params.slug}`,
    ...(expert.avatarUrl ? { image: expert.avatarUrl } : {}),
  };

  return (
    <div className="space-y-8">
      {/* eslint-disable-next-line react/no-danger */}
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />

      <Card className="overflow-hidden border-0 bg-ink-900 text-white">
        <CardHeader>
          <div className="flex items-center gap-4">
            <Avatar name={expert.name} src={expert.avatarUrl} className="h-14 w-14 text-lg" />
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <CardTitle className="text-2xl text-white">{expert.name}</CardTitle>
                {expert.verified && <Badge className="bg-white/10 text-white">Verified</Badge>}
              </div>
              <CardDescription className="text-white/70">{expert.organization}</CardDescription>
            </div>
          </div>
          {expert.bio && <p className="mt-4 max-w-2xl text-sm leading-6 text-white/70">{expert.bio}</p>}
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-3">
          <div className="rounded-[24px] bg-white/10 p-4">
            <p className="text-sm text-white/60">Track record</p>
            <p className="mt-2 text-2xl font-semibold">
              {hasProvisionalTrackRecord ? "Building a track record" : formatPercent(stats.hitRate ?? 0)}
            </p>
          </div>
          <div className="rounded-[24px] bg-white/10 p-4">
            <p className="text-sm text-white/60">Graded calls</p>
            <p className="mt-2 text-2xl font-semibold">
              {stats.hitCount} hit · {stats.missCount} miss
            </p>
          </div>
          <div className="rounded-[24px] bg-white/10 p-4">
            <p className="text-sm text-white/60">Pending</p>
            <p className="mt-2 text-2xl font-semibold">{stats.pendingCount} awaiting resolution</p>
          </div>
        </CardContent>
      </Card>

      {stats.perInstrument.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>By instrument</CardTitle>
            <CardDescription>Graded calls broken down by what was being called.</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid gap-3 sm:grid-cols-2">
              {stats.perInstrument.map((row) => (
                <div
                  key={row.instrument}
                  className="flex items-center justify-between rounded-[20px] border border-ink-100 px-4 py-3"
                >
                  <div>
                    <p className="text-sm font-semibold text-ink-900">{row.instrument}</p>
                    <p className="text-xs text-ink-400">
                      {row.resolvedCount > 0
                        ? `${row.hitCount} hit · ${row.missCount} miss`
                        : `${row.pendingCount} pending`}
                    </p>
                  </div>
                  {row.resolvedCount > 0 && (
                    <p className="text-lg font-semibold text-ink-900">
                      {formatPercent(row.hitCount / row.resolvedCount)}
                    </p>
                  )}
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Recent calls</CardTitle>
          <CardDescription>Newest first. Every call links back to its original source.</CardDescription>
        </CardHeader>
        <CardContent>
          {recentCalls.length === 0 ? (
            <p className="py-6 text-center text-sm text-ink-500">No public calls recorded yet.</p>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHead>
                  <TableRow>
                    <TableHeaderCell>Call</TableHeaderCell>
                    <TableHeaderCell>Instrument</TableHeaderCell>
                    <TableHeaderCell>Direction</TableHeaderCell>
                    <TableHeaderCell>Date</TableHeaderCell>
                    <TableHeaderCell>Verdict</TableHeaderCell>
                    <TableHeaderCell>Source</TableHeaderCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {recentCalls.map((call) => (
                    <TableRow key={call.id}>
                      <TableCell className="max-w-xs">
                        <Link href={`/calls/${call.id}`} className="text-ink-700 hover:text-ink-900">
                          &ldquo;{call.quote.length > 120 ? `${call.quote.slice(0, 120)}…` : call.quote}&rdquo;
                        </Link>
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-ink-600">
                        {call.instrument ?? "—"}
                      </TableCell>
                      <TableCell>
                        <DirectionChip direction={call.direction} />
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-ink-500">
                        {formatDateOnly(call.publishedAt)}
                      </TableCell>
                      <TableCell>
                        <VerdictBadge status={call.resolutionStatus} />
                      </TableCell>
                      <TableCell>
                        <a
                          href={call.sourceUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex items-center gap-1 text-signal-sky hover:underline"
                        >
                          Source
                          <ArrowUpRight className="h-3.5 w-3.5" />
                        </a>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      <AnalystDisclaimerFooter />
    </div>
  );
}
