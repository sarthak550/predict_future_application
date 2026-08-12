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
 * `weightPct`, this panel shows a "Wt." column and a "Top weight" header
 * callout for the single largest constituent. Two sources feed this, and the
 * callout's caveat text is source-aware via `weightIsEstimate`:
 *   - NSE (`indexLiveWatch.ts`): a live free-float-mcap-share ESTIMATE — NSE
 *     applies capping factors on top that this payload doesn't carry, so it's
 *     labeled as an estimate, never asserted to be NSE's own official weight.
 *   - BSE (`bseIndexConstituents.ts`, added 2026-08-12): BSE's OWN published
 *     `Weightage` field from its live IndicesWatch feed — the real final
 *     number, not derived by us, so no estimate caveat is shown.
 * A plain-CSV index with no live-watch mapping (either exchange) renders
 * exactly as before this feature existed (no Wt. column at all, `weightPct`
 * all null).
 */

function formatRupees(value: number): string {
  return `₹${value.toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;
}

export type IndexCompositionConstituent = {
  /** Null for a BSE-only constituent our own company-name resolver couldn't link to an `/instruments/[symbol]` page (see bseIndexConstituents.ts's module doc, "no dead links") — renders as plain text instead of a Link. Always non-null for every NSE constituent (indexConstituents.ts derives it directly from NSE's own published Symbol column). */
  symbol: string | null;
  companyName: string;
  industry: string | null;
  close: number | null;
  changePercent: number | null;
  /** Index weight (0-100) from either exchange's live source, or undefined/null when unavailable — see this file's module doc. Optional so existing callers (a plain IndexConstituentQuoteRow with no weight field) keep compiling unchanged. */
  weightPct?: number | null;
  /** True for NSE's ffmc-share estimate, false for BSE's own published Weightage — governs which caveat (or none) the "Top weight" callout shows. See this file's module doc. */
  weightIsEstimate?: boolean;
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
            <span className="text-ink-300">
              {topWeight.weightIsEstimate === false
                ? "(BSE’s own published index weight)"
                : "(free-float mcap share, estimate — not NSE’s published weight)"}
            </span>
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
              const rowClassName = hasWeights
                ? "grid grid-cols-[minmax(0,1fr)_4rem_9rem] items-center gap-3 rounded-md py-2.5 transition-colors"
                : "grid grid-cols-[minmax(0,1fr)_9rem] items-center gap-3 rounded-md py-2.5 transition-colors";

              const rowContent = (
                <>
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-ink-900">{c.symbol ?? c.companyName}</p>
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
                </>
              );

              return (
                <li key={c.symbol ?? c.companyName}>
                  {c.symbol ? (
                    <Link href={`/instruments/${c.symbol}`} className={`${rowClassName} hover:bg-ink-50/60`}>
                      {rowContent}
                    </Link>
                  ) : (
                    // No StockEodQuote match for this BSE-only listing (see
                    // IndexCompositionConstituent's own doc) — a real member,
                    // rendered honestly, but never a dead Link.
                    <div className={rowClassName} title="Not yet linked to an instrument page">
                      {rowContent}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      </CardContent>
    </Card>
  );
}
