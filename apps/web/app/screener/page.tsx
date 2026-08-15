import type { Metadata } from "next";
import Link from "next/link";

import { ScreenerFilterBar } from "@/components/finance/screener-filter-bar";
import { AnalystDisclaimerFooter } from "@/components/finance/disclaimer-footer";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeaderCell, TableRow } from "@/components/ui/table";
import { fetchScreenerRows, parseScreenerFilters, windowDays, type ScreenerRow } from "@/lib/finance/screenerQuery";
import { formatCompactCurrency } from "@/lib/utils";

export const metadata: Metadata = {
  title: "Screener — Predict Future",
  description:
    "Rank instruments by graded analyst call signal — bull/bear/neutral call counts, distinct-analyst coverage, and an accuracy-weighted sentiment score, filterable by time window and sector.",
  // Every filter combination is a near-duplicate of the base page from a
  // search engine's perspective, same reasoning /opinions applies.
  robots: { index: false, follow: true },
};

type SearchParams = Record<string, string | string[] | undefined>;

function formatScore(score: number | null): { label: string; className: string } {
  if (score === null) {
    return { label: "Insufficient track record", className: "text-xs text-ink-400" };
  }
  const pct = Math.round(score * 100);
  const sign = pct > 0 ? "+" : "";
  const className = pct > 0 ? "text-emerald-600" : pct < 0 ? "text-rose-600" : "text-ink-500";
  return { label: `${sign}${pct}`, className: `text-sm font-semibold ${className}` };
}

function InstrumentCell({ row }: { row: ScreenerRow }) {
  const inner = (
    <>
      <p className="font-medium text-ink-900">{row.displayName}</p>
      {row.symbol && row.symbol !== row.displayName && <p className="text-xs text-ink-400">{row.symbol}</p>}
    </>
  );
  return row.symbol ? (
    <Link href={`/instruments/${row.symbol}`} className="block hover:text-signal-sky">
      {inner}
    </Link>
  ) : (
    <div>{inner}</div>
  );
}

export default async function ScreenerPage({ searchParams }: { searchParams: SearchParams }) {
  const filters = parseScreenerFilters(searchParams);
  const rows = await fetchScreenerRows(filters);
  const days = windowDays(filters.window);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-semibold text-ink-900">Screener</h1>
        <p className="mt-3 max-w-3xl text-sm leading-6 text-ink-500">
          Rank instruments by graded analyst call signal, not just price technicals. The{" "}
          <span className="font-medium text-ink-700">Score</span> column weights each graded bullish/bearish call by
          its author&rsquo;s own all-time accuracy (95% CI lower bound) — a bullish call from a proven analyst counts
          more than one from an unproven analyst. Range −100 to +100; instruments with fewer than 3 graded directional
          calls in the window show &ldquo;Insufficient track record&rdquo; instead of a score.
        </p>
      </div>

      <ScreenerFilterBar />

      {rows.length === 0 ? (
        <Card>
          <CardContent className="p-8 text-center text-sm text-ink-500">
            No instruments have any analyst calls in the last {days} days matching these filters. Try widening the
            window or clearing a filter.
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="overflow-x-auto p-0">
            <Table>
              <TableHead>
                <TableRow>
                  <TableHeaderCell>Instrument</TableHeaderCell>
                  <TableHeaderCell>Sector</TableHeaderCell>
                  <TableHeaderCell className="text-right">Bullish</TableHeaderCell>
                  <TableHeaderCell className="text-right">Bearish</TableHeaderCell>
                  <TableHeaderCell className="text-right">Neutral</TableHeaderCell>
                  <TableHeaderCell className="text-right">Analysts</TableHeaderCell>
                  <TableHeaderCell className="text-right">Score</TableHeaderCell>
                  <TableHeaderCell className="text-right">Mkt cap</TableHeaderCell>
                  <TableHeaderCell className="text-right">P/E</TableHeaderCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {rows.map((row) => {
                  const score = formatScore(row.score);
                  return (
                    <TableRow key={row.ticker}>
                      <TableCell>
                        <InstrumentCell row={row} />
                      </TableCell>
                      <TableCell className="text-ink-500">{row.sector ?? "—"}</TableCell>
                      <TableCell className="text-right text-emerald-600">{row.bullishCount}</TableCell>
                      <TableCell className="text-right text-rose-600">{row.bearishCount}</TableCell>
                      <TableCell className="text-right text-ink-500">{row.neutralCount}</TableCell>
                      <TableCell className="text-right text-ink-700">{row.distinctAnalystCount}</TableCell>
                      <TableCell className={`text-right ${score.className}`}>{score.label}</TableCell>
                      <TableCell className="text-right text-ink-500">
                        {row.marketCap != null ? formatCompactCurrency(row.marketCap) : "—"}
                      </TableCell>
                      <TableCell className="text-right text-ink-500">
                        {row.trailingPE != null ? row.trailingPE.toFixed(1) : "—"}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      <AnalystDisclaimerFooter />
    </div>
  );
}
