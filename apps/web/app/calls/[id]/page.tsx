import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowUpRight } from "lucide-react";

import { AnalystDisclaimerFooter } from "@/components/finance/disclaimer-footer";
import { DirectionChip, VerdictBadge } from "@/components/finance/analyst-badges";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { prisma } from "@/lib/prisma";
import { formatDateOnly } from "@/lib/utils";

// Resolved outcomes only render a full share card. This is thin, single-call content,
// so it stays noindex — the sitemap only ever lists /analysts/[slug] pages.
export const revalidate = 3600;

async function fetchResolvedCall(id: string) {
  const opinion = await prisma.expertOpinion.findUnique({
    where: { id },
    select: {
      id: true,
      quote: true,
      instrument: true,
      direction: true,
      sourceUrl: true,
      publishedAt: true,
      resolvedAt: true,
      resolutionStatus: true,
      resolutionNote: true,
      suppressedAt: true,
      expert: {
        select: { name: true, organization: true, slug: true, verified: true, avatarUrl: true },
      },
    },
  });

  if (!opinion || opinion.suppressedAt) {
    return { kind: "not-found" as const };
  }

  if (opinion.resolutionStatus !== "RESOLVED_HIT" && opinion.resolutionStatus !== "RESOLVED_MISS") {
    return { kind: "unresolved" as const, expertSlug: opinion.expert.slug };
  }

  return { kind: "resolved" as const, opinion };
}

export async function generateMetadata({ params }: { params: { id: string } }): Promise<Metadata> {
  const result = await fetchResolvedCall(params.id);

  if (result.kind !== "resolved") {
    return { title: "Call not found — Predict Future" };
  }

  const { opinion } = result;
  const verdictLabel = opinion.resolutionStatus === "RESOLVED_HIT" ? "HIT" : "MISS";
  const title = `${opinion.expert.name}'s call on ${opinion.instrument ?? "the market"} — ${verdictLabel} | Predict Future`;
  const description = `"${opinion.quote}" — ${opinion.expert.name}, ${opinion.expert.organization}. Graded ${verdictLabel} by Predict Future's Analyst Scorecard.`;

  return {
    title,
    description,
    // Thin, single-call content — keep it out of the index; the analyst profile page
    // (which links here) is the indexable surface.
    robots: { index: false, follow: true },
    alternates: { canonical: `https://predictfuture.app/calls/${params.id}` },
    openGraph: {
      title,
      description,
      type: "article",
      url: `https://predictfuture.app/calls/${params.id}`,
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
    },
  };
}

export default async function CallSharePage({ params }: { params: { id: string } }) {
  const result = await fetchResolvedCall(params.id);

  if (result.kind === "not-found") {
    notFound();
  }

  if (result.kind === "unresolved") {
    // No completed verdict yet — nothing shareable to show. Send the visitor to the
    // analyst's full profile if we know it, otherwise there's nothing left to show.
    if (result.expertSlug) {
      redirect(`/analysts/${result.expertSlug}`);
    }
    notFound();
  }

  const { opinion } = result;
  const isHit = opinion.resolutionStatus === "RESOLVED_HIT";

  return (
    <div className="space-y-8">
      <Card className="overflow-hidden border-0 bg-ink-900 text-white">
        <CardHeader>
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <Avatar name={opinion.expert.name} src={opinion.expert.avatarUrl} />
              <div>
                {opinion.expert.slug ? (
                  <Link href={`/analysts/${opinion.expert.slug}`} className="text-lg font-semibold text-white hover:underline">
                    {opinion.expert.name}
                  </Link>
                ) : (
                  <p className="text-lg font-semibold text-white">{opinion.expert.name}</p>
                )}
                <p className="text-sm text-white/60">{opinion.expert.organization}</p>
              </div>
            </div>
            <Badge variant={isHit ? "success" : "default"} className={isHit ? "" : "bg-white/10 text-white"}>
              {isHit ? "HIT" : "MISS"}
            </Badge>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <blockquote className="rounded-[24px] bg-white/10 p-5 text-lg leading-8 text-white">
            &ldquo;{opinion.quote}&rdquo;
          </blockquote>
          <div className="flex flex-wrap items-center gap-3">
            {opinion.instrument && <Badge className="bg-white/10 text-white">{opinion.instrument}</Badge>}
            <DirectionChip direction={opinion.direction} />
            <span className="text-sm text-white/60">Called {formatDateOnly(opinion.publishedAt)}</span>
            {opinion.resolvedAt && (
              <span className="text-sm text-white/60">Graded {formatDateOnly(opinion.resolvedAt)}</span>
            )}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="flex flex-col gap-4 p-6">
          <div className="flex items-center gap-2 text-sm text-ink-500">
            <span>Verdict:</span>
            <VerdictBadge status={opinion.resolutionStatus} />
          </div>
          {opinion.resolutionNote && (
            <p className="text-sm leading-6 text-ink-600">{opinion.resolutionNote}</p>
          )}
          <a
            href={opinion.sourceUrl}
            target="_blank"
            rel="noreferrer"
            className="inline-flex w-fit items-center gap-2 text-sm font-medium text-signal-sky hover:underline"
          >
            Read the original article
            <ArrowUpRight className="h-4 w-4" />
          </a>
          {opinion.expert.slug && (
            <Link
              href={`/analysts/${opinion.expert.slug}`}
              className="inline-flex w-fit items-center gap-2 text-sm font-medium text-ink-700 hover:underline"
            >
              See {opinion.expert.name}&rsquo;s full track record
              <ArrowUpRight className="h-4 w-4" />
            </Link>
          )}
        </CardContent>
      </Card>

      <AnalystDisclaimerFooter />
    </div>
  );
}
