import type { Metadata } from "next";
import Link from "next/link";

import { CreatePortfolioCta } from "@/components/portfolios/create-portfolio-cta";
import { ModelPortfolioBadge } from "@/components/portfolios/model-portfolio-badge";
import { PortfolioCard } from "@/components/portfolios/portfolio-card";
import { PortfolioDisclaimerFooter } from "@/components/portfolios/portfolio-disclaimer-footer";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { listPublicPortfolios } from "@/lib/portfolios/queries";

export const revalidate = 900;

type KindFilter = "all" | "analysts" | "community";

export const metadata: Metadata = {
  title: "Model Portfolios — Simulated Paper-Trading Leaderboard | Predict Future",
  description:
    "Public model portfolios trading real historical prices with simulated ₹10,00,000 virtual capital — analyst-derived shadow portfolios and community portfolios, ranked by return since inception. Not investment advice.",
  alternates: { canonical: "https://predictfuture.app/portfolios" },
  openGraph: {
    title: "Model Portfolios — Predict Future",
    description: "Simulated paper-trading portfolios, ranked by return since inception. Not investment advice.",
    type: "website",
    url: "https://predictfuture.app/portfolios"
  }
};

function resolveKindFilter(value?: string): KindFilter {
  if (value === "analysts" || value === "community") return value;
  return "all";
}

export default async function PortfoliosDirectoryPage({
  searchParams
}: {
  searchParams?: { kind?: string };
}) {
  const kindFilter = resolveKindFilter(searchParams?.kind);
  const all = await listPublicPortfolios();

  const filtered = all.filter((p) => {
    if (kindFilter === "analysts") return p.kind === "SHADOW";
    if (kindFilter === "community") return p.kind === "USER";
    return true;
  });

  const ranked = filtered
    .filter((p) => p.eligible)
    .sort((a, b) => b.live.returnPct - a.live.returnPct);
  const tooNew = filtered
    .filter((p) => !p.eligible)
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());

  return (
    <div className="space-y-8">
      <div className="space-y-3">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="text-3xl font-semibold text-ink-900">Model Portfolios</h1>
            <p className="mt-3 max-w-2xl text-sm leading-6 text-ink-500">
              Every portfolio here trades a simulated ₹10,00,000 in virtual capital at real, historical
              closing prices. Analyst portfolios auto-track their graded calls; community portfolios are
              built by Predict Future users. Ranked by return since inception, once a portfolio has traded
              long enough to be meaningful.
            </p>
          </div>
          <CreatePortfolioCta />
        </div>
        <ModelPortfolioBadge />
      </div>

      <div className="flex flex-wrap gap-2">
        <Link href="/portfolios">
          <Badge variant={kindFilter === "all" ? "accent" : "default"}>All</Badge>
        </Link>
        <Link href="/portfolios?kind=analysts">
          <Badge variant={kindFilter === "analysts" ? "accent" : "default"}>Analysts</Badge>
        </Link>
        <Link href="/portfolios?kind=community">
          <Badge variant={kindFilter === "community" ? "accent" : "default"}>Community</Badge>
        </Link>
      </div>

      <section className="space-y-4">
        <h2 className="text-xl font-semibold text-ink-900">Ranked by return</h2>
        {ranked.length === 0 ? (
          <Card>
            <CardContent className="p-8 text-center text-sm text-ink-500">
              No portfolios have traded long enough to rank yet. Check back soon, or see the portfolios
              below that are still building a track record.
            </CardContent>
          </Card>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2">
            {ranked.map((p, i) => (
              <PortfolioCard
                key={p.id}
                slug={p.slug}
                name={p.name}
                kind={p.kind}
                ownerLabel={p.ownerLabel}
                ownerHref={p.ownerHref}
                ownerOrganization={p.ownerOrganization}
                ownerAvatarUrl={p.ownerAvatarUrl}
                returnPct={p.live.returnPct}
                totalValue={p.live.totalValue}
                createdAt={p.createdAt}
                rank={i + 1}
              />
            ))}
          </div>
        )}
      </section>

      {tooNew.length > 0 && (
        <section className="space-y-4">
          <div>
            <h2 className="text-xl font-semibold text-ink-900">Too new to rank</h2>
            <p className="mt-1 text-sm text-ink-500">
              Newest first. A portfolio needs a 30-day-old track record and at least 3 settled trades
              before it&apos;s eligible for the ranked leaderboard above.
            </p>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            {tooNew.map((p) => (
              <PortfolioCard
                key={p.id}
                slug={p.slug}
                name={p.name}
                kind={p.kind}
                ownerLabel={p.ownerLabel}
                ownerHref={p.ownerHref}
                ownerOrganization={p.ownerOrganization}
                ownerAvatarUrl={p.ownerAvatarUrl}
                returnPct={p.live.returnPct}
                totalValue={p.live.totalValue}
                createdAt={p.createdAt}
              />
            ))}
          </div>
        </section>
      )}

      <PortfolioDisclaimerFooter />
    </div>
  );
}
