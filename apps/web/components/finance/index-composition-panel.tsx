import Link from "next/link";
import { TrendingDown, TrendingUp } from "lucide-react";

import { Card, CardContent } from "@/components/ui/card";

/**
 * Index Composition Panel (Indices Consolidation, 2026-08-12, Ask 2b +
 * founder addendum: "what stocks in index fell or rise by what percent are
 * very good detailing"). Only rendered for the ~30 indices with a
 * hand-verified constituent CSV (lib/finance/indexConstituents.ts) — never
 * for a plain equity or a long-tail index with no verified list.
 *
 * ORDERING (founder, 2026-08-12 follow-up: weights "not sorted in
 * decreasing order — it would be great if we can do that"): when weights
 * exist, rows sort by weight DESCENDING (heaviest first — supersedes the
 * earlier day-change ordering for weighted indices; weightless members
 * fall to the end, then by change). Indices with no weight data keep the
 * original day-change order (gainers first, losers last) the server
 * already provides. Constituents with no StockEodQuote row are never
 * dropped — they render with a "—" change cell.
 *
 * WEIGHT COLUMN (2026-08-12 follow-up): when a constituent carries
 * `weightPct` (indexLiveWatch.ts's live free-float-mcap-share estimate — see
 * that file's module doc), this panel shows a "Wt." column and a "Top
 * weight" header callout for the single largest constituent. Labeled as an
 * ESTIMATE, never asserted to be NSE's own official (possibly capped)
 * published weight — the source CSVs still carry no weight column of their
 * own, and a plain-CSV index with no live-watch mapping renders exactly as
 * before (no Wt. column at all, `weightPct` all null).
 */

function formatRupees(value: number): string {
  return `₹${value.toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;
}

export type IndexCompositionConstituent = {
  symbol: string;
  companyName: string;
  industry: string | null;
  close: number | null;
  changePercent: number | null;
  /** Live free-float-mcap-share weight estimate (0-100), or undefined/null when unavailable — see this file's module doc. Optional so existing callers (a plain IndexConstituentQuoteRow with no weight field) keep compiling unchanged. */
  weightPct?: number | null;
};

export type IndexCompositionPanelProps = {
  constituents: IndexCompositionConstituent[];
  /** From the same live allIndices snapshot the metrics panel reads (IndexMetrics) — reused here for header coherence rather than recomputed from the (possibly thinner, quote-gated) constituent list itself. */
  advances?: number | null;
  declines?: number | null;
};

/** Below this count, every row fits comfortably without a scrollbar (a 10-stock NIFTY IT gaining an inner scroll cutoff for a hidden 10th row read as broken, not deliberate) — the cap only kicks in for the genuinely long lists (NIFTY 500, NIFTY TOTAL MARKET) where an unbounded page height would be worse. */
const SCROLL_THRESHOLD = 12;

export function IndexCompositionPanel({ constituents, advances, declines }: IndexCompositionPanelProps) {
  if (constituents.length === 0) return null;

  const breadthLabel =
    advances != null && declines != null ? ` · ${advances} advanced · ${declines} declined` : "";
  const listClassName = constituents.length > SCROLL_THRESHOLD ? "max-h-[560px] overflow-y-auto" : "";

  const hasWeights = constituents.some((c) => c.weightPct != null);
  // Weight-descending presentation order (founder 2026-08-12) — weightless
  // members sink to the end, ranked among themselves by day change.
  const ordered = hasWeights
    ? [...constituents].sort(
        (a, b) => (b.weightPct ?? -1) - (a.weightPct ?? -1) || (b.changePercent ?? -Infinity) - (a.changePercent ?? -Infinity),
      )
    : constituents;
  const topWeight = hasWeights ? ordered[0] : null;

  return (
    <Card>
      <CardContent className="p-5">
        <div className="mb-1 flex flex-wrap items-baseline justify-between gap-2">
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-ink-400">Composition</p>
          <p className="text-[11px] text-ink-400">
            {constituents.length} stocks
            {breadthLabel}
          </p>
        </div>
        <p className={topWeight ? "mb-1 text-xs text-ink-400" : "mb-3 text-xs text-ink-400"}>
          {hasWeights
            ? "Member stocks, ranked by index weight — heaviest first."
            : "Member stocks, ranked by today's change — biggest gainers first, biggest losers last."}
        </p>
        {topWeight && topWeight.weightPct != null && (
          <p className="mb-3 text-xs text-ink-500">
            Top weight: <span className="font-semibold text-ink-700">{topWeight.symbol}</span> ·{" "}
            {topWeight.weightPct.toFixed(1)}%{" "}
            <span className="text-ink-300">(free-float mcap share, estimate — not NSE&apos;s published weight)</span>
          </p>
        )}

        {/* Fixed-width right columns (founder 2026-08-12: "weights are not
            in 1 column") — a header row plus per-row grid tracks so Weight,
            Price, and Change each align vertically down the whole list
            instead of drifting with the name block's width. Literal class
            strings (grid track lists included) per the Tailwind purge law. */}
        <div
          className={
            hasWeights
              ? "grid grid-cols-[minmax(0,1fr)_4rem_9rem] gap-3 border-b border-ink-100 pb-1.5 text-[11px] font-medium uppercase tracking-wide text-ink-400"
              : "grid grid-cols-[minmax(0,1fr)_9rem] gap-3 border-b border-ink-100 pb-1.5 text-[11px] font-medium uppercase tracking-wide text-ink-400"
          }
        >
          <span>Stock</span>
          {hasWeights && <span className="text-right">Weight</span>}
          <span className="text-right">Price · Day</span>
        </div>
        <div className={listClassName}>
          <ul className="divide-y divide-ink-100">
            {ordered.map((c) => {
              const hasChange = c.changePercent != null;
              const isUp = hasChange && (c.changePercent as number) >= 0;
              const Icon = isUp ? TrendingUp : TrendingDown;
              const toneClass = isUp ? "text-emerald-600" : "text-rose-600";

              return (
                <li key={c.symbol}>
                  <Link
                    href={`/instruments/${c.symbol}`}
                    className={
                      hasWeights
                        ? "grid grid-cols-[minmax(0,1fr)_4rem_9rem] items-center gap-3 rounded-md py-2.5 transition-colors hover:bg-ink-50/60"
                        : "grid grid-cols-[minmax(0,1fr)_9rem] items-center gap-3 rounded-md py-2.5 transition-colors hover:bg-ink-50/60"
                    }
                  >
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-ink-900">{c.symbol}</p>
                      <p className="truncate text-xs text-ink-400">
                        {c.companyName}
                        {c.industry ? <span className="text-ink-300"> · {c.industry}</span> : null}
                      </p>
                    </div>
                    {hasWeights && (
                      <p className="text-right text-sm font-medium text-ink-700 tabular-nums">
                        {c.weightPct != null ? `${c.weightPct.toFixed(1)}%` : "—"}
                      </p>
                    )}
                    <div className="text-right">
                      {c.close != null && <p className="text-sm text-ink-700 tabular-nums">{formatRupees(c.close)}</p>}
                      {hasChange ? (
                        <p className={`flex items-center justify-end gap-1 text-sm font-semibold tabular-nums ${toneClass}`}>
                          <Icon className="h-3.5 w-3.5" />
                          {isUp ? "+" : ""}
                          {(c.changePercent as number).toFixed(2)}%
                        </p>
                      ) : (
                        <p className="text-sm text-ink-300">—</p>
                      )}
                    </div>
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      </CardContent>
    </Card>
  );
}
