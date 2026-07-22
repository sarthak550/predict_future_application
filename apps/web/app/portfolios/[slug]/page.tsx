import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { ModelPortfolioBadge } from "@/components/portfolios/model-portfolio-badge";
import { PortfolioDisclaimerFooter } from "@/components/portfolios/portfolio-disclaimer-footer";
import { PortfolioNavChart } from "@/components/portfolios/nav-chart";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeaderCell, TableRow } from "@/components/ui/table";
import { formatRupees, formatSignedPercent, formatSignedRupees } from "@/lib/portfolios/format";
import { getPortfolioDetailBySlug, type PortfolioDetail } from "@/lib/portfolios/queries";
import { formatDateOnly, formatIstSessionDate } from "@/lib/utils";

/**
 * Public, unauthenticated portfolio page. This is an ISR page that reads NO
 * session — a PRIVATE portfolio always 404s here, for owner and non-owner
 * alike. Owners view (and trade) their own PRIVATE portfolios exclusively via
 * the signed-in /portfolios/manage dashboard, never this route. See
 * getPortfolioDetailBySlug's doc comment for why viewerUserId is always null.
 */
export const revalidate = 900;

async function fetchPublicPortfolio(slug: string): Promise<PortfolioDetail | null> {
  const { access, detail } = await getPortfolioDetailBySlug(slug, null);
  if (access !== "public" || !detail) return null;
  return detail;
}

export async function generateMetadata({ params }: { params: { slug: string } }): Promise<Metadata> {
  const portfolio = await fetchPublicPortfolio(params.slug);

  if (!portfolio) {
    return { title: "Portfolio not found — Predict Future", robots: { index: false, follow: true } };
  }

  const title = `${portfolio.name} — Model Portfolio | Predict Future`;
  const description = `${portfolio.ownerLabel}'s model portfolio: ${formatSignedPercent(portfolio.live.returnPct)} since inception, ${formatRupees(portfolio.live.totalValue)} current value. Simulated ₹10,00,000 starting capital, real historical prices. Not investment advice.`;
  const url = `https://predictfuture.app/portfolios/${params.slug}`;

  return {
    title,
    description,
    alternates: { canonical: url },
    robots: { index: true, follow: true },
    openGraph: { title, description, type: "website", url },
    twitter: { card: "summary_large_image", title, description }
  };
}

