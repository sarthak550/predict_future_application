import Link from "next/link";
import { ArrowUpRight } from "lucide-react";

import { DirectionChip } from "@/components/finance/analyst-badges";
import { FirmLink } from "@/components/finance/firm-link";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import type { BigCallResult } from "@/lib/finance/bigCall";
import { formatDateOnly } from "@/lib/utils";

/**
 * Homepage spotlight for the day's highest-scored analyst call — see
 * lib/finance/bigCall.ts for the selection algorithm. Renders nothing when
 * no candidate exists (empty pool), per the ticket's "skip the module
 * gracefully if none" instruction — the homepage layout doesn't reserve
 * space for it.
 */
export function BigCallCard({ result }: { result: BigCallResult }) {
  if (!result.opinion) {
    return null;
  }

  const { opinion } = result;

  return (
    <Card className="overflow-hidden border-0 bg-ink-900 text-white">
      <CardContent className="space-y-4 p-6 sm:p-8">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="text-xs font-semibold uppercase tracking-[0.24em] text-signal-sky">
            {result.windowLabel}
          </span>
          {/* Audit #3 (2026-08-15): every hero call declares its grading state —
              a graded HIT wears its receipt, and a pending call says so
              plainly instead of reading as an implicit endorsement on a page
              whose whole pitch is "we grade every call". */}
          {opinion.isPostResolution ? (
            <Badge className="bg-emerald-500/20 text-emerald-300">HIT — graded correct</Badge>
          ) : (
            <Badge className="bg-amber-500/20 text-amber-300">Pending — not yet graded</Badge>
          )}
        </div>

        <div className="flex items-center gap-3">
          <Avatar name={opinion.expertName} src={opinion.avatarUrl} />
          <div>
            {opinion.expertSlug ? (
              <Link
                href={`/analysts/${opinion.expertSlug}`}
                className="text-base font-semibold text-white hover:underline"
              >
                {opinion.expertName}
              </Link>
            ) : (
              <p className="text-base font-semibold text-white">{opinion.expertName}</p>
            )}
            <p className="text-sm text-white/60">
              <FirmLink organization={opinion.expertOrganization} className="hover:underline" />
            </p>
          </div>
        </div>

        <blockquote className="rounded-[24px] bg-white/10 p-5 text-lg leading-8 text-white">
          &ldquo;{opinion.quote}&rdquo;
        </blockquote>

        <div className="flex flex-wrap items-center gap-3">
          {opinion.instrument && <Badge className="bg-white/10 text-white">{opinion.instrument}</Badge>}
          <DirectionChip direction={opinion.direction} />
          <span className="text-sm text-white/60">Called {formatDateOnly(opinion.publishedAt)}</span>
        </div>

        <a
          href={opinion.sourceUrl}
          target="_blank"
          rel="noreferrer"
          className="inline-flex w-fit items-center gap-2 text-sm font-medium text-signal-sky hover:underline"
        >
          Read the original article
          <ArrowUpRight className="h-4 w-4" />
        </a>
      </CardContent>
    </Card>
  );
}
