import type { MetadataRoute } from "next";

/**
 * No robots.txt existed before this file — the site was fully open to crawl by
 * default. This formalizes that (allow "/") rather than narrowing it, and adds
 * explicit disallow rules only for routes that were never meant to be indexed
 * (API routes, the admin console). /analysts is covered by the blanket allow;
 * listed explicitly below for clarity since it's the whole point of this file.
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: ["/", "/analysts"],
        disallow: ["/api/", "/admin"],
      },
    ],
    sitemap: "https://predictfuture.app/sitemap.xml",
  };
}
