import { Card, CardContent } from "@/components/ui/card";
import { formatCompactINR } from "@/lib/utils";
import type { DividendPoint, FundamentalsPoint } from "@/lib/finance/fundamentals";

/**
 * Instrument Page v2 (T5) — Fundamentals & Performance panel. Server
 * component, purely presentational. Renders as "supporting evidence" per
 * the thesis-alignment constraint (Decision in the CTO assignment brief):
 * compact stat tables, not a dense TradingView-style grid, and every card
 * that has zero data for its series renders NOTHING (not an empty/broken
 * card) — graceful partial-data degrade is the norm, not the exception,
 * since Yahoo's per-symbol fundamentals coverage genuinely varies (see
 * lib/finance/fundamentals.ts's spot-check doc comment).
 */

export type FundamentalsPanelProps = {
  annualRevenue: FundamentalsPoint[] | null;
  annualNetIncome: FundamentalsPoint[] | null;
  annualDilutedEps: FundamentalsPoint[] | null;
  quarterlyRevenue: FundamentalsPoint[] | null;
  quarterlyNetIncome: FundamentalsPoint[] | null;
  quarterlyDilutedEps: FundamentalsPoint[] | null;
  dividends: DividendPoint[] | null;
  fetchedAt: Date | null;
};

/** "2026-03-31" -> "Mar 2026" — enough precision to place a period without asserting a specific "FY26" labeling convention. */
function formatPeriodLabel(isoDate: string): string {
  return new Intl.DateTimeFormat("en-IN", { month: "short", year: "numeric", timeZone: "UTC" }).format(
    new Date(isoDate)
  );
}

function formatFetchedAt(date: Date): string {
  return new Intl.DateTimeFormat("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    timeZone: "Asia/Kolkata",
  }).format(date);
}

type StatementSeries = { label: string; points: FundamentalsPoint[]; isEps: boolean };

/** Renders whichever of revenue/net income/diluted EPS actually came back — columns for absent series simply don't exist, never a zero column. */
function StatementTable({
  title,
  revenue,
  netIncome,
  dilutedEps,
}: {
  title: string;
  revenue: FundamentalsPoint[] | null;
  netIncome: FundamentalsPoint[] | null;
  dilutedEps: FundamentalsPoint[] | null;
}) {
  const series: StatementSeries[] = [];
  if (revenue && revenue.length > 0) series.push({ label: "Revenue", points: revenue, isEps: false });
  if (netIncome && netIncome.length > 0) series.push({ label: "Net income", points: netIncome, isEps: false });
  if (dilutedEps && dilutedEps.length > 0) series.push({ label: "Diluted EPS", points: dilutedEps, isEps: true });

  if (series.length === 0) return null;

  const periods = Array.from(new Set(series.flatMap((s) => s.points.map((p) => p.periodEnd)))).sort();

  return (
    <div>
      <p className="mb-2 text-xs font-semibold uppercase tracking-[0.2em] text-ink-400">{title}</p>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[420px] text-sm">
          <thead>
            <tr className="border-b border-ink-100 text-left text-xs text-ink-400">
              <th className="py-2 pr-3 font-medium">Period</th>
              {series.map((s) => (
                <th key={s.label} className="py-2 pr-3 text-right font-medium">
                  {s.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-ink-50">
            {periods.map((periodEnd) => (
              <tr key={periodEnd}>
                <td className="py-2 pr-3 text-ink-600">{formatPeriodLabel(periodEnd)}</td>
                {series.map((s) => {
                  const point = s.points.find((p) => p.periodEnd === periodEnd);
                  return (
                    <td key={s.label} className="py-2 pr-3 text-right font-medium text-ink-900">
                      {point == null ? (
                        <span className="text-ink-300">—</span>
                      ) : s.isEps ? (
                        `₹${point.value.toFixed(2)}`
                      ) : (
                        `₹${formatCompactINR(point.value)}`
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function DividendList({ dividends }: { dividends: DividendPoint[] }) {
  if (dividends.length === 0) {
    return (
      <div>
        <p className="mb-2 text-xs font-semibold uppercase tracking-[0.2em] text-ink-400">Dividends</p>
        <p className="text-sm text-ink-500">No dividends declared in the last 3 years.</p>
      </div>
    );
  }

  const sortedDesc = dividends.slice().sort((a, b) => b.date.localeCompare(a.date));

  return (
    <div>
      <p className="mb-2 text-xs font-semibold uppercase tracking-[0.2em] text-ink-400">Dividends</p>
      <ul className="divide-y divide-ink-50">
        {sortedDesc.map((d) => (
          <li key={d.date} className="flex items-center justify-between py-2 text-sm">
            <span className="text-ink-500">{formatPeriodLabel(d.date)}</span>
            <span className="font-medium text-ink-900">₹{d.amount.toFixed(2)} / share</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function FundamentalsPanel({
  annualRevenue,
  annualNetIncome,
  annualDilutedEps,
  quarterlyRevenue,
  quarterlyNetIncome,
  quarterlyDilutedEps,
  dividends,
  fetchedAt,
}: FundamentalsPanelProps) {
  const hasAnnual = [annualRevenue, annualNetIncome, annualDilutedEps].some((s) => s && s.length > 0);
  const hasQuarterly = [quarterlyRevenue, quarterlyNetIncome, quarterlyDilutedEps].some((s) => s && s.length > 0);
  const hasDividends = dividends != null;

  // A true first-ever visit (nothing cached yet, background fetch just
  // kicked off) has nothing to show — render nothing rather than an empty
  // shell. The NEXT visit (after the background fetch lands) will populate
  // this section.
  if (!hasAnnual && !hasQuarterly && !hasDividends) return null;

  return (
    <Card>
      <CardContent className="space-y-6 p-5">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-ink-400">Fundamentals</p>
          {fetchedAt && (
            <p className="text-[11px] text-ink-400">
              Source: Yahoo Finance — may lag official filings · as of {formatFetchedAt(fetchedAt)}
            </p>
          )}
        </div>

        {hasAnnual && (
          <StatementTable
            title="Annual"
            revenue={annualRevenue}
            netIncome={annualNetIncome}
            dilutedEps={annualDilutedEps}
          />
        )}

        {hasQuarterly && (
          <StatementTable
            title="Quarterly"
            revenue={quarterlyRevenue}
            netIncome={quarterlyNetIncome}
            dilutedEps={quarterlyDilutedEps}
          />
        )}

        {hasDividends && <DividendList dividends={dividends!} />}
      </CardContent>
    </Card>
  );
}
