import type { MetadataRoute } from "next";

import { getPublicProfileStats } from "@/lib/finance/publicProfile";
import { listPublicEligiblePortfolioSlugsForSitemap } from "@/lib/portfolios/queries";
import { prisma } from "@/lib/prisma";

const SITE_URL = "https://predictfuture.app";

/**
 * The homepage, analyst directory, /opinions, /pulse, and indexable analyst
 * profiles ship here (Analyst Scorecard SEO layer). "Indexable" for an
 * analyst profile mirrors the exact same getPublicProfileStats().indexable
 * check used by app/analysts/[slug]'s own generateMetadata robots directive
 * and the /analysts directory listing — a URL only ever appears here if it's
 * also served as index,follow, so we never submit a noindex page to Google
 * via the sitemap.
 *
 * /opinions only ever lists its bare, unfiltered URL here — filtered/paginated
 * combinations are noindex (see app/opinions/page.tsx's generateMetadata) and
 * are never submitted, same reasoning as the analyst-profile gating above.
 *
 * /calls/[id] pages are intentionally excluded — they're noindex share artifacts,
 * not sitemap content.
 *
 * /instruments/[symbol] entries (Market Pulse Phase 2) are capped to symbols
 * with a quote in the MOST RECENT StockEodQuote session (~1,900-2,000 names,
 * not the full historical ~2k-per-session backlog) — mirrors the indexable
 * gating on that page itself (generateMetadata there noindexes any symbol
 * without a quote), so nothing submitted here is ever a noindex page.
 *
 * /portfolios/[slug] entries (Portfolios P3.2) are PUBLIC + eligible-for-ranking
 * only (isEligibleForPublicRanking) — a PUBLIC-but-too-new portfolio is still a
 * real, indexable page (app/portfolios/[slug]'s own robots directive doesn't
 * gate on eligibility), it's just not submitted to the sitemap until it has a
 * real track record, mirroring how /opinions only submits its bare URL.
 */
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const latestQuoteSession = await prisma.stockEodQuote.findFirst({
    orderBy: { sessionDate: "desc" },
    select: { sessionDate: true },
  });
  const instrumentRows = latestQuoteSession
    ? await prisma.stockEodQuote.findMany({
        where: { sessionDate: latestQuoteSession.sessionDate },
        select: { symbol: true },
      })
    : [];
  const instrumentEntries: MetadataRoute.Sitemap = instrumentRows.map((row) => ({
    url: `${SITE_URL}/instruments/${row.symbol}`,
    lastModified: latestQuoteSession!.sessionDate,
    changeFrequency: "daily",
    priority: 0.5,
  }));

  const experts = await prisma.expert.findMany({
    where: { slug: { not: null } },
    select: {
      slug: true,
      updatedAt: true,
      opinions: {
        where: { suppressedAt: null },
        select: { resolutionStatus: true, instrument: true, instrumentTicker: true },
      },
    },
  });

  const analystEntries: MetadataRoute.Sitemap = experts
    .filter((expert) => getPublicProfileStats(expert.opinions).indexable)
    .map((expert) => ({
      url: `${SITE_URL}/analysts/${expert.slug}`,
      lastModified: expert.updatedAt,
      changeFrequency: "daily",
      priority: 0.7,
    }));

  const eligiblePortfolios = await listPublicEligiblePortfolioSlugsForSitemap();
  const portfolioEntries: MetadataRoute.Sitemap = eligiblePortfolios.map((p) => ({
    url: `${SITE_URL}/portfolios/${p.slug}`,
    lastModified: p.lastModified,
    changeFrequency: "daily",
    priority: 0.6,
  }));

  return [
    {
      url: SITE_URL,
      lastModified: new Date(),
      changeFrequency: "hourly",
      priority: 1.0,
    },
    {
      url: `${SITE_URL}/analysts`,
      lastModified: new Date(),
      changeFrequency: "daily",
      priority: 0.8,
    },
    {
      url: `${SITE_URL}/opinions`,
      lastModified: new Date(),
      changeFrequency: "hourly",
      priority: 0.7,
    },
    {
      url: `${SITE_URL}/pulse`,
      lastModified: new Date(),
      changeFrequency: "hourly",
      priority: 0.6,
    },
    {
      url: `${SITE_URL}/portfolios`,
      lastModified: new Date(),
      changeFrequency: "daily",
      priority: 0.6,
    },
    ...analystEntries,
    ...instrumentEntries,
    ...portfolioEntries,
  ];
}
