"use client";

/**
 * Top Movers as a single card: Gainers | Losers side by side with ONE shared
 * "Show all" control. (Replaces two separate cards with per-column toggles —
 * independent expansion left the columns lopsided and doubled the clicks for
 * what reads as one action.)
 *
 * Phase 1 interactivity sprint additions (read-only, no layout jump when
 * absent): last price, a truncated "why is it moving" headline linking to
 * its source, and an "analyst said" badge linking to the analyst's profile.
 */

import Link from "next/link";
import { useState } from "react";
import { TrendingDown, TrendingUp } from "lucide-react";

import { DirectionChip, VerdictBadge } from "@/components/finance/analyst-badges";
import { Card, CardContent } from "@/components/ui/card";
import type { MoverRow } from "@/lib/finance/marketPulse";
import { formatRelativeTime } from "@/lib/utils";

const COLLAPSED_COUNT = 5;

/** "₹1,830.50" — Indian digit grouping, at most 2 decimal places. */
function formatRupees(value: number): string {
  return `₹${value.toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;
}

/** "+₹52.00" / "-₹12.30" — signed rupee change, shown beside the % figure. */
function formatSignedRupees(value: number): string {
  const sign = value > 0 ? "+" : value < 0 ? "-" : "";
  return `${sign}₹${Math.abs(value).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;
}

export function TopMoversCard({ gainers, losers }: { gainers: MoverRow[]; losers: MoverRow[] }) {
  const [showAll, setShowAll] = useState(false);
  const maxRows = Math.max(gainers.length, losers.length);
  const hiddenCount = Math.max(0, maxRows - COLLAPSED_COUNT);

  return (
    <Card>
      <CardContent className="p-5">
        <div className="grid gap-6 sm:grid-cols-2 sm:divide-x sm:divide-ink-100">
          <MoverColumn title="Gainers" rows={gainers} tone="up" showAll={showAll} />
          <MoverColumn title="Losers" rows={losers} tone="down" showAll={showAll} className="sm:pl-6" />
        </div>
        {hiddenCount > 0 ? (
          <button
            type="button"
            onClick={() => setShowAll((v) => !v)}
            className="mt-4 w-full rounded-md border border-ink-100 py-2 text-center text-xs font-medium text-ink-500 transition-colors hover:bg-ink-50 hover:text-ink-700"
          >
            {showAll ? "Show less" : `Show all ${maxRows}`}
          </button>
        ) : null}
      </CardContent>
    </Card>
  );
}

function MoverColumn({
  title,
  rows,
  tone,
  showAll,
  className = "",
}: {
  title: string;
  rows: MoverRow[];
  tone: "up" | "down";
  showAll: boolean;
  className?: string;
}) {
  const Icon = tone === "up" ? TrendingUp : TrendingDown;
  const toneClass = tone === "up" ? "text-emerald-600" : "text-rose-600";
  const visible = showAll ? rows : rows.slice(0, COLLAPSED_COUNT);

  return (
    <div className={className}>
      <p className={`mb-3 flex items-center gap-1.5 text-sm font-semibold ${toneClass}`}>
        <Icon className="h-4 w-4" />
        {title}
      </p>
      {rows.length === 0 ? (
        <p className="text-sm text-ink-400">No {title.toLowerCase()} captured this session.</p>
      ) : (
        <ul className="divide-y divide-ink-100">
          {visible.map((row) => {
            const isGraded =
              row.analystCall?.resolutionStatus === "RESOLVED_HIT" ||
              row.analystCall?.resolutionStatus === "RESOLVED_MISS";
            return (
              <li key={row.tickerSymbol} className="py-2.5">
                <Link
                  href={`/instruments/${row.tickerSymbol}`}
                  className="block rounded-md transition-colors hover:bg-ink-50/60"
                >
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex min-w-0 items-baseline gap-2">
                      <span className="w-6 shrink-0 text-xs tabular-nums text-ink-300">{row.rank}</span>
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium text-ink-900">{row.companyName}</p>
                        <p className="text-xs text-ink-400">
                          {row.tickerSymbol}
                          {row.lastPrice != null ? (
                            <span className="ml-1.5 text-ink-500">{formatRupees(row.lastPrice)}</span>
                          ) : null}
                        </p>
                      </div>
                    </div>
                    <div className="shrink-0 text-right">
                      <p className={`text-sm font-semibold ${toneClass}`}>
                        {row.changePercent > 0 ? "+" : ""}
                        {row.changePercent.toFixed(2)}%
                      </p>
                      <p className="text-[11px] text-ink-400">{formatSignedRupees(row.changeAbs)}</p>
                      {row.isUnusualVolume && (
                        <p className="text-[10px] font-medium uppercase tracking-wide text-signal-amber">
                          Unusual volume
                        </p>
                      )}
                    </div>
                  </div>
                </Link>
                {row.topHeadline ? (
                  <a
                    href={row.topHeadline.sourceUrl}
                    target="_blank"
                    rel="noreferrer"
                    onClick={(e) => e.stopPropagation()}
                    title={row.topHeadline.headline}
                    className="mt-1 block truncate pl-8 text-xs text-ink-400 hover:text-ink-600 hover:underline"
                  >
                    {row.topHeadline.headline}
                  </a>
                ) : null}
                {row.analystCall ? (
                  <div className="mt-1 flex flex-wrap items-center gap-1.5 pl-8 text-xs">
                    {row.analystCall.analystSlug ? (
                      <Link
                        href={`/analysts/${row.analystCall.analystSlug}`}
                        className="font-medium text-ink-600 hover:underline"
                      >
                        {row.analystCall.analystName}
                      </Link>
                    ) : (
                      <span className="font-medium text-ink-600">{row.analystCall.analystName}</span>
                    )}
                    <span className="text-ink-400">called</span>
                    <DirectionChip direction={row.analystCall.direction} />
                    {isGraded ? <VerdictBadge status={row.analystCall.resolutionStatus} /> : null}
                    <span className="text-ink-400">{formatRelativeTime(row.analystCall.publishedAt)}</span>
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