export default async function PortfolioDetailPage({ params }: { params: { slug: string } }) {
  const portfolio = await fetchPublicPortfolio(params.slug);

  if (!portfolio) {
    notFound();
  }

  const isUp = portfolio.live.returnPct >= 0;

  return (
    <div className="space-y-8">
      <div className="space-y-3">
        <Card className="overflow-hidden border-0 bg-ink-900 text-white">
          <CardHeader>
            <div className="flex flex-wrap items-center gap-3">
              {portfolio.kind === "SHADOW" && (
                <Avatar name={portfolio.ownerLabel} src={portfolio.ownerAvatarUrl} className="h-12 w-12" />
              )}
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <CardTitle className="text-2xl text-white">{portfolio.name}</CardTitle>
                  <Badge className="bg-white/10 text-white">
                    {portfolio.kind === "SHADOW" ? "Auto-generated from graded calls" : "Community"}
                  </Badge>
                </div>
                <CardDescription className="text-white/70">
                  {portfolio.ownerHref ? (
                    <Link href={portfolio.ownerHref} className="hover:underline">
                      {portfolio.ownerLabel}
                    </Link>
                  ) : (
                    portfolio.ownerLabel
                  )}
                  {portfolio.ownerOrganization ? ` · ${portfolio.ownerOrganization}` : ""}
                </CardDescription>
              </div>
            </div>
            {portfolio.description && (
              <p className="mt-2 max-w-2xl text-sm leading-6 text-white/70">{portfolio.description}</p>
            )}
          </CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-4">
            <div className="rounded-[24px] bg-white/10 p-4">
              <p className="text-sm text-white/60">Current value</p>
              <p className="mt-2 text-xl font-semibold">{formatRupees(portfolio.live.totalValue)}</p>
            </div>
            <div className="rounded-[24px] bg-white/10 p-4">
              <p className="text-sm text-white/60">Return since inception</p>
              <p className={`mt-2 text-xl font-semibold ${isUp ? "text-emerald-400" : "text-rose-400"}`}>
                {formatSignedPercent(portfolio.live.returnPct)}
              </p>
            </div>
            <div className="rounded-[24px] bg-white/10 p-4">
              <p className="text-sm text-white/60">Cash</p>
              <p className="mt-2 text-xl font-semibold">{formatRupees(portfolio.live.cash)}</p>
            </div>
            <div className="rounded-[24px] bg-white/10 p-4">
              <p className="text-sm text-white/60">Holdings</p>
              <p className="mt-2 text-xl font-semibold">{portfolio.holdings.length}</p>
            </div>
          </CardContent>
        </Card>
        <ModelPortfolioBadge />
        {portfolio.publicSince && (
          <p className="text-xs text-ink-400">Made public on {formatDateOnly(portfolio.publicSince)}.</p>
        )}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Value over time</CardTitle>
          <CardDescription>
            Dashed line marks the ₹{portfolio.startingCapital.toLocaleString("en-IN")} starting capital.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <PortfolioNavChart
            points={portfolio.dailyValues.map((d) => ({ sessionDate: d.sessionDate, totalValue: d.totalValue }))}
            startingCapital={portfolio.startingCapital}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Holdings</CardTitle>
          <CardDescription>Current positions, priced at each symbol&apos;s latest known close.</CardDescription>
        </CardHeader>
        <CardContent>
          {portfolio.holdings.length === 0 ? (
            <p className="py-6 text-center text-sm text-ink-500">No open positions.</p>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHead>
                  <TableRow>
                    <TableHeaderCell>Symbol</TableHeaderCell>
                    <TableHeaderCell>Qty</TableHeaderCell>
                    <TableHeaderCell>Avg. cost</TableHeaderCell>
                    <TableHeaderCell>Latest close</TableHeaderCell>
                    <TableHeaderCell>Value</TableHeaderCell>
                    <TableHeaderCell>P&amp;L</TableHeaderCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {portfolio.holdings.map((h) => {
                    const value = h.latestClose != null ? h.quantity * h.latestClose : null;
                    const pnl = value != null ? value - h.costBasis : null;
                    return (
                      <TableRow key={h.symbol}>
                        <TableCell>
                          <Link href={`/instruments/${h.symbol}`} className="font-medium text-signal-sky hover:underline">
                            {h.symbol}
                          </Link>
                        </TableCell>
                        <TableCell>{h.quantity}</TableCell>
                        <TableCell>{formatRupees(h.avgCost)}</TableCell>
                        <TableCell>{h.latestClose != null ? formatRupees(h.latestClose) : "—"}</TableCell>
                        <TableCell>{value != null ? formatRupees(value) : "—"}</TableCell>
                        <TableCell className={pnl == null ? "" : pnl >= 0 ? "text-emerald-600" : "text-rose-600"}>
                          {pnl != null ? formatSignedRupees(pnl) : "—"}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Transaction history</CardTitle>
          <CardDescription>
            Immutable record of every filled or cancelled order. Newest first. Pending (unfilled) orders
            aren&apos;t shown publicly.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {portfolio.transactionHistory.length === 0 ? (
            <p className="py-6 text-center text-sm text-ink-500">No settled transactions yet.</p>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHead>
                  <TableRow>
                    <TableHeaderCell>Date</TableHeaderCell>
                    <TableHeaderCell>Side</TableHeaderCell>
                    <TableHeaderCell>Symbol</TableHeaderCell>
                    <TableHeaderCell>Qty</TableHeaderCell>
                    <TableHeaderCell>Price</TableHeaderCell>
                    <TableHeaderCell>Status</TableHeaderCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {portfolio.transactionHistory.map((tx) => (
                    <TableRow key={tx.id}>
                      <TableCell>{formatIstSessionDate(tx.executionSessionDate ?? tx.requestedAt)}</TableCell>
                      <TableCell>
                        <Badge variant={tx.side === "BUY" ? "success" : "danger"}>{tx.side}</Badge>
                      </TableCell>
                      <TableCell>
                        <Link href={`/instruments/${tx.symbol}`} className="font-medium text-signal-sky hover:underline">
                          {tx.symbol}
                        </Link>
                      </TableCell>
                      <TableCell>{tx.quantity}</TableCell>
                      <TableCell>{tx.priceAtTx != null ? formatRupees(tx.priceAtTx) : "—"}</TableCell>
                      <TableCell>
                        <Badge variant={tx.status === "EXECUTED" ? "success" : "default"}>{tx.status}</Badge>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      <PortfolioDisclaimerFooter />
    </div>
  );
}
