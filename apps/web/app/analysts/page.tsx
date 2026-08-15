import type { Metadata } from "next";
import Link from "next/link";

import { AccuracyCaption, AccuracyPercent } from "@/components/finance/accuracy-stat";
import { AnalystFirmFilter } from "@/components/finance/analyst-firm-filter";
import { AnalystDisclaimerFooter } from "@/components/finance/disclaimer-footer";
import { FirmLink } from "@/components/finance/firm-link";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { buildFirmOptions, fetchIndexableAnalysts, sortAnalysts, type AnalystSortMode } from "@/lib/finance/analysts";

export const revalidate = 3600;

type SortMode = AnalystSortMode;

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

export default async function AnalystsDirectoryPage({
  searchParams,
}: {
  searchParams?: { sort?: string; firm?: string };
}) {
  // Default sort is descending accuracy — a "worst analyst" default ordering is a hard
  // legal-framing requirement, never build one, not even as an available option.
  const sort: SortMode = searchParams?.sort === "volume" ? "volume" : "accuracy";
  const firmFilter = searchParams?.firm ?? "";

  const analysts = await fetchIndexableAnalysts();
  // Firm options are built from the FULL (unfiltered) analyst list so counts and
  // the dropdown itself stay stable regardless of which firm is currently
  // selected — filtering happens after, on a copy.
  const firmOptions = buildFirmOptions(analysts);
  const filtered = firmFilter ? analysts.filter((a) => a.organization === firmFilter) : analysts;
  const sorted = sortAnalysts(filtered, sort);
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

      <div className="flex flex-wrap items-center gap-3">
        <div className="flex flex-wrap gap-2">
          <Link href={{ pathname: "/analysts", query: { sort: "accuracy", ...(firmFilter ? { firm: firmFilter } : {}) } }}>
            <Badge variant={sort === "accuracy" ? "accent" : "default"}>Highest accuracy</Badge>
          </Link>
          <Link href={{ pathname: "/analysts", query: { sort: "volume", ...(firmFilter ? { firm: firmFilter } : {}) } }}>
            <Badge variant={sort === "volume" ? "accent" : "default"}>Most graded calls</Badge>
          </Link>
        </div>
        <AnalystFirmFilter firmOptions={firmOptions} />
      </div>

      {visible.length === 0 ? (
        <Card>
          <CardContent className="p-8 text-center text-sm text-ink-500">
            {firmFilter
              ? `No analysts from ${firmFilter} have enough graded calls yet to appear here.`
              : "No analysts have enough graded calls yet to appear here. Check back soon."}
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {visible.map((analyst) => (
            // The card is a "stretched link" to the profile (Link positioned
            // absolute+inset-0 under the content) rather than wrapping the
            // whole card in a single <Link> — that would make the firm name
            // below un-independently-clickable (nested <a> tags aren't valid
            // HTML and browsers mis-render them). This way the card's default
            // click still goes to the profile, but the firm name inside opens
            // its own filtered-directory link instead.
            <Card key={analyst.id} className="relative h-full transition hover:border-signal-sky/40">
              <Link
                href={`/analysts/${analyst.slug}`}
                className="absolute inset-0 z-0"
                aria-label={analyst.name}
              />
              <CardContent className="pointer-events-none relative z-10 flex items-center gap-4 p-5">
                <Avatar name={analyst.name} src={analyst.avatarUrl} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <p className="truncate text-base font-semibold text-ink-900">{analyst.name}</p>
                    {analyst.verified && <Badge variant="accent">Verified</Badge>}
                  </div>
                  <p className="truncate text-sm text-ink-500">
                    <FirmLink
                      organization={analyst.organization}
                      className="pointer-events-auto relative z-20 hover:underline"
                    />
                  </p>
                </div>
                <div className="text-right">
                  <p className="text-xl">
                    <AccuracyPercent
                      hitCount={analyst.stats.hitCount}
                      resolvedCount={analyst.stats.resolvedCount}
                      normalClassName="font-semibold text-ink-900"
                      mutedClassName="font-medium text-ink-500"
                    />
                  </p>
                  <p className="text-xs text-ink-400">
                    {/* Card is a "stretched link" (Link positioned absolute+inset-0, z-0) with
                        CardContent set pointer-events-none — badgeClassName re-enables pointer
                        events + raises z-index, same opt-in pattern FirmLink uses above, so the
                        badge's own /methodology link is actually clickable instead of being
                        swallowed by the full-card link underneath it. */}
                    <AccuracyCaption
                      hitCount={analyst.stats.hitCount}
                      resolvedCount={analyst.stats.resolvedCount}
                      badgeClassName="pointer-events-auto relative z-20 inline-block align-middle"
                    />
                  </p>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <AnalystDisclaimerFooter />
    </div>
  );
}
