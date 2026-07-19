import type { MetadataRoute } from "next";

/**
 * No robots.txt existed before this file — the site was fully open to crawl by
 * default. This formalizes that (allow "/") rather than narrowing it, and adds
 * explicit disallow rules only for routes that were never meant to be indexed
 * (API routes, the admin console). /analysts, /opinions, /pulse are covered by
 * the blanket allow; listed explicitly below for clarity since they're the
 * whole point of this file (the Analyst Scorecard's indexable surfaces).
 * Filtered/paginated /opinions URLs stay crawlable (follow) but noindex via
 * their own per-page robots meta, not via a disallow here.
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: ["/", "/analysts", "/opinions", "/pulse"],
        disallow: ["/api/", "/admin"],
      },
    ],
    sitemap: "https://predictfuture.app/sitemap.xml",
  };
}
