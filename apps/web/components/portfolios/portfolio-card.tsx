import Link from "next/link";

import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { formatRupees, formatSignedPercent } from "@/lib/portfolios/format";
import { cn, formatRelativeTime } from "@/lib/utils";

export interface PortfolioCardProps {
  slug: string;
  name: string;
  kind: "USER" | "SHADOW";
  ownerLabel: string;
  ownerHref: string | null;
  ownerOrganization: string | null;
  ownerAvatarUrl: string | null;
  returnPct: number;
  totalValue: number;
  createdAt: Date;
  /** Ordinal position within the ranked list — omitted in the "too new to rank" section. */
  rank?: number;
}

/**
 * Directory card for app/portfolios/page.tsx. Kind badge text mirrors the CEO
 * brief exactly for SHADOW ("Auto-generated from graded calls"); USER gets a
 * plain "Community" badge so the mixed "All" tab still reads at a glance.
 */
export function PortfolioCard({
  slug,
  name,
  kind,
  ownerLabel,
  ownerHref,
  ownerOrganization,
  ownerAvatarUrl,
  returnPct,
  totalValue,
  createdAt,
  rank
}: PortfolioCardProps) {
  const isUp = returnPct >= 0;

  return (
    <Link href={`/portfolios/${slug}`}>
      <Card className="h-full transition hover:border-signal-sky/40">
        <CardContent className="flex flex-col gap-3 p-5">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                {rank != null && <Badge variant="accent">#{rank}</Badge>}
                <p className="truncate text-base font-semibold text-ink-900">{name}</p>
              </div>
              <div className="mt-1.5 flex items-center gap-2">
                {kind === "SHADOW" && <Avatar name={ownerLabel} src={ownerAvatarUrl} className="h-6 w-6 text-[10px]" />}
                {ownerHref ? (
                  <Link
                    href={ownerHref}
                    className="truncate text-sm text-ink-500 hover:text-signal-sky hover:underline"
                  >
                    {ownerLabel}
                  </Link>
                ) : (
                  <span className="truncate text-sm text-ink-500">{ownerLabel}</span>
                )}
                {ownerOrganization && <span className="truncate text-xs text-ink-400">· {ownerOrganization}</span>}
              </div>
            </div>
            <Badge>{kind === "SHADOW" ? "Auto-generated from graded calls" : "Community"}</Badge>
          </div>

          <div className="flex items-end justify-between border-t border-ink-100 pt-3">
            <div>
              <p className="text-xs text-ink-400">Value</p>
              <p className="mt-0.5 text-lg font-semibold text-ink-900">{formatRupees(totalValue)}</p>
            </div>
            <div className="text-right">
              <p className="text-xs text-ink-400">Return since inception</p>
              <p className={cn("mt-0.5 text-lg font-semibold", isUp ? "text-emerald-600" : "text-rose-600")}>
                {formatSignedPercent(returnPct)}
              </p>
            </div>
          </div>

          <p className="text-xs text-ink-400">{formatRelativeTime(createdAt)}</p>
        </CardContent>
      </Card>
    </Link>
  );
}
