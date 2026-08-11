import Link from "next/link";

import { formatIndexLevel } from "@/components/finance/index-change-badge";
import { Card, CardContent } from "@/components/ui/card";

/**
 * Index Metrics Panel (Indices Consolidation, 2026-08-12, Ask 2a) — replaces
 * FundamentalsPanel in the equity-shaped slot on an index's
 * `/instruments/[symbol]` page (FundamentalsPanel renders nothing for an
 * index today — `enrichment` is EMPTY_INSTRUMENT_ENRICHMENT by design, see
 * lib/finance/instrument.ts — so this was a blank gap, not an intentional
 * choice, until now).
 *
 * Also the new home for every stat the retired slim `/indices/[slug]` page
 * used to render (open/high/low/prev-close, 52-week range, P/E, dividend
 * yield, the "Member stocks today" advance/decline/unchanged breakdown, the
 * tradable-underlying badge + options-terminal CTA, and the "as of" stamp) —
 * see that migration checklist in the consolidation ticket's report. P/B is
 * new (the slim page never surfaced it, though the same live snapshot always
 * carried it).
 */

function formatIstAsOf(iso: string): string {
  return new Intl.DateTimeFormat("en-IN", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: "Asia/Kolkata",
  }).format(new Date(iso));
}

function StatCell({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs text-ink-400">{label}</p>
      <p className="mt-0.5 text-[13px] font-semibold tabular-nums text-ink-900">{value}</p>
    </div>
  );
}

export type IndexMetricsPanelProps = {
  symbol: string;
  metrics: {
    peRatio: number | null;
    pbRatio: number | null;
    dividendYield: number | null;
    advances: number | null;
    declines: number | null;
    unchanged: number | null;
    open: number | null;
    high: number | null;
    low: number | null;
    previousClose: number | null;
    yearHigh: number | null;
    yearLow: number | null;
    asOf: string;
  };
  /** True for the 5 F&O-tradable underlyings — shows the "tradable" badge + options-terminal CTA the slim page's bottom card used to carry. */
  isTradable: boolean;
};

export function IndexMetricsPanel({ symbol, metrics, isTradable }: IndexMetricsPanelProps) {
  const {
    peRatio,
    pbRatio,
    dividendYield,
    advances,
    declines,
    unchanged,
    open,
    high,
    low,
    previousClose,
    yearHigh,
    yearLow,
    asOf,
  } = metrics;

  const hasMemberBreakdown = advances != null || declines != null || unchanged != null;
  const hasAnyStat =
    peRatio != null ||
    pbRatio != null ||
    dividendYield != null ||
    open != null ||
    high != null ||
    low != null ||
    previousClose != null ||
    yearHigh != null ||
    yearLow != null;

  if (!hasAnyStat && !hasMemberBreakdown) return null;

  return (
    <Card>
      <CardContent className="p-5">
        <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-ink-400">Index metrics</p>
          <p className="text-[11px] text-ink-400">As of {formatIstAsOf(asOf)} IST</p>
        </div>

        {hasAnyStat && (
          <div className="grid grid-cols-2 gap-4 text-sm sm:grid-cols-4">
            {open != null && <StatCell label="Open" value={formatIndexLevel(open)} />}
            {high != null && <StatCell label="Day High" value={formatIndexLevel(high)} />}
            {low != null && <StatCell label="Day Low" value={formatIndexLevel(low)} />}
            {previousClose != null && <StatCell label="Prev. Close" value={formatIndexLevel(previousClose)} />}
            {yearHigh != null && <StatCell label="52W High" value={formatIndexLevel(yearHigh)} />}
            {yearLow != null && <StatCell label="52W Low" value={formatIndexLevel(yearLow)} />}
            {peRatio != null && <StatCell label="P/E" value={peRatio.toFixed(2)} />}
            {pbRatio != null && <StatCell label="P/B" value={pbRatio.toFixed(2)} />}
            {dividendYield != null && <StatCell label="Div. Yield" value={`${dividendYield.toFixed(2)}%`} />}
          </div>
        )}

        {hasMemberBreakdown && (
          <div className={hasAnyStat ? "mt-5 border-t border-ink-100 pt-4" : ""}>
            <p className="mb-1 text-xs font-semibold uppercase tracking-[0.2em] text-ink-400">Member stocks today</p>
            <p className="mb-3 text-xs text-ink-400">
              How many of this index&apos;s member stocks rose or fell today — a broad move and a few-heavyweights
              move look very different here.
            </p>
            <div className="grid grid-cols-3 gap-4 text-center">
              <div>
                <p className="text-xl font-semibold text-emerald-600">{advances ?? "—"}</p>
                <p className="text-xs text-ink-400">Rose</p>
              </div>
              <div>
                <p className="text-xl font-semibold text-rose-600">{declines ?? "—"}</p>
                <p className="text-xs text-ink-400">Fell</p>
              </div>
              <div>
                <p className="text-xl font-semibold text-ink-600">{unchanged ?? "—"}</p>
                <p className="text-xs text-ink-400">Flat</p>
              </div>
            </div>
          </div>
        )}

        {isTradable && (
          <div className="mt-5 flex flex-wrap items-center justify-between gap-3 border-t border-ink-100 pt-4">
            <div>
              <p className="text-sm font-semibold text-emerald-600">Tradable in the F&amp;O options terminal</p>
              <p className="text-xs text-ink-500">Paper trading — practice with a simulated account, real market prices.</p>
            </div>
            <Link
              href={`/paper-trading/options?underlying=${encodeURIComponent(symbol)}`}
              className="rounded-full bg-ink-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-ink-700"
            >
              Open options terminal →
            </Link>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
