import type { Metadata } from "next";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Table, TableBody, TableCell, TableHead, TableHeaderCell, TableRow } from "@/components/ui/table";
import { formatIndexLevel, IndexChangeBadge } from "@/components/finance/index-change-badge";
import { fetchLatestBseIndices } from "@/lib/finance/bseIndices";
import { formatIstSessionDate } from "@/lib/utils";

export const revalidate = 1800;

export const metadata: Metadata = {
  title: "BSE Indices — Daily Closing Levels | Predict Future",
  description:
    "Daily closing levels for every index published by the BSE (Bombay Stock Exchange), including SENSEX, BANKEX, and sector indices — informational only, not a trading surface.",
  alternates: { canonical: "https://predictfuture.app/bse-indices" },
  robots: { index: false, follow: true },
};

/**
 * BSE Expansion Phase 1 (2026-08-12) — the minimal browse surface this
 * phase ships instead of a slim per-index page: BSE's index universe hasn't
 * cleared the live-Yahoo-price-match bar a full `/instruments/[symbol]` page
 * requires (that's Phase 2's job — see the assigning brief), and the
 * `/indices/[slug]` route this app used to use for exactly this tier was
 * itself retired 2026-08-12 in favor of NSE's `/instruments/[symbol]`
 * pages, so re-creating that pattern here would resurrect a shape the
 * founder just asked to remove. This page is intentionally simple: one
 * table, real ingested data, a "View only" badge, no per-index drill-down —
 * honest about what Phase 1 actually has (a durable daily close, nothing
 * more yet), not a placeholder for something unbuilt.
 *
 * `noindex` for now: with zero backfilled history beyond what Phase 1's
 * bounded backfill script has run, per-index depth is thin; revisit once
 * the ~1-year backfill has actually run in prod (see the coordinator
 * runbook in this ticket's report).
 */
export default async function BseIndicesPage() {
  const indices = await fetchLatestBseIndices();

  return (
    <div className="space-y-8">
      <div>
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-3xl font-semibold text-ink-900">BSE Indices</h1>
          <Badge variant="default">View only</Badge>
        </div>
        <p className="mt-3 max-w-2xl text-sm leading-6 text-ink-500">
          Daily closing levels for every index the BSE (Bombay Stock Exchange) itself publishes — SENSEX,
          BANKEX, and the broader BSE sector/strategy index family. Informational only: no live intraday
          chart, no trading, no opinions linkage yet.
        </p>
      </div>

      {indices.length === 0 ? (
        <EmptyState
          title="No BSE index data yet"
          description="The daily ingestion cron hasn't run yet, or today's session hasn't published. Check back after market close."
        />
      ) : (
        <Card>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <Table>
                <TableHead>
                  <TableRow>
                    <TableHeaderCell>Index</TableHeaderCell>
                    <TableHeaderCell className="text-right">Close</TableHeaderCell>
                    <TableHeaderCell className="text-right">Change</TableHeaderCell>
                    <TableHeaderCell className="text-right">P/E</TableHeaderCell>
                    <TableHeaderCell className="text-right">Div. Yield</TableHeaderCell>
                    <TableHeaderCell className="text-right">As of</TableHeaderCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {indices.map((row) => (
                    <TableRow key={row.indexName}>
                      <TableCell className="font-medium text-ink-900">{row.indexName}</TableCell>
                      <TableCell className="text-right tabular-nums">{formatIndexLevel(row.close)}</TableCell>
                      <TableCell className="text-right">
                        <IndexChangeBadge changePercent={row.changePercent} />
                      </TableCell>
                      <TableCell className="text-right tabular-nums text-ink-500">
                        {row.peRatio != null ? row.peRatio.toFixed(2) : "—"}
                      </TableCell>
                      <TableCell className="text-right tabular-nums text-ink-500">
                        {row.dividendYield != null ? `${row.dividendYield.toFixed(2)}%` : "—"}
                      </TableCell>
                      <TableCell className="text-right text-ink-400">
                        {formatIstSessionDate(row.sessionDate)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
