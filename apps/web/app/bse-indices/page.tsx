import type { Metadata } from "next";
import Link from "next/link";

import { deriveIndexSymbol } from "@predict-future/business-rules/finance/indexUniverse";

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
 * phase shipped instead of a slim per-index page: BSE's index universe
 * hadn't cleared the live-Yahoo-price-match bar a full `/instruments/[symbol]`
 * page requires. The `/indices/[slug]` route this app used to use for
 * exactly this tier was itself retired 2026-08-12 in favor of NSE's
 * `/instruments/[symbol]` pages, so re-creating that pattern here would have
 * resurrected a shape the founder just asked to remove.
 *
 * BSE Expansion Phase 2 (2026-08-12) — every BSE index now HAS a full
 * `/instruments/[symbol]` page (self-owned BseIndexEodQuote history at
 * minimum, a live 1D intraday pipe for the 18 BSE_INDEX_UNIVERSE
 * Yahoo-verified ones — see business-rules/bseIndexUniverse.ts). This
 * directory now links every row onward, same "browse hub -> full page"
 * pattern /indices used before its own retirement — the table itself stays
 * (a flat, sortable-by-eye overview is still useful even once every row has
 * its own page), it just isn't a dead end anymore.
 *
 * `noindex` unchanged for now: the directory's own SEO value is thin next to
 * the 133 real instrument pages it now links to, which are themselves
 * indexable once they carry a quote (see /instruments/[symbol]'s own
 * generateMetadata robots directive) — no reason to compete with them for
 * the same query.
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
          BANKEX, and the broader BSE sector/strategy index family. Informational only, not a trading
          surface. Tap any index for its full price history, live level (where available) and analyst
          opinions.
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
                      <TableCell className="font-medium text-ink-900">
                        <Link
                          href={`/instruments/${deriveIndexSymbol(row.indexName)}`}
                          className="text-ink-900 hover:underline"
                        >
                          {row.indexName}
                        </Link>
                      </TableCell>
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
