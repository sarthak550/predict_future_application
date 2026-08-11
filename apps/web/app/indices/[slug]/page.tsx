import { notFound, permanentRedirect } from "next/navigation";

import { deriveIndexSymbol } from "@predict-future/business-rules/finance/indexUniverse";
import { slugifyIndexName } from "@predict-future/business-rules/finance/indexSlug";

import { fetchIndexBySlug } from "@/lib/finance/indices";
import { tradableUnderlyingForIndexSlug } from "@/lib/finance/indexTradableAlias";

/**
 * Indices Consolidation (2026-08-12) — founder: "why do we have separate
 * indices page when everything is there in instrument page." The slim
 * per-index page (live level, day chart, 52-week range) is now strictly
 * subsumed by `/instruments/[symbol]` (Index History Stage 2, 2026-08-11,
 * gave every index a full instrument page — real daily OHLC at minimum,
 * plus now metrics + composition panels, see IndexMetricsPanel/
 * IndexCompositionPanel). Every stat this route used to render has a
 * verified new home there; see the consolidation ticket's report for the
 * field-by-field migration checklist.
 *
 * This route STAYS ALIVE as a redirect rather than being deleted — these
 * URLs are indexed (see sitemap.ts's historical /indices/[slug] entries,
 * now pointing at /instruments/[symbol] directly) and may still be linked
 * from outside this app. `permanentRedirect()` (Next.js's 308) is the
 * closest built-in equivalent to a 301: Next.js's App Router does not offer
 * a literal 301 status for a page-level redirect (`redirect()` itself is a
 * 307), and a 308 is treated identically to a 301 for SEO link-equity
 * purposes (both "permanent", both preserve the request method) — see
 * https://nextjs.org/docs/app/api-reference/functions/permanentRedirect.
 *
 * Slug -> symbol resolution mirrors indexLongTail.ts/the search route's own
 * logic exactly: the 5 tradable underlyings use their short mnemonic code
 * (not derivable from the full NSE name), every other index's code is the
 * pure `deriveIndexSymbol(name)` function. `notFound()` only when the slug
 * matches no index in the live allIndices snapshot at all (a genuinely
 * unknown/typo'd slug) — matches this route's pre-existing 404 behavior.
 */
export default async function IndexDetailRedirect({ params }: { params: { slug: string } }) {
  // Case-normalize BEFORE the tradable lookup — the homepage Economy tiles
  // (and any external links) use lowercase slugs ("/indices/nifty-50"),
  // while the alias map keys are uppercase. Without this, lowercase slugs
  // for the tradable 5 fell through to the generic name-derive path and
  // minted duplicate degraded pages (NIFTY50 instead of NIFTY, NIFTYBANK
  // instead of BANKNIFTY) — founder-reported 2026-08-12.
  const tradableUnderlying = tradableUnderlyingForIndexSlug(params.slug.toUpperCase());
  if (tradableUnderlying) {
    permanentRedirect(`/instruments/${tradableUnderlying}`);
  }

  const index = await fetchIndexBySlug(params.slug);
  if (!index) {
    notFound();
  }

  // Second guard on the same bug class: after resolving the index by (any-
  // case) slug, re-check its CANONICAL slug against the tradable alias so
  // no path ever mints a derived twin of a tradable underlying's page.
  const canonicalTradable = tradableUnderlyingForIndexSlug(slugifyIndexName(index.name));
  permanentRedirect(`/instruments/${canonicalTradable ?? deriveIndexSymbol(index.name)}`);
}
