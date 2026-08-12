import type { MetadataRoute } from "next";

import { deriveIndexSymbol } from "@predict-future/business-rules/finance/indexUniverse";

import { fetchAllIndices } from "@/lib/finance/indices";
import { fetchLatestBseIndices } from "@/lib/finance/bseIndices";
import { INDEX_SLUG_TO_TRADABLE_UNDERLYING } from "@/lib/finance/indexTradableAlias";
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
 *
 * Index entries (Indices Consolidation, 2026-08-12) — `/indices/[slug]` now
 * 301(308)-redirects onward to `/instruments/[symbol]` (see that route's own
 * doc comment), so this sitemap submits the REDIRECT TARGET directly rather
 * than the old slug URL — submitting a page that immediately redirects would
 * waste crawl budget and dilute the ranking signal the target page should
 * get. Symbol resolution mirrors the search route's own identical logic:
 * the 5 tradable underlyings use their short mnemonic code (not derivable
 * from the full NSE name), every other index's code is
 * `deriveIndexSymbol(name)`. Sourced from the SAME live NSE fetch every
 * index surface uses (fetchAllIndices), so every index in the current
 * snapshot is covered; `fetchAllIndices` never throws (returns null on any
 * upstream failure), in which case these entries are simply omitted from
 * this particular sitemap generation, not a broken build.
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

  const allIndices = await fetchAllIndices();
  const now = new Date();
  const indexEntries: MetadataRoute.Sitemap = (allIndices?.indices ?? []).map((row) => {
    const tradableUnderlying = INDEX_SLUG_TO_TRADABLE_UNDERLYING[row.slug];
    const symbol = tradableUnderlying ?? deriveIndexSymbol(row.name);
    return {
      url: `${SITE_URL}/instruments/${symbol}`,
      lastModified: now,
      changeFrequency: "daily",
      priority: 0.4,
    };
  });

  // BSE Expansion Phase 2 (2026-08-12) — every BSE index now has a real
  // /instruments/[symbol] page too (self-owned BseIndexEodQuote history at
  // minimum, live Yahoo feed for the 18 BSE_INDEX_UNIVERSE ones), same
  // symbol-derivation rule as the NSE indexEntries above (deriveIndexSymbol,
  // reused not reimplemented). fetchLatestBseIndices never throws (empty
  // array before the cron has ever run), so this degrades to zero entries
  // rather than a broken sitemap build.
  const bseIndices = await fetchLatestBseIndices();
  const bseIndexEntries: MetadataRoute.Sitemap = bseIndices.map((row) => ({
    url: `${SITE_URL}/instruments/${deriveIndexSymbol(row.indexName)}`,
    lastModified: now,
    changeFrequency: "daily",
    priority: 0.4,
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
    {
      url: `${SITE_URL}/indices`,
      lastModified: new Date(),
      changeFrequency: "hourly",
      priority: 0.6,
    },
    ...analystEntries,
    ...instrumentEntries,
    ...portfolioEntries,
    ...indexEntries,
    ...bseIndexEntries,
  ];
}
