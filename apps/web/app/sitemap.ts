import type { MetadataRoute } from "next";

import { getPublicProfileStats } from "@/lib/finance/publicProfile";
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
 */
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
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
    ...analystEntries,
  ];
}
