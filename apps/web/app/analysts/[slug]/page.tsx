import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { AnalystDisclaimerFooter } from "@/components/finance/disclaimer-footer";
import { ExpandableCallsTable } from "@/components/finance/expandable-calls-table";
import { FirmLink } from "@/components/finance/firm-link";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { canonicalizeOrgDisplay } from "@predict-future/business-rules/experts/firmAliases";
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
      entityKind: true,
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
          headline: true,
          instrument: true,
          instrumentTicker: true,
          direction: true,
          sourceUrl: true,
          publishedAt: true,
          resolutionStatus: true,
          resolutionNote: true,
          resolvedAt: true,
        },
      },
    },
  });

  if (!expert) {
    return null;
  }

  return {
    ...expert,
    organization: canonicalizeOrgDisplay(expert.organization),
    isFirm: expert.entityKind === "FIRM",
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

  // FIRM entities (publication/desk "org-as-analyst" identities — see apps/api/lib/
  // finance/expertEntityKind.ts) are never presented as a person with a track
  // record, on-brand with the existing isSourceAttribution display convention
  // ("Market Analysis from [Source]") — see the profile body below for the same
  // framing. Also never indexed as a scored "analyst" page (robots.index: false
  // regardless of stats.indexable) — a publication doesn't have a personal
  // credibility score to rank.
  const title = expert.isFirm
    ? `Market Analysis from ${expert.organization} | Predict Future`
    : `${expert.name} — Track Record & Analyst Scorecard | Predict Future`;
  const description = expert.isFirm
    ? `Market analysis and calls attributed to ${expert.organization}, sourced back to the original article. Not investment advice.`
    : expert.stats.resolvedCount >= 3
      ? `${expert.name} (${expert.organization}) has a ${formatPercent(expert.stats.hitRate ?? 0)} hit rate across ${expert.stats.resolvedCount} graded market calls. See every call, sourced back to the original article.`
      : `Track record for ${expert.name} (${expert.organization}) — public market calls, sourced back to the original article. Not investment advice.`;

  return {
    title,
    description,
    alternates: { canonical: `https://predictfuture.app/analysts/${params.slug}` },
    robots: {
      index: !expert.isFirm && expert.stats.indexable,
      follow: true,
    },
    openGraph: {
      title,
      description,
      type: expert.isFirm ? "website" : "profile",
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

  // FIRM entities are never described as a Person in structured data — never
  // pretend personhood for a publication/desk attribution (founder requirement,
  // 2026-08-08).
  const jsonLd = expert.isFirm
    ? {
        "@context": "https://schema.org",
        "@type": "Organization",
        name: expert.organization,
        url: `https://predictfuture.app/analysts/${params.slug}`,
      }
    : {
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
            <Avatar name={expert.organization} src={expert.avatarUrl} className="h-14 w-14 text-lg" />
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <CardTitle className="text-2xl text-white">
                  {expert.isFirm ? expert.organization : expert.name}
                </CardTitle>
                {expert.verified && <Badge className="bg-white/10 text-white">Verified</Badge>}
              </div>
              <CardDescription className="text-white/70">
                {expert.isFirm ? (
                  "Market analysis from this source"
                ) : (
                  <FirmLink organization={expert.organization} className="hover:underline" />
                )}
              </CardDescription>
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
          <CardTitle>{expert.isFirm ? "Recent analysis" : "Recent calls"}</CardTitle>
          <CardDescription>Newest first. Every call links back to its original source.</CardDescription>
        </CardHeader>
        <CardContent>
          {recentCalls.length === 0 ? (
            <p className="py-6 text-center text-sm text-ink-500">No public calls recorded yet.</p>
          ) : (
            <ExpandableCallsTable
              calls={recentCalls.map((call) => ({
                id: call.id,
                quote: call.quote,
                headline: call.headline,
                instrument: call.instrument,
                instrumentTicker: call.instrumentTicker,
                direction: call.direction,
                sourceUrl: call.sourceUrl,
                publishedAtLabel: formatDateOnly(call.publishedAt),
                resolutionStatus: call.resolutionStatus,
                resolutionNote: call.resolutionNote,
                resolvedAtLabel: call.resolvedAt ? formatDateOnly(call.resolvedAt) : null,
              }))}
            />
          )}
        </CardContent>
      </Card>

      <AnalystDisclaimerFooter />
    </div>
  );
}
