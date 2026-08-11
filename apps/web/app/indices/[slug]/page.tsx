import { notFound, permanentRedirect } from "next/navigation";

import { deriveIndexSymbol } from "@predict-future/business-rules/finance/indexUniverse";

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
  const tradableUnderlying = tradableUnderlyingForIndexSlug(params.slug);
  if (tradableUnderlying) {
    permanentRedirect(`/instruments/${tradableUnderlying}`);
  }

  const index = await fetchIndexBySlug(params.slug);
  if (!index) {
    notFound();
  }

  permanentRedirect(`/instruments/${deriveIndexSymbol(index.name)}`);
}
