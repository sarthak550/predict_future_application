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
 * ORDERING (explicit design call, per the founder's own "your design call,
 * but change-ordered beats alphabetical" allowance): biggest gainers first,
 * biggest losers last, sorted purely by day change% — computed and sorted
 * server-side in lib/finance/instrument.ts, this component just renders the
 * order it's given. Constituents with no StockEodQuote row yet (thin/newly
 * listed coverage) are grouped at the very end with a "—" change cell rather
 * than dropped — still real members, just unrankable by a change that
 * doesn't exist.
 *
 * NO WEIGHTS COLUMN: the source CSVs don't carry index weights, and this
 * panel never estimates one — see indexConstituents.ts's module doc.
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
        <p className="mb-3 text-xs text-ink-400">
          Member stocks, ranked by today&apos;s change — biggest gainers first, biggest losers last.
        </p>

        <div className={listClassName}>
          <ul className="divide-y divide-ink-100">
            {constituents.map((c) => {
              const hasChange = c.changePercent != null;
              const isUp = hasChange && (c.changePercent as number) >= 0;
              const Icon = isUp ? TrendingUp : TrendingDown;
              const toneClass = isUp ? "text-emerald-600" : "text-rose-600";

              return (
                <li key={c.symbol}>
                  <Link
                    href={`/instruments/${c.symbol}`}
                    className="flex items-center justify-between gap-3 rounded-md py-2.5 transition-colors hover:bg-ink-50/60"
                  >
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-ink-900">{c.symbol}</p>
                      <p className="truncate text-xs text-ink-400">
                        {c.companyName}
                        {c.industry ? <span className="text-ink-300"> · {c.industry}</span> : null}
                      </p>
                    </div>
                    <div className="shrink-0 text-right">
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
