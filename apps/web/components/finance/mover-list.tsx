"use client";

/**
 * Top Movers column for /pulse (gainers or losers). Server data arrives as the
 * FULL session list (NSE's movers feed caps at ~20 per direction market-wide);
 * the column renders a compact top-5 by default with a "Show all N" toggle so
 * the first paint stays scannable while the full depth is one click away.
 */

import { useState } from "react";
import { TrendingDown, TrendingUp } from "lucide-react";

import { Card, CardContent } from "@/components/ui/card";
import type { MoverRow } from "@/lib/finance/marketPulse";

const COLLAPSED_COUNT = 5;

export function MoverList({
  title,
  rows,
  tone,
}: {
  title: string;
  rows: MoverRow[];
  tone: "up" | "down";
}) {
  const [showAll, setShowAll] = useState(false);
  const Icon = tone === "up" ? TrendingUp : TrendingDown;
  const toneClass = tone === "up" ? "text-emerald-600" : "text-rose-600";
  const visible = showAll ? rows : rows.slice(0, COLLAPSED_COUNT);
  const hiddenCount = rows.length - COLLAPSED_COUNT;

  return (
    <Card>
      <CardContent className="p-5">
        <p className={`mb-3 flex items-center gap-1.5 text-sm font-semibold ${toneClass}`}>
          <Icon className="h-4 w-4" />
          {title}
        </p>
        {rows.length === 0 ? (
          <p className="text-sm text-ink-400">No {title.toLowerCase()} captured this session.</p>
        ) : (
          <>
            <ul className="divide-y divide-ink-100">
              {visible.map((row) => (
                <li key={row.tickerSymbol} className="flex items-center justify-between gap-3 py-2.5">
                  <div className="flex min-w-0 items-baseline gap-2">
                    <span className="w-5 shrink-0 text-xs tabular-nums text-ink-300">{row.rank}</span>
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-ink-900">{row.companyName}</p>
                      <p className="text-xs text-ink-400">{row.tickerSymbol}</p>
                    </div>
                  </div>
                  <div className="text-right">
                    <p className={`text-sm font-semibold ${toneClass}`}>
                      {row.changePercent > 0 ? "+" : ""}
                      {row.changePercent.toFixed(2)}%
                    </p>
                    {row.isUnusualVolume && (
                      <p className="text-[10px] font-medium uppercase tracking-wide text-signal-amber">
                        Unusual volume
                      </p>
                    )}
                  </div>
                </li>
              ))}
            </ul>
            {hiddenCount > 0 ? (
              <button
                type="button"
                onClick={() => setShowAll((v) => !v)}
                className="mt-3 w-full rounded-md border border-ink-100 py-1.5 text-center text-xs font-medium text-ink-500 transition-colors hover:bg-ink-50 hover:text-ink-700"
              >
                {showAll ? "Show less" : `Show all ${rows.length}`}
              </button>
            ) : null}
          </>
        )}
      </CardContent>
    </Card>
  );
}
