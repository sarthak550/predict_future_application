import { NextResponse } from "next/server";

import { getIndexBySlug } from "@/lib/marketMoves/allIndices";

export const dynamic = "force-dynamic";

/**
 * GET /api/finance/indices/[slug]
 *
 * Single-index detail, keyed by the slug getAllIndices() derives from NSE's
 * live index name (see allIndices.ts's slugifyIndexName doc). 404 when the
 * slug matches no index in the current live snapshot (unknown slug, typo,
 * or an index NSE has since renamed/delisted — no distinction is made,
 * both are "not found right now").
 *
 * Public, no auth. Cache-Control: public, max-age=60, same convention as the
 * list route.
 */
export async function GET(_request: Request, { params }: { params: { slug: string } }) {
  const rawSlug = params.slug;
  if (!rawSlug || typeof rawSlug !== "string" || rawSlug.trim().length === 0) {
    return NextResponse.json({ error: "Slug is required." }, { status: 400 });
  }

  const result = await getIndexBySlug(rawSlug);
  if (!result) {
    return NextResponse.json({ error: "Unknown index." }, { status: 404 });
  }

  const response = NextResponse.json({ asOf: result.asOf, ...result.row });
  response.headers.set("Cache-Control", "public, max-age=60");
  return response;
}
