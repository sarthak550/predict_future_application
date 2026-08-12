"use client";

import { useState } from "react";
import Link from "next/link";

import { Card, CardContent } from "@/components/ui/card";
import type { IndexMembershipEntry } from "@/lib/finance/indexMembership";

/**
 * "Index membership" (founder ask, 2026-08-12 — "in similar fashion like we
 * show what funds track the indices, can we also add the indices the stock
 * is part of, on the stock page"). Symmetric with `EtfTrackingList`'s "ETFs
 * tracking this index" on the index side; renders only real, registry/
 * live-watch-verified memberships (lib/finance/indexMembership.ts) — never a
 * sector-taxonomy guess. A stock in zero covered indices simply doesn't
 * render this section (same graceful-degrade discipline as
 * `IndexCompositionPanel`/`EtfTrackingList`).
 *
 * ORDERING (founder follow-up, same day: "not just index name but what
 * weights they assign to it" + "ORDER the memberships by that weight
 * descending... memberships with no weight data... after the weighted ones,
 * alphabetical among themselves"): weighted memberships first, heaviest
 * first; weightless (CSV-only, no live-watch coverage for that index) ones
 * after, sorted alphabetically by index name. Mirrors
 * IndexCompositionPanel's own weight-descending presentation-order rule,
 * applied here across DIFFERENT indices' weights for the SAME stock rather
 * than across different stocks' weights within one index.
 *
 * CAP: a large-cap sitting in 30+ indices (RELIANCE will) gets a "+N more"
 * expansion rather than an unbounded chip wall.
 */

const VISIBLE_CAP = 12;

export function IndexMembershipStrip({ memberships }: { memberships: IndexMembershipEntry[] }) {
  const [expanded, setExpanded] = useState(false);

  if (memberships.length === 0) return null;

  const hasWeights = memberships.some((m) => m.weightPct != null);
  const ordered = [...memberships].sort((a, b) => {
    if (a.weightPct != null && b.weightPct != null) return b.weightPct - a.weightPct;
    if (a.weightPct != null) return -1;
    if (b.weightPct != null) return 1;
    return a.indexName.localeCompare(b.indexName);
  });

  const visible = expanded ? ordered : ordered.slice(0, VISIBLE_CAP);
  const remaining = ordered.length - visible.length;

  return (
    <Card>
      <CardContent className="p-5">
        <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-ink-400">Index membership</p>
          <p className="text-[11px] text-ink-400">
            {ordered.length} {ordered.length === 1 ? "index" : "indices"}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {visible.map((m) => (
            <Link
              key={m.indexSymbol}
              href={`/instruments/${m.indexSymbol}`}
              className="inline-flex items-center gap-1 rounded-full border border-ink-200 px-3 py-1 text-xs font-medium text-ink-700 transition-colors hover:border-signal-sky hover:text-signal-sky"
            >
              {m.indexName}
              {m.weightPct != null && (
                <span className="font-normal text-ink-400">· {m.weightPct.toFixed(1)}%</span>
              )}
            </Link>
          ))}
          {!expanded && remaining > 0 && (
            <button
              type="button"
              onClick={() => setExpanded(true)}
              className="inline-flex items-center rounded-full border border-dashed border-ink-300 px-3 py-1 text-xs font-medium text-ink-500 transition-colors hover:border-ink-400 hover:text-ink-700"
            >
              +{remaining} more
            </button>
          )}
        </div>
        {hasWeights && (
          <p className="mt-3 border-t border-ink-100 pt-3 text-[11px] leading-5 text-ink-400">
            Weight is a free-float market-cap-share estimate from NSE&apos;s live index data, not NSE&apos;s own
            published (and sometimes capped) index weight. Indices without a live weight feed are listed without
            one, in alphabetical order after the weighted ones.
          </p>
        )}
      </CardContent>
    </Card>
  );
}
