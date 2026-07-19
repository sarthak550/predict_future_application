import type { Metadata } from "next";
import Link from "next/link";

import { AnalystDisclaimerFooter } from "@/components/finance/disclaimer-footer";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { getPublicProfileStats } from "@/lib/finance/publicProfile";
import { prisma } from "@/lib/prisma";
import { formatPercent } from "@/lib/utils";

export const revalidate = 3600;

type SortMode = "accuracy" | "volume";

export const metadata: Metadata = {
  title: "Analyst Scorecard — Track Records of Indian Market Analysts | Predict Future",
  description:
    "Which market analysts actually get their calls right? We track public statements by Indian market analysts and grade every call HIT or MISS against what actually happened, sourced back to the original article.",
  alternates: { canonical: "https://predictfuture.app/analysts" },
  openGraph: {
    title: "Analyst Scorecard — Predict Future",
    description: "Track records of Indian market analysts, graded HIT or MISS against public statements.",
    type: "website",
    url: "https://predictfuture.app/analysts",
  },
};

async function fetchIndexableAnalysts() {
  const experts = await prisma.expert.findMany({
    where: { slug: { not: null } },
    select: {
      id: true,
      slug: true,
      name: true,
      organization: true,
      verified: true,
      avatarUrl: true,
      opinions: {
        where: { suppressedAt: null },
        select: { resolutionStatus: true, instrument: true, instrumentTicker: true },
      },
    },
  });

  return experts
    .map((expert) => ({
      id: expert.id,
      slug: expert.slug as string,
      name: expert.name,
      organization: expert.organization,
      verified: expert.verified,
      avatarUrl: expert.avatarUrl,
      stats: getPublicProfileStats(expert.opinions),
    }))
    .filter((expert) => expert.stats.indexable);
}

export default async function AnalystsDirectoryPage({
  searchParams,
}: {
  searchParams?: { sort?: string };
}) {
  // Default sort is descending accuracy — a "worst analyst" default ordering is a hard
  // legal-framing requirement, never build one, not even as an available option.
  const sort: SortMode = searchParams?.sort === "volume" ? "volume" : "accuracy";

  const analysts = await fetchIndexableAnalysts();

  const sorted = [...analysts].sort((a, b) => {
    if (sort === "volume") {
      return b.stats.resolvedCount - a.stats.resolvedCount;
    }
    // accuracy: hitRate is guaranteed non-null here since indexable implies resolvedCount >= 5
    return (b.stats.hitRate ?? 0) - (a.stats.hitRate ?? 0);
  });

  const visible = sorted.slice(0, 100);

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-3xl font-semibold text-ink-900">Analyst Scorecard</h1>
        <p className="mt-3 max-w-2xl text-sm leading-6 text-ink-500">
          We track what market analysts said in the press, and grade every call HIT or MISS against what
          actually happened. Below are the analysts with enough graded calls to show a meaningful track
          record. Not investment advice — a record of public statements, not a recommendation.
        </p>
      </div>

      <div className="flex flex-wrap gap-2">
        <Link href="/analysts?sort=accuracy">
          <Badge variant={sort === "accuracy" ? "accent" : "default"}>Highest accuracy</Badge>
        </Link>
        <Link href="/analysts?sort=volume">
          <Badge variant={sort === "volume" ? "accent" : "default"}>Most graded calls</Badge>
        </Link>
      </div>

      {visible.length === 0 ? (
        <Card>
          <CardContent className="p-8 text-center text-sm text-ink-500">
            No analysts have enough graded calls yet to appear here. Check back soon.
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          {visible.map((analyst) => (
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
                    <p className="text-xl font-semibold text-ink-900">
                      {formatPercent(analyst.stats.hitRate ?? 0)}
                    </p>
                    <p className="text-xs text-ink-400">{analyst.stats.resolvedCount} graded calls</p>
                  </div>
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      )}

      <AnalystDisclaimerFooter />
    </div>
  );
}
